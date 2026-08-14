export type Role = 'superadmin' | 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  dept_id: string;
  dept_name?: string;
  ext: string;
  email: string;
  role: Role;
  must_change_password?: boolean;
  is_active?: boolean;
}

export interface Department {
  id: string;
  name: string;
  phone?: string;
  sort_order: number;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  location?: string;
  color_key: string;
  is_active: number;
}

export interface Equipment {
  id: string;
  name: string;
  is_active: number;
  sort_order: number;
}

export interface Reservation {
  id: string;
  room_id: string;
  room_name?: string;
  room_color?: string;
  /** The account (工號) that filed the booking. */
  user_id: string;
  user_name?: string;
  user_ext?: string | null;
  dept_name?: string;
  /**
   * Server's verdict on whether the logged-in user may edit or cancel this booking.
   * Render gating only — the API re-checks it on every mutation.
   */
  can_manage?: boolean;
  date: string; // YYYY-MM-DD
  start_min: number;
  end_min: number;
  start_time?: string;
  end_time?: string;
  reason: string;
  meeting_type: 'internal' | 'external' | 'department' | 'other';
  headcount: number;
  notes?: string;
  attendees_email?: string;
  equipment_ids?: string[];
  equipment_names?: string[];
  status: 'active' | 'cancelled';
}

export interface PublicScheduleItem {
  id: string;
  roomId: string;
  roomName: string;
  roomColor: string;
  date: string;
  startMin: number;
  endMin: number;
  startTime: string;
  endTime: string;
  deptName: string;
  title: string;
}

export interface AuditLogItem {
  id: number;
  actor_id: string | null;
  actor_name?: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  created_at: string;
}

export type ViewMode = 'month' | 'timeline' | 'list' | 'stats' | 'admin' | 'public';
