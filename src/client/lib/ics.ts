import { Reservation } from '../types';

/**
 * Escape a value for an iCalendar TEXT property (RFC 5545 §3.3.11).
 *
 * 事由、備註、姓名 and 會議室名稱 are free text and were interpolated into SUMMARY /
 * DESCRIPTION / LOCATION raw. A newline inside any of them ends the property line, and
 * whatever follows is parsed as a new iCalendar property — so a 事由 containing
 * "早會\r\nATTENDEE:mailto:…" (or an entire second BEGIN:VEVENT) is written verbatim into
 * a .ics that the recipient's calendar then imports and trusts. Backslash, semicolon and
 * comma are separators in the same grammar and are escaped for the same reason.
 *
 * The order matters: backslash first, or the escapes introduced below get re-escaped.
 */
export function escapeIcsText(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function generateAndDownloadIcs(res: Reservation) {
  const formatDateForIcs = (dateStr: string, timeStr: string) => {
    // dateStr: YYYY-MM-DD, timeStr: HH:MM
    const [year, month, day] = dateStr.split('-');
    const [hour, minute] = (timeStr || '08:00').split(':');
    return `${year}${month}${day}T${hour}${minute}00`;
  };

  const dtStart = formatDateForIcs(res.date, res.start_time || '08:30');
  const dtEnd = formatDateForIcs(res.date, res.end_time || '10:00');
  const roomName = res.room_name || '會議室';
  const summary = escapeIcsText(`${res.reason} (${roomName})`);
  // Each field is escaped on its own and the intended breaks are added afterwards as the
  // literal two-character sequence the format uses — never by escaping a pre-joined string
  // through a separator character, which a value could then contain itself.
  const description = [
    `會議事由：${escapeIcsText(res.reason)}`,
    `會議地點：${escapeIcsText(roomName)}`,
    `登記單位：${escapeIcsText(res.dept_name || '')} ${escapeIcsText(res.user_name || '')}`,
    `與會人數：${Number(res.headcount) || 0} 人`,
  ].join('\\n');
  const location = escapeIcsText(roomName);

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hsinchu Health Bureau//Meeting Booking//TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:res-${res.id}@hccg.gov.tw`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meeting-${res.date}-${res.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
