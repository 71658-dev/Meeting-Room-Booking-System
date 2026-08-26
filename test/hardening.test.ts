import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';

/**
 * Regression tests for the 2026-08 hardening pass.
 *
 * Kept in their own file rather than appended to api.test.ts because that suite mutates a
 * single superadmin password across its cases in order; these need a session but nothing
 * else from it, so isolating them keeps that ordering fragile in one place only.
 */

const ORIGIN = 'https://example.com';
const url = (path: string) => `${ORIGIN}${path}`;
const SUPERADMIN_ID = '99999';
const BOOTSTRAP_PASSWORD = 'test-only-bootstrap-password-9f3a';
const WORKING_PASSWORD = 'Cardamom-Trellis-82';
const TURNSTILE = 'test-token';

function post(path: string, body: unknown, init: RequestInit = {}) {
  return SELF.fetch(url(path), {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(init.headers as any) },
    body: JSON.stringify(body),
  });
}

/** POST a raw, un-serialised body — the point of several tests below. */
function postRaw(path: string, body: string, init: RequestInit = {}) {
  return SELF.fetch(url(path), {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(init.headers as any) },
    body,
  });
}

const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().substring(0, 10);

let cookie: string;

beforeAll(async () => {
  await SELF.fetch(url('/api/config'));

  const bootstrap = await post('/api/auth/login', {
    id: SUPERADMIN_ID,
    password: BOOTSTRAP_PASSWORD,
    turnstileToken: TURNSTILE,
  });
  const bootstrapCookie = bootstrap.headers.get('set-cookie')!.split(';')[0];

  await post(
    '/api/auth/password',
    { oldPassword: BOOTSTRAP_PASSWORD, newPassword: WORKING_PASSWORD },
    { headers: { Cookie: bootstrapCookie } }
  );

  const res = await post('/api/auth/login', {
    id: SUPERADMIN_ID,
    password: WORKING_PASSWORD,
    turnstileToken: TURNSTILE,
  });
  expect(res.status, await res.text()).toBe(200);
  cookie = res.headers.get('set-cookie')!.split(';')[0];
});

