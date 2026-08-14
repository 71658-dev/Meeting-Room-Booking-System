import { User, Room, Department, Equipment, Reservation, PublicScheduleItem, AuditLogItem } from './types';

class APIError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  let data: any;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    const errorMsg = (data && data.error) || (data && data.message) || `HTTP error ${res.status}`;
    throw new APIError(errorMsg, res.status, data);
  }

  return data as T;
}

export const api = {
  // Auth
  async login(id: string, password: string, turnstileToken?: string) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ id, password, turnstileToken }),
    });
  },

  async logout() {
    return request('/api/auth/logout', { method: 'POST' });
  },

  async getMe() {
    return request<{ success: boolean; user: User }>('/api/auth/me');
  },

  async changePassword(oldPassword: string, newPassword: string) {
    return request('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },

  async getConfig() {
    return request<{ TURNSTILE_SITEKEY: string }>('/api/config');
  },

  // Public Schedule
  async getPublicSchedule(params?: { from?: string; to?: string; roomId?: string }) {
    const search = new URLSearchParams(params as any).toString();
    return request<{ success: boolean; schedule: PublicScheduleItem[] }>(`/api/public/schedule?${search}`);
  },

  // Reservations
  async getReservations(params?: { from?: string; to?: string; roomId?: string; deptId?: string; mine?: boolean }) {
    const search = new URLSearchParams();
    if (params?.from) search.append('from', params.from);
    if (params?.to) search.append('to', params.to);
    if (params?.roomId) search.append('roomId', params.roomId);
    if (params?.deptId) search.append('deptId', params.deptId);
    if (params?.mine) search.append('mine', 'true');
    // `truncated` is set when the result hit the server's row cap. Anything that totals
    // the list rather than just rendering it has to check this, or it reports a partial
    // count as a complete one.
    return request<{ success: boolean; reservations: Reservation[]; truncated?: boolean }>(
      `/api/reservations?${search.toString()}`
    );
  },

  async createReservation(data: {
    roomId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    meetingType?: string;
    headcount?: number;
    notes?: string;
    attendeesEmail?: string;
    equipmentIds?: string[];
    sendEmail?: boolean;
  }) {
    return request('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateReservation(id: string, data: Partial<{
    roomId: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string;
    meetingType: string;
    headcount: number;
    notes: string;
    attendeesEmail: string;
    equipmentIds: string[];
    sendEmail: boolean;
  }>) {
    return request(`/api/reservations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async cancelReservation(id: string) {
    return request(`/api/reservations/${id}`, { method: 'DELETE' });
  },

  async notifyReservation(id: string) {
    return request(`/api/reservations/${id}/notify`, { method: 'POST' });
  },

  // Rooms
  async getRooms() {
    return request<{ success: boolean; rooms: Room[] }>('/api/rooms');
  },

  async createRoom(data: { name: string; capacity: number; location?: string; colorKey?: string }) {
    return request('/api/rooms', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateRoom(id: string, data: Partial<Room>) {
    return request(`/api/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteRoom(id: string) {
    return request(`/api/rooms/${id}`, { method: 'DELETE' });
  },

  // Departments
  async getDepartments() {
    return request<{ success: boolean; departments: Department[] }>('/api/departments');
  },

  async createDepartment(data: { name: string; phone?: string; sortOrder?: number }) {
    return request('/api/departments', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateDepartment(id: string, data: Partial<Department>) {
    return request(`/api/departments/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteDepartment(id: string) {
    return request(`/api/departments/${id}`, { method: 'DELETE' });
  },

  // Equipment
  async getEquipment() {
    return request<{ success: boolean; equipment: Equipment[] }>('/api/equipment');
  },

  async createEquipment(data: { name: string; sortOrder?: number }) {
    return request('/api/equipment', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateEquipment(id: string, data: Partial<Equipment>) {
    return request(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async deleteEquipment(id: string) {
    return request(`/api/equipment/${id}`, { method: 'DELETE' });
  },

  // Users Management
  async getUsers() {
    return request<{ success: boolean; users: User[] }>('/api/users');
  },

  async createUser(data: { id: string; name: string; deptId: string; ext?: string; email?: string; role: string }) {
    return request('/api/users', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateUser(id: string, data: Partial<User & { deptId?: string; isActive?: boolean }>) {
    return request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async resetUserPassword(id: string) {
    return request<{ success: boolean; message: string; tempPassword: string }>(`/api/users/${id}/reset-password`, {
      method: 'POST',
    });
  },

  // Audit Log
  async getAuditLogs(page = 1, limit = 50) {
    return request<{ success: boolean; page: number; limit: number; total: number; logs: AuditLogItem[] }>(
      `/api/audit?page=${page}&limit=${limit}`
    );
  },
};
