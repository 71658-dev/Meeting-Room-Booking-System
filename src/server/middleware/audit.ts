import { D1Database } from '@cloudflare/workers-types';

/**
 * Keys that must never reach `audit_log`.
 *
 * The audit table has no expiry and no access grading below "superadmin", and
 * `GET /api/audit` hands whole rows back to the client. Anything copied in here is
 * therefore copied into a second, longer-lived place with a wider read surface than the
 * table it came from.
 *
 * This bit a real caller: `PATCH /api/users/:id` snapshotted `SELECT *`, so every user
 * edit wrote that account's `password_hash` into `before_json`. For an account still on
 * the legacy unsalted SHA-256 format (see verifyPasswordChain's compatibility chain)
 * that is a credential an offline cracker recovers in seconds.
 *
 * Redaction happens here rather than only at the call sites because the call sites are
 * where it was forgotten. Individual routes should still pass narrow snapshots — see
 * `auditableUser()` in routes/users.ts — but this is the backstop for the next route
 * that reaches for `SELECT *`.
 */
const REDACTED_KEYS = new Set([
  'password_hash',
  'passwordHash',
  'password',
  'newPassword',
  'oldPassword',
  'tempPassword',
  'password_expires_at',
  'passwordExpiresAt',
  'token',
  'token_hash',
  'tokenHash',
]);

const REDACTED_PLACEHOLDER = '[redacted]';

/**
 * Walks plain objects and arrays, replacing sensitive values. Depth is capped because
 * audit payloads are shallow by construction and a cycle here would take down the
 * request that triggered the write.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? REDACTED_PLACEHOLDER : redactSensitive(item, depth + 1);
  }
  return out;
}

export async function writeAuditLog(
  db: D1Database,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeData: any = null,
  afterData: any = null,
  ip: string | null = null
): Promise<void> {
  try {
    const beforeJson = beforeData ? JSON.stringify(redactSensitive(beforeData)) : null;
    const afterJson = afterData ? JSON.stringify(redactSensitive(afterData)) : null;
    const createdAt = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before_json, after_json, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(actorId, action, entityType, entityId, beforeJson, afterJson, ip, createdAt)
      .run();
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}
