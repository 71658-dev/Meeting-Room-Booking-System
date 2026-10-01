import { useState, useEffect } from 'preact/hooks';
import { CalendarPlus, Copy, Pencil, Search, Trash2 } from 'lucide-preact';
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
  showToast,
} from '../state';
import { Reservation } from '../types';
import { generateAndDownloadIcs } from '../lib/ics';
import { isPastSlot } from '../../shared/time';
import { roomStyle } from '../lib/roomColor';

export function ListView() {
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resData, roomData, deptData] = await Promise.all([
        api.getReservations(),
        api.getRooms(),
        api.getDepartments(),
      ]);
      if (resData.success) reservations.value = resData.reservations;
      if (roomData.success) rooms.value = roomData.rooms;
      if (deptData.success) departments.value = deptData.departments;
    } catch (e) {
      console.error('Failed to load list data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filter reservations
  const filtered = reservations.value.filter((r) => {
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

  const handleCopyInfo = (r: Reservation) => {
    const text = `【會議通知】\n地點：${r.room_name}\n日期：${r.date}\n時間：${r.start_time} ~ ${r.end_time}\n事由：${r.reason}\n登記人：${r.dept_name} ${r.user_name}（${r.user_id}）\n聯絡分機：${r.user_ext || '—'}\n備註：${r.notes || '無'}`;
    navigator.clipboard.writeText(text);
    showToast('會議資訊已複製至剪貼簿', 'success');
  };

  const handleCancel = async (r: Reservation) => {
    if (!confirm(`確定要取消「${r.reason}」的預約嗎？`)) return;
    try {
      await api.cancelReservation(r.id);
      showToast('預約已取消', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || '取消失敗', 'error');
    }
  };

  const handleEdit = (r: Reservation) => {
    editingReservation.value = r;
    isReservationModalOpen.value = true;
  };

  /** Row actions, shared by the desktop table and the phone cards. */
  const actionsFor = (r: Reservation) => {
    const canManage = !!currentUser.value && r.can_manage === true;
    return [
      { key: 'copy', label: '複製會議資訊', Icon: Copy, onClick: () => handleCopyInfo(r), danger: false, show: true },
      { key: 'ics', label: '下載 .ics 行事曆', Icon: CalendarPlus, onClick: () => generateAndDownloadIcs(r), danger: false, show: true },
      // Once the booking has started it is history: browse or cancel only.
      { key: 'edit', label: '編輯預約', Icon: Pencil, onClick: () => handleEdit(r), danger: false, show: canManage && !isPastSlot(r.date, r.start_min) },
      { key: 'cancel', label: '取消預約', Icon: Trash2, onClick: () => handleCancel(r), danger: true, show: canManage },
    ].filter((a) => a.show);
  };

  const searchBox = (extra: string) => (
    <label class={`glass-input flex items-center gap-2 cursor-text ${extra}`}>
      <Search size={17} class="flex-none text-label-2" aria-hidden="true" />
      <span class="sr-only">搜尋</span>
      <input
        type="search"
        placeholder="搜尋事由、同仁、地點"
        value={searchQuery.value}
        onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
        class="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] placeholder:text-label-2"
      />
    </label>
  );

  const roomSelect = (extra: string) => (
    <select
      aria-label="會議室篩選"
      value={selectedRoomFilter.value}
      onChange={(e) => (selectedRoomFilter.value = (e.target as HTMLSelectElement).value)}
      class={`glass-select ${selectedRoomFilter.value ? 'is-set' : ''} ${extra}`}
    >
      <option value="">全部會議室</option>
      {rooms.value.map((rm) => (
        <option key={rm.id} value={rm.id}>
          {rm.name}
        </option>
      ))}
    </select>
  );

  const deptSelect = (extra: string) => (
    <select
      aria-label="科室篩選"
      value={selectedDeptFilter.value}
      onChange={(e) => (selectedDeptFilter.value = (e.target as HTMLSelectElement).value)}
      class={`glass-select ${selectedDeptFilter.value ? 'is-set' : ''} ${extra}`}
    >
      <option value="">全部科室</option>
      {departments.value.map((d) => (
        <option key={d.id} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 min-h-[calc(100vh-88px)]">
      {/* Title + filters */}
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3 md:gap-4 mb-3 md:mb-4">
        <div>
          <div class="hidden md:block lg-eyebrow">共 {filtered.length} 筆預約紀錄</div>
          <h1 class="m-0 lg-title-1">預約清單</h1>
        </div>

        <div class="hidden md:flex flex-wrap items-center gap-2.5">
          {searchBox('w-[300px]')}
          {roomSelect('')}
          {deptSelect('')}
          {currentUser.value && (
            <div class="glass-input flex items-center gap-2.5 pr-1.5 font-medium">
              <span id="list-only-mine">僅看我的</span>
              <button
                type="button"
                role="switch"
                aria-checked={onlyMineFilter.value}
                aria-labelledby="list-only-mine"
                onClick={() => (onlyMineFilter.value = !onlyMineFilter.value)}
                class="switch"
              ></button>
            </div>
          )}
        </div>

        {/* Phone: search, then a sideways-scrolling chip row */}
        <div class="md:hidden">
          {searchBox('w-full h-11 text-[17px]')}
          <div class="flex gap-2 overflow-x-auto mt-3 -mx-4 px-4 pb-1">
            {roomSelect('h-[34px] flex-none text-[15px] pl-3.5')}
            {deptSelect('h-[34px] flex-none text-[15px] pl-3.5')}
            {currentUser.value && (
              <button
                type="button"
                onClick={() => (onlyMineFilter.value = !onlyMineFilter.value)}
                aria-pressed={onlyMineFilter.value}
                class={`chip chip-solid flex-none ${onlyMineFilter.value ? '' : 'glass'}`}
              >
                僅我的
              </button>
            )}
          </div>
          <div class="text-[13px] text-label-2 mt-2 mx-1">共 {filtered.length} 筆</div>
        </div>
      </div>

      {/* Phone cards — the desktop table's six columns do not survive a phone. */}
      <div class="md:hidden flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div class="surface rounded-[24px] px-4 py-8 text-center text-[15px] text-label-2">尚無符合條件的預約紀錄</div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} class="surface rounded-[24px] px-4 py-3.5">
              <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="room-pill h-6 text-xs truncate" style={roomStyle(r.room_color)}>
                  {r.room_name}
                </span>
                <span class="text-[13px] text-label-2 flex-none">{r.headcount || 0} 人</span>
              </div>
              <div class="text-[17px] leading-[22px] font-semibold">{r.reason}</div>
              <div class="text-[15px] text-black/80 mt-0.5 tabular-nums">
                {formatMd(r.date)} {formatWd(r.date)} · {r.start_time}–{r.end_time}
              </div>
              <div class="text-[13px] text-label-2">
                {r.dept_name} {r.user_name}（{r.user_id}）· 分機 {r.user_ext || '—'}
              </div>
              {r.notes && <div class="text-[13px] text-label-2 mt-0.5">備註：{r.notes}</div>}

              <div class="flex gap-1.5 mt-2.5">
                {actionsFor(r).map(({ key, label, Icon, onClick, danger }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={onClick}
                    aria-label={label}
                    title={label}
                    class={`btn flex-1 h-[34px] ${danger ? 'btn-danger' : 'btn-tinted'}`}
                  >
                    <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table — desktop */}
      <div class="hidden md:block surface rounded-[28px] overflow-x-auto">
        <table class="lg-table min-w-[900px]">
          <thead>
            <tr>
              <th>會議地點</th>
              <th>日期與時間</th>
              <th>會議事由</th>
              <th>登記科室 / 同仁</th>
              <th class="text-center">人數</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} class="text-center py-10 text-label-2">
                  尚無符合條件的預約紀錄
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span class="room-pill" style={roomStyle(r.room_color)}>
                      {r.room_name}
                    </span>
                  </td>
                  <td class="whitespace-nowrap">
                    <div class="font-semibold tabular-nums">
                      {formatMd(r.date)} {formatWd(r.date)}
                    </div>
                    <div class="text-[13px] text-label-2 tabular-nums">
                      {r.start_time} – {r.end_time}
                    </div>
                  </td>
                  <td>
                    <div class="font-semibold">{r.reason}</div>
                    {r.notes && <div class="text-[13px] text-label-2">備註：{r.notes}</div>}
                  </td>
                  <td>
                    <div>
                      {r.dept_name} {r.user_name}
                    </div>
                    <div class="text-[13px] text-label-2">
                      {r.user_id} · 分機 {r.user_ext || '—'}
                    </div>
                  </td>
                  <td class="text-center tabular-nums">{r.headcount || 0}</td>
                  <td>
                    <div class="flex justify-end gap-1.5">
                      {actionsFor(r).map(({ key, label, Icon, onClick, danger }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={onClick}
                          aria-label={label}
                          title={label}
                          class={`btn btn-icon ${danger ? 'btn-danger' : 'btn-tinted'}`}
                        >
                          <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `2026-10-07` → `10/7`. The list is unfiltered and can span years, so another year keeps its prefix. */
function formatMd(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const thisYear = new Date().getFullYear();
  return y === thisYear ? `${m}/${d}` : `${y}/${m}/${d}`;
}

function formatWd(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `週${'日一二三四五六'[new Date(y, m - 1, d).getDay()]}`;
}
