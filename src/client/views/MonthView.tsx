import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import {
  reservations,
  rooms,
  departments,
  selectedRoomFilter,
  selectedDeptFilter,
  searchQuery,
  onlyMineFilter,
  currentUser,
  isReservationModalOpen,
  editingReservation,
  modalSelectedDate,
  isDatePanelOpen,
  panelSelectedDate,
  showToast,
} from '../state';
import { Reservation } from '../types';
import { generateAndDownloadIcs } from '../lib/ics';
import { roomInk } from '../lib/roomInk';
import { agencyToday, isPastDate, isPastSlot } from '../../shared/time';

export function MonthView() {
  const [currentYearMonth, setCurrentYearMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const [loading, setLoading] = useState(false);

  const year = currentYearMonth.year;
  const month = currentYearMonth.month;

  const loadMonthData = async () => {
    setLoading(true);
    try {
      const monthStr = month.toString().padStart(2, '0');
      const from = `${year}-${monthStr}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;

      const [resData, roomData, deptData] = await Promise.all([
        api.getReservations({ from, to }),
        api.getRooms(),
        api.getDepartments(),
      ]);

      if (resData.success) reservations.value = resData.reservations;
      if (roomData.success) rooms.value = roomData.rooms;
      if (deptData.success) departments.value = deptData.departments;
    } catch (e) {
      console.error('Failed to load month view data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMonthData();
  }, [year, month]);

  const handlePrevMonth = () => {
    if (month === 1) {
      setCurrentYearMonth({ year: year - 1, month: 12 });
    } else {
      setCurrentYearMonth({ year, month: month - 1 });
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setCurrentYearMonth({ year: year + 1, month: 1 });
    } else {
      setCurrentYearMonth({ year, month: month + 1 });
    }
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentYearMonth({ year: now.getFullYear(), month: now.getMonth() + 1 });
  };

  // Build grid calendar days
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const daysInMonth = new Date(year, month, 0).getDate();

  const calendarDays: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean }> = [];

  // Prev month padding
  const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDay - i;
    const prevM = month === 1 ? 12 : month - 1;
    const prevY = month === 1 ? year - 1 : year;
    const dateStr = `${prevY}-${prevM.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: true });
  }

  // Next month padding
  const remaining = (7 - (calendarDays.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;
    const dateStr = `${nextY}-${nextM.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    calendarDays.push({ dateStr, dayNum: d, isCurrentMonth: false });
  }

  // Filter reservations
  const filteredReservations = reservations.value.filter((r) => {
    if (selectedRoomFilter.value && r.room_id !== selectedRoomFilter.value) return false;
    if (selectedDeptFilter.value && r.dept_name !== selectedDeptFilter.value) return false;
    if (onlyMineFilter.value && currentUser.value && r.user_id !== currentUser.value.id) return false;
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchReason = r.reason.toLowerCase().includes(q);
      const matchUser = (r.user_name || '').toLowerCase().includes(q);
      const matchNotes = (r.notes || '').toLowerCase().includes(q);
      const matchRoom = (r.room_name || '').toLowerCase().includes(q);
      if (!matchReason && !matchUser && !matchNotes && !matchRoom) return false;
    }
    return true;
  });

  const resByDate: Record<string, Reservation[]> = {};
  for (const r of filteredReservations) {
    if (!resByDate[r.date]) resByDate[r.date] = [];
    resByDate[r.date].push(r);
  }

  const todayStr = agencyToday();

  // Esc closes the drawer. The reservation modal owns Esc while it is open — it is
  // stacked above the drawer, and closing both on one keypress loses the date context.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isReservationModalOpen.value) return;
      isDatePanelOpen.value = false;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleCellClick = (dateStr: string) => {
    panelSelectedDate.value = dateStr;
    isDatePanelOpen.value = true;
    // The drawer is anchored to the top of the container, so clicking a date in the
    // last rows would slide it in entirely above the fold — the page has to come with it.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAddModal = (dateStr?: string) => {
    if (!currentUser.value) {
      showToast('請先登入系統後再發起預約', 'error');
      return;
    }
    const target = dateStr || panelSelectedDate.value || todayStr;
    if (isPastDate(target)) {
      showToast('已過去的日期無法新增預約', 'error');
      return;
    }
    modalSelectedDate.value = target;
    editingReservation.value = null;
    isReservationModalOpen.value = true;
  };

  const handleEditReservation = (e: Event, res: Reservation) => {
    e.stopPropagation();
    if (!currentUser.value) return;
    if (!res.can_manage) {
      showToast('您沒有權限修改此預約', 'error');
      return;
    }
    if (isPastSlot(res.date, res.start_min)) {
      showToast('此預約已經開始，僅能瀏覽或取消', 'error');
      return;
    }
    editingReservation.value = res;
    isReservationModalOpen.value = true;
  };

  const handleCancelReservation = async (res: Reservation) => {
    if (!confirm(`確定要取消「${res.reason}」的預約嗎？`)) return;
    try {
      await api.cancelReservation(res.id);
      showToast('預約已取消', 'success');
      loadMonthData();
    } catch (err: any) {
      showToast(err.message || '取消失敗', 'error');
    }
  };

  const handleCopyInfo = (res: Reservation) => {
    const text = `【會議預約】${res.reason}\n時間：${res.date} ${res.start_time}~${res.end_time}\n地點：${res.room_name}\n單位：${res.dept_name} ${res.user_name}（${res.user_id}）\n聯絡分機：${res.user_ext || '—'}`;
    navigator.clipboard.writeText(text);
    showToast('會議資訊已複製至剪貼簿', 'success');
  };

  // Selected date panel reservations
  const selectedDateRes = resByDate[panelSelectedDate.value] || [];

  const formatChineseDate = (dateStr: string) => {
    if (!dateStr) return { title: '', subtitle: '', dateStr: '' };
    const parts = dateStr.split('-');
    if (parts.length < 3) return { title: dateStr, subtitle: '', dateStr };
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(parseInt(parts[0], 10), m - 1, d);
    const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dayOfWeek = dayNames[dateObj.getDay()];
    return { title: `${m} 月 ${d} 日`, subtitle: `${dayOfWeek} · ${selectedDateRes.length} 筆預約`, dateStr };
  };

  const dateMeta = formatChineseDate(panelSelectedDate.value);

  // 近期預約 (手機版 only): the month view has no room for per-cell entry text on a phone,
  // so the cells carry a presence dot and the detail moves to this list underneath.
  const upcoming = filteredReservations
    .filter((r) => r.date >= todayStr)
    .sort((a, b) => (a.date === b.date ? a.start_min - b.start_min : a.date.localeCompare(b.date)))
    .slice(0, 10);

  return (
    <div class="max-w-[1400px] mx-auto p-0 md:p-8 relative overflow-hidden min-h-[calc(100vh-5rem)]">
      {/* The drawer overlays this block instead of reserving space next to it: reflowing
          the calendar grid on open shrank every cell and re-wrapped the entry text. */}
      <div>
        {/* Mobile month bar */}
        <div class="md:hidden px-4 pt-5">
          <div class="flex items-center justify-between pb-3 border-b-2 border-[#201e1d]">
            <div class="font-extrabold text-2xl leading-none text-[#201e1d]">
              {year} / {month.toString().padStart(2, '0')}
            </div>
            <div class="flex gap-2">
              <button
                onClick={handlePrevMonth}
                aria-label="上個月"
                class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] leading-none cursor-pointer"
              >
                ◀
              </button>
              <button
                onClick={handleToday}
                class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] leading-none cursor-pointer"
              >
                今天
              </button>
              <button
                onClick={handleNextMonth}
                aria-label="下個月"
                class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] leading-none cursor-pointer"
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        {/* Header Bar — desktop */}
        <div class="hidden md:block bg-[#f3f2f2] p-6 mcard mb-6 border border-[#201e1d]">
          <div class="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 pb-4 border-b-2 border-[#201e1d]">
            <div>
              <div class="mono-label">MONTH · 月曆總覽</div>
              <div class="font-extrabold text-4xl sm:text-5xl leading-none tracking-tight mt-2 text-[#201e1d]">
                {year} / {month.toString().padStart(2, '0')}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePrevMonth}
                class="border border-[#201e1d] bg-white px-3.5 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
              >
                ◀ 上個月
              </button>
              <button
                onClick={handleToday}
                class="border border-[#201e1d] bg-white px-3.5 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
              >
                今天
              </button>
              <button
                onClick={handleNextMonth}
                class="border border-[#201e1d] bg-white px-3.5 py-2 font-semibold text-sm hover:bg-[#eae9e9] cursor-pointer"
              >
                下個月 ▶
              </button>
              {currentUser.value && (
                <button
                  onClick={() => handleOpenAddModal()}
                  class="bg-[#9e3526] text-white px-4 py-2 font-bold text-sm hover:bg-[#71261b] cursor-pointer"
                >
                  ＋ 新增預約
                </button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div class="flex flex-wrap items-center gap-3 mt-4 text-sm">
            <select
              value={selectedRoomFilter.value}
              onChange={(e) => (selectedRoomFilter.value = (e.target as HTMLSelectElement).value)}
              class="border border-[#201e1d] bg-white px-3.5 py-2 font-medium text-xs sm:text-sm text-[#201e1d] outline-none"
            >
              <option value="">全部會議室 ({rooms.value.length} 間) ▾</option>
              {rooms.value.map((rm) => (
                <option key={rm.id} value={rm.id}>
                  {rm.name} ({rm.capacity}人)
                </option>
              ))}
            </select>

            <select
              value={selectedDeptFilter.value}
              onChange={(e) => (selectedDeptFilter.value = (e.target as HTMLSelectElement).value)}
              class="border border-[#201e1d] bg-white px-3.5 py-2 font-medium text-xs sm:text-sm text-[#201e1d] outline-none"
            >
              <option value="">全部科室 ▾</option>
              {departments.value.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="🔍 搜尋事由 / 同仁 / 會議室"
              value={searchQuery.value}
              onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
              class="border border-[#201e1d] bg-white px-3.5 py-2 font-normal text-xs sm:text-sm text-[#201e1d] w-56 outline-none"
            />

            {currentUser.value && (
              <label class="flex items-center gap-2 border border-[#201e1d] bg-white px-3.5 py-2 font-bold text-xs sm:text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyMineFilter.value}
                  onChange={(e) => (onlyMineFilter.value = (e.target as HTMLInputElement).checked)}
                  class="w-4 h-4 accent-[#9e3526]"
                />
                僅我的預約
              </label>
            )}
          </div>
        </div>

        {/* Days of Week Header. The English abbreviations are dropped below md — at a
            seventh of a phone's width they wrap onto a second line. */}
        <div class="grid grid-cols-7 mt-3 md:mt-0 mx-4 md:mx-0 bg-[#444141] text-white font-bold text-[11px] md:text-sm md:tracking-wider md:uppercase text-center md:text-left">
          {['日', '一', '二', '三', '四', '五', '六'].map((zh, i) => (
            <div
              key={zh}
              class={`py-2 md:p-3 ${i < 6 ? 'border-r border-[#201e1d]/40' : ''}`}
            >
              <span class="hidden md:inline">
                {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][i]}{' '}
              </span>
              {zh}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div class="grid grid-cols-7 mx-4 md:mx-0 border-l border-[#201e1d]/20 bg-[#dedbd5]">
          {calendarDays.map((day) => {
            const dayResList = resByDate[day.dateStr] || [];
            const isToday = day.dateStr === todayStr;
            const isSelected = isDatePanelOpen.value && day.dateStr === panelSelectedDate.value;

            return (
              <div
                key={day.dateStr}
                onClick={() => handleCellClick(day.dateStr)}
                class={`mcell min-h-[46px] md:min-h-[138px] pt-1.5 px-0 pb-1 md:p-3 flex flex-col items-center md:items-stretch gap-1 md:gap-2 cursor-pointer border-r border-b md:border-b-2 border-[#201e1d]/20 select-none ${
                  !day.isCurrentMonth
                    ? 'bg-[#eae9e9]'
                    : isSelected
                    ? 'bg-[#ffffff] md:ring-2 md:ring-inset md:ring-[#9e3526]'
                    : isToday
                    ? 'bg-[#fff2ef]'
                    : 'bg-[#f3f2f2]'
                }`}
              >
                <div class="flex flex-col md:flex-row items-center md:items-baseline md:justify-between gap-1 md:gap-0 w-full">
                  <span
                    class={`font-bold md:font-extrabold text-sm md:text-3xl leading-none ${
                      !day.isCurrentMonth
                        ? 'text-[#bab6b6]'
                        : isToday
                        ? 'text-[#9e3526]'
                        : 'text-[#201e1d]'
                    }`}
                  >
                    {day.dayNum}
                  </span>
                  {dayResList.length > 0 && (
                    <>
                      {/* Presence dot on a phone, count on desktop. */}
                      <span
                        aria-label={`${dayResList.length} 筆預約`}
                        class="md:hidden w-[5px] h-[5px] bg-[#9e3526] inline-block"
                      ></span>
                      <span class="hidden md:inline font-bold text-xs text-[#605d5d]">
                        {dayResList.length} 筆
                      </span>
                    </>
                  )}
                </div>

                <div class="hidden md:flex flex-col gap-1.5 overflow-hidden">
                  {dayResList.map((r) => (
                    <div
                      key={r.id}
                      class="border-t border-[#201e1d]/20 pt-1 text-left overflow-hidden"
                    >
                      <div class="font-bold text-xs sm:text-sm text-[#201e1d] truncate">
                        {r.reason}
                      </div>
                      <div class="font-normal text-[11px] sm:text-xs text-[#605d5d] truncate">
                        {r.start_time}–{r.end_time} · {r.room_name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 近期預約 — 手機版 only */}
        <div class="md:hidden px-4 mt-6 pb-8">
          <div class="mono-label text-xs mb-2.5 normal-case">近期預約</div>
          {upcoming.length === 0 ? (
            <div class="font-normal text-sm text-[#7d7979] py-2">本月尚無即將到來的預約</div>
          ) : (
            <div class="flex flex-col gap-3.5">
              {upcoming.map((r) => {
                const room = rooms.value.find((rm) => rm.id === r.room_id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleCellClick(r.date)}
                    style={{ borderLeftColor: roomInk(room?.color_key) }}
                    class="text-left w-full bg-transparent border-none border-l-[3px] border-solid pl-2.5 cursor-pointer"
                  >
                    <div class="font-bold text-[13px] leading-tight text-[#7d7979]">
                      {r.date.slice(5).replace('-', '/')} · {r.start_time}–{r.end_time}
                    </div>
                    <div class="font-bold text-base leading-snug text-[#201e1d]">{r.reason}</div>
                    <div class="font-normal text-[13px] leading-normal text-[#605d5d]">
                      {r.room_name} · {r.dept_name} {r.user_name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Scrim: the click target for dismissing the drawer now that it covers the grid.
          Kept light so the month behind it stays readable. */}
      <div
        onClick={() => (isDatePanelOpen.value = false)}
        aria-hidden="true"
        class={`fixed lg:absolute inset-0 bg-[#201e1d] z-20 transition-opacity duration-300 ${
          isDatePanelOpen.value ? 'opacity-20' : 'opacity-0 pointer-events-none'
        }`}
      ></div>

      {/* Right Slide-in Info Drawer (1e / 2a style) */}
      {/* On a phone this is a whole screen rather than a drawer — it starts below the
          56px ink bar so the hamburger and ＋ stay reachable. */}
      <div
        class={`fixed lg:absolute top-14 md:top-0 right-0 bottom-0 w-full md:w-[360px] bg-[#f3f2f2] md:border-l-2 md:border-[#201e1d] shadow-2xl z-30 p-5 md:p-6 overflow-y-auto transition-transform duration-300 ease-in-out ${
          isDatePanelOpen.value ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => (isDatePanelOpen.value = false)}
          class="md:hidden bg-transparent border-none p-0 mb-4 font-semibold text-sm text-[#605d5d] cursor-pointer"
        >
          ← 返回月曆
        </button>

        <div class="flex items-center justify-between">
          <div class="mono-label">選定日期</div>
          <span
            onClick={() => (isDatePanelOpen.value = false)}
            class="hidden md:inline font-bold text-xl cursor-pointer text-[#605d5d] hover:text-[#201e1d]"
          >
            ✕
          </span>
        </div>

        <div class="font-extrabold text-3xl leading-tight mt-2.5 mb-1 text-[#201e1d]">
          {dateMeta ? dateMeta.title : ''}
        </div>
        <div class="font-medium text-sm text-[#605d5d]">
          {dateMeta ? dateMeta.subtitle : ''}
        </div>

        <div class="h-0.5 bg-[#201e1d] my-5"></div>

        <div class="flex flex-col gap-4">
          {selectedDateRes.length > 0 ? (
            selectedDateRes.map((r) => (
              <div key={r.id} class="border-l-4 border-[#201e1d] pl-3 py-1">
                <div class="font-bold text-base sm:text-lg text-[#201e1d]">{r.reason}</div>
                <div class="font-medium text-sm text-[#444141] mt-0.5">
                  {r.start_time} – {r.end_time} · {r.room_name}
                </div>
                <div class="font-normal text-xs sm:text-sm text-[#605d5d] mt-0.5">
                  {r.dept_name} {r.user_name} {r.headcount ? `· ${r.headcount} 人` : ''}
                </div>
                <div class="font-normal text-xs text-[#7d7979] mt-0.5">
                  帳號 {r.user_id} · 分機 {r.user_ext || '—'}
                </div>
                <div class="flex flex-wrap gap-2 mt-2.5">
                  {/* 編輯 disappears once the booking has begun; 取消 stays, because a
                      meeting that did not happen still has to be struck from the record. */}
                  {currentUser.value && r.can_manage === true && !isPastSlot(r.date, r.start_min) && (
                    <button
                      onClick={(e) => handleEditReservation(e, r)}
                      class="border border-[#201e1d] bg-white px-2.5 py-1 text-xs font-semibold hover:bg-[#eae9e9] cursor-pointer"
                    >
                      編輯
                    </button>
                  )}
                  {currentUser.value && r.can_manage === true && (
                    <button
                      onClick={() => handleCancelReservation(r)}
                      class="bg-[#9e3526] hover:bg-[#71261b] text-white px-2.5 py-1 text-xs font-semibold border-none cursor-pointer"
                    >
                      取消預約
                    </button>
                  )}
                  <button
                    onClick={() => handleCopyInfo(r)}
                    class="border border-[#201e1d] bg-white px-2.5 py-1 text-xs font-semibold hover:bg-[#eae9e9] cursor-pointer"
                  >
                    複製資訊
                  </button>
                  <button
                    onClick={() => generateAndDownloadIcs(r)}
                    class="border border-[#201e1d] bg-white px-2.5 py-1 text-xs font-semibold hover:bg-[#eae9e9] cursor-pointer"
                  >
                    .ics 行事曆
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div class="font-normal text-sm text-[#7d7979] py-4">
              本日尚無預約紀錄
            </div>
          )}
        </div>

        <div class="h-px bg-[#d7d3d3] my-6"></div>

        {isPastDate(panelSelectedDate.value) ? (
          <div class="border border-[#d7d3d3] bg-[#eae9e9] p-3.5 font-medium text-sm text-[#605d5d]">
            此日期已過去，僅供查詢；如需異動請取消該筆預約。
          </div>
        ) : currentUser.value ? (
          <button
            onClick={() => handleOpenAddModal(panelSelectedDate.value)}
            class="w-full bg-[#9e3526] hover:bg-[#71261b] text-white p-3.5 font-bold text-base border-none cursor-pointer text-left transition-colors"
          >
            ＋ 於此日新增預約
          </button>
        ) : (
          <button
            onClick={() => showToast('請先登入系統後再發起預約', 'error')}
            class="w-full border border-[#201e1d] bg-white text-[#201e1d] p-3.5 font-semibold text-sm cursor-pointer text-left"
          >
            登入後發起預約
          </button>
        )}
      </div>
    </div>
  );
}
