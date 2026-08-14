import { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getSessionAndUser, SESSION_COOKIE_NAME } from '../auth/session';
import { requirePasswordChangeComplete } from './security';
import { HonoEnv, Role } from '../types';

export function extractToken(c: any): string | null {
  // Check cookie first
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken) return cookieToken;

  // Fallback to Bearer token
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const token = extractToken(c);
  if (!token) {
    return c.json({ success: false, error: '未登入或 Session 已過期' }, 401);
  }

  const result = await getSessionAndUser(c.env.DB, token);
  if (!result) {
    return c.json({ success: false, error: 'Session 無效或已撤銷' }, 401);
  }

  c.set('user', result.user);
  c.set('session', result.session);
  c.set('clientIp', c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1');

  // Composed here rather than mounted per-route: every protected endpoint goes through
  // authMiddleware, so this is the one place the forced-change state cannot be skipped.
  return requirePasswordChangeComplete(c, next);
};

export const optionalAuthMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const token = extractToken(c);
  if (token) {
    const result = await getSessionAndUser(c.env.DB, token);
    if (result) {
      c.set('user', result.user);
      c.set('session', result.session);
    }
  }
  c.set('clientIp', c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1');
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ success: false, error: '未授權' }, 401);
    }

    if (!roles.includes(user.role)) {
      return c.json({ success: false, error: '權限不足' }, 403);
    }

    await next();
  };
}
