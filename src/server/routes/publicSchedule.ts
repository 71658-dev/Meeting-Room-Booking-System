import { Hono } from 'hono';
import { minToTimeStr } from './reservations';
import { getClientIp } from '../middleware/security';
import { HonoEnv } from '../types';

const publicApp = new Hono<HonoEnv>();

/**
 * This endpoint is unauthenticated by design, and de-identified for the same reason: no
 * 事由, no 登記人, no 備註 — that leak is what the v1 shared endpoint was replaced over.
 *
 * What it does still carry is 哪個科室在哪天用了哪間會議室. Left open-ended, a caller with
 * no credentials could pull the agency's entire room history, past and future, in one
 * request — a usable movement record, and a free multiplier on D1 reads. So an unqualified
 * request now means "the quarter around today" rather than "everything", and an explicit
 * range is capped. Anyone wanting more can page through it; that is the point.
 *
 * This is the one route an anonymous flood would aim at, and it is defended in the Worker
 * rather than at the edge. A WAF rate-limiting rule is the usual answer, but WAF rules are
 * a paid feature and this deployment sits on workers.dev, which has no zone to attach one
 * to. Two free layers replace it, in this order:
 *
 *   1. a response cache (`caches.default`), checked first. The overwhelming majority of
 *      requests — every visitor loading the public page, and every request in a flood that
 *      does not bother varying the query string — resolve to the same canonical key, so
 *      they are answered from the colo without touching D1 at all. This is the layer that
 *      actually addresses read amplification.
 *   2. the Workers Rate Limiting binding, applied only to requests that *missed* the
 *      cache, i.e. only to those that would really cost a D1 query. Metering after the
 *      cache rather than before it is deliberate: the agency reaches this service through
 *      a handful of shared egress addresses, and a limiter in front of the cache would
 *      throttle a whole office over requests that cost nothing to serve.
 *
 * An earlier revision of this comment ruled rate limiting out here on the grounds that
 * metering costs a KV read and write per hit, which is the very cost being defended
 * against. That is true of a KV counter and is why one is not used: the rate-limit binding
 * is evaluated inside the isolate with no storage round-trip.
 *
 * That is also its limitation, and the reason layer 1 is the one that matters. **The
 * counter lives in the isolate, not in the colo**, so the configured limit is enforced per
 * isolate rather than per IP: the real ceiling is `limit × live isolates`, and Cloudflare
 * adds isolates exactly when traffic rises. Measured on dev, 50 sequential requests from a
 * single address were spread over seven isolates — the busiest saw sixteen, so a setting of
 * 30/60s never fired once. The number in wrangler.json is therefore a per-isolate burst
 * brake, not a per-IP quota, and must be read as one: it bounds how fast any one isolate
 * can drive D1, and nothing stronger. Do not raise it on the theory that "30 a minute is
 * too strict for an office" — the office never reaches it, because the office is served by
 * layer 1.
 */
const DEFAULT_PAST_DAYS = 90;
const DEFAULT_FUTURE_DAYS = 90;
const MAX_RANGE_DAYS = 400;
const MAX_ROWS = 2000;

/**
 * How long a schedule response may be reused.
 *
 * Bounded by how stale the public board is allowed to look: a booking made now shows up
 * to anonymous visitors within a minute. The authenticated views read /api/reservations,
 * which is never cached, so nobody managing a booking sees a stale copy of their own work.
 */
const CACHE_TTL_SECONDS = 60;

const shiftDate = (days: number): string =>
  new Date(Date.now() + days * 86400000).toISOString().substring(0, 10);

