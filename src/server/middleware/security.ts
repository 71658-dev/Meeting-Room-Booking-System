import { MiddlewareHandler } from 'hono';
import { HonoEnv } from '../types';

// CSRF defence for the cookie-based session (REWRITE_PLAN.md §5.1).
//
// v1 authenticated with an Authorization header, so CSRF did not apply. v2 moved the
// session into an httpOnly cookie to keep it away from script, which the browser now
// attaches automatically — so cross-site requests must be rejected explicitly.
// SameSite=Strict on the cookie is the first layer; this is the second, because
// SameSite is unenforced on some older/managed browsers and proxies may strip it.
//
// Same-origin requests from fetch always carry Origin on state-changing methods. When
// Origin is absent we fall back to Referer, and reject if neither is present.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const expectedHost = new URL(c.req.url).host;
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');
  const source = origin || referer;

  if (!source) {
    return c.json(
      { success: false, error: '請求來源無法驗證，請重新整理頁面後再試' },
      403
    );
  }

  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return c.json({ success: false, error: '請求來源格式無效' }, 403);
  }

  if (sourceHost !== expectedHost) {
    return c.json({ success: false, error: '跨站請求已被阻擋' }, 403);
  }

  await next();
};

// Enforce the forced-password-change state on the server, not just in the UI.
//
// A user holding a temporary password previously received a full-privilege session and
// nothing stopped them from using every endpoint while skipping the change screen.
// While must_change_password is set, only the endpoints needed to complete the change
// (or to leave) are reachable.
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  'GET /api/auth/me',
  'POST /api/auth/password',
  'POST /api/auth/logout',
  'GET /api/config',
]);

export const requirePasswordChangeComplete: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const user = c.get('user');

  if (user?.must_change_password) {
    const path = new URL(c.req.url).pathname;
    const key = `${c.req.method} ${path}`;
    if (!PASSWORD_CHANGE_ALLOWLIST.has(key)) {
      return c.json(
        { success: false, error: '請先變更您的密碼後才能使用系統功能', mustChangePassword: true },
        403
      );
    }
  }

  await next();
};

/**
 * The caller's IP, taken from the one header the platform actually controls.
 *
 * `cf-connecting-ip` is written by Cloudflare's edge and cannot be set by the client —
 * any value a caller sends is overwritten. `x-forwarded-for` is not: it is a
 * comma-separated chain the client can start, so its leftmost entry is attacker-chosen
 * text. Reading the whole raw header meant that value became the per-IP lockout key in
 * auth/lockout.ts and the `ip` column in audit_log. Both matter:
 *
 *   - a login sprayer could send a fresh X-Forwarded-For per attempt and never once
 *     accumulate against the 30-failures-per-IP track, and
 *   - the audit trail recorded an origin the attacker chose, which is worse than
 *     recording none at all.
 *
 * XFF is kept only as a last resort for non-Cloudflare contexts (wrangler dev, tests),
 * and even then only the first hop, trimmed and length-capped so it cannot be used to
 * blow past KV's key limit or to pad the log.
 */
export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim().slice(0, 45);

  const forwarded = c.req.header('x-forwarded-for');
  const firstHop = (forwarded || '').split(',')[0].trim();
  // An IPv4/IPv6 literal and nothing else — a value that is not one is not usable as an
  // origin, so recording it would only launder attacker text into the audit log.
  if (firstHop && /^[0-9a-fA-F:.]{3,45}$/.test(firstHop)) return firstHop;

  return '127.0.0.1';
}

/**
 * Parse a JSON request body without letting a malformed one become a 500.
 *
 * `await c.req.json()` throws on any body that is not valid JSON, and every mutating
 * route called it unguarded — so `curl -X POST -d 'x'` produced a server error rather
 * than the 400 it is. Returns `undefined` on failure; callers answer with 400.
 */
export async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** The 400 every route returns for an unparseable body, so the copy stays identical. */
export const INVALID_JSON_ERROR = '請求內容格式不正確（需為 JSON）';
