import { useState, useEffect } from 'preact/hooks';
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Plus } from 'lucide-preact';
import { api } from '../api';
import { selectedDate, rooms, reservations, isReservationModalOpen, editingReservation, modalSelectedDate, currentUser, showToast } from '../state';
import { Reservation } from '../types';
import { computeHourRange } from '../lib/timeline';
import { agencyMinutesNow, agencyToday, isPastDate, isPastSlot, minToTimeStr } from '../../shared/time';
import { roomColor } from '../lib/roomColor';

export function TimelineView() {
  const [date, setDate] = useState(selectedDate.value);
  const [loading, setLoading] = useState(false);

  const loadDayData = async (targetDate: string) => {
    setLoading(true);
    try {
      const [resData, roomData] = await Promise.all([
        api.getReservations({ from: targetDate, to: targetDate }),
        api.getRooms(),
      ]);
      if (resData.success) reservations.value = resData.reservations;
      if (roomData.success) rooms.value = roomData.rooms;
    } catch (e) {
      console.error('Failed to load timeline data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDayData(date);
  }, [date]);

  const { startHour, endHour } = computeHourRange(reservations.value);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const windowStartMin = startHour * 60;
  const windowTotalMin = (endHour - startHour) * 60;

  const shiftDay = (delta: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const next = new Date(y, m - 1, d + delta);
    const newDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    setDate(newDate);
    selectedDate.value = newDate;
  };

  const handleToday = () => {
    const today = agencyToday();
    setDate(today);
    selectedDate.value = today;
  };

  const openReservation = (r: Reservation) => {
    if (!currentUser.value) return;
    // Bars are clickable for everyone signed in, so the gate lives here rather than on the
    // element: opening the form for a booking the API will refuse to save is worse than
    // saying so up front. Same reasoning for the past-slot check.
    if (!r.can_manage) {
      showToast('此預約由其他同仁登記，您沒有修改權限', 'error');
      return;
    }
    if (isPastSlot(r.date, r.start_min)) {
      showToast('此預約已經開始，僅能瀏覽或取消', 'error');
      return;
    }
    editingReservation.value = r;
    isReservationModalOpen.value = true;
  };

  const openNewReservation = () => {
    if (!currentUser.value) return;
    if (isPastDate(date)) {
      showToast('已過去的日期無法新增預約', 'error');
      return;
    }
    modalSelectedDate.value = date;
    editingReservation.value = null;
    isReservationModalOpen.value = true;
  };

  const rangeLabel = `${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:00`;

  // 手機版 scrolls the track horizontally at a fixed hour width rather than fitting the
  // day into the viewport — at ~50px per hour a 90-minute meeting has no room for a label.
  const MOBILE_HOUR_WIDTH = 76;
  const mobileTrackWidth = hours.length * MOBILE_HOUR_WIDTH;

  const [y, m, d] = date.split('-').map(Number);
  const zhDay = y && m && d ? ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()] : '';
  const titleLabel = y && m && d ? `${m} 月 ${d} 日 星期${zhDay}` : date;
  const mobileDateLabel = y && m && d ? `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}（${zhDay}）` : date;

  // The red "now" rule, only on today and only while now falls inside the drawn window.
  const nowMin = date === agencyToday() ? agencyMinutesNow() : null;
  const nowPercent =
    nowMin !== null && nowMin >= windowStartMin && nowMin <= windowStartMin + windowTotalMin
      ? ((nowMin - windowStartMin) / windowTotalMin) * 100
      : null;

  const barPosition = (r: Reservation) => ({
    left: `${((r.start_min - windowStartMin) / windowTotalMin) * 100}%`,
    width: `${((r.end_min - r.start_min) / windowTotalMin) * 100}%`,
  });

  const navButton = 'btn bg-transparent text-accent w-9 h-9 p-0 hover:bg-fill';

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 min-h-[calc(100vh-88px)]">
      {/* Mobile date bar */}
      <div class="md:hidden flex items-center justify-between gap-2 mb-2">
        <button type="button" onClick={() => shiftDay(-1)} aria-label="前一天" class="glass btn btn-icon-lg text-accent">
          <ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button type="button" onClick={handleToday} title="回到今天" class="glass btn h-11 px-[18px] text-[15px] text-black">
          {mobileDateLabel}
        </button>
        <button type="button" onClick={() => shiftDay(1)} aria-label="後一天" class="glass btn btn-icon-lg text-accent">
          <ChevronRight size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      {/* Title + date navigation */}
      <div class="flex items-end justify-between gap-4 mb-4 md:mb-5">
        <div>
          <div class="hidden md:block lg-eyebrow">時段對照 · {rangeLabel}</div>
          <h1 class="m-0 lg-title-1">
            <span class="hidden md:inline">{titleLabel}</span>
            <span class="md:hidden">時段對照</span>
          </h1>
        </div>
        <div class="hidden md:flex items-center gap-2.5">
          <div class="glass flex items-center gap-0.5 h-11 px-1 rounded-full">
            <button type="button" onClick={() => shiftDay(-1)} aria-label="前一天" class={navButton}>
              <ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <label class="flex items-center gap-1.5 px-2 text-[15px] font-semibold cursor-pointer">
              <CalendarDays size={16} aria-hidden="true" />
              <span class="sr-only">選擇日期</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  if (!v) return;
                  setDate(v);
                  selectedDate.value = v;
                }}
                class="bg-transparent border-none outline-none font-semibold text-[15px] tabular-nums cursor-pointer"
              />
            </label>
            <button type="button" onClick={() => shiftDay(1)} aria-label="後一天" class={navButton}>
              <ChevronRight size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={handleToday} class="glass btn h-11 px-[18px] text-[15px] text-accent">
            今天
          </button>
        </div>
      </div>

      {loading && <p class="text-[15px] text-label-2 py-2 m-0">資料載入中…</p>}

      {!loading && rooms.value.length === 0 && (
        <p class="text-[15px] text-label-2 py-8 text-center m-0">尚未設定任何會議室。</p>
      )}

      {/* Mobile: one card per room, each with its own scrollable track. */}
      <div class="md:hidden flex flex-col gap-3.5">
        {rooms.value.map((room) => {
          const roomReservations = reservations.value.filter((r) => r.room_id === room.id);
          const c = roomColor(room.color_key);

          return (
            <div key={room.id} class="surface rounded-[24px] py-3.5 pl-4 overflow-hidden">
              <div class="flex items-center gap-2.5 mb-2.5 pr-4">
                <span class="w-[30px] h-[30px] rounded-lg text-white flex items-center justify-center flex-none" style={{ background: c.color }}>
                  <DoorOpen size={16} aria-hidden="true" />
                </span>
                <div class="min-w-0">
                  <div class="text-[17px] font-semibold leading-5 truncate">{room.name}</div>
                  <div class="text-xs text-label-2 truncate">
                    {room.capacity} 人 · {room.location || '局內'}
                  </div>
                </div>
              </div>

              <div class="overflow-x-auto pr-4">
                <div class="relative h-[52px] rounded-xl bg-fill-2" style={{ width: `${mobileTrackWidth}px` }}>
                  <div class="absolute inset-0 flex pointer-events-none">
                    {hours.map((h) => (
                      <div key={h} class="flex-1 border-l-[0.5px] border-black/[.08] pt-[3px] pl-1 text-[10px] leading-none text-label-3">
                        {h.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>

                  {roomReservations.length === 0 && (
                    <span class="absolute inset-0 flex items-center justify-center text-xs text-label-2">本日空閒</span>
                  )}

                  {roomReservations.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openReservation(r)}
                      style={{ ...barPosition(r), background: c.color }}
                      class="absolute top-3.5 bottom-1 rounded-[9px] text-white px-2 border-none flex items-center overflow-hidden cursor-pointer text-left text-xs font-semibold whitespace-nowrap"
                      title={`${r.start_time} - ${r.end_time}｜${r.reason}`}
                    >
                      {r.start_time} {r.reason}
                    </button>
                  ))}

                  {nowPercent !== null && (
                    <div class="absolute -top-1 -bottom-1 w-0.5 -ml-px rounded-[1px] bg-danger pointer-events-none" style={{ left: `${nowPercent}%` }}></div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gantt timeline — desktop */}
      <div class="hidden md:block surface rounded-[28px] px-6 pt-2 pb-4 overflow-x-auto">
        <div class="min-w-[760px]">
          <div class="flex h-10 items-center">
            <div class="w-[200px] flex-none"></div>
            <div class="flex-1 flex">
              {hours.map((h) => (
                <div key={h} class="flex-1 text-xs text-label-2 tabular-nums">
                  {h.toString().padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {rooms.value.map((room) => {
            const roomReservations = reservations.value.filter((r) => r.room_id === room.id);
            const c = roomColor(room.color_key);

            return (
              <div key={room.id} class="flex items-center py-3.5 border-t-[0.5px] border-separator">
                <div class="w-[200px] flex-none flex items-center gap-3 pr-3">
                  <span class="w-9 h-9 rounded-[10px] text-white flex items-center justify-center flex-none" style={{ background: c.color }}>
                    <DoorOpen size={18} aria-hidden="true" />
                  </span>
                  <div class="min-w-0">
                    <div class="text-[17px] font-semibold truncate">{room.name}</div>
                    <div class="text-[13px] text-label-2 truncate">
                      {room.capacity} 人 · {room.location || '局內'}
                    </div>
                  </div>
                </div>

                <div class="flex-1 relative h-16 rounded-[14px] bg-fill-2">
                  <div class="absolute inset-0 flex pointer-events-none">
                    {hours.map((h) => (
                      <div key={h} class="flex-1 border-l-[0.5px] border-black/[.08]"></div>
                    ))}
                  </div>

                  {roomReservations.length === 0 && (
                    <span class="absolute inset-0 flex items-center justify-center text-[13px] text-label-2">本日空閒</span>
                  )}

                  {roomReservations.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => openReservation(r)}
                      style={{ ...barPosition(r), background: c.color }}
                      class="absolute top-[5px] bottom-[5px] rounded-[11px] text-white px-3 border-none text-left cursor-pointer overflow-hidden flex flex-col justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.3),0_4px_12px_rgba(0,0,0,.12)] transition-[filter] hover:brightness-110"
                      title={`${r.start_time} - ${r.end_time}｜${r.reason} (${r.dept_name} ${r.user_name}／${r.user_id}・分機 ${r.user_ext || '—'})`}
                    >
                      <span class="text-[13px] font-semibold truncate">{r.reason}</span>
                      <span class="text-[11px] opacity-90 truncate">
                        {r.start_time}–{r.end_time} · {r.dept_name} {r.user_name}
                      </span>
                    </button>
                  ))}

                  {nowPercent !== null && (
                    <div class="absolute -top-1.5 -bottom-1.5 w-0.5 -ml-px rounded-[1px] bg-danger pointer-events-none" style={{ left: `${nowPercent}%` }}></div>
                  )}
                </div>
              </div>
            );
          })}

          {nowPercent !== null && nowMin !== null && rooms.value.length > 0 && (
            <div class="flex pt-1.5">
              <div class="w-[200px] flex-none"></div>
              <div class="flex-1 relative h-5">
                <span
                  class="absolute -translate-x-1/2 text-[11px] font-semibold text-white bg-danger rounded-full px-[7px] py-0.5 tabular-nums"
                  style={{ left: `${nowPercent}%` }}
                >
                  {minToTimeStr(nowMin)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {currentUser.value && (
        <div class="mt-4 md:mt-5 flex md:justify-end">
          {isPastDate(date) ? (
            <div class="w-full md:w-auto rounded-2xl bg-fill px-5 py-3.5 text-[15px] text-label-2">此日期已過去，僅供查詢</div>
          ) : (
            <button type="button" onClick={openNewReservation} class="btn btn-primary btn-lg w-full md:w-auto">
              <Plus size={19} strokeWidth={2.4} aria-hidden="true" />
              新增此日預約
            </button>
          )}
        </div>
      )}
    </div>
  );
}
