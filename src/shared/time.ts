/**
 * Wall-clock time for the agency, shared by the Worker and the browser.
 *
 * Cloudflare Workers run in UTC, so `new Date()` there is eight hours behind the office.
 * The browser is usually — but not reliably — on Taipei time. Any rule that turns on
 * "has this already happened" has to give the same answer on both sides, so both import
 * from here rather than reaching for `new Date()` directly.
 *
 * This also replaces `new Date().toISOString().substring(0, 10)`, which was used in
 * several places as "today". That is the *UTC* date: between 00:00 and 08:00 Taipei time
 * it names yesterday, so for eight hours a day the calendar highlighted the wrong cell
 * and a booking for this morning looked like it was in the past.
 *
 * Asia/Taipei has been a fixed UTC+8 with no daylight saving since 1980, so a constant
 * offset is exact. It is also the only formulation that cannot throw: `Intl` with an
 * explicit `timeZone` depends on the ICU data the runtime happens to ship, and this code
 * sits directly in the booking path.
 */
export const AGENCY_UTC_OFFSET_MINUTES = 8 * 60;

/**
 * "HH:mm" to minutes since midnight, the unit the DB stores in `start_min` / `end_min`.
 * Times are never compared as strings — that breaks on ordering and across midnight.
 */
export function timeStrToMin(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map((num) => parseInt(num, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Inverse of timeStrToMin. */
export function minToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Shift the instant by the agency's offset so the UTC accessors below read out as local
 * wall-clock fields. Never hand the result to anything that will format it as an instant.
 */
function agencyClock(now: Date = new Date()): Date {
  return new Date(now.getTime() + AGENCY_UTC_OFFSET_MINUTES * 60_000);
}

/** Today's date in the agency's timezone, as YYYY-MM-DD. */
export function agencyToday(now?: Date): string {
  return agencyClock(now).toISOString().substring(0, 10);
}

/** Minutes since midnight in the agency's timezone — the same unit as `start_min`. */
export function agencyMinutesNow(now?: Date): number {
  const d = agencyClock(now);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Whether a whole calendar day is already over. */
export function isPastDate(date: string, now?: Date): boolean {
  return date < agencyToday(now);
}

/**
 * Whether a booking slot has already begun.
 *
 * Keyed on the *start*, not the end: a booking whose start has passed would otherwise let
 * someone retroactively claim a room they were never in, which defeats the audit trail.
 * A slot starting exactly this minute still counts as future.
 */
export function isPastSlot(date: string, startMin: number, now?: Date): boolean {
  const today = agencyToday(now);
  if (date < today) return true;
  if (date > today) return false;
  return startMin < agencyMinutesNow(now);
}
