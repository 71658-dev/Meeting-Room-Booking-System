import { Hono } from 'hono';
import { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { hashPasswordChain, generateRandomToken } from '../auth/crypto';
import { revokeAllUserSessions } from '../auth/session';
import { authMiddleware, requireRole } from '../middleware/auth';
import { readJsonBody, INVALID_JSON_ERROR } from '../middleware/security';
import { writeAuditLog } from '../middleware/audit';
import { HonoEnv, Role } from '../types';

const usersApp = new Hono<HonoEnv>();

// One-time passwords are valid for 15 minutes (REWRITE_PLAN.md §5.2).
const TEMP_PASSWORD_TTL_MINUTES = 15;

const tempPasswordDeadline = () =>
  new Date(Date.now() + TEMP_PASSWORD_TTL_MINUTES * 60 * 1000).toISOString();

// 16 hex chars = 64 bits. The previous 'Tmp!' + 8 hex form carried only 32 bits, which
// is thin for a credential that is transmitted out-of-band and may sit unused.
const generateTempPassword = () => `Tmp-${generateRandomToken(8)}`;

/**
 * The only fields of a user row that may be written to the audit log.
 *
 * An allow-list, not a deny-list: `SELECT *` on this table returns `password_hash` and
 * `password_expires_at`, and passing that straight through as the before-snapshot put a
 * copy of the credential into `audit_log.before_json`, which `GET /api/audit` then hands
 * back whole. `writeAuditLog` redacts those keys as a backstop, but the snapshot the
 * route builds should not contain them in the first place.
 *
 * reservations.ts already does the equivalent for `owner_role`; users is the table that
 * actually holds secrets, so it needs it more.
 */
const AUDITABLE_USER_FIELDS = [
  'id',
  'name',
  'dept_id',
  'ext',
  'email',
  'role',
  'must_change_password',
  'is_active',
  'created_at',
  'updated_at',
] as const;

function auditableUser(row: any): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of AUDITABLE_USER_FIELDS) {
    if (field in row) snapshot[field] = row[field];
  }
  return snapshot;
}

/**
 * Record the hash a user's password has just been set to.
 *
 * Every path that sets `password_hash` must call this, or the "must differ from the last
 * 3" rule in POST /api/auth/password silently develops holes: a password rotated in via
 * an admin reset was invisible to the history check, so it could be re-used immediately.
 */
async function recordPasswordHistory(db: D1Database, userId: string, hash: string, at: string) {
  await db
    .prepare(`INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)`)
    .bind(userId, hash, at)
    .run();
}

usersApp.get('/', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT u.id, u.name, u.dept_id, d.name as dept_name, u.ext, u.email, u.role,
              u.must_change_password, u.is_active, u.created_at, u.updated_at
       FROM users u
       LEFT JOIN departments d ON u.dept_id = d.id
       ORDER BY u.id ASC`
    )
    .all<any>();

  const users = (rows.results || []).map((u: any) => ({
    ...u,
    must_change_password: u.must_change_password === 1,
    is_active: u.is_active === 1,
  }));

  return c.json({ success: true, users });
});

/**
 * Email is optional, but if one is given it has to be an address.
 *
 * The blank case is spelled out because the admin form always submits the field, sending
 * '' when it was left empty — a bare `.email()` rejects that, which turned "create a user
 * without an email" into a validation error rather than the no-op it reads as. Blank
 * normalises to null so the column holds one representation of "no address", not two.
 */
const optionalEmail = z
  .union([z.string().email('Email 格式不正確'), z.literal(''), z.null()])
  .optional()
  // `undefined` must survive the transform: PATCH distinguishes "field omitted, keep what
  // is stored" from "field sent empty, clear it", and collapsing both to null would make
  // every partial update silently wipe the address.
  .transform((v) => (v === undefined ? undefined : v || null));

/**
 * Bounds on the identity fields.
 *
 * `id` is not just a column: it is concatenated into the KV lockout keys in
 * auth/lockout.ts and the mail-quota key in services/email.ts, and it is written to
 * `audit_log.actor_id`. Unbounded and unconstrained, an admin could mint an account whose
 * id contains the key separator (`:`) and have it collide with another account's throttle
 * bucket, or one long enough to push those keys past KV's 512-byte limit — at which point
 * that user's every login attempt is a 500 rather than a login. Restricting it to the
 * shape a 工號 actually takes removes the whole question.
 *
 * The same cap on the free-text fields matches the one reservations.ts puts on 事由/備註,
 * for the same reason: these are stored and later interpolated into outbound mail.
 */
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 100;
const MAX_EXT_LENGTH = 20;

const userIdField = z
  .string()
  .min(1, '請輸入工號/帳號')
  .max(MAX_ID_LENGTH, `工號/帳號長度不得超過 ${MAX_ID_LENGTH} 個字元`)
  .regex(/^[A-Za-z0-9._-]+$/, '工號/帳號僅能使用英數字與 . _ - 符號');

const createUserSchema = z.object({
  id: userIdField,
  name: z.string().min(1, '請輸入同仁姓名').max(MAX_NAME_LENGTH, `姓名長度不得超過 ${MAX_NAME_LENGTH} 個字元`),
  deptId: z.string().min(1, '請選擇所屬科室').max(MAX_ID_LENGTH),
  ext: z.string().max(MAX_EXT_LENGTH, `分機長度不得超過 ${MAX_EXT_LENGTH} 個字元`).optional().nullable(),
  email: optionalEmail,
  role: z.enum(['superadmin', 'admin', 'staff']).default('staff'),
});

usersApp.post('/', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const currentUser = c.get('user')!;
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { id, name, deptId, ext, email, role } = parsed.data;

  // Rule: General admin cannot create superadmin
  if (role === 'superadmin' && currentUser.role !== 'superadmin') {
    return c.json({ success: false, error: '一般管理者無法建立超級管理者帳號' }, 403);
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first<any>();
  if (existing) {
    return c.json({ success: false, error: `工號/帳號 [${id}] 已存在` }, 400);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPasswordChain(tempPassword);
  const nowStr = new Date().toISOString();
  const expiresAt = tempPasswordDeadline();

  await c.env.DB
    .prepare(
      `INSERT INTO users (id, name, dept_id, ext, email, role, password_hash, must_change_password, is_active, created_at, updated_at, password_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    )
    .bind(id, name, deptId, ext || null, email || null, role, passwordHash, nowStr, nowStr, expiresAt)
    .run();

  await recordPasswordHistory(c.env.DB, id, passwordHash, nowStr);

  await writeAuditLog(c.env.DB, currentUser.id, 'CREATE_USER', 'user', id, null, { id, name, deptId, role }, c.get('clientIp'));

  return c.json({
    success: true,
    message: '使用者建立成功',
    user: { id, name, deptId, ext, email, role },
    tempPassword, // Displayed ONCE to admin
  });
});

