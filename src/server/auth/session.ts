import { D1Database } from '@cloudflare/workers-types';
import { generateRandomToken, sha256Hex } from './crypto';
import { DBSession, DBUser, UserSafe } from '../types';

export const SESSION_COOKIE_NAME = 'meeting_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export async function createSession(
  db: D1Database,
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<{ token: string; expiresAt: string }> {
  const token = generateRandomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresDate = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  const createdAtStr = now.toISOString();
  const expiresAtStr = expiresDate.toISOString();

  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(tokenHash, userId, createdAtStr, expiresAtStr, createdAtStr, ip || null, userAgent || null)
    .run();

  return { token, expiresAt: expiresAtStr };
}

export async function getSessionAndUser(
  db: D1Database,
  token: string
): Promise<{ session: DBSession; user: UserSafe } | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const nowStr = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT s.*, u.name as u_name, u.dept_id as u_dept_id, d.name as u_dept_name,
              u.ext as u_ext, u.email as u_email, u.role as u_role,
              u.must_change_password as u_must_change_password, u.is_active as u_is_active
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN departments d ON u.dept_id = d.id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1`
    )
    .bind(tokenHash, nowStr)
    .first<any>();

  if (!row) return null;

  // Update last_seen_at
  await db
    .prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`)
    .bind(nowStr, tokenHash)
    .run();

  const session: DBSession = {
    token_hash: row.token_hash,
    user_id: row.user_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: nowStr,
    ip: row.ip,
    user_agent: row.user_agent,
    revoked_at: row.revoked_at,
  };

  const user: UserSafe = {
    id: row.user_id,
    name: row.u_name,
    dept_id: row.u_dept_id,
    dept_name: row.u_dept_name || row.u_dept_id,
    ext: row.u_ext || '',
    email: row.u_email || '',
    role: row.u_role,
    must_change_password: row.u_must_change_password === 1,
    is_active: row.u_is_active === 1,
  };

  return { session, user };
}

/**
 * Revoke a single session, identified by the SHA-256 of its token as stored in D1.
 *
 * Takes the hash rather than the raw token on purpose: callers reach this from a
 * request context where only `session.token_hash` is at hand. The earlier signature
 * accepted a token and hashed it internally, but logout passed the already-hashed
 * value — so the UPDATE matched sha256(sha256(token)), touched zero rows, and left
 * every "logged out" session valid for the remainder of its 8 hours.
 */
export async function revokeSessionByHash(db: D1Database, tokenHash: string): Promise<void> {
  const nowStr = new Date().toISOString();
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`)
    .bind(nowStr, tokenHash)
    .run();
}

/** Revoke a session given the raw token (e.g. from a client-supplied cookie). */
export async function revokeSessionByToken(db: D1Database, token: string): Promise<void> {
  await revokeSessionByHash(db, await sha256Hex(token));
}

export async function revokeAllUserSessions(db: D1Database, userId: string): Promise<void> {
  const nowStr = new Date().toISOString();
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(nowStr, userId)
    .run();
}

/** Revoke every live session for a user except the one identified by `keepTokenHash`. */
export async function revokeOtherUserSessions(
  db: D1Database,
  userId: string,
  keepTokenHash: string
): Promise<void> {
  const nowStr = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE user_id = ? AND revoked_at IS NULL AND token_hash != ?`
    )
    .bind(nowStr, userId, keepTokenHash)
    .run();
}
