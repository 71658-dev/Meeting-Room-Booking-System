import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth';
import { HonoEnv } from '../types';

const auditApp = new Hono<HonoEnv>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * `parseInt` alone is not validation.
 *
 * `?limit=abc` yields NaN, which D1 refuses to bind and surfaces as a 500. `?limit=-1` is
 * worse: SQLite reads a negative LIMIT as "no limit", so a single request dumped the
 * entire audit table in one response. `?page=0` produces a negative OFFSET.
 *
 * Only superadmin reaches this route, so none of that is a privilege boundary — but it is
 * an amplifier for anything the table happens to contain, which is why the bounds are
 * applied here rather than trusted to the caller.
 */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

auditApp.get('/', authMiddleware, requireRole('superadmin'), async (c) => {
  const page = clampInt(c.req.query('page'), 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = clampInt(c.req.query('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = (page - 1) * limit;

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM audit_log`).first<any>();
  const total = countRow ? countRow.total : 0;

  const rows = await c.env.DB
    .prepare(
      `SELECT a.*, u.name as actor_name
       FROM audit_log a
       LEFT JOIN users u ON a.actor_id = u.id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<any>();

  return c.json({
    success: true,
    page,
    limit,
    total,
    logs: rows.results || [],
  });
});

export default auditApp;
