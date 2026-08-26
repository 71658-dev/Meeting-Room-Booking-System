import { Hono } from 'hono';
import { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { readJsonBody, INVALID_JSON_ERROR } from '../middleware/security';
import { writeAuditLog } from '../middleware/audit';
import { sendReservationEmail } from '../services/email';
import { HonoEnv, DBReservation, ReservationWithDetails, Role } from '../types';
import { isPastSlot, timeStrToMin, minToTimeStr } from '../../shared/time';

const resApp = new Hono<HonoEnv>();

/**
 * Past bookings are read-only apart from cancellation.
 *
 * Enforced here rather than only in the UI for the same reason the overlap check is: the
 * client is a convenience, and anything that can be reached with curl has to hold on the
 * server. Cancelling stays open — a meeting that did not happen still needs to be struck
 * from the record, and DELETE keeps its own permission gate.
 */
const PAST_CREATE_MESSAGE = '不可預約已過去的時段，請改選今天稍後或未來的時間';
const PAST_EDIT_MESSAGE = '此預約已經開始，僅能瀏覽或取消，不可再修改';

/**
 * Who may edit / cancel / re-notify a booking.
 *
 * Deliberately the same shape as the user-management matrix in routes/users.ts:
 * staff touch only their own records, admin additionally covers staff, superadmin covers
 * everyone. Before this, any admin could rewrite a superadmin's booking — the two gates
 * disagreeing is how "admin" quietly comes to mean something different per resource.
 *
 * The owner's role must come from the users table on every call. Never accept it from the
 * request or from a cached client copy.
 */
export function canManageReservation(
  actor: { id: string; role: Role },
  ownerId: string,
  ownerRole: Role
): boolean {
  if (actor.id === ownerId) return true;
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin') return ownerRole === 'staff';
  return false;
}

const FORBIDDEN_MESSAGE = '您沒有權限異動此預約（僅限本人，或由管理者處理所轄同仁的預約）';

/**
 * Overlap rule, in one place: existing.start < new.end AND existing.end > new.start.
 *
 * Only ever called *after* an atomic write has already refused to go through, to put a
 * name and a time on the booking that won. It is not the check itself — reading it and
 * then deciding is what created the race this replaced.
 */
async function findConflict(
  db: D1Database,
  roomId: string,
  date: string,
  startMin: number,
  endMin: number,
  excludeId?: string
): Promise<any | null> {
  return db
    .prepare(
      `SELECT r.*, rm.name as room_name, u.name as user_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       WHERE r.room_id = ? AND r.date = ? AND r.status = 'active'
         AND r.start_min < ? AND r.end_min > ?
         AND r.id != ?`
    )
    .bind(roomId, date, endMin, startMin, excludeId ?? '')
    .first<any>();
}

/**
 * The room a booking names has to be a real, bookable room.
 *
 * `roomId` arrived straight from the request and went into the INSERT unchecked. D1 does
 * not enforce foreign keys by default, so a caller could file a booking against a room id
 * that does not exist, or against one an admin had deliberately deactivated. Neither is
 * caught later: the listing endpoints INNER JOIN `rooms`, so such a row is invisible in
 * every view while still occupying its slot in the overlap check — a booking nobody can
 * see, cancel, or find the owner of.
 *
 * Returns an error message, or null when the room is usable.
 */
async function assertBookableRoom(db: D1Database, roomId: string): Promise<string | null> {
  const room = await db
    .prepare(`SELECT id, is_active FROM rooms WHERE id = ?`)
    .bind(roomId)
    .first<any>();

  if (!room) return '指定的會議室不存在';
  if (room.is_active !== 1) return '此會議室已停用，無法預約';
  return null;
}

/**
 * Rewrite a booking's equipment links from a client-supplied id list.
 *
 * Two things are enforced here that were not before:
 *
 *  - the ids are filtered against `equipment` (active rows only), so a caller cannot
 *    write arbitrary strings into `reservation_equipment`. The rows are unreachable via
 *    the JOIN in the listing, so they were pure unbounded storage under caller control —
 *    50 per request, with nothing to garbage-collect them.
 *  - duplicates are removed. PATCH inserted each element of the array with a bare
 *    `INSERT`, so `equipmentIds: ['eq-1', 'eq-1']` hit the composite primary key and the
 *    whole request came back as a 500 *after* the booking had already been updated.
 */
async function replaceEquipmentLinks(
  db: D1Database,
  reservationId: string,
  equipmentIds: string[] | undefined,
  clearFirst: boolean
): Promise<void> {
  if (clearFirst) {
    await db.prepare(`DELETE FROM reservation_equipment WHERE reservation_id = ?`).bind(reservationId).run();
  }

  const requested = Array.from(new Set(equipmentIds || []));
  if (requested.length === 0) return;

  const placeholders = requested.map(() => '?').join(',');
  const known = await db
    .prepare(`SELECT id FROM equipment WHERE is_active = 1 AND id IN (${placeholders})`)
    .bind(...requested)
    .all<any>();

  const valid = (known.results || []).map((row: any) => row.id);
  if (valid.length === 0) return;

  await db.batch(
    valid.map((eqId: string) =>
      db
        .prepare(`INSERT OR IGNORE INTO reservation_equipment (reservation_id, equipment_id) VALUES (?, ?)`)
        .bind(reservationId, eqId)
    )
  );
}

/**
 * The 409 body. Create and edit must produce the same `conflict` shape — the client
 * renders one dialog for both, and it can only name the clashing booking if they agree.
 */
function conflictResponse(c: any, row: any | null, mode: 'create' | 'update') {
  const lead = mode === 'create' ? '預約時段與既有預約衝突！' : '修改後的時間與既有預約衝突！';

  // The losing write is authoritative even when the row cannot be re-read: by the time we
  // look, the booking that beat us may itself have been cancelled. Refusing is still
  // correct — reporting a conflict we can no longer describe beats inventing one.
  if (!row) {
    return c.json({ success: false, error: `${lead}請重新整理後再試一次` }, 409);
  }

  const timeStr = `${minToTimeStr(row.start_min)} ~ ${minToTimeStr(row.end_min)}`;
  return c.json(
    {
      success: false,
      error: `${lead}「${row.room_name}」於 ${timeStr} 已被 ${row.user_name} 預約`,
      conflict: {
        id: row.id,
        roomName: row.room_name,
        date: row.date,
        userName: row.user_name,
        reason: row.reason,
        startTime: minToTimeStr(row.start_min),
        endTime: minToTimeStr(row.end_min),
      },
    },
    409
  );
}

// Re-exported so existing importers (and the tests) keep their current entry point while
// the implementation lives in src/shared, where the client can reach it too.
export { timeStrToMin, minToTimeStr };

/**
 * Upper bounds on the free-text fields.
 *
 * Not cosmetic: these values are written to D1 and interpolated into outbound mail, so
 * without a ceiling one authenticated account can inflate both storage and per-message
 * send cost with a single request. passwordPolicy.ts already caps password length for the
 * same reason (there, to stop PBKDF2 being used to burn CPU); the booking fields were
 * simply never given the same treatment.
 *
 * The limits are generous against real use — a 事由 is a sentence, 備註 a short paragraph
 * — so they bite only on abuse, not on a long-winded booking.
 */
const MAX_REASON = 200;
const MAX_NOTES = 2000;
const MAX_ATTENDEES_EMAIL = 2000;
const MAX_HEADCOUNT = 500;
const MAX_EQUIPMENT_ITEMS = 50;

const reservationInputSchema = z.object({
  id: z.string().optional(),
  roomId: z.string().min(1, '請選擇會議室'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必須為 YYYY-MM-DD'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, '開始時間格式必須為 HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, '結束時間格式必須為 HH:mm'),
  reason: z.string().min(1, '請輸入會議事由').max(MAX_REASON, `會議事由不得超過 ${MAX_REASON} 個字`),
  meetingType: z.enum(['internal', 'external', 'department', 'other']).default('internal'),
  headcount: z
    .number()
    .int()
    .min(1)
    .max(MAX_HEADCOUNT, `與會人數不得超過 ${MAX_HEADCOUNT} 人`)
    .default(1),
  notes: z.string().max(MAX_NOTES, `備註不得超過 ${MAX_NOTES} 個字`).optional().nullable(),
  attendeesEmail: z
    .string()
    .max(MAX_ATTENDEES_EMAIL, `與會者信箱欄位不得超過 ${MAX_ATTENDEES_EMAIL} 個字`)
    .optional()
    .nullable(),
  equipmentIds: z
    .array(z.string().max(100))
    .max(MAX_EQUIPMENT_ITEMS, `設備項目過多`)
    .optional()
    .default([]),
  sendEmail: z.boolean().optional().default(false),
});

// GET /api/reservations - List reservations (authentication REQUIRED)
// This endpoint returns personally identifiable data (登記人姓名、事由、備註、與會者信箱).
// Unauthenticated callers must use GET /api/public/schedule, which is de-identified by design.
/**
 * No default date window here, deliberately — an unqualified request means every booking,
 * because StatsView is built on exactly that and a silently narrowed window would make
 * 總預約次數 / 總時數 quietly wrong rather than visibly limited. `from`/`to` stay pure
 * filters, applied only when the caller sends them.
 *
 * MAX_ROWS is a backstop against the response itself becoming unbounded, not a window: it
 * is set far above any plausible real total (two rooms, one agency), and when it does bite
 * the response says so via `truncated` instead of handing back a short list that looks
 * complete. A caller that hits it should page with `from`/`to`.
 *
 * The read-amplification this endpoint was flagged for is addressed by the batched
 * equipment lookup below — that turned a listing of N bookings from N+1 round-trips into
 * two — rather than by refusing to answer the question the UI actually asks.
 *
 * /api/public/schedule keeps its window. That one is unauthenticated, which is a different
 * problem: there, "everything ever" is free for anyone to harvest.
 */
const MAX_ROWS = 5000;

resApp.get('/', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const { from, to, roomId, deptId, mine } = c.req.query();

  let query = `
    SELECT r.*, rm.name as room_name, rm.color_key as room_color,
           u.name as user_name, u.ext as user_ext, u.role as owner_role, u.dept_id, d.name as dept_name
    FROM reservations r
    JOIN rooms rm ON r.room_id = rm.id
    JOIN users u ON r.user_id = u.id
    LEFT JOIN departments d ON u.dept_id = d.id
    WHERE r.status = 'active'
  `;
  const params: any[] = [];

  if (from) {
    query += ` AND r.date >= ?`;
    params.push(from);
  }
  if (to) {
    query += ` AND r.date <= ?`;
    params.push(to);
  }
  if (roomId) {
    query += ` AND r.room_id = ?`;
    params.push(roomId);
  }
  if (deptId) {
    query += ` AND u.dept_id = ?`;
    params.push(deptId);
  }
  if (mine === 'true') {
    query += ` AND r.user_id = ?`;
    params.push(user.id);
  }

  // One over MAX_ROWS, so hitting the cap is distinguishable from landing exactly on it.
  query += ` ORDER BY r.date ASC, r.start_min ASC LIMIT ?`;
  params.push(MAX_ROWS + 1);

  const rows = await c.env.DB.prepare(query).bind(...params).all<any>();
  const all = rows.results || [];
  const truncated = all.length > MAX_ROWS;
  const results = truncated ? all.slice(0, MAX_ROWS) : all;

  // One query for all the equipment, grouped in memory.
  //
  // This was a subquery per row inside the loop, so a listing of N bookings cost N+1 D1
  // round-trips — the same request that had no date ceiling on it. The placeholders are
  // generated from the row count, never from request data; the ids themselves are bound.
  const equipmentByReservation = new Map<string, { ids: string[]; names: string[] }>();
  if (results.length > 0) {
    const placeholders = results.map(() => '?').join(',');
    const eqRows = await c.env.DB
      .prepare(
        `SELECT re.reservation_id, eq.id, eq.name
         FROM reservation_equipment re
         JOIN equipment eq ON re.equipment_id = eq.id
         WHERE re.reservation_id IN (${placeholders})`
      )
      .bind(...results.map((r: any) => r.id))
      .all<any>();

    for (const e of eqRows.results || []) {
      const entry = equipmentByReservation.get(e.reservation_id) || { ids: [], names: [] };
      entry.ids.push(e.id);
      entry.names.push(e.name);
      equipmentByReservation.set(e.reservation_id, entry);
    }
  }

  const reservations: ReservationWithDetails[] = results.map((row: any) => {
    const equipment = equipmentByReservation.get(row.id) || { ids: [], names: [] };

    // owner_role is stripped: it is only here to resolve can_manage. Shipping it would tell
    // every member of staff exactly which colleagues hold admin, which the client never needs.
    const { owner_role: ownerRole, ...rest } = row;

    return {
      ...rest,
      equipment_ids: equipment.ids,
      equipment_names: equipment.names,
      start_time: minToTimeStr(row.start_min),
      end_time: minToTimeStr(row.end_min),
      can_manage: canManageReservation(user, row.user_id, ownerRole as Role),
    };
  });

  // `truncated` is part of the contract, not diagnostics: StatsView totals every row it
  // receives, so a caller that cannot tell a capped list from a complete one would report
  // a confidently wrong number.
  return c.json({ success: true, reservations, truncated });
});

