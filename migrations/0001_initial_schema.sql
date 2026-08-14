-- Cloudflare D1 Initial Schema for Meeting Room Booking System
-- Database: SQLite

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dept_id TEXT NOT NULL,
  ext TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin', 'admin', 'staff')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- NOTE: password_expires_at is added by 0002_password_expiry.sql.

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  phone TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER DEFAULT 0,
  location TEXT,
  color_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL, -- YYYY-MM-DD
  start_min INTEGER NOT NULL, -- e.g. 510 = 08:30
  end_min INTEGER NOT NULL,   -- e.g. 600 = 10:00
  reason TEXT NOT NULL,
  meeting_type TEXT NOT NULL DEFAULT 'internal',
  headcount INTEGER DEFAULT 1,
  notes TEXT,
  attendees_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT
);

CREATE TABLE IF NOT EXISTS reservation_equipment (
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  PRIMARY KEY (reservation_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Indices for rapid querying and conflict detection
CREATE INDEX IF NOT EXISTS idx_res_room_date ON reservations(room_id, date, start_min);
CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