publicApp.get('/', async (c) => {
  const { from: rawFrom, to: rawTo, roomId } = c.req.query();

  const from = rawFrom || shiftDate(-DEFAULT_PAST_DAYS);
  const to = rawTo || shiftDate(DEFAULT_FUTURE_DAYS);

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(span) || span > MAX_RANGE_DAYS) {
    return c.json({ success: false, error: `查詢區間過長，單次最多 ${MAX_RANGE_DAYS} 天` }, 400);
  }

  // Built from the *resolved* parameters, not from the raw URL: `/schedule`,
  // `/schedule?`, and `/schedule?roomId=` are the same question and must share one entry,
  // or a caller could walk past the cache by permuting the query string.
  //
  // Every cache interaction is optional. The Cache API is a no-op or absent in some
  // runtimes this code is loaded in (the vitest pool, older local-dev setups), and a
  // caching layer that takes the endpoint down when it is unavailable is worse than no
  // caching layer at all.
  const cache: any = typeof caches !== 'undefined' ? (caches as any).default : undefined;
  const cacheKey = new Request(
    `https://public-schedule.internal/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&roomId=${encodeURIComponent(roomId || '')}`
  );

  if (cache) {
    const cached = await cache.match(cacheKey);
    // Re-wrapped rather than returned as-is: a Response handed back by the Cache API has
    // immutable headers, and the middleware in index.ts sets headers on whatever the
    // handler returns — which would throw on the cache-hit path only, i.e. in production
    // under load and nowhere else.
    if (cached) return new Response(cached.body, cached);
  }

  // Only cache misses are metered — see the note above. `limit()` fails open on a runtime
  // that has no binding, which is the same call made for every other optional dependency
  // here: a public read endpoint degrading to "unthrottled" beats it degrading to "down".
  if (c.env.PUBLIC_RATE_LIMITER) {
    const { success } = await c.env.PUBLIC_RATE_LIMITER.limit({ key: getClientIp(c) });
    if (!success) {
      return c.json(
        { success: false, error: '查詢過於頻繁，請稍後再試' },
        429,
        // Retry-After matches `period` in wrangler.json: telling a caller to come back in a
        // minute when the window clears in ten seconds turns a brake into an outage.
        //
        // no-store because this path is exempt from the blanket rule in index.ts, and a
        // throttle response is the one answer here that is about the caller rather than
        // about the data — it must never be handed to the next visitor from the colo.
        { 'Retry-After': '10', 'Cache-Control': 'no-store' }
      );
    }
  }

  let query = `
    SELECT r.id, r.room_id, rm.name as room_name, rm.color_key as room_color,
           r.date, r.start_min, r.end_min, d.name as dept_name
    FROM reservations r
    JOIN rooms rm ON r.room_id = rm.id
    JOIN users u ON r.user_id = u.id
    LEFT JOIN departments d ON u.dept_id = d.id
    WHERE r.status = 'active'
  `;
  const params: any[] = [from, to];
  query += ` AND r.date >= ? AND r.date <= ?`;

  if (roomId) {
    query += ` AND r.room_id = ?`;
    params.push(roomId);
  }

  query += ` ORDER BY r.date ASC, r.start_min ASC LIMIT ?`;
  params.push(MAX_ROWS);

  const rows = await c.env.DB.prepare(query).bind(...params).all<any>();

  const schedule = (rows.results || []).map((r: any) => ({
    id: r.id,
    roomId: r.room_id,
    roomName: r.room_name,
    roomColor: r.room_color,
    date: r.date,
    startMin: r.start_min,
    endMin: r.end_min,
    startTime: minToTimeStr(r.start_min),
    endTime: minToTimeStr(r.end_min),
    deptName: r.dept_name || '衛生局科室',
    title: '預約使用中 (公務會議)',
  }));

  // Echo the window so a client that sent no range can tell what it actually got back,
  // rather than mistaking a truncated view for the whole picture.
  const res = c.json({ success: true, schedule, range: { from, to } });

  // The one API response that is allowed to be cached, which is why the no-store rule in
  // index.ts skips /api/public/*. Nothing here is authorised by a cookie and nothing here
  // is personal — the payload is exactly what an anonymous visitor already sees.
  res.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);

  if (cache) {
    // `waitUntil` where it is available, so the write does not sit in the response path;
    // `c.executionCtx` throws rather than returning undefined when the runtime has none,
    // hence the catch. Failing to populate the cache costs a D1 query next time and
    // nothing else, so it must never fail the request.
    const write = cache.put(cacheKey, res.clone()).catch(() => {});
    try {
      c.executionCtx.waitUntil(write);
    } catch {
      /* no execution context here; the put still runs, just unawaited */
    }
  }

  return res;
});

export default publicApp;