// POST /api/reservations - Create reservation with atomic conflict check
resApp.post('/', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = reservationInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { roomId, date, startTime, endTime, reason, meetingType, headcount, notes, attendeesEmail, equipmentIds, sendEmail } = parsed.data;

  const startMin = timeStrToMin(startTime);
  const endMin = timeStrToMin(endTime);

  if (endMin <= startMin) {
    return c.json({ success: false, error: '結束時間必須晚於開始時間' }, 400);
  }

  if (isPastSlot(date, startMin)) {
    return c.json({ success: false, error: PAST_CREATE_MESSAGE }, 400);
  }

  const roomError = await assertBookableRoom(c.env.DB, roomId);
  if (roomError) {
    return c.json({ success: false, error: roomError }, 400);
  }

  // Generate ID and insert
  const resId = `res-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const nowStr = new Date().toISOString();

  // Conflict check and insert are ONE statement, on purpose.
  //
  // This used to be a SELECT followed by a separate INSERT with nothing between them —
  // no transaction, and no UNIQUE constraint on the table to catch what slipped past. Two
  // requests could both read "free" and both write, double-booking the room. The window
  // was only as wide as one D1 round-trip, but "two people grabbing the same room at the
  // same moment" is precisely the traffic that aims for it. The comment here claimed
  // ATOMIC while the code was not, which is the failure mode the last review called out.
  //
  // `INSERT ... SELECT ... WHERE NOT EXISTS` is evaluated as a single SQLite statement, so
  // the overlap test and the write cannot be separated. `changes === 0` means the guard
  // fired; the losing request then reads the row it lost to, only to name it in the error.
  const insert = await c.env.DB
    .prepare(
      `INSERT INTO reservations (id, room_id, user_id, date, start_min, end_min, reason, meeting_type, headcount, notes, attendees_email, status, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM reservations
         WHERE room_id = ? AND date = ? AND status = 'active'
           AND start_min < ? AND end_min > ?
       )`
    )
    .bind(
      resId, roomId, user.id, date, startMin, endMin, reason, meetingType, headcount,
      notes || null, attendeesEmail || null, nowStr, nowStr,
      roomId, date, endMin, startMin
    )
    .run();

  if (!insert.meta.changes) {
    return conflictResponse(c, await findConflict(c.env.DB, roomId, date, startMin, endMin), 'create');
  }

  // Insert equipment relations, restricted to ids that actually exist and are active.
  await replaceEquipmentLinks(c.env.DB, resId, equipmentIds, false);

  await writeAuditLog(c.env.DB, user.id, 'CREATE_RESERVATION', 'reservation', resId, null, { roomId, date, startTime, endTime, reason }, c.get('clientIp'));

  // Get room info for return and email
  const roomRow = await c.env.DB.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(roomId).first<any>();
  const roomName = roomRow ? roomRow.name : roomId;

  let emailStatus: any = null;
  if (sendEmail) {
    emailStatus = await sendReservationEmail(
      c.env,
      user.id,
      user.email,
      attendeesEmail || undefined,
      {
        id: resId,
        roomName,
        date,
        startTime,
        endTime,
        reason,
        dept: user.dept_name || user.dept_id,
        userName: user.name,
        ext: user.ext,
        notes: notes || undefined,
      },
      'create'
    );
  }

  return c.json({
    success: true,
    message: '預約成功',
    reservationId: resId,
    emailStatus,
  });
});

// PATCH /api/reservations/:id - Update reservation
resApp.patch('/:id', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const resId = c.req.param('id');
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = reservationInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const row = await c.env.DB
    .prepare(
      `SELECT r.*, u.role as owner_role FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.id = ?`
    )
    .bind(resId)
    .first<any>();
  if (!row || row.status !== 'active') {
    return c.json({ success: false, error: '預約不存在或已被取消' }, 404);
  }

  // owner_role is kept out of `existing` so it never leaks into the audit log's before_json.
  const { owner_role: ownerRole, ...existing } = row;

  if (!canManageReservation(user, existing.user_id, ownerRole as Role)) {
    return c.json({ success: false, error: FORBIDDEN_MESSAGE }, 403);
  }

  // A booking that has already begun is history. Editing it would rewrite what the room
  // was actually used for, which is exactly what the audit log exists to prevent.
  if (isPastSlot(existing.date, existing.start_min)) {
    return c.json({ success: false, error: PAST_EDIT_MESSAGE }, 400);
  }

  const data = parsed.data;
  const roomId = data.roomId || existing.room_id;
  const date = data.date || existing.date;
  const startTime = data.startTime || minToTimeStr(existing.start_min);
  const endTime = data.endTime || minToTimeStr(existing.end_min);
  const startMin = timeStrToMin(startTime);
  const endMin = timeStrToMin(endTime);

  if (endMin <= startMin) {
    return c.json({ success: false, error: '結束時間必須晚於開始時間' }, 400);
  }

  // ...and it must not be moved backwards into the past either, which would otherwise be
  // a way around the create-side check.
  if (isPastSlot(date, startMin)) {
    return c.json({ success: false, error: PAST_CREATE_MESSAGE }, 400);
  }

  // Only when the room is actually being moved: an existing booking whose room was
  // deactivated afterwards must still be editable (and cancellable) by its owner.
  if (data.roomId && data.roomId !== existing.room_id) {
    const roomError = await assertBookableRoom(c.env.DB, roomId);
    if (roomError) {
      return c.json({ success: false, error: roomError }, 400);
    }
  }

  const nowStr = new Date().toISOString();

  // Same single-statement guard as POST: the overlap test rides along in the UPDATE's
  // WHERE clause, so no concurrent write can land between checking and moving the
  // booking. `NOT EXISTS` excludes this row, since a booking never conflicts with itself.
  const update = await c.env.DB
    .prepare(
      `UPDATE reservations
       SET room_id = ?, date = ?, start_min = ?, end_min = ?, reason = ?, meeting_type = ?,
           headcount = ?, notes = ?, attendees_email = ?, updated_at = ?
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1 FROM reservations
           WHERE room_id = ? AND date = ? AND status = 'active'
             AND start_min < ? AND end_min > ?
             AND id != ?
         )`
    )
    .bind(
      roomId,
      date,
      startMin,
      endMin,
      data.reason || existing.reason,
      data.meetingType || existing.meeting_type,
      data.headcount ?? existing.headcount,
      data.notes !== undefined ? data.notes : existing.notes,
      data.attendeesEmail !== undefined ? data.attendeesEmail : existing.attendees_email,
      nowStr,
      resId,
      roomId, date, endMin, startMin, resId
    )
    .run();

  if (!update.meta.changes) {
    return conflictResponse(c, await findConflict(c.env.DB, roomId, date, startMin, endMin, resId), 'update');
  }

  // Update equipment relations if provided
  if (data.equipmentIds) {
    await replaceEquipmentLinks(c.env.DB, resId, data.equipmentIds, true);
  }

  await writeAuditLog(c.env.DB, user.id, 'UPDATE_RESERVATION', 'reservation', resId, existing, data, c.get('clientIp'));

  let emailStatus: any = null;
  if (data.sendEmail) {
    const roomRow = await c.env.DB.prepare(`SELECT name FROM rooms WHERE id = ?`).bind(roomId).first<any>();
    emailStatus = await sendReservationEmail(
      c.env,
      user.id,
      user.email,
      data.attendeesEmail || existing.attendees_email || undefined,
      {
        id: resId,
        roomName: roomRow ? roomRow.name : roomId,
        date,
        startTime,
        endTime,
        reason: data.reason || existing.reason,
        dept: user.dept_name || user.dept_id,
        userName: user.name,
        ext: user.ext,
        notes: data.notes || existing.notes || undefined,
      },
      'update'
    );
  }

  return c.json({ success: true, message: '預約修改成功', emailStatus });
});

// DELETE /api/reservations/:id - Soft delete (Cancel)
resApp.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const resId = c.req.param('id');

  const row = await c.env.DB
    .prepare(
      `SELECT r.*, u.role as owner_role FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.id = ?`
    )
    .bind(resId)
    .first<any>();
  if (!row || row.status !== 'active') {
    return c.json({ success: false, error: '預約不存在或已取消' }, 404);
  }

  const { owner_role: ownerRole, ...existing } = row;

  if (!canManageReservation(user, existing.user_id, ownerRole as Role)) {
    return c.json({ success: false, error: FORBIDDEN_MESSAGE }, 403);
  }

  const nowStr = new Date().toISOString();
  await c.env.DB
    .prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ?`)
    .bind(nowStr, user.id, nowStr, resId)
    .run();

  await writeAuditLog(c.env.DB, user.id, 'CANCEL_RESERVATION', 'reservation', resId, existing, null, c.get('clientIp'));

  return c.json({ success: true, message: '預約已成功取消' });
});

