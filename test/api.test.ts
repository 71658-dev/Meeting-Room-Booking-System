import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { reconcileAddedColumns } from '../src/server/index';

// Requests are issued against the worker running in workerd. ORIGIN must match the
// request host or csrfMiddleware rejects every state-changing call.
const ORIGIN = 'https://example.com';
const url = (path: string) => `${ORIGIN}${path}`;

const SUPERADMIN_ID = '99999';

// The value of SUPERADMIN_DEFAULT_PASSWORD in vitest.config.ts. It only ever gets the
// account created and the first login through: the bootstrap sets must_change_password,
// so nothing else is reachable until it has been replaced.
const BOOTSTRAP_PASSWORD = 'test-only-bootstrap-password-9f3a';

// What the account actually uses for the rest of the run. Mutable because changing a
// password is itself under test, and because password history forbids going back — a
// test that reverted to an earlier value would be rejected by the last-3 rule.
let superadminPassword = 'Tangerine-Pylon-47';

// Any non-empty token verifies against Cloudflare's always-pass testing secret, which
// is the only place that secret is configured (see vitest.config.ts).
const TURNSTILE = 'test-token';

function post(path: string, body: unknown, init: RequestInit = {}) {
  // `init` is spread first so that caller-supplied headers merge into the defaults
  // rather than replacing them — dropping Origin here would make every call look like
  // a cross-site request to csrfMiddleware.
  return SELF.fetch(url(path), {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(init.headers as any) },
    body: JSON.stringify(body),
  });
}

async function login(password: string): Promise<string> {
  const res = await post('/api/auth/login', {
    id: SUPERADMIN_ID,
    password,
    turnstileToken: TURNSTILE,
  });
  expect(res.status).toBe(200);

  const setCookie = res.headers.get('set-cookie');
  expect(setCookie, 'login must issue a session cookie').toBeTruthy();
  return setCookie!.split(';')[0];
}

const loginAsSuperadmin = () => login(superadminPassword);

/** Change the superadmin password and remember it, so later logins keep working. */
async function changeSuperadminPassword(cookie: string, next: string) {
  const res = await post(
    '/api/auth/password',
    { oldPassword: superadminPassword, newPassword: next },
    { headers: { Cookie: cookie } }
  );
  expect(res.status, await res.text()).toBe(200);
  superadminPassword = next;
}

beforeAll(async () => {
  // First API call triggers the schema bootstrap; the superadmin row is created by the
  // SUPERADMIN_DEFAULT_PASSWORD-gated path on first login.
  await SELF.fetch(url('/api/config'));

  // That bootstrap account lands with must_change_password = 1 — the secret is a delivery
  // mechanism for the first login, not a password — so every other endpoint is refused
  // until it has been replaced. Do that once here; the rest of the suite logs in normally.
  const bootstrapCookie = await login(BOOTSTRAP_PASSWORD);

  const blocked = await SELF.fetch(url('/api/users'), { headers: { Cookie: bootstrapCookie } });
  expect(blocked.status, 'bootstrap credential must not unlock the system').toBe(403);

  const res = await post(
    '/api/auth/password',
    { oldPassword: BOOTSTRAP_PASSWORD, newPassword: superadminPassword },
    { headers: { Cookie: bootstrapCookie } }
  );
  expect(res.status, await res.text()).toBe(200);
});

