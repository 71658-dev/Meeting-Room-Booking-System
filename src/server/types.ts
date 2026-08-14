import { KVNamespace, D1Database, Fetcher } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  MEETING_DB: KVNamespace;
  ASSETS: Fetcher;
  TURNSTILE_SECRET?: string;
  SUPERADMIN_DEFAULT_PASSWORD?: string;
  TURNSTILE_SITEKEY?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  SENDGRID_API_KEY?: string;
  EMAIL_SENDER_ADDRESS?: string;
  /** Comma-separated extra recipient domains, e.g. "example.org,partner.com.tw". */
  ALLOWED_EMAIL_DOMAINS?: string;
}

export type Role = 'superadmin' | 'admin' | 'staff';

export interface DBUser {
  id: string;
  name: string;
  dept_id: string;
  ext: string | null;
  email: string | null;
  role: Role;
  password_hash: string;
  must_change_password: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserSafe {
  id: string;
  name: string;
  dept_id: string;
  dept_name?: string;
  ext: string;
  email: string;
  role: Role;
  must_change_password: boolean;
  is_active: boolean;
}

export interface DBDepartment {
  id: string;
  name: string;
  phone: string | null;
  sort_order: number;
}

export interface DBRoom {
  id: string;
  name: string;
  capacity: number;
  location: string | null;
  color_key: string;
  is_active: number;
}

export interface DBEquipment {
  id: string;
  name: string;
  is_active: number;
  sort_order: number;
}

export interface DBReservation {
  id: string;
  room_id: string;
  user_id: string;
  date: string;
  start_min: number;
  end_min: number;
  reason: string;
  meeting_type: string;
  headcount: number;
  notes: string | null;
  attendees_email: string | null;
  status: 'active' | 'cancelled';
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export interface ReservationWithDetails extends DBReservation {
  room_name?: string;
  room_color?: string;
  user_name?: string;
  /** Extension of the account that filed the booking, for follow-up calls. */
  user_ext?: string | null;
  dept_name?: string;
  /**
   * Whether the *requesting* user may edit or cancel this row, decided server-side by
   * canManageReservation(). Sent instead of the owner's role so the client can render the
   * right buttons without every member of staff learning who the admins are.
   */
  can_manage?: boolean;
  equipment_ids?: string[];
  equipment_names?: string[];
  start_time?: string;
  end_time?: string;
}

export interface DBSession {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip: string | null;
  user_agent: string | null;
  revoked_at: string | null;
}

export interface DBAuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  created_at: string;
}

export interface HonoEnv {
  Bindings: Env;
  Variables: {
    user?: UserSafe;
    session?: DBSession;
    clientIp?: string;
  };
}
