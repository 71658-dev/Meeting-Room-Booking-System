import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import { selectedDate, rooms, reservations, isReservationModalOpen, editingReservation, modalSelectedDate, currentUser, showToast } from '../state';
import { Reservation } from '../types';
import { computeHourRange } from '../lib/timeline';
import { agencyToday, isPastDate, isPastSlot } from '../../shared/time';

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

  const mobileDateLabel = (() => {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return date;
    const zhDay = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} (${zhDay})`;
  })();

  return (
    <div class="max-w-[1400px] mx-auto p-0 md:p-8 min-h-[calc(100vh-5rem)]">
      {/* Mobile date bar */}
      <div class="md:hidden px-4 pt-5">
        <div class="flex items-center justify-between pb-3.5 border-b-2 border-[#201e1d]">
          <button
            onClick={() => shiftDay(-1)}
            aria-label="前一天"
            class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] leading-none cursor-pointer"
          >
            ◀
          </button>
          <button
            onClick={handleToday}
            class="bg-transparent border-none font-extrabold text-[17px] leading-none text-[#201e1d] cursor-pointer"
            title="回到今天"
          >
            {mobileDateLabel}
          </button>
          <button
            onClick={() => shiftDay(1)}
            aria-label="後一天"
            class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] leading-none cursor-pointer"
          >
            ▶
          </button>
        </div>
      </div>

      {/* Date Navigation Bar — desktop */}
      <div class="hidden md:block mcard p-6 mb-6 border border-[#201e1d] bg-[#f3f2f2]">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b-2 border-[#201e1d]">
          <div class="flex flex-wrap items-center gap-3">
            <button
              onClick={() => shiftDay(-1)}
              class="border border-[#201e1d] bg-white px-3.5 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
            >
              ◀ 前一天
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setDate(v);
                selectedDate.value = v;
              }}
              class="border border-[#201e1d] bg-white px-4 py-2 font-extrabold text-lg text-[#201e1d] outline-none"
            />
            <button
              onClick={() => shiftDay(1)}
              class="border border-[#201e1d] bg-white px-3.5 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
            >
              後一天 ▶
            </button>
            <button
              onClick={handleToday}
              class="border border-[#201e1d] bg-white px-4 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
            >
              今天
            </button>
          </div>

          <div class="font-semibold text-sm text-[#444141] flex items-center gap-2">
            <span class="w-2.5 h-2.5 bg-[#9e3526] inline-block"></span>
            會議室佔用時段 ({rangeLabel})
          </div>
        </div>
      </div>

      {loading && (
        <p class="text-sm font-semibold text-[#605d5d] py-4 px-4 md:px-0">資料載入中...</p>
      )}

      {!loading && rooms.value.length === 0 && (
        <p class="text-sm text-[#605d5d] py-8 text-center">尚未設定任何會議室。</p>
      )}

      {/* Mobile: one stacked block per room, each with its own scrollable track. */}
      <div class="md:hidden px-4 pt-4 pb-8 flex flex-col gap-5">
        {rooms.value.map((room) => {
          const roomReservations = reservations.value.filter((r) => r.room_id === room.id);

          return (
            <div key={room.id}>
              <div class="font-bold text-[15px] leading-snug text-[#201e1d]">{room.name}</div>
              <div class="font-normal text-xs leading-normal text-[#605d5d] mb-2">
                容納 {room.capacity} 人 · {room.location || '局內'}
              </div>

              <div class="overflow-x-auto">
                <div
                  class="relative h-11 border border-[#201e1d]/30 bg-[#eae9e9]"
                  style={{ width: `${mobileTrackWidth}px` }}
                >
                  <div class="absolute inset-0 flex pointer-events-none">
                    {hours.map((h) => (
                      <div
                        key={h}
                        class="flex-1 border-l border-[#201e1d]/15 pt-[3px] pl-[3px] font-semibold text-[10px] leading-none text-[#9b9797]"
                      >
                        {h.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>

                  {roomReservations.length === 0 && (
                    <span class="absolute inset-0 flex items-center justify-center font-normal text-xs text-[#7d7979]">
                      本日空閒
                    </span>
                  )}

                  {roomReservations.map((r) => {
                    const leftPercent = ((r.start_min - windowStartMin) / windowTotalMin) * 100;
                    const widthPercent = ((r.end_min - r.start_min) / windowTotalMin) * 100;

                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => openReservation(r)}
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                        class="absolute top-[3px] bottom-[3px] bg-[#201e1d] text-white px-2 border-none flex flex-col justify-center overflow-hidden cursor-pointer text-left"
                        title={`${r.start_time} - ${r.end_time}｜${r.reason}`}
                      >
                        <span class="font-bold text-xs leading-tight whitespace-nowrap">
                          {r.start_time}-{r.end_time} {r.reason}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gantt Timeline View — desktop */}
      <div class="hidden md:block mcard border border-[#201e1d] overflow-x-auto bg-[#f3f2f2]">
        {/* Header Row */}
        <div class="flex border-b-2 border-[#201e1d] bg-[#eae9e9] text-xs font-bold text-[#444141]">
          <div class="w-56 p-3 flex-none border-r border-[#201e1d]/30">會議室與容量</div>
          <div class="flex-1 flex text-left">
            {hours.map((h) => (
              <div key={h} class="flex-1 p-3 border-l border-[#201e1d]/25">
                {h.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>
        </div>

        {/* Rooms Rows */}
        <div class="divide-y divide-[#201e1d]/25">
          {rooms.value.map((room) => {
            const roomReservations = reservations.value.filter((r) => r.room_id === room.id);

            return (
              <div key={room.id} class="flex items-center py-4 hover:bg-white transition-colors">
                <div class="w-56 px-4 flex-none">
                  <div class="font-bold text-base text-[#201e1d]">{room.name}</div>
                  <div class="font-medium text-xs text-[#605d5d] mt-0.5">
                    容納 {room.capacity} 人 · {room.location || '局內'}
                  </div>
                </div>

                <div class="flex-1 relative h-13 border border-[#201e1d]/30 mr-4 bg-[#eae9e9]">
                  {/* Grid lines */}
                  <div class="absolute inset-0 flex pointer-events-none">
                    {hours.map((h) => (
                      <div key={h} class="flex-1 border-l border-[#201e1d]/15"></div>
                    ))}
                  </div>

                  {roomReservations.length === 0 && (
                    <span class="absolute inset-0 flex items-center justify-center font-normal text-xs text-[#7d7979]">
                      本日空閒
                    </span>
                  )}

                  {roomReservations.map((r) => {
                    const leftPercent = ((r.start_min - windowStartMin) / windowTotalMin) * 100;
                    const widthPercent = ((r.end_min - r.start_min) / windowTotalMin) * 100;

                    return (
                      <div
                        key={r.id}
                        onClick={() => openReservation(r)}
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                        class="absolute top-1 bottom-1 bg-[#201e1d] hover:bg-[#9e3526] text-white px-2.5 py-1 text-left cursor-pointer overflow-hidden flex flex-col justify-center transition-colors"
                        title={`${r.start_time} - ${r.end_time}｜${r.reason} (${r.dept_name} ${r.user_name}／${r.user_id}・分機 ${r.user_ext || '—'})`}
                      >
                        <span class="font-bold text-xs truncate">
                          {r.reason}
                        </span>
                        <span class="font-normal text-[11px] opacity-85 truncate">
                          {r.start_time}–{r.end_time} · {r.dept_name} {r.user_name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {currentUser.value && (
        <div class="px-4 pb-8 md:px-0 md:pb-0 md:mt-6 flex md:justify-end">
          {isPastDate(date) ? (
            <div class="w-full md:w-auto border border-[#d7d3d3] bg-[#eae9e9] px-5 py-3.5 md:py-3 font-medium text-sm text-[#605d5d]">
              此日期已過去，僅供查詢
            </div>
          ) : (
            <button
              onClick={openNewReservation}
              class="w-full md:w-auto bg-[#9e3526] hover:bg-[#71261b] text-white px-5 py-3.5 md:py-3 font-bold text-base md:text-sm border-none cursor-pointer text-left md:text-center"
            >
              ＋ 新增此日預約
            </button>
          )}
        </div>
      )}
    </div>
  );
}
