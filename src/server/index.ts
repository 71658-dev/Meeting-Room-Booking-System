import { Hono } from 'hono';
import authApp from './routes/auth';
import resApp from './routes/reservations';
import roomsApp from './routes/rooms';
import deptsApp from './routes/departments';
import equipApp from './routes/equipment';
import usersApp from './routes/users';
import auditApp from './routes/audit';
import publicApp from './routes/publicSchedule';
import configApp from './routes/config';
import { csrfMiddleware } from './middleware/security';
import { HonoEnv } from './types';

const app = new Hono<HonoEnv>();

// Security Headers Middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '1; mode=block');
  // These two were in public/_headers but not here, so /api/* responses — the only ones
  // that actually reach the Worker — went out without them. The two lists are supposed to
  // be the same list; keep them that way.
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // No 'unsafe-eval' and no 'unsafe-inline' in script-src: the Preact/Vite build needs
  // neither, and removing them is the main CSP win the v2 rewrite was meant to deliver.
  // style-src still allows 'unsafe-inline' because a few components set percentage
  // widths via the style prop; that is a far weaker exposure and there is no innerHTML
  // anywhere in the client.
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' https://challenges.cloudflare.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; " +
      "frame-src https://challenges.cloudflare.com; " +
      "img-src 'self' data:; " +
      "connect-src 'self' https://challenges.cloudflare.com; " +
      "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
});

// Auto-migration & database bootstrap check.
// Cached per isolate so we do not pay an extra D1 round-trip on every API request.
let schemaReady = false;

