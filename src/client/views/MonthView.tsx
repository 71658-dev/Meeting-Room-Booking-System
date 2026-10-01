import { useState, useEffect } from 'preact/hooks';
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Search, X } from 'lucide-preact';
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
import { roomColor } from '../lib/roomColor';
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

  const roomList = rooms.value;
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  // Three rooms still fit a segmented control beside the other filters; past that it
  // turns into a dropdown like the department filter.
  const roomsAsSegments = roomList.length > 0 && roomList.length <= 3;
  const monthTitle = `${year} 年 ${month} 月`;

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 relative min-h-[calc(100vh-88px)]">
      {/* The drawer overlays this block instead of reserving space next to it: reflowing
          the calendar grid on open shrank every cell and re-wrapped the entry text. */}
      <div>
        {/* Title + month navigation */}
        <div class="flex items-end justify-between gap-4 mb-3 md:mb-4">
          <div>
            <div class="hidden md:block lg-eyebrow">月曆總覽</div>
            <h1 class="m-0 lg-title-1">
              <span class="hidden md:inline">{monthTitle}</span>
              <span class="md:hidden">{month} 月</span>
            </h1>
          </div>
          <div class="glass flex items-center gap-0.5 h-11 px-1 rounded-full">
            <button type="button" onClick={handlePrevMonth} aria-label="上個月" class="btn bg-transparent text-accent w-9 h-9 p-0 hover:bg-fill">
              <ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" onClick={handleToday} class="btn bg-transparent text-accent h-9 px-3 text-[15px] hover:bg-fill">
              今天
            </button>
            <button type="button" onClick={handleNextMonth} aria-label="下個月" class="btn bg-transparent text-accent w-9 h-9 p-0 hover:bg-fill">
              <ChevronRight size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Filter row — desktop */}
        <div class="hidden md:flex flex-wrap items-center gap-2.5 mb-4">
          <label class="glass-input flex items-center gap-2 w-[280px] cursor-text">
            <Search size={17} class="flex-none text-label-2" aria-hidden="true" />
            <span class="sr-only">搜尋</span>
            <input
              type="search"
              placeholder="搜尋事由 / 同仁 / 會議室"
              value={searchQuery.value}
              onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
              class="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] placeholder:text-label-2"
            />
          </label>

          {roomsAsSegments ? (
            <div class="segmented h-10" role="group" aria-label="會議室篩選">
              <button type="button" aria-pressed={!selectedRoomFilter.value} onClick={() => (selectedRoomFilter.value = '')}>
                全部會議室
              </button>
              {roomList.map((rm) => (
                <button
                  key={rm.id}
                  type="button"
                  aria-pressed={selectedRoomFilter.value === rm.id}
                  onClick={() => (selectedRoomFilter.value = rm.id)}
                >
                  {rm.name}
                </button>
              ))}
            </div>
          ) : (
            <select
              aria-label="會議室篩選"
              value={selectedRoomFilter.value}
              onChange={(e) => (selectedRoomFilter.value = (e.target as HTMLSelectElement).value)}
              class={`glass-select ${selectedRoomFilter.value ? 'is-set' : ''}`}
            >
              <option value="">全部會議室（{roomList.length} 間）</option>
              {roomList.map((rm) => (
                <option key={rm.id} value={rm.id}>
                  {rm.name}（{rm.capacity} 人）
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="科室篩選"
            value={selectedDeptFilter.value}
            onChange={(e) => (selectedDeptFilter.value = (e.target as HTMLSelectElement).value)}
            class={`glass-select ${selectedDeptFilter.value ? 'is-set' : ''}`}
          >
            <option value="">全部科室</option>
            {departments.value.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>

          {currentUser.value && (
            <div class="glass-input flex items-center gap-2.5 pr-1.5 font-medium">
              <span id="month-only-mine">僅我的預約</span>
              <button
                type="button"
                role="switch"
                aria-checked={onlyMineFilter.value}
                aria-labelledby="month-only-mine"
                onClick={() => (onlyMineFilter.value = !onlyMineFilter.value)}
                class="switch"
              ></button>
            </div>
          )}

          <div class="flex-1"></div>

          {roomList.length > 0 && (
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-label-2">
              {roomList.map((rm) => (
                <span key={rm.id} class="inline-flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full" style={{ background: roomColor(rm.color_key).color }}></span>
                  {rm.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Calendar */}
        <div class="surface rounded-[24px] md:rounded-[28px] overflow-hidden px-1.5 pt-2.5 md:pt-3.5 pb-1.5">
          <div class="grid grid-cols-7 pb-1 md:pb-2">
            {WEEKDAYS.map((zh, i) => (
              <div
                key={zh}
                class={`text-center md:text-left md:px-3.5 text-[11px] md:text-[13px] font-semibold ${
                  i === 0 || i === 6 ? 'text-[rgba(60,60,67,.45)]' : 'text-label-2'
                }`}
              >
                <span class="hidden md:inline">週</span>
                {zh}
              </div>
            ))}
          </div>

          <div class="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              const dayResList = resByDate[day.dateStr] || [];
              const isToday = day.dateStr === todayStr;
              const isSelected = isDatePanelOpen.value && day.dateStr === panelSelectedDate.value;
              const isWeekend = i % 7 === 0 || i % 7 === 6;

              // Phone: the selected day takes the blue disc and today keeps red text.
              // Desktop: today takes the red disc and selection is the cell's blue ring.
              const numClass = isSelected
                ? `max-md:bg-accent max-md:text-white ${isToday ? 'md:bg-danger md:text-white' : 'md:text-black'}`
                : isToday
                ? 'text-danger md:bg-danger md:text-white'
                : !day.isCurrentMonth
                ? 'text-label-3'
                : isWeekend
                ? 'text-black md:text-label-2'
                : 'text-black';

              return (
                <div key={day.dateStr} class="md:p-[3px] md:border-t-[0.5px] md:border-black/[.08]">
                  <button
                    type="button"
                    onClick={() => handleCellClick(day.dateStr)}
                    aria-label={`${day.dateStr}${dayResList.length ? `，${dayResList.length} 筆預約` : ''}`}
                    aria-pressed={isSelected}
                    class={`w-full h-[46px] md:h-[140px] p-0 md:p-2 flex flex-col items-center md:items-stretch justify-center md:justify-start gap-[3px] md:gap-1 border-none rounded-2xl text-left overflow-hidden cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-transparent md:bg-accent/[.07] md:shadow-[inset_0_0_0_2px_#0088ff]'
                        : 'bg-transparent md:hover:bg-fill-2'
                    }`}
                  >
                    <span class="flex items-center justify-between md:w-full">
                      <span
                        class={`w-8 h-8 md:w-[30px] md:h-[30px] rounded-full flex items-center justify-center text-[17px] tabular-nums ${
                          isToday || isSelected ? 'font-semibold' : 'font-normal'
                        } ${numClass}`}
                      >
                        {day.dayNum}
                      </span>
                      {dayResList.length > 1 && (
                        <span class="hidden md:inline text-xs text-label-2">{dayResList.length} 筆</span>
                      )}
                    </span>

                    {/* Presence dot on a phone, entry chips on desktop. */}
                    <span
                      aria-hidden="true"
                      class={`md:hidden w-[5px] h-[5px] rounded-full ${dayResList.length ? 'bg-[rgba(60,60,67,.35)]' : 'bg-transparent'}`}
                    ></span>

                    {dayResList.slice(0, MAX_CHIPS).map((r) => {
                      const c = roomColor(r.room_color);
                      return (
                        <span key={r.id} class="hidden md:block flex-none px-2 py-[3px] rounded-[9px] overflow-hidden" style={{ background: c.tint }}>
                          <span class="block text-xs leading-[15px] font-semibold text-black truncate">{r.reason}</span>
                          <span class="flex items-center gap-1 text-[11px] leading-[13px] text-label-2 whitespace-nowrap overflow-hidden">
                            <span class="w-1.5 h-1.5 rounded-full flex-none" style={{ background: c.color }}></span>
                            <span class="truncate">
                              {r.start_time} · {r.room_name}
                            </span>
                          </span>
                        </span>
                      );
                    })}
                    {dayResList.length > MAX_CHIPS && (
                      <span class="hidden md:block px-2 text-[11px] font-semibold text-label-2">
                        還有 {dayResList.length - MAX_CHIPS} 筆
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 近期預約 — 手機版 only */}
        <div class="md:hidden">
          <h2 class="m-0 mt-5 mb-2 mx-1 text-xl leading-[25px] font-semibold">近期預約</h2>
          {upcoming.length === 0 ? (
            <div class="surface rounded-[24px] px-4 py-5 text-[15px] text-label-2">本月尚無即將到來的預約</div>
          ) : (
            <div class="surface rounded-[24px] overflow-hidden">
              {upcoming.map((r, idx) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleCellClick(r.date)}
                  class={`w-full flex gap-3 px-4 py-3 bg-transparent border-none text-left cursor-pointer ${
                    idx > 0 ? 'shadow-[inset_0_.5px_0_rgba(0,0,0,.08)]' : ''
                  }`}
                >
                  <span class="w-[42px] flex-none text-right">
                    <span class="block text-[15px] font-semibold tabular-nums">{r.start_time}</span>
                    <span class="block text-xs text-label-2 tabular-nums">{shortDate(r.date)}</span>
                  </span>
                  <span class="w-1 rounded-sm flex-none" style={{ background: roomColor(r.room_color).color }}></span>
                  <span class="min-w-0">
                    <span class="block text-[17px] leading-[22px] font-semibold truncate">{r.reason}</span>
                    <span class="block text-[13px] text-label-2 truncate">
                      {r.room_name} · {r.dept_name} {r.user_name}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scrim: the click target for dismissing the drawer now that it covers the grid.
          Kept light so the month behind it stays readable. */}
      <div
        onClick={() => (isDatePanelOpen.value = false)}
        aria-hidden="true"
        class={`hidden md:block absolute inset-0 z-20 transition-opacity duration-300 ${
          isDatePanelOpen.value ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      ></div>

      {/* Day drawer (D2). A floating glass panel over the calendar on desktop; on a phone
          a screen of its own, under the tab bar so the tabs and ＋ stay reachable. */}
      <aside
        aria-label="選定日期的預約"
        aria-hidden={!isDatePanelOpen.value}
        class={`fixed md:absolute inset-0 md:inset-auto md:top-2 md:right-4 md:h-[calc(100vh-112px)] md:max-h-[calc(100%-24px)] md:w-[380px] z-30 max-md:bg-[#f2f2f7] md:glass-sheet md:rounded-[32px] p-5 pt-6 pb-32 md:pb-5 flex flex-col gap-4 overflow-y-auto transition-[translate,opacity] duration-300 ease-out ${
          isDatePanelOpen.value
            ? 'translate-x-0 opacity-100'
            : 'translate-x-full md:translate-x-[calc(100%+16px)] opacity-0 pointer-events-none'
        }`}
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[13px] font-semibold text-accent">{dateMeta.subtitle}</div>
            <div class="text-[28px] leading-[34px] font-bold">{dateMeta.title}</div>
          </div>
          <button
            type="button"
            onClick={() => (isDatePanelOpen.value = false)}
            aria-label="關閉"
            class="btn btn-plain btn-icon w-9 h-9 text-label-2"
          >
            <X size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        {selectedDateRes.length > 0 ? (
          selectedDateRes.map((r) => {
            const canManage = !!currentUser.value && r.can_manage === true;
            return (
              <div key={r.id} class="rounded-[20px] bg-white/85 px-4 py-3.5 flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full flex-none" style={{ background: roomColor(r.room_color).color }}></span>
                  <span class="text-[13px] font-semibold text-label-2">
                    {r.start_time} – {r.end_time} · {r.room_name}
                  </span>
                </div>
                <div class="text-[17px] leading-[22px] font-semibold">{r.reason}</div>
                <div class="text-[13px] leading-[18px] text-label-2">
                  {r.dept_name} {r.user_name}
                  {r.headcount ? ` · ${r.headcount} 人` : ''}
                  <br />
                  帳號 {r.user_id} · 分機 {r.user_ext || '—'}
                </div>
                <div class="flex flex-wrap gap-1.5 mt-1.5">
                  {/* 編輯 disappears once the booking has begun; 取消 stays, because a
                      meeting that did not happen still has to be struck from the record. */}
                  {canManage && !isPastSlot(r.date, r.start_min) && (
                    <button type="button" onClick={(e) => handleEditReservation(e, r)} class="btn btn-tinted btn-sm gap-1">
                      <Pencil size={13} strokeWidth={2.4} aria-hidden="true" />
                      編輯
                    </button>
                  )}
                  <button type="button" onClick={() => handleCopyInfo(r)} class="btn btn-tinted btn-sm gap-1">
                    <Copy size={13} strokeWidth={2.4} aria-hidden="true" />
                    複製
                  </button>
                  <button type="button" onClick={() => generateAndDownloadIcs(r)} class="btn btn-tinted btn-sm gap-1">
                    <CalendarPlus size={13} strokeWidth={2.4} aria-hidden="true" />
                    .ics
                  </button>
                  {canManage && (
                    <button type="button" onClick={() => handleCancelReservation(r)} class="btn btn-tinted btn-sm text-danger">
                      取消預約
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div class="rounded-[20px] bg-white/60 px-4 py-6 text-center text-[15px] text-label-2">本日尚無預約紀錄</div>
        )}

        <div class="flex-1"></div>

        {isPastDate(panelSelectedDate.value) ? (
          <div class="rounded-2xl bg-fill px-4 py-3.5 text-[15px] text-label-2">
            此日期已過去，僅供查詢；如需異動請取消該筆預約。
          </div>
        ) : currentUser.value ? (
          <button type="button" onClick={() => handleOpenAddModal(panelSelectedDate.value)} class="btn btn-primary btn-lg w-full flex-none">
            <Plus size={19} strokeWidth={2.4} aria-hidden="true" />
            於此日新增預約
          </button>
        ) : (
          <button type="button" onClick={() => showToast('請先登入系統後再發起預約', 'error')} class="btn btn-tinted btn-lg w-full flex-none">
            登入後發起預約
          </button>
        )}
      </aside>
    </div>
  );
}

// Two chips plus the 還有 N 筆 line is what a 140px cell holds without clipping.
const MAX_CHIPS = 2;

/** `2026-10-07` → `10/7` */
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}
