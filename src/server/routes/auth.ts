import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { hashPasswordChain, verifyPasswordChain } from '../auth/crypto';
import {
  createSession,
  revokeSessionByHash,
  revokeOtherUserSessions,
  SESSION_COOKIE_NAME,
} from '../auth/session';
import { checkLockout, recordFailure, clearAccountFailures } from '../auth/lockout';
import { validatePasswordPolicy, MIN_PASSWORD_LENGTH } from '../auth/passwordPolicy';
import { authMiddleware } from '../middleware/auth';
import { getClientIp, readJsonBody, INVALID_JSON_ERROR } from '../middleware/security';
import { writeAuditLog } from '../middleware/audit';
import { HonoEnv } from '../types';

const authApp = new Hono<HonoEnv>();

// A syntactically valid pbkdf2c hash that no password can match (all-zero salt and
// digest). Verifying against it burns the same work as a real check, which is what
// keeps "unknown account" and "wrong password" indistinguishable by response time.
const TIMING_EQUALISATION_HASH =
  'pbkdf2c$sha256$6x100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// Turnstile validation helper against Cloudflare siteverify endpoint.
//
// There is deliberately NO fallback secret here. An earlier revision fell back to
// Cloudflare's official always-pass testing secret ('1x0000...AA') whenever
// TURNSTILE_SECRET was unset, which silently turned the human check into a no-op in
// exactly the environments that had not been configured yet (i.e. production).
// Missing configuration must fail closed and be visible, never degrade quietly.
// For local development, put Cloudflare's test secret in .dev.vars explicitly.
async function verifyTurnstileToken(secretKey: string, token: string, remoteIp?: string): Promise<boolean> {
  if (!token || !secretKey) return false;

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteIp) formData.append('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data = (await res.json()) as any;
    return !!data.success;
  } catch (err) {
    console.error('Turnstile siteverify error:', err);
    return false;
  }
}

// Zod v4 reports a missing field as a type issue and a too-short field as a size issue.
// Passing `error` as well as a `.min()` message keeps the Chinese copy on both paths;
// with only `.min()`, an absent field falls back to Zod's English default.
const requiredString = (message: string) => z.string({ error: message }).min(1, message);

// Both fields are length-capped, and the cap is a control rather than tidiness.
//
// `id` is concatenated into the KV lockout key and written to audit_log.actor_id, so an
// unbounded value let one request either blow past KV's 512-byte key limit (an
// unauthenticated 500, on the endpoint that must stay up) or pad the audit table with
// kilobytes per attempt. `password` is fed to a 6x100k PBKDF2 chain; the 200-character
// ceiling matches auth/passwordPolicy.ts, which capped it there for the same reason and
// was the only place the limit existed.
const MAX_ID_LENGTH = 64;
const MAX_LOGIN_PASSWORD_LENGTH = 200;

const loginSchema = z.object({
  id: requiredString('請輸入工號/帳號').max(MAX_ID_LENGTH, '工號/帳號格式不正確'),
  password: requiredString('請輸入密碼').max(MAX_LOGIN_PASSWORD_LENGTH, '密碼格式不正確'),
  turnstileToken: z.string().max(4096).optional(),
});