describe('public surface', () => {
  it('serves the de-identified schedule without authentication', async () => {
    const res = await SELF.fetch(url('/api/public/schedule'));
    expect(res.status).toBe(200);

    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.schedule)).toBe(true);
  });

  it('never exposes reservation PII to unauthenticated callers', async () => {
    const res = await SELF.fetch(url('/api/reservations'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for the removed v1 compatibility endpoints', async () => {
    for (const path of ['/api/data', '/api/send-email', '/api/login']) {
      const res = await SELF.fetch(url(path));
      expect(res.status, `${path} must not exist`).toBe(404);
    }
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request with no Origin or Referer', async () => {
    const res = await SELF.fetch(url('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', password: 'y' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-site Origin', async () => {
    const res = await SELF.fetch(url('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({ id: 'x', password: 'y' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows safe methods without an Origin', async () => {
    const res = await SELF.fetch(url('/api/config'));
    expect(res.status).toBe(200);
  });
});

describe('authentication', () => {
  it('refuses login without a Turnstile token', async () => {
    const res = await post('/api/auth/login', { id: SUPERADMIN_ID, password: superadminPassword });
    expect(res.status).toBe(403);
  });

  it('logs in the bootstrapped superadmin and sets an httpOnly cookie', async () => {
    const res = await post('/api/auth/login', {
      id: SUPERADMIN_ID,
      password: superadminPassword,
      turnstileToken: TURNSTILE,
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(body.user.role).toBe('superadmin');
    // The session token must travel only in the cookie.
    expect(body.token).toBeUndefined();
  });

  it('rejects a wrong password with the same message as an unknown account', async () => {
    const wrong = await post('/api/auth/login', {
      id: SUPERADMIN_ID, password: 'definitely-not-the-password', turnstileToken: TURNSTILE,
    });
    const unknown = await post('/api/auth/login', {
      id: 'no-such-user-12345', password: 'definitely-not-the-password', turnstileToken: TURNSTILE,
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json<any>()).toEqual(await unknown.json<any>());
  });

  it('locks an account after five failures', async () => {
    const id = 'lockout-probe';
    let last: Response | undefined;

    for (let i = 0; i < 6; i++) {
      last = await post('/api/auth/login', { id, password: `wrong-${i}`, turnstileToken: TURNSTILE });
    }

    expect(last!.status).toBe(429);
  });

  it('rejects an unauthenticated call to /api/auth/me', async () => {
    const res = await SELF.fetch(url('/api/auth/me'));
    expect(res.status).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const cookie = await loginAsSuperadmin();

    const before = await SELF.fetch(url('/api/auth/me'), { headers: { Cookie: cookie } });
    expect(before.status).toBe(200);

    const out = await post('/api/auth/logout', {}, { headers: { Cookie: cookie } });
    expect(out.status).toBe(200);

    const after = await SELF.fetch(url('/api/auth/me'), { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });
});

/**
 * Bookings must be in the future, so test dates cannot be literals — a hardcoded
 * '2026-09-15' passes until that day arrives and then fails forever.
 */
const daysFromNow = (n: number) => {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  return d.toISOString().substring(0, 10);
};

describe('reservations', () => {
  it('enforces the booking conflict rule on the server', async () => {
    const cookie = await loginAsSuperadmin();
    const headers = { Cookie: cookie };

    const base = {
      roomId: 'room-1',
      date: daysFromNow(30),
      reason: '第一場會議',
      turnstileToken: TURNSTILE,
    };

    const first = await post(
      '/api/reservations',
      { ...base, startTime: '09:00', endTime: '10:30' },
      { headers }
    );
    expect(first.status).toBe(200);

    // Overlaps 09:00-10:30 by half an hour.
    const overlapping = await post(
      '/api/reservations',
      { ...base, startTime: '10:00', endTime: '11:00', reason: '第二場會議' },
      { headers }
    );
    expect(overlapping.status).toBe(409);
    expect((await overlapping.json<any>()).conflict).toBeTruthy();

    // Touching but not overlapping: the previous booking ends exactly at 10:30.
    const adjacent = await post(
      '/api/reservations',
      { ...base, startTime: '10:30', endTime: '11:00', reason: '銜接場次' },
      { headers }
    );
    expect(adjacent.status).toBe(200);
  });

  it('enforces the conflict rule when a booking is moved, not just created', async () => {
    const cookie = await loginAsSuperadmin();
    const headers = { Cookie: cookie };
    const date = daysFromNow(45);

    const occupied = await post(
      '/api/reservations',
      { roomId: 'room-1', date, startTime: '14:00', endTime: '15:00', reason: '既有會議' },
      { headers }
    );
    expect(occupied.status).toBe(200);

    const mover = await post(
      '/api/reservations',
      { roomId: 'room-1', date, startTime: '16:00', endTime: '17:00', reason: '要改期的會議' },
      { headers }
    );
    expect(mover.status).toBe(200);
    const { reservationId } = await mover.json<any>();

    // The check rides in the UPDATE's WHERE clause, so this exercises the same statement
    // that performs the write — not a separate read that a concurrent write could outrun.
    const clash = await SELF.fetch(url(`/api/reservations/${reservationId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify({ startTime: '14:30', endTime: '15:30' }),
    });
    expect(clash.status).toBe(409);
    expect((await clash.json<any>()).conflict).toBeTruthy();

    // The row must be untouched by the refused edit.
    const row = await env.DB.prepare(`SELECT start_min FROM reservations WHERE id = ?`)
      .bind(reservationId)
      .first<any>();
    expect(row.start_min).toBe(16 * 60);

    // Moving somewhere free still works — the guard must not reject its own row.
    const ok = await SELF.fetch(url(`/api/reservations/${reservationId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify({ startTime: '16:30', endTime: '17:30' }),
    });
    expect(ok.status).toBe(200);
  });

  it('rejects an end time that is not after the start time', async () => {
    const cookie = await loginAsSuperadmin();
    const res = await post(
      '/api/reservations',
      { roomId: 'room-1', date: daysFromNow(31), startTime: '11:00', endTime: '11:00', reason: '零長度' },
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(400);
  });

  it('returns a Chinese validation message rather than a 500', async () => {
    const cookie = await loginAsSuperadmin();
    const res = await post(
      '/api/reservations',
      { roomId: 'room-1', date: 'not-a-date', startTime: '09:00', endTime: '10:00', reason: 'x' },
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toContain('YYYY-MM-DD');
  });
});

describe('authorisation', () => {
  it('refuses the audit log to non-superadmins and requires auth', async () => {
    const res = await SELF.fetch(url('/api/audit'));
    expect(res.status).toBe(401);
  });

  it('refuses user administration without a session', async () => {
    const res = await SELF.fetch(url('/api/users'));
    expect(res.status).toBe(401);
  });

  it('will not leave the system without an active superadmin', async () => {
    const cookie = await loginAsSuperadmin();
    const res = await SELF.fetch(url(`/api/users/${SUPERADMIN_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(409);
  });
});

/**
 * Regressions from the v2 security review. Each of these is a path that was reachable,
 * not a hypothetical — see SECURITY_REPORT_V2.md.
 */
describe('credential handling', () => {
  it('refuses to reset your own password, even as superadmin (H-2)', async () => {
    const cookie = await loginAsSuperadmin();

    // The endpoint returns a working one-time password and revokes every session for the
    // account. Reachable against yourself, a stolen cookie was enough to take the account
    // over permanently, bypassing the old-password check that /api/auth/password enforces.
    const res = await post(`/api/users/${SUPERADMIN_ID}/reset-password`, {}, { headers: { Cookie: cookie } });

    expect(res.status).toBe(403);
    expect((await res.json<any>()).tempPassword).toBeUndefined();
  });

  it('never writes a password hash into the audit log (H-1)', async () => {
    const cookie = await loginAsSuperadmin();

    // A user edit used to snapshot `SELECT *` as before_json, copying password_hash into
    // a table with no expiry that GET /api/audit hands back whole.
    const patch = await SELF.fetch(url(`/api/users/${SUPERADMIN_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ ext: '123' }),
    });
    expect(patch.status).toBe(200);

    // The snapshot must still be written — a redaction that silently dropped the audit
    // entry would pass a "no hash present" check while destroying the trail it protects.
    const entry = await env.DB
      .prepare(
        `SELECT before_json FROM audit_log
         WHERE action = 'UPDATE_USER' AND entity_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .bind(SUPERADMIN_ID)
      .first<any>();
    expect(entry, 'the user edit must still be audited').toBeTruthy();
    expect(entry.before_json).toContain('"role"');

    const leaked = await env.DB
      .prepare(
        `SELECT COUNT(*) as count FROM audit_log
         WHERE before_json LIKE '%pbkdf2%' OR after_json LIKE '%pbkdf2%'
            OR before_json LIKE '%password_hash%' OR after_json LIKE '%password_hash%'`
      )
      .first<any>();
    expect(leaked.count, 'audit_log must not contain password material').toBe(0);

    const res = await SELF.fetch(url('/api/audit'), { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('pbkdf2');
  });

  it('clamps audit paging instead of dumping the table or 500ing (M-3)', async () => {
    const cookie = await loginAsSuperadmin();
    const headers = { Cookie: cookie };

    // limit=-1 is "no limit" to SQLite; limit=abc binds NaN and used to surface as a 500.
    const negative = await SELF.fetch(url('/api/audit?limit=-1'), { headers });
    expect(negative.status).toBe(200);
    expect((await negative.json<any>()).limit).toBe(1);

    const nonNumeric = await SELF.fetch(url('/api/audit?limit=abc&page=0'), { headers });
    expect(nonNumeric.status).toBe(200);
    const body = await nonNumeric.json<any>();
    expect(body.limit).toBe(50);
    expect(body.page).toBe(1);

    const huge = await SELF.fetch(url('/api/audit?limit=100000'), { headers });
    expect((await huge.json<any>()).limit).toBe(200);
  });
});

describe('request size and range limits', () => {
  it('caps the free-text booking fields (M-2)', async () => {
    const cookie = await loginAsSuperadmin();
    const res = await post(
      '/api/reservations',
      {
        roomId: 'room-1',
        date: daysFromNow(60),
        startTime: '09:00',
        endTime: '10:00',
        reason: 'x'.repeat(5000),
      },
      { headers: { Cookie: cookie } }
    );
    expect(res.status).toBe(400);
  });

  it('leaves the authenticated listing unwindowed so statistics stay complete', async () => {
    const cookie = await loginAsSuperadmin();

    // Inserted directly: the API refuses to create a booking this far back, which is the
    // point — it sits well outside any default window, so if one existed this row would
    // vanish from the totals without anything saying so.
    const longAgo = daysFromNow(-800);
    const nowStr = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO reservations
         (id, room_id, user_id, date, start_min, end_min, reason, meeting_type,
          headcount, notes, attendees_email, status, created_at, updated_at)
       VALUES ('res-stats-window-probe', 'room-1', ?, ?, 540, 600, '兩年前的會議',
               'internal', 3, NULL, NULL, 'active', ?, ?)`
    )
      .bind(SUPERADMIN_ID, longAgo, nowStr, nowStr)
      .run();

    const res = await SELF.fetch(url('/api/reservations'), { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    const body = await res.json<any>();
    expect(body.truncated).toBe(false);
    expect(
      body.reservations.some((r: any) => r.id === 'res-stats-window-probe'),
      'a booking from two years ago must still be counted'
    ).toBe(true);
  });

  it('applies a default window to an unqualified schedule request (M-4)', async () => {
    const res = await SELF.fetch(url('/api/public/schedule'));
    expect(res.status).toBe(200);

    // Anonymous callers used to get every booking ever recorded in one request.
    const { range } = await res.json<any>();
    expect(range.from).toBeTruthy();
    expect(range.to).toBeTruthy();
    expect(range.from < range.to).toBe(true);
  });

  it('refuses an over-wide explicit range (M-4)', async () => {
    const res = await SELF.fetch(url('/api/public/schedule?from=1990-01-01&to=2090-01-01'));
    expect(res.status).toBe(400);
  });
});

describe('security headers', () => {
  it('sends a CSP with no unsafe-eval or inline script', async () => {
    const res = await SELF.fetch(url('/api/config'));
    const csp = res.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('sets the standard hardening headers', async () => {
    const res = await SELF.fetch(url('/api/config'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('matches public/_headers on HSTS and Permissions-Policy (L-11)', async () => {
    // Static assets never reach the Worker, so the two header sets are maintained
    // separately — and these two had been added to public/_headers only, leaving every
    // /api/* response without them.
    const res = await SELF.fetch(url('/api/config'));
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
  });
});

/**
 * 過去的時間不可新增預約，只能瀏覽或刪除.
 *
 * These run against the Worker rather than the helper in src/shared/time, because the
 * point of the rule is that it holds for a caller who never loads the UI. The client-side
 * checks are convenience only.
 */
describe('past bookings are read-only apart from cancellation', () => {
  /** Insert a booking directly, which is the only way to get a past one into the table. */
  async function seedPastReservation(id: string) {
    const nowStr = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO reservations
         (id, room_id, user_id, date, start_min, end_min, reason, meeting_type,
          headcount, notes, attendees_email, status, created_at, updated_at)
       VALUES (?, 'room-1', ?, ?, 540, 630, '已結束的會議', 'internal', 5, NULL, NULL,
               'active', ?, ?)`
    )
      .bind(id, SUPERADMIN_ID, daysFromNow(-7), nowStr, nowStr)
      .run();
  }

  it('refuses to create a booking on a past date', async () => {
    const cookie = await loginAsSuperadmin();
    const res = await post(
      '/api/reservations',
      { roomId: 'room-1', date: daysFromNow(-1), startTime: '09:00', endTime: '10:00', reason: '補登' },
      { headers: { Cookie: cookie } }
    );

    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toContain('過去');
  });

  it('refuses to move an existing booking backwards into the past', async () => {
    const cookie = await loginAsSuperadmin();
    const headers = { Cookie: cookie };

    const created = await post(
      '/api/reservations',
      { roomId: 'room-1', date: daysFromNow(40), startTime: '09:00', endTime: '10:00', reason: '可改期的會議' },
      { headers }
    );
    expect(created.status).toBe(200);
    const { reservationId } = await created.json<any>();

    const moved = await SELF.fetch(url(`/api/reservations/${reservationId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify({ date: daysFromNow(-2) }),
    });

    expect(moved.status).toBe(400);
    expect((await moved.json<any>()).error).toContain('過去');
  });

  it('refuses to edit a booking that has already started', async () => {
    const cookie = await loginAsSuperadmin();
    const resId = 'res-past-edit-test';
    await seedPastReservation(resId);

    const res = await SELF.fetch(url(`/api/reservations/${resId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ reason: '事後竄改的事由' }),
    });

    expect(res.status).toBe(400);

    // The stored row must be untouched.
    const row = await env.DB.prepare(`SELECT reason FROM reservations WHERE id = ?`)
      .bind(resId)
      .first<any>();
    expect(row.reason).toBe('已結束的會議');
  });

  it('still allows cancelling a past booking', async () => {
    const cookie = await loginAsSuperadmin();
    const resId = 'res-past-cancel-test';
    await seedPastReservation(resId);

    const res = await SELF.fetch(url(`/api/reservations/${resId}`), {
      method: 'DELETE',
      headers: { Origin: ORIGIN, Cookie: cookie },
    });

    expect(res.status).toBe(200);

    // Soft delete: the row survives for the audit trail.
    const row = await env.DB.prepare(`SELECT status FROM reservations WHERE id = ?`)
      .bind(resId)
      .first<any>();
    expect(row.status).toBe('cancelled');
  });
});

/**
 * Schema drift between a database created from an older CREATE TABLE and the columns the
 * code now names. See ADDED_COLUMNS in src/server/index.ts.
 */
describe('schema column reconciliation', () => {
  const columnNames = async () => {
    const info = await env.DB.prepare(`PRAGMA table_info(users)`).all<{ name: string }>();
    return (info.results || []).map((r) => r.name);
  };

  it('adds a column that an older database is missing, and is idempotent', async () => {
    await SELF.fetch(url('/api/config'));
    expect(await columnNames()).toContain('password_expires_at');

    // Recreate the drift that broke dev: a users table from before migrations/0002.
    await env.DB.prepare(`ALTER TABLE users DROP COLUMN password_expires_at`).run();
    expect(await columnNames()).not.toContain('password_expires_at');

    await reconcileAddedColumns(env.DB);
    expect(await columnNames()).toContain('password_expires_at');

    // Running again must not throw — it executes on every cold isolate.
    await reconcileAddedColumns(env.DB);
    expect(await columnNames()).toContain('password_expires_at');
  });

  it('lets the password change succeed once the column is present', async () => {
    const cookie = await loginAsSuperadmin();

    // Moves forward rather than changing and reverting: password_history forbids reusing
    // any of the last three, so putting the old value back would now be rejected on the
    // rule's own terms. changeSuperadminPassword records the new one for later logins.
    await changeSuperadminPassword(cookie, 'Str0ng-Replacement-Pass!2026');

    const relogin = await post('/api/auth/login', {
      id: SUPERADMIN_ID,
      password: superadminPassword,
      turnstileToken: TURNSTILE,
    });
    expect(relogin.status).toBe(200);
  });
});