const updateUserSchema = z.object({
  name: z.string().min(1, '請輸入同仁姓名').max(MAX_NAME_LENGTH, `姓名長度不得超過 ${MAX_NAME_LENGTH} 個字元`).optional(),
  deptId: z.string().min(1, '請選擇科室').max(MAX_ID_LENGTH).optional(),
  ext: z.string().max(MAX_EXT_LENGTH, `分機長度不得超過 ${MAX_EXT_LENGTH} 個字元`).optional().nullable(),
  // Same rule as create. PATCH used to take a bare `z.string()`, so the one endpoint an
  // admin actually uses day to day was the one that would store a non-address.
  email: optionalEmail,
  role: z.enum(['superadmin', 'admin', 'staff']).optional(),
  isActive: z.boolean().optional(),
});

usersApp.patch('/:id', authMiddleware, async (c) => {
  const currentUser = c.get('user')!;
  const targetId = c.req.param('id');
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(targetId).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '使用者不存在' }, 404);
  }

  const isSelf = currentUser.id === targetId;
  const isSuperadmin = currentUser.role === 'superadmin';
  const isAdmin = currentUser.role === 'admin';

  // Authorization Matrix:
  // - Regular staff: Can edit ONLY self.
  // - General admin: Can edit self AND regular staff (role === 'staff'). Cannot edit other admins or superadmin.
  // - Superadmin: Can manage & edit ALL users (superadmin, admin, staff).
  if (!isSelf && !isSuperadmin) {
    if (!(isAdmin && existing.role === 'staff')) {
      return c.json({ success: false, error: '權限不足：一般管理者僅能編輯自身及一般同仁 (staff) 帳號' }, 403);
    }
  }

  const data = parsed.data;

  // Role & active status permission checks:
  let newRole: Role = existing.role;
  let newIsActive = existing.is_active;

  if (isSuperadmin) {
    if (data.role) newRole = data.role;
    if (data.isActive !== undefined) newIsActive = data.isActive ? 1 : 0;
  } else if (isAdmin) {
    if (data.role) {
      if (data.role === 'superadmin') {
        return c.json({ success: false, error: '一般管理者無法指派超級管理者權限' }, 403);
      }
      newRole = data.role;
    }
    if (data.isActive !== undefined) newIsActive = data.isActive ? 1 : 0;
  }

  // Guard the last way in. Demoting or disabling the only remaining active superadmin
  // leaves nobody who can appoint another one, and there is no out-of-band recovery
  // path short of editing D1 by hand.
  const losingSuperadmin =
    existing.role === 'superadmin' && (newRole !== 'superadmin' || newIsActive === 0);

  if (losingSuperadmin) {
    const remaining = await c.env.DB
      .prepare(
        `SELECT COUNT(*) as count FROM users
         WHERE role = 'superadmin' AND is_active = 1 AND id != ?`
      )
      .bind(targetId)
      .first<any>();

    if (!remaining || remaining.count === 0) {
      return c.json(
        { success: false, error: '無法變更：系統必須至少保留一位啟用中的超級管理者' },
        409
      );
    }
  }

  const nowStr = new Date().toISOString();
  await c.env.DB
    .prepare(
      `UPDATE users
       SET name = ?, dept_id = ?, ext = ?, email = ?, role = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      data.name !== undefined ? data.name : existing.name,
      data.deptId !== undefined ? data.deptId : existing.dept_id,
      data.ext !== undefined ? data.ext : existing.ext,
      data.email !== undefined ? data.email : existing.email,
      newRole,
      newIsActive,
      nowStr,
      targetId
    )
    .run();

  // A role change or a deactivation must take effect immediately, not at the end of the
  // target's 8-hour session. Sessions carry no role of their own — authorisation always
  // re-reads the DB — but a disabled account must lose its session outright.
  if (newRole !== existing.role || newIsActive !== existing.is_active) {
    await revokeAllUserSessions(c.env.DB, targetId);
  }

  // Narrow snapshot, not `existing`: that row carries password_hash and
  // password_expires_at straight out of `SELECT *`.
  await writeAuditLog(
    c.env.DB, currentUser.id, 'UPDATE_USER', 'user', targetId,
    auditableUser(existing), data, c.get('clientIp')
  );

  // Get updated user profile
  const updatedUserRow = await c.env.DB
    .prepare(
      `SELECT u.id, u.name, u.dept_id, d.name as dept_name, u.ext, u.email, u.role, u.must_change_password, u.is_active
       FROM users u
       LEFT JOIN departments d ON u.dept_id = d.id
       WHERE u.id = ?`
    )
    .bind(targetId)
    .first<any>();

  return c.json({
    success: true,
    message: '使用者資料已更新',
    user: updatedUserRow ? {
      ...updatedUserRow,
      must_change_password: updatedUserRow.must_change_password === 1,
      is_active: updatedUserRow.is_active === 1,
    } : null,
  });
});

usersApp.post('/:id/reset-password', authMiddleware, async (c) => {
  const currentUser = c.get('user')!;
  const targetId = c.req.param('id');

  const existing = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(targetId).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '使用者不存在' }, 404);
  }

  const isSuperadmin = currentUser.role === 'superadmin';
  const isAdmin = currentUser.role === 'admin';

  // Self-reset is refused outright, for everyone, including superadmin.
  //
  // This endpoint hands back a working one-time password and revokes every session for
  // the account. Allowing it against yourself meant a stolen session cookie was enough to
  // take an account over permanently: call it, read `tempPassword` from the response, log
  // in with it (which also logs the real owner out), set a new password. Requiring the
  // current password is the one thing standing between "attacker can act as you" and
  // "attacker owns the account", and this path bypassed it.
  //
  // Someone who is already logged in never needs this: POST /api/auth/password changes
  // their own password and correctly demands the old one first.
  if (currentUser.id === targetId) {
    return c.json(
      { success: false, error: '無法重置自己的密碼，請改用「變更密碼」功能（需輸入現行密碼）' },
      403
    );
  }

  if (!isSuperadmin) {
    if (!(isAdmin && existing.role === 'staff')) {
      return c.json({ success: false, error: '權限不足：一般管理者僅能重置一般同仁 (staff) 的密碼' }, 403);
    }
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPasswordChain(tempPassword);
  const nowStr = new Date().toISOString();
  const expiresAt = tempPasswordDeadline();

  await c.env.DB
    .prepare(
      `UPDATE users
       SET password_hash = ?, must_change_password = 1, password_expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(passwordHash, expiresAt, nowStr, targetId)
    .run();

  // The reset password counts toward the "must differ from the last 3" rule too, or an
  // admin reset would leave a gap the user could immediately re-use.
  await recordPasswordHistory(c.env.DB, targetId, passwordHash, nowStr);

  // Revoke all active sessions for security
  await revokeAllUserSessions(c.env.DB, targetId);

  await writeAuditLog(c.env.DB, currentUser.id, 'RESET_PASSWORD', 'user', targetId, null, { targetId }, c.get('clientIp'));

  return c.json({
    success: true,
    message: `帳號 [${targetId}] 密碼已重置，此一次性密碼將於 ${TEMP_PASSWORD_TTL_MINUTES} 分鐘後失效`,
    tempPassword,
    tempPasswordExpiresAt: expiresAt,
  });
});

export default usersApp;
