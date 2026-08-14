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
  showToast,
} from '../state';
import { Reservation } from '../types';
import { generateAndDownloadIcs } from '../lib/ics';
import { isPastSlot } from '../../shared/time';

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

  return (
    <div class="max-w-[1400px] mx-auto p-0 md:p-8 min-h-[calc(100vh-5rem)]">
      {/* Mobile search + filter rail. The selects scroll sideways as a chip row rather
          than wrapping onto three lines. */}
      <div class="md:hidden px-4 pt-5">
        <input
          type="text"
          placeholder="🔍 搜尋事由、同仁、地點"
          value={searchQuery.value}
          onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
          class="w-full border border-[#201e1d] bg-white px-3.5 py-2.5 font-normal text-base text-[#201e1d] outline-none placeholder-[#9b9797] mb-2.5"
        />

        <div class="flex gap-2 overflow-x-auto pb-3.5 border-b-2 border-[#201e1d] mb-4">
          <select
            value={selectedRoomFilter.value}
            onChange={(e) => (selectedRoomFilter.value = (e.target as HTMLSelectElement).value)}
            class={`flex-none border border-[#201e1d] px-3 py-2 font-semibold text-[13px] outline-none whitespace-nowrap ${
              selectedRoomFilter.value ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d]'
            }`}
          >
            <option value="">全部會議室</option>
            {rooms.value.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.name}
              </option>
            ))}
          </select>

          <select
            value={selectedDeptFilter.value}
            onChange={(e) => (selectedDeptFilter.value = (e.target as HTMLSelectElement).value)}
            class={`flex-none border border-[#201e1d] px-3 py-2 font-semibold text-[13px] outline-none whitespace-nowrap ${
              selectedDeptFilter.value ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d]'
            }`}
          >
            <option value="">全部科室</option>
            {departments.value.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>

          {currentUser.value && (
            <button
              type="button"
              onClick={() => (onlyMineFilter.value = !onlyMineFilter.value)}
              aria-pressed={onlyMineFilter.value}
              class={`flex-none border border-[#201e1d] px-3 py-2 font-semibold text-[13px] whitespace-nowrap cursor-pointer ${
                onlyMineFilter.value ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d]'
              }`}
            >
              僅我的預約
            </button>
          )}
        </div>
      </div>

      {/* Search & Filters Bar — desktop */}
      <div class="hidden md:flex mcard p-5 mb-6 border border-[#201e1d] bg-[#f3f2f2] flex-wrap items-center justify-between gap-4">
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <input
            type="text"
            placeholder="🔍 搜尋會議事由、同仁、地點..."
            value={searchQuery.value}
            onInput={(e) => (searchQuery.value = (e.target as HTMLInputElement).value)}
            class="border border-[#201e1d] bg-white px-3.5 py-2 font-normal text-sm text-[#201e1d] w-64 outline-none placeholder-[#9b9797]"
          />

          <select
            value={selectedRoomFilter.value}
            onChange={(e) => (selectedRoomFilter.value = (e.target as HTMLSelectElement).value)}
            class="border border-[#201e1d] bg-white px-3.5 py-2 font-medium text-sm text-[#201e1d] outline-none"
          >
            <option value="">全部會議室 ▾</option>
            {rooms.value.map((rm) => (
              <option key={rm.id} value={rm.id}>
                {rm.name}
              </option>
            ))}
          </select>

          <select
            value={selectedDeptFilter.value}
            onChange={(e) => (selectedDeptFilter.value = (e.target as HTMLSelectElement).value)}
            class="border border-[#201e1d] bg-white px-3.5 py-2 font-medium text-sm text-[#201e1d] outline-none"
          >
            <option value="">全部科室 ▾</option>
            {departments.value.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>

          {currentUser.value && (
            <label class="flex items-center gap-2 border border-[#201e1d] bg-white px-3.5 py-2 font-bold text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyMineFilter.value}
                onChange={(e) => (onlyMineFilter.value = (e.target as HTMLInputElement).checked)}
                class="w-4 h-4 accent-[#9e3526]"
              />
              僅看我的預約
            </label>
          )}
        </div>

        <div class="font-bold text-sm text-[#605d5d]">
          共 {filtered.length} 筆預約紀錄
        </div>
      </div>

      {/* Mobile card list — the desktop table's eight columns do not survive a phone. */}
      <div class="md:hidden px-4 pb-8 flex flex-col gap-3.5">
        {filtered.length === 0 ? (
          <div class="font-medium text-sm text-[#7d7979] py-8 text-center">
            尚無符合條件的預約紀錄
          </div>
        ) : (
          filtered.map((r) => (
            <div key={r.id} class="border border-[#201e1d]/30 bg-[#f3f2f2] p-3.5">
              <div class="flex items-center justify-between mb-2 gap-2">
                <span class="mtag mtag-accent-2 truncate">{r.room_name}</span>
                <span class="font-semibold text-[13px] text-[#605d5d] flex-none">
                  {r.headcount || 0} 人
                </span>
              </div>

              <div class="font-bold text-[17px] leading-snug text-[#201e1d]">{r.reason}</div>
              <div class="font-medium text-sm leading-normal text-[#444141] mt-1">
                {r.date} · {r.start_time} ~ {r.end_time}
              </div>
              <div class="font-normal text-[13px] leading-normal text-[#605d5d]">
                {r.dept_name} {r.user_name}（{r.user_id}）· 分機 {r.user_ext || '—'}
              </div>
              {r.notes && (
                <div class="font-normal text-[13px] leading-normal text-[#7d7979] mt-1">
                  備註: {r.notes}
                </div>
              )}

              <div class="grid grid-cols-2 gap-2 mt-2.5">
                <button
                  onClick={() => handleCopyInfo(r)}
                  class="border border-[#201e1d] bg-white py-2 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                >
                  複製
                </button>
                <button
                  onClick={() => generateAndDownloadIcs(r)}
                  class="border border-[#201e1d] bg-white py-2 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                >
                  .ics
                </button>
                {currentUser.value && r.can_manage === true && (
                  <>
                    {/* Once the booking has started it is history: browse or cancel only. */}
                    {!isPastSlot(r.date, r.start_min) && (
                      <button
                        onClick={() => {
                          editingReservation.value = r;
                          isReservationModalOpen.value = true;
                        }}
                        class="border border-[#201e1d] bg-white py-2 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                      >
                        編輯
                      </button>
                    )}
                    <button
                      onClick={() => handleCancel(r)}
                      class="bg-[#9e3526] text-white py-2 font-semibold text-[13px] border-none cursor-pointer"
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modernist Table — desktop */}
      <div class="hidden md:block mcard border border-[#201e1d] overflow-x-auto bg-[#f3f2f2]">
        <table class="mtable w-full">
          <thead>
            <tr class="bg-[#eae9e9]">
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d]">會議地點</th>
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d]">日期與時間</th>
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d]">會議事由</th>
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d]">登記科室 / 同仁（帳號・分機）</th>
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d] text-center">人數</th>
              <th class="p-3.5 px-4 font-bold text-sm text-[#201e1d] text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#201e1d]/20 text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} class="text-center py-10 font-medium text-[#7d7979]">
                  尚無符合條件的預約紀錄
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} class="hover:bg-white transition-colors">
                  <td class="p-3.5 px-4">
                    <span class="mtag mtag-accent-2">{r.room_name}</span>
                  </td>
                  <td class="p-3.5 px-4 font-semibold text-[#201e1d]">
                    <div>{r.date}</div>
                    <div class="font-normal text-xs text-[#605d5d]">{r.start_time} – {r.end_time}</div>
                  </td>
                  <td class="p-3.5 px-4">
                    <div class="font-bold text-[#201e1d]">{r.reason}</div>
                    {r.notes && <div class="font-normal text-xs text-[#605d5d]">備註: {r.notes}</div>}
                  </td>
                  <td class="p-3.5 px-4">
                    <div class="font-semibold text-[#201e1d]">{r.dept_name}</div>
                    <div class="font-normal text-xs text-[#605d5d]">
                      {r.user_name}（{r.user_id}）
                    </div>
                    <div class="font-normal text-xs text-[#605d5d]">
                      分機 {r.user_ext || '—'}
                    </div>
                  </td>
                  <td class="p-3.5 px-4 text-center font-bold text-[#201e1d]">
                    {r.headcount || 0}
                  </td>
                  <td class="p-3.5 px-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleCopyInfo(r)}
                        class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-xs text-[#201e1d] hover:bg-[#eae9e9] cursor-pointer"
                      >
                        複製
                      </button>
                      <button
                        onClick={() => generateAndDownloadIcs(r)}
                        class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-xs text-[#201e1d] hover:bg-[#eae9e9] cursor-pointer"
                      >
                        .ics
                      </button>
                      {currentUser.value && r.can_manage === true && (
                        <>
                          {!isPastSlot(r.date, r.start_min) && (
                            <button
                              onClick={() => {
                                editingReservation.value = r;
                                isReservationModalOpen.value = true;
                              }}
                              class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-xs text-[#201e1d] hover:bg-[#eae9e9] cursor-pointer"
                            >
                              編輯
                            </button>
                          )}
                          <button
                            onClick={() => handleCancel(r)}
                            class="bg-[#9e3526] hover:bg-[#71261b] text-white px-2.5 py-1.5 font-semibold text-xs border-none cursor-pointer"
                          >
                            取消
                          </button>
                        </>
                      )}
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
