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
