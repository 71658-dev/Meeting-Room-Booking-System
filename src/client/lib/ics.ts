import { Reservation } from '../types';

export function generateAndDownloadIcs(res: Reservation) {
  const formatDateForIcs = (dateStr: string, timeStr: string) => {
    // dateStr: YYYY-MM-DD, timeStr: HH:MM
    const [year, month, day] = dateStr.split('-');
    const [hour, minute] = (timeStr || '08:00').split(':');
    return `${year}${month}${day}T${hour}${minute}00`;
  };

  const dtStart = formatDateForIcs(res.date, res.start_time || '08:30');
  const dtEnd = formatDateForIcs(res.date, res.end_time || '10:00');
  const summary = `${res.reason} (${res.room_name || '會議室'})`;
  const description = `會議事由：${res.reason}\\n會議地點：${res.room_name || '會議室'}\\n登記單位：${res.dept_name || ''} ${res.user_name || ''}\\n與會人數：${res.headcount || 0} 人`;
  const location = res.room_name || '會議室';

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
