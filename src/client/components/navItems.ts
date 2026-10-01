import { CalendarDays, ChartColumn, ChartGantt, Globe, List, Settings2 } from 'lucide-preact';
import { ViewMode, User } from '../types';

export interface NavItem {
  key: ViewMode;
  /** Header label. */
  label: string;
  /** Tab bar label — the 5-up mobile bar fits two characters. */
  short: string;
  Icon: typeof CalendarDays;
}

const MONTH: NavItem = { key: 'month', label: '月曆總覽', short: '月曆', Icon: CalendarDays };
const TIMELINE: NavItem = { key: 'timeline', label: '時段對照', short: '時段', Icon: ChartGantt };
const LIST: NavItem = { key: 'list', label: '預約清單', short: '清單', Icon: List };
const STATS: NavItem = { key: 'stats', label: '使用統計', short: '統計', Icon: ChartColumn };
const ADMIN: NavItem = { key: 'admin', label: '後台管理', short: '後台', Icon: Settings2 };
const PUBLIC: NavItem = { key: 'public', label: '公開排程', short: '公開排程', Icon: Globe };

/**
 * The views a visitor can reach. Shared by the desktop header and the mobile tab bar so
 * the two cannot disagree about who sees 後台管理 — the server gates the admin API
 * regardless, but a tab that only ever 403s is a bug.
 */
export function navItemsFor(user: User | null): NavItem[] {
  if (!user) return [MONTH, TIMELINE, LIST, STATS, PUBLIC];
  const items = [MONTH, TIMELINE, LIST, STATS];
  if (user.role === 'admin' || user.role === 'superadmin') items.push(ADMIN);
  return items;
}

export function roleLabel(role: User['role'] | undefined): string {
  return role === 'superadmin' ? '超管' : role === 'admin' ? '管理員' : '同仁';
}

/** The single character shown in an avatar: the given name's last character. */
export function avatarInitial(name: string | undefined): string {
  return name ? name.slice(-1) : '?';
}
