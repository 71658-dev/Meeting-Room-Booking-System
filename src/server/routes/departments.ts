import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole, optionalAuthMiddleware } from '../middleware/auth';
import { writeAuditLog } from '../middleware/audit';
import { HonoEnv } from '../types';

const deptsApp = new Hono<HonoEnv>();

/**
 * Readable without a session, deliberately.
 *
 * PublicScheduleView renders 科室 names for anonymous visitors, so this list has to be
 * reachable before login. It is not a leak of anything the agency does not publish — the
 * 科室 and their switchboard extensions are on the public website — but it is a decision
 * rather than an oversight, and it applies to rooms.ts and equipment.ts too. If personal
 * or internal-only fields are ever added to this table, this route must start selecting
 * columns explicitly instead of `SELECT *`.
 */
deptsApp.get('/', optionalAuthMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM departments ORDER BY sort_order ASC, name ASC`).all<any>();
  return c.json({ success: true, departments: rows.results || [] });
});

const deptSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '請輸入科室名稱'),
  phone: z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
});

deptsApp.post('/', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();
  const parsed = deptSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { name, phone, sortOrder } = parsed.data;
  const id = parsed.data.id || `dept-${Date.now()}`;

  // The client may supply `id`. Colliding with an existing row used to hit the primary
  // key constraint and surface as an opaque 500; a caller sending a duplicate deserves to
  // be told which value was rejected. `name` is UNIQUE as well, hence the catch.
  const clash = await c.env.DB.prepare(`SELECT id FROM departments WHERE id = ?`).bind(id).first<any>();
  if (clash) {
    return c.json({ success: false, error: `科室代碼 [${id}] 已存在` }, 400);
  }

  try {
    await c.env.DB
      .prepare(`INSERT INTO departments (id, name, phone, sort_order) VALUES (?, ?, ?, ?)`)
      .bind(id, name, phone || null, sortOrder)
      .run();
  } catch (err) {
    console.warn('Department insert rejected:', err);
    return c.json({ success: false, error: `科室建立失敗：名稱 [${name}] 可能已存在` }, 400);
  }

  await writeAuditLog(c.env.DB, user.id, 'CREATE_DEPT', 'department', id, null, parsed.data, c.get('clientIp'));

  return c.json({ success: true, message: '科室建立成功', deptId: id });
});

deptsApp.patch('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = deptSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM departments WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '科室不存在' }, 404);
  }

  const d = parsed.data;
  await c.env.DB
    .prepare(`UPDATE departments SET name = ?, phone = ?, sort_order = ? WHERE id = ?`)
    .bind(
      d.name !== undefined ? d.name : existing.name,
      d.phone !== undefined ? d.phone : existing.phone,
      d.sortOrder !== undefined ? d.sortOrder : existing.sort_order,
      id
    )
    .run();

  await writeAuditLog(c.env.DB, user.id, 'UPDATE_DEPT', 'department', id, existing, d, c.get('clientIp'));

  return c.json({ success: true, message: '科室更新成功' });
});

deptsApp.delete('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`SELECT * FROM departments WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '科室不存在' }, 404);
  }

  // Departments are hard-deleted, unlike rooms and equipment which are only deactivated.
  // D1 does not enforce foreign keys by default, so deleting one that users still point
  // at leaves those rows with a dept_id that resolves to nothing: the LEFT JOIN in
  // /api/users and /api/reservations then yields a null dept_name, and the booking form's
  // 科室 dropdown can no longer round-trip the value. Refuse instead, and say who is in
  // the way — reassigning the affected staff first is the only correct order.
  const inUse = await c.env.DB
    .prepare(`SELECT COUNT(*) as count FROM users WHERE dept_id = ?`)
    .bind(id)
    .first<any>();

  if (inUse && inUse.count > 0) {
    return c.json(
      {
        success: false,
        error: `無法刪除：仍有 ${inUse.count} 位同仁隸屬於「${existing.name}」，請先將他們改派至其他科室`,
      },
      409
    );
  }

  await c.env.DB.prepare(`DELETE FROM departments WHERE id = ?`).bind(id).run();
  await writeAuditLog(c.env.DB, user.id, 'DELETE_DEPT', 'department', id, existing, null, c.get('clientIp'));

  return c.json({ success: true, message: '科室已刪除' });
});

export default deptsApp;