// POST /api/reservations/:id/notify - Resend email notification
resApp.post('/:id/notify', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const resId = c.req.param('id');

  const existing = await c.env.DB
    .prepare(
      `SELECT r.*, rm.name as room_name, u.name as user_name, u.ext as user_ext,
              u.role as owner_role, d.name as dept_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       LEFT JOIN departments d ON u.dept_id = d.id
       WHERE r.id = ? AND r.status = 'active'`
    )
    .bind(resId)
    .first<any>();

  if (!existing) {
    return c.json({ success: false, error: '預約不存在或已被取消' }, 404);
  }

  // Same gate as PATCH/DELETE. A resend mails the booking out under the agency's sending
  // domain, so leaving it open to any authenticated account made it a spam lever against
  // whatever address sits in attendees_email.
  if (!canManageReservation(user, existing.user_id, existing.owner_role as Role)) {
    return c.json({ success: false, error: FORBIDDEN_MESSAGE }, 403);
  }

  const emailResult = await sendReservationEmail(
    c.env,
    user.id,
    user.email,
    existing.attendees_email || undefined,
    {
      id: resId,
      roomName: existing.room_name,
      date: existing.date,
      startTime: minToTimeStr(existing.start_min),
      endTime: minToTimeStr(existing.end_min),
      reason: existing.reason,
      dept: existing.dept_name || user.dept_id,
      userName: existing.user_name,
      ext: existing.user_ext,
      notes: existing.notes || undefined,
    },
    'notify'
  );

  return c.json(emailResult);
});

export default resApp;
