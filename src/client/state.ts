import { signal } from '@preact/signals';
import { User, Room, Department, Equipment, Reservation, ViewMode } from './types';
import { agencyToday } from '../shared/time';

export const currentUser = signal<User | null>(null);
export const currentView = signal<ViewMode>('month');
export const selectedDate = signal<string>(agencyToday());

export const reservations = signal<Reservation[]>([]);
export const rooms = signal<Room[]>([]);
export const departments = signal<Department[]>([]);
export const equipment = signal<Equipment[]>([]);

export const selectedRoomFilter = signal<string>('');
export const selectedDeptFilter = signal<string>('');
export const searchQuery = signal<string>('');
export const onlyMineFilter = signal<boolean>(false);

export const toast = signal<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

export const isReservationModalOpen = signal<boolean>(false);
export const editingReservation = signal<Reservation | null>(null);
export const modalSelectedDate = signal<string>('');

// Slide-in Date Detail Drawer (1c+1e)
export const isDatePanelOpen = signal<boolean>(false);
export const panelSelectedDate = signal<string>(agencyToday());

export const isPasswordModalOpen = signal<boolean>(false);
export const turnstileSiteKey = signal<string>('');

// Own-profile editor. Raised from the account sheet, which both chromes open, so it lives
// here rather than as local state inside either.
export const isProfileModalOpen = signal<boolean>(false);

// Account sheet: profile, password, logout. Opened from the avatar pill in the desktop
// header and the avatar button in the mobile chrome — the tab bar has no room for them.
export const isAccountSheetOpen = signal<boolean>(false);

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  toast.value = { message, type };
  setTimeout(() => {
    if (toast.value?.message === message) {
      toast.value = null;
    }
  }, 4000);
}
