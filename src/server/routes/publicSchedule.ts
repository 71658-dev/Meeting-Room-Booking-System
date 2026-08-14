import { Hono } from 'hono';
import { minToTimeStr } from './reservations';
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
 * Request *rate* is deliberately not limited in the Worker: this is the one route an
 * anonymous flood would target, and metering it here means a KV read and write per hit,
 * which is itself the cost being defended against. Rate limiting belongs at the edge —
 * configure a Cloudflare rate-limiting rule on /api/public/schedule.
 */
const DEFAULT_PAST_DAYS = 90;
const DEFAULT_FUTURE_DAYS = 90;
const MAX_RANGE_DAYS = 400;
const MAX_ROWS = 2000;

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
  return c.json({ success: true, schedule, range: { from, to } });
});

export default publicApp;
