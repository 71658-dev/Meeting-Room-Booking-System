// Per-room ink used for the flush-left rule on mobile reservation rows.
//
// Modernist has no categorical hue ramp — the palette is ink plus one brick accent — so
// rooms are told apart by value rather than colour. These are the same six inks the
// `.cat-N-badge` rules in index.css use for their left border, kept in sync by hand.
const ROOM_INK: Record<string, string> = {
  'cat-1': '#201e1d',
  'cat-2': '#605d5d',
  'cat-3': '#9e3526',
  'cat-4': '#9b9797',
  'cat-5': '#444141',
  'cat-6': '#71261b',
};

export function roomInk(colorKey?: string | null): string {
  if (!colorKey) return '#201e1d';
  return ROOM_INK[colorKey] ?? '#201e1d';
}
