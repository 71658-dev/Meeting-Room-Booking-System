// Per-room colour (Liquid Glass 改版). Rooms carry a `color_key` of cat-1…cat-6, chosen
// in 後台管理; this maps each to an iOS system hue plus the 12% tint the design uses for
// pills and calendar chips. cat-1/cat-2 are the two the design itself shows (第一 / 第二
// 會議室); the rest continue round the system palette in an order that keeps adjacent
// keys distinguishable.
const ROOM_COLORS: Record<string, string> = {
  'cat-1': '#0088FF', // blue
  'cat-2': '#6155F5', // indigo
  'cat-3': '#00C8B3', // teal
  'cat-4': '#FF8D28', // orange
  'cat-5': '#FF2D55', // pink
  'cat-6': '#34C759', // green
};

const FALLBACK = '#8E8E93';

export interface RoomColor {
  color: string;
  tint: string;
}

export function roomColor(colorKey?: string | null): RoomColor {
  const color = (colorKey && ROOM_COLORS[colorKey]) || FALLBACK;
  return { color, tint: hexToRgba(color, 0.12) };
}

/** Inline style that feeds `.room-pill` (and anything else reading --room / --room-tint). */
export function roomStyle(colorKey?: string | null): Record<string, string> {
  const { color, tint } = roomColor(colorKey);
  return { '--room': color, '--room-tint': tint };
}

export const ROOM_COLOR_KEYS = Object.keys(ROOM_COLORS);

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