authApp.post('/login', async (c) => {
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { id, password, turnstileToken } = parsed.data;
  const clientIp = getClientIp(c);

  // Fail closed when the human-verification secret is not configured, rather than
  // letting logins through unchecked. This mirrors how SUPERADMIN_DEFAULT_PASSWORD
  // is treated: an unconfigured environment refuses to serve auth at all.
  if (!c.env.TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET is not configured; refusing to process logins.');
    return c.json(
      { success: false, error: '系統尚未完成人機驗證設定，暫時無法登入，請聯繫系統管理者' },
      503
    );
  }

  // MANDATORY Turnstile Verification Guard
  if (!turnstileToken || !turnstileToken.trim()) {
    return c.json({ success: false, error: '請先完成 Cloudflare 人機驗證 (Turnstile)' }, 403);
  }

  const turnstilePassed = await verifyTurnstileToken(
    c.env.TURNSTILE_SECRET,
    turnstileToken,
    clientIp
  );

  if (!turnstilePassed) {
    return c.json({ success: false, error: '人機驗證 (Turnstile) 驗證失敗，請重新勾選驗證' }, 403);
  }

  // Dual-track throttling: per-account and per-IP (see auth/lockout.ts).
  const lockout = await checkLockout(c.env.MEETING_DB, id, clientIp);
  if (lockout.locked) {
    await writeAuditLog(
      c.env.DB, id, 'LOGIN_BLOCKED', 'user', id, null, { ip: clientIp, track: lockout.reason }, clientIp
    );
    return c.json(
      { success: false, error: '登入失敗次數過多，請於 15 分鐘後再試' },
      429
    );
  }

  // Lookup user in D1
  let userRow = await c.env.DB
    .prepare(
      `SELECT u.*, d.name as dept_name
       FROM users u
       LEFT JOIN departments d ON u.dept_id = d.id
       WHERE u.id = ?`
    )
    .bind(id)
    .first<any>();

  // First-run bootstrap of the superadmin account, gated entirely on the
  // SUPERADMIN_DEFAULT_PASSWORD secret. Without that secret no account is ever created.
  //
  // must_change_password = 1, like every account an admin creates. The bootstrap
  // credential lives in `wrangler secret`, gets pasted into handover notes and terminal
  // history, and is shared by whoever set the environment up — it is a delivery mechanism
  // for the first login, not a password. Landing on 0 meant the most privileged account in
  // the system could keep it indefinitely, which is the one account where that matters
  // most. No password_expires_at: unlike an admin-issued one-time password there is
  // nobody to reissue this one, so a deadline would lock the environment out of itself.
  if (!userRow && id === '99999' && c.env.SUPERADMIN_DEFAULT_PASSWORD) {
    const initHash = await hashPasswordChain(c.env.SUPERADMIN_DEFAULT_PASSWORD);
    const now = new Date().toISOString();
    await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO users (id, name, dept_id, ext, email, role, password_hash, must_change_password, is_active, created_at, updated_at)
         VALUES ('99999', '系統管理者', 'dept-3', '100', 'admin@ems.hccg.gov.tw', 'superadmin', ?, 1, 1, ?, ?)`
      )
      .bind(initHash, now, now)
      .run();

    userRow = await c.env.DB.prepare(`SELECT * FROM users WHERE id = '99999'`).first<any>();
  }

  const failLogin = async (reason: string) => {
    await recordFailure(c.env.MEETING_DB, id, clientIp);
    await writeAuditLog(
      c.env.DB, id, 'LOGIN_FAILED', 'user', id, null, { ip: clientIp, reason }, clientIp
    );
    return c.json({ success: false, error: '工號/帳號或密碼錯誤' }, 401);
  };

  if (!userRow || userRow.is_active === 0) {
    // Verify against a throwaway hash so that a non-existent or disabled account costs
    // the same ~6x100k PBKDF2 as a real one. Returning early here would let an attacker
    // enumerate valid 工號 purely from response latency.
    await verifyPasswordChain(password, TIMING_EQUALISATION_HASH);
    return failLogin(userRow ? 'account_disabled' : 'unknown_account');
  }

  // Verify password via the backward-compatible chain
  const verifyResult = await verifyPasswordChain(password, userRow.password_hash);
  if (!verifyResult.ok) {
    return failLogin('bad_password');
  }

  // An admin-issued one-time password stops working at its deadline even if nobody used
  // it. Checked after verification so an expired credential is not distinguishable from
  // a wrong one by timing, and so the attempt still counts toward the lockout.
  if (userRow.password_expires_at && new Date(userRow.password_expires_at) <= new Date()) {
    await writeAuditLog(
      c.env.DB, id, 'LOGIN_FAILED', 'user', id, null, { ip: clientIp, reason: 'temp_password_expired' }, clientIp
    );
    return c.json(
      { success: false, error: '此為一次性密碼且已逾期，請聯繫管理者重新產生' },
      401
    );
  }

  // Clear the account counter on success. The IP counter is intentionally left to
  // expire on its own, so a successful login cannot be used to reset a spray budget.
  await clearAccountFailures(c.env.MEETING_DB, id);

  // Upgrade password hash to pbkdf2c if needed
  if (verifyResult.needsUpgrade) {
    const newHash = await hashPasswordChain(password);
    const nowStr = new Date().toISOString();
    await c.env.DB
      .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
      .bind(newHash, nowStr, id)
      .run();
  }

  // Create session
  const userAgent = c.req.header('user-agent') || undefined;
  const { token, expiresAt } = await createSession(c.env.DB, id, clientIp, userAgent);

  // Set HttpOnly cookie.
  //
  // These three attributes are what the `__Host-` prefix in the cookie's name requires:
  // Secure, Path=/, and no Domain. A browser silently drops the cookie if any of them is
  // missing, so changing them here breaks login rather than merely weakening it — see the
  // note on SESSION_COOKIE_NAME for why the prefix is there.
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 8 * 3600,
  });

  const userSafe = {
    id: userRow.id,
    name: userRow.name,
    dept_id: userRow.dept_id,
    dept_name: userRow.dept_name || userRow.dept_id,
    ext: userRow.ext || '',
    email: userRow.email || '',
    // Authority is the role column, not the 工號. The previous hardcoded
    // `id === '99999' ? 'superadmin' : ...` meant demoting or restricting that one
    // account in the database had no effect on what it could actually do.
    role: userRow.role,
    must_change_password: userRow.must_change_password === 1,
    is_active: true,
  };

  await writeAuditLog(c.env.DB, id, 'LOGIN', 'user', id, null, { ip: clientIp }, clientIp);

  // The session token is returned only via the httpOnly cookie set above. Echoing it in
  // the body would invite clients to keep a copy somewhere script can reach, which is
  // exactly what moving off sessionStorage was meant to prevent.
  return c.json({
    success: true,
    user: userSafe,
    expiresAt,
  });
});

authApp.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const session = c.get('session')!;

  await revokeSessionByHash(c.env.DB, session.token_hash);
  // The deletion has to satisfy the `__Host-` rules too, or the browser rejects the
  // Set-Cookie outright and the cookie stays put — logged out on the server, still
  // present in the browser, and the user sees a confusing 401 loop instead of the
  // login screen.
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', secure: true, sameSite: 'Strict' });

  await writeAuditLog(c.env.DB, user.id, 'LOGOUT', 'user', user.id, null, null, c.get('clientIp'));

  return c.json({ success: true, message: '已成功登出' });
});

authApp.get('/me', authMiddleware, async (c) => {
  return c.json({ success: true, user: c.get('user') });
});

const passwordSchema = z.object({
  oldPassword: requiredString('請輸入舊密碼'),
  newPassword: z
    .string({ error: `新密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元` })
    .min(MIN_PASSWORD_LENGTH, `新密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元`),
});

authApp.post('/password', authMiddleware, async (c) => {
  const user = c.get('user')!;
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { oldPassword, newPassword } = parsed.data;

  const policy = validatePasswordPolicy(newPassword, { userId: user.id, name: user.name });
  if (!policy.ok) {
    return c.json({ success: false, error: policy.error }, 400);
  }

  // Verify old password
  const dbUser = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first<any>();
  if (!dbUser) {
    return c.json({ success: false, error: '使用者不存在' }, 404);
  }

  const verifyOld = await verifyPasswordChain(oldPassword, dbUser.password_hash);
  if (!verifyOld.ok) {
    return c.json({ success: false, error: '舊密碼不正確' }, 400);
  }

  // Check password history (last 3)
  const historyRows = await c.env.DB
    .prepare(`SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT 3`)
    .bind(user.id)
    .all<any>();

  for (const hist of historyRows.results || []) {
    const matchHist = await verifyPasswordChain(newPassword, hist.password_hash);
    if (matchHist.ok) {
      return c.json({ success: false, error: '新密碼不得與最近 3 次使用過的密碼相同' }, 400);
    }
  }

  // Hash new password using chained 6x100k PBKDF2
  const newHash = await hashPasswordChain(newPassword);
  const nowStr = new Date().toISOString();

  // Update password, clear the forced-change flag and any one-time password deadline.
  await c.env.DB
    .prepare(
      `UPDATE users
       SET password_hash = ?, must_change_password = 0, password_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .bind(newHash, nowStr, user.id)
    .run();

  // Insert into password_history
  await c.env.DB
    .prepare(`INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)`)
    .bind(user.id, newHash, nowStr)
    .run();

  // A password change must invalidate sessions held elsewhere — that is the whole point
  // of being able to change it after a suspected compromise. The current session is
  // kept so the user is not bounced out of the screen they just submitted.
  const session = c.get('session')!;
  await revokeOtherUserSessions(c.env.DB, user.id, session.token_hash);

  await writeAuditLog(c.env.DB, user.id, 'CHANGE_PASSWORD', 'user', user.id, null, null, c.get('clientIp'));

  return c.json({ success: true, message: '密碼變更成功，其他裝置的登入已一併登出' });
});

export default authApp;
