// Default window shown when a day has no bookings, or when every booking falls inside
// office hours. The grid is never *limited* to this — see computeHourRange.
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 18;

export interface TimeSpan {
  start_min: number;
  end_min: number;
}

/**
 * Widen the visible window so every reservation of the day is actually drawn.
 *
 * The previous timeline hardcoded 08:00-18:00 and positioned blocks with
 * `Math.max(0, (start_min - 480) / 600)`. A 07:00 booking clamped to 0 and was drawn as
 * if it started at 08:00; anything past 18:00 computed an offset beyond 100% and was
 * pushed outside the track. Both cases silently showed the room as free when it wasn't.
 */
export function computeHourRange(dayReservations: TimeSpan[]): {
  startHour: number;
  endHour: number;
} {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;

  for (const r of dayReservations) {
    startHour = Math.min(startHour, Math.floor(r.start_min / 60));
    endHour = Math.max(endHour, Math.ceil(r.end_min / 60));
  }

  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}