/**
 * Columns added to a table after that table first shipped.
 *
 * `CREATE TABLE IF NOT EXISTS` below is a no-op against a database that already has the
 * table, so it can create a *missing* table but can never retrofit a *new column* onto an
 * existing one. Adding a column to the CREATE above therefore only reaches databases
 * created from scratch afterwards — every older one silently lacks it, and the first
 * statement that names the column fails at runtime.
 *
 * That is not hypothetical: `users.password_expires_at` (migrations/0002) never reached
 * the dev database, and 變更密碼 / 新增帳號 / 重置密碼 all returned 500 there because
 * their UPDATE and INSERT name the column.
 *
 * So: adding a column means adding a file to migrations/ *and* the column to the CREATE
 * above *and* an entry here. Table names are literals in this list, never request data.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; type: string }> = [
  { table: 'users', column: 'password_expires_at', type: 'TEXT' },
];

export async function reconcileAddedColumns(db: D1Database): Promise<void> {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const present = (info.results || []).some((row) => row.name === column);
    if (present) continue;

    console.log(`Schema drift: adding ${table}.${column}`);
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

app.use('/api/*', async (c, next) => {
  if (schemaReady) {
    await next();
    return;
  }

  try {
    // Quick DB check to ensure tables exist
    await c.env.DB.prepare(`SELECT 1 FROM users LIMIT 1`).first();

    // The tables are here, but they may predate a later column. A failure is logged
    // rather than thrown: an isolate that cannot reconcile still serves every route that
    // does not touch the missing column, which beats returning 500 for all of them.
    try {
      await reconcileAddedColumns(c.env.DB);
    } catch (columnErr) {
      console.error('Column reconciliation failed:', columnErr);
    }

    schemaReady = true;
  } catch (err) {
    console.log('Tables missing, bootstrapping schema...');
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, dept_id TEXT NOT NULL, ext TEXT, email TEXT,
          role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin', 'admin', 'staff')),
          password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          password_expires_at TEXT)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS departments (
          id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, phone TEXT, sort_order INTEGER DEFAULT 0)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, capacity INTEGER DEFAULT 0, location TEXT, color_key TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS equipment (
          id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER DEFAULT 0)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY, room_id TEXT NOT NULL, user_id TEXT NOT NULL, date TEXT NOT NULL,
          start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, reason TEXT NOT NULL, meeting_type TEXT NOT NULL DEFAULT 'internal',
          headcount INTEGER DEFAULT 1, notes TEXT, attendees_email TEXT, status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancelled_at TEXT, cancelled_by TEXT)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS reservation_equipment (
          reservation_id TEXT NOT NULL, equipment_id TEXT NOT NULL, PRIMARY KEY (reservation_id, equipment_id))`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL, ip TEXT, user_agent TEXT, revoked_at TEXT)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
          entity_id TEXT, before_json TEXT, after_json TEXT, ip TEXT, created_at TEXT NOT NULL)`),
        c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`),
      ]);

      // Seed non-secret reference data only.
      //
      // NO user accounts are seeded here. A previous revision embedded password
      // hashes for '99999' and '71658' directly in this file — they were plain
      // unsalted SHA-256 of guessable passwords, committed to a public repository,
      // which handed anyone who read the source a superadmin login.
      // The only way an account comes into existence now is:
      //   - the SUPERADMIN_DEFAULT_PASSWORD-gated bootstrap in routes/auth.ts, or
      //   - an authenticated admin creating one via POST /api/users.
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT OR IGNORE INTO departments (id, name, phone, sort_order) VALUES
          ('dept-1', '局長室', '5355191', 1), ('dept-2', '副局長室', '5355192', 2), ('dept-3', '秘書室', '5355193', 3),
          ('dept-4', '企劃科', '5355194', 4), ('dept-5', '疾管科', '5355195', 5), ('dept-6', '醫政科', '5355196', 6),
          ('dept-7', '藥政科', '5355197', 7), ('dept-8', '食品藥物管理科', '5355198', 8), ('dept-9', '保健科', '5355199', 9),
          ('dept-10', '檢驗科', '5355200', 10), ('dept-11', '人事室', '5355201', 11), ('dept-12', '政風室', '5355202', 12), ('dept-13', '會計室', '5355203', 13)`),
        c.env.DB.prepare(`INSERT OR IGNORE INTO rooms (id, name, capacity, location, color_key, is_active) VALUES
          ('room-1', '第一會議室', 30, '3 樓 301 室', 'cat-1', 1), ('room-2', '第二會議室', 15, '2 樓 202 室', 'cat-2', 1)`),
        c.env.DB.prepare(`INSERT OR IGNORE INTO equipment (id, name, is_active, sort_order) VALUES
          ('eq-1', '單槍投影機', 1, 1), ('eq-2', '無線麥克風', 1, 2), ('eq-3', '視訊會議設備', 1, 3),
          ('eq-4', '簡報筆', 1, 4), ('eq-5', '筆記型電腦', 1, 5), ('eq-6', '錄音設備', 1, 6)`),
      ]);

      schemaReady = true;
    } catch (bootstrapErr) {
      console.error('Schema bootstrap failed:', bootstrapErr);
    }
  }
  await next();
});

// Origin/Referer check for every state-changing API call. Must be mounted before the
// route handlers so a rejected cross-site request never reaches a handler.
app.use('/api/*', csrfMiddleware);

// API Routes Mounts
app.route('/api/auth', authApp);
app.route('/api/reservations', resApp);
app.route('/api/rooms', roomsApp);
app.route('/api/departments', deptsApp);
app.route('/api/equipment', equipApp);
app.route('/api/users', usersApp);
app.route('/api/audit', auditApp);
app.route('/api/public/schedule', publicApp);
app.route('/api/config', configApp);

// The v1 compatibility endpoints (/api/login, GET+POST /api/data, /api/send-email)
// were removed in the v2 rewrite. Two of them were active vulnerabilities:
//   - GET /api/data returned reservation reason/notes/登記人 to unauthenticated callers.
//   - POST /api/send-email accepted an arbitrary recipient list and an arbitrary
//     reservation body, making it an authenticated open relay for HTML mail sent
//     from the agency's own sender domain.
// The v2 client never called any of them. Use the resource-oriented routes above,
// and /api/public/schedule for the de-identified public view.

// Unmatched API paths must not fall through to the static-asset handler: passing a
// POST there surfaces as an opaque 500 rather than an honest 404.
app.all('/api/*', (c) => c.json({ success: false, error: 'API 端點不存在' }, 404));

// Fallback to static assets.
// Cast through `any`: Hono types Request/Response against the DOM lib while the ASSETS
// binding is typed by @cloudflare/workers-types. The two shapes are structurally
// incompatible at the type level but identical at runtime inside workerd.
app.all('*', async (c) => {
  return (c.env.ASSETS as any).fetch(c.req.raw) as Promise<Response>;
});

export default app;