describe('malformed input is a 400, not a 500', () => {
  it('answers a body that is not JSON with a Chinese 400', async () => {
    // `await c.req.json()` throws on an unparseable body. Every mutating route called it
    // unguarded, so `curl -d 'x'` produced a server error — on the login endpoint, without
    // a session, from anywhere.
    const res = await postRaw('/api/auth/login', 'not json at all');
    expect(res.status).toBe(400);

    const body = await res.json<any>();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('does the same on an authenticated route', async () => {
    const res = await postRaw('/api/reservations', '{{{', { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long account id instead of overflowing the throttle key', async () => {
    // `id` is concatenated into the KV lockout key. Unbounded, a long enough value pushes
    // that key past KV's limit and the failure surfaces as a 500 on the login endpoint.
    const res = await post('/api/auth/login', {
      id: 'x'.repeat(5000),
      password: 'irrelevant-but-long-enough',
      turnstileToken: TURNSTILE,
    });
    expect(res.status).toBe(400);
  });
});

describe('response hygiene', () => {
  it('marks every API response uncacheable', async () => {
    // These bodies carry 事由/備註/姓名 and are authorised by a cookie, not by the URL.
    const res = await SELF.fetch(url('/api/reservations'), { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('vary')).toContain('Cookie');
  });

  it('keeps the security headers on a 404 as well as a 200', async () => {
    const res = await SELF.fetch(url('/api/definitely-not-a-route'), { method: 'POST', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('no longer sends the deprecated XSS auditor opt-in', async () => {
    const res = await SELF.fetch(url('/api/config'));
    expect(res.headers.get('x-xss-protection')).toBe('0');
  });
});

describe('bookings may only reference real, bookable resources', () => {
  it('refuses a booking against a room that does not exist', async () => {
    const res = await post(
      '/api/reservations',
      {
        roomId: 'room-does-not-exist',
        date: daysFromNow(60),
        startTime: '09:00',
        endTime: '10:00',
        reason: '幽靈會議',
      },
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toContain('會議室');
  });

  it('refuses a booking against a deactivated room', async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rooms (id, name, capacity, location, color_key, is_active)
       VALUES ('room-retired', '已裁撤會議室', 10, '—', 'cat-1', 0)`
    ).run();

    const res = await post(
      '/api/reservations',
      {
        roomId: 'room-retired',
        date: daysFromNow(61),
        startTime: '09:00',
        endTime: '10:00',
        reason: '停用會議室',
      },
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(400);
  });

  it('drops unknown equipment ids rather than storing them', async () => {
    const created = await post(
      '/api/reservations',
      {
        roomId: 'room-1',
        date: daysFromNow(62),
        startTime: '09:00',
        endTime: '10:00',
        reason: '設備驗證',
        equipmentIds: ['eq-1', 'eq-not-real'],
      },
      { headers: { Cookie: cookie } }
    );
    const createdBody = await created.json<any>();
    expect(created.status, JSON.stringify(createdBody)).toBe(200);
    const { reservationId } = createdBody;

    const rows = await env.DB.prepare(
      `SELECT equipment_id FROM reservation_equipment WHERE reservation_id = ?`
    )
      .bind(reservationId)
      .all<any>();

    const stored = (rows.results || []).map((r: any) => r.equipment_id);
    expect(stored).toContain('eq-1');
    expect(stored).not.toContain('eq-not-real');
  });

  it('survives a duplicated equipment id on edit', async () => {
    const created = await post(
      '/api/reservations',
      {
        roomId: 'room-1',
        date: daysFromNow(63),
        startTime: '09:00',
        endTime: '10:00',
        reason: '重複設備',
      },
      { headers: { Cookie: cookie } }
    );
    const { reservationId } = await created.json<any>();

    // The old PATCH inserted each element with a bare INSERT, so a repeated id hit the
    // composite primary key and the request 500ed *after* the booking had been updated.
    const patched = await SELF.fetch(url(`/api/reservations/${reservationId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ equipmentIds: ['eq-1', 'eq-1', 'eq-2'] }),
    });
    expect(patched.status, await patched.text()).toBe(200);
  });
});

describe('client-supplied IP headers do not steer the throttle or the audit trail', () => {
  it('ignores X-Forwarded-For when Cloudflare supplies the connecting IP', async () => {
    await post(
      '/api/auth/login',
      { id: 'ip-probe-user', password: 'wrong-password-here', turnstileToken: TURNSTILE },
      { headers: { 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': 'spoofed-value' } }
    );

    const row = await env.DB.prepare(
      `SELECT ip FROM audit_log WHERE actor_id = 'ip-probe-user' ORDER BY id DESC LIMIT 1`
    ).first<any>();

    expect(row?.ip).toBe('203.0.113.9');
  });

  it('will not record a forged X-Forwarded-For value verbatim', async () => {
    // No CF-Connecting-IP here, so the fallback runs — and it accepts only something
    // shaped like an address, because the value ends up as a throttle key and as the
    // recorded origin of the attempt.
    await post(
      '/api/auth/login',
      { id: 'ip-probe-user-2', password: 'wrong-password-here', turnstileToken: TURNSTILE },
      { headers: { 'X-Forwarded-For': 'not-an-ip-at-all' } }
    );

    const row = await env.DB.prepare(
      `SELECT ip FROM audit_log WHERE actor_id = 'ip-probe-user-2' ORDER BY id DESC LIMIT 1`
    ).first<any>();

    expect(row?.ip).toBe('127.0.0.1');
  });
});

describe('session cookie carries the __Host- prefix', () => {
  it('names the cookie __Host-meeting_session and satisfies the prefix rules', async () => {
    const res = await post('/api/auth/login', {
      id: SUPERADMIN_ID,
      password: WORKING_PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain('__Host-meeting_session=');
    // A browser drops a __Host- cookie unless all three hold, so these are correctness
    // requirements, not hardening extras.
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toContain('Domain=');
    // Unchanged, but they are why the cookie is worth protecting in the first place.
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('no longer accepts a session under the old cookie name', async () => {
    // The rename is the migration: a cookie tossed in under `meeting_session` is not a
    // session any more, whatever it contains.
    const res = await SELF.fetch(url('/api/auth/me'), {
      headers: { Cookie: `meeting_session=${cookie.split('=')[1]}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('the public schedule is cacheable; everything else is not', () => {
  it('lets the de-identified schedule be cached at the edge', async () => {
    // This is the free replacement for a WAF rate-limiting rule: the flood target is
    // answered from the colo instead of from D1.
    const res = await SELF.fetch(url('/api/public/schedule'));
    expect(res.status).toBe(200);

    const cacheControl = res.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('public');
    expect(cacheControl).toContain('max-age=');
    expect(cacheControl).not.toContain('no-store');
  });

  it('still refuses to let an authenticated response be cached', async () => {
    const res = await SELF.fetch(url('/api/auth/me'), { headers: { Cookie: cookie } });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('serves the same answer whether or not the query string is present', async () => {
    // The cache key is built from the resolved window, so these must not be two entries.
    const bare = await SELF.fetch(url('/api/public/schedule'));
    const empty = await SELF.fetch(url('/api/public/schedule?roomId='));

    expect(bare.status).toBe(200);
    expect(empty.status).toBe(200);
    expect(await empty.json<any>()).toEqual(await bare.json<any>());
  });
});
