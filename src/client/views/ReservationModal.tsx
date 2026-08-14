import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import {
  isReservationModalOpen,
  editingReservation,
  modalSelectedDate,
  rooms,
  equipment,
  showToast,
  currentUser,
  reservations,
} from '../state';
import { Reservation } from '../types';
import { Modal } from '../components/Modal';
import { agencyToday, isPastSlot, timeStrToMin } from '../../shared/time';

/** The `conflict` object a 409 carries, from both POST and PATCH /api/reservations. */
interface ConflictInfo {
  roomName?: string;
  date?: string;
  userName?: string;
  reason?: string;
  startTime?: string;
  endTime?: string;
}

export function ReservationModal() {
  const isOpen = isReservationModalOpen.value;
  const editTarget = editingReservation.value;

  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:30');
  const [endTime, setEndTime] = useState('10:00');
  const [reason, setReason] = useState('');
  const [meetingType, setMeetingType] = useState<'internal' | 'external' | 'department' | 'other'>('internal');
  const [headcount, setHeadcount] = useState(5);
  const [notes, setNotes] = useState('');
  const [attendeesEmail, setAttendeesEmail] = useState('');
  const [selectedEqIds, setSelectedEqIds] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(false);

  const [loading, setLoading] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null);
  // The banner alone was missable: the form is taller than the viewport, so a user who
  // scrolled down to reach 確認預約 never saw the message appear at the top of the column.
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false);

  // For occupancy list calculation on the right panel
  const [roomOccupancy, setRoomOccupancy] = useState<Reservation[]>([]);

  useEffect(() => {
    if (isOpen) {
      setConflictError(null);
      setConflictInfo(null);
      setIsConflictDialogOpen(false);
      if (editTarget) {
        setRoomId(editTarget.room_id);
        setDate(editTarget.date);
        setStartTime(editTarget.start_time || '08:30');
        setEndTime(editTarget.end_time || '10:00');
        setReason(editTarget.reason);
        setMeetingType(editTarget.meeting_type || 'internal');
        setHeadcount(editTarget.headcount || 5);
        setNotes(editTarget.notes || '');
        setAttendeesEmail(editTarget.attendees_email || '');
        setSelectedEqIds(editTarget.equipment_ids || []);
        setSendEmail(false);
      } else {
        setRoomId(rooms.value[0]?.id || '');
        setDate(modalSelectedDate.value || agencyToday());
        setStartTime('08:30');
        setEndTime('10:00');
        setReason('');
        setMeetingType('internal');
        setHeadcount(5);
        setNotes('');
        setAttendeesEmail('');
        setSelectedEqIds([]);
        setSendEmail(false);
      }
    }
  }, [isOpen, editTarget]);

  // Reference data the form depends on. Every main view loads rooms, but the
  // modal can also be opened from the header while a view that never fetched
  // them is mounted, and nothing else fetches equipment at all.
  useEffect(() => {
    if (!isOpen) return;
    if (rooms.value.length === 0) {
      api.getRooms().then((res) => {
        if (res.success) {
          rooms.value = res.rooms;
          setRoomId((prev) => prev || res.rooms[0]?.id || '');
        }
      }).catch(() => {});
    }
    if (equipment.value.length === 0) {
      api.getEquipment().then((res) => {
        if (res.success) equipment.value = res.equipment;
      }).catch(() => {});
    }
  }, [isOpen]);

  // Load occupancy data when roomId or date changes
  useEffect(() => {
    if (isOpen && roomId && date) {
      api.getReservations({ from: date, to: date, roomId }).then((res) => {
        if (res.success) {
          // Filter out current editTarget if editing
          const list = editTarget ? res.reservations.filter((r) => r.id !== editTarget.id) : res.reservations;
          setRoomOccupancy(list);
        }
      }).catch(() => {});
    }
  }, [isOpen, roomId, date]);

  if (!isOpen) return null;

  const quickSlots = [
    { label: '08:30–10:00', start: '08:30', end: '10:00' },
    { label: '10:00–12:00', start: '10:00', end: '12:00' },
    { label: '13:30–15:00', start: '13:30', end: '15:00' },
    { label: '15:00–17:00', start: '15:00', end: '17:00' },
    { label: '上午 半天', start: '08:30', end: '12:00' },
    { label: '下午 半天', start: '13:30', end: '17:00' },
    { label: '全天', start: '08:30', end: '17:00' },
  ];

  const handleShortcut = (st: string, et: string) => {
    setStartTime(st);
    setEndTime(et);
  };

  // Mirrors the server rule in routes/reservations.ts. The server is authoritative — this
  // only exists so the form says no before a round trip, and so past slots are visibly
  // unavailable rather than silently rejected on submit.
  const today = agencyToday();
  const slotIsPast = (slotStart: string) => isPastSlot(date, timeStrToMin(slotStart));

  const handleEquipmentToggle = (eqId: string) => {
    if (selectedEqIds.includes(eqId)) {
      setSelectedEqIds(selectedEqIds.filter((id) => id !== eqId));
    } else {
      setSelectedEqIds([...selectedEqIds, eqId]);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (isPastSlot(date, timeStrToMin(startTime))) {
      showToast('不可預約已過去的時段，請改選今天稍後或未來的時間', 'error');
      return;
    }

    setConflictError(null);
    setConflictInfo(null);
    setLoading(true);

    const payload = {
      roomId,
      date,
      startTime,
      endTime,
      reason,
      meetingType,
      headcount,
      notes,
      attendeesEmail,
      equipmentIds: selectedEqIds,
      sendEmail,
    };

    try {
      if (editTarget) {
        await api.updateReservation(editTarget.id, payload);
        showToast('預約已更新成功！', 'success');
      } else {
        await api.createReservation(payload);
        showToast('會議室預約成功！', 'success');
      }

      isReservationModalOpen.value = false;

      // Reload reservations list
      const res = await api.getReservations();
      if (res.success) reservations.value = res.reservations;
    } catch (err: any) {
      if (err.status === 409 || err.message?.includes('衝突')) {
        setConflictError(err.message || '預約時間與既有預約衝突');
        setConflictInfo(err.data?.conflict ?? null);
        setIsConflictDialogOpen(true);
      } else {
        showToast(err.message || '預約處置失敗', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectedRoomObj = rooms.value.find((r) => r.id === roomId);

  const toMin = (t: string) => {
    const [h, m] = (t || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
  };

  // The anchor hours give the panel the ruler shape the design shows, but a
  // booking starting between two anchors (11:30, say) matched no row and vanished
  // from the panel entirely — so every existing booking contributes its own start
  // time as well, as does the slot being planned.
  const ANCHOR_SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:30', '15:00', '17:00'];
  const hourBlocks = Array.from(
    new Set([
      ...ANCHOR_SLOTS,
      ...roomOccupancy.map((r) => r.start_time).filter((t): t is string => !!t),
      startTime,
    ])
  ).sort((a, b) => toMin(a) - toMin(b));

  // Compared as minutes from midnight rather than as strings, per this project's
  // convention for times.
  const getSlotStatus = (timeSlot: string) => {
    const slot = toMin(timeSlot);
    const inPlanned = slot >= toMin(startTime) && slot < toMin(endTime);
    const occ = roomOccupancy.find((r) => slot >= r.start_min && slot < r.end_min);

    // An overlap has to win over the planned slot: this panel exists to surface
    // the clash before submitting, so painting it as "規劃中" would hide exactly
    // what the user needs to see.
    if (occ && inPlanned) {
      return { status: 'conflict', text: `⚠ 與「${occ.reason}」時段重疊` };
    }
    if (occ) {
      return { status: 'occupied', text: `${occ.reason} (${occ.dept_name} ${occ.user_name})` };
    }
    if (inPlanned) {
      return { status: 'planning', text: '本次預約（規劃中）' };
    }
    return { status: 'free', text: '空閒' };
  };

  return (
    <>
    <div
      onClick={() => (isReservationModalOpen.value = false)}
      class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-start justify-center p-0 md:p-8 overflow-y-auto"
    >
      {/* Full-bleed sheet below md (手機版 treats the form as its own screen), framed
          dialog above it. */}
      <div
        onClick={(e) => e.stopPropagation()}
        class="w-full min-h-full md:min-h-0 md:max-w-[1040px] bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] shadow-2xl md:my-auto"
      >
        <div class="p-5 md:p-8 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 md:gap-8">
          {/* Left Form Column */}
          <div class="lg:pr-8 lg:border-r-2 lg:border-[#201e1d]/40">
            {/* Back affordance on a phone, close glyph on desktop. */}
            <button
              type="button"
              onClick={() => (isReservationModalOpen.value = false)}
              class="md:hidden bg-transparent border-none p-0 mb-4 font-semibold text-sm text-[#605d5d] cursor-pointer"
            >
              ← 返回
            </button>

            <div class="flex items-center justify-between">
              <div>
                <div class="mono-label">NEW RESERVATION</div>
                <h2 class="m-0 font-extrabold text-[26px] md:text-3xl leading-tight text-[#201e1d] mt-1">
                  {editTarget ? '編輯會議室預約' : '發起會議室預約'}
                </h2>
              </div>
              <span
                onClick={() => (isReservationModalOpen.value = false)}
                class="hidden md:inline font-bold text-2xl cursor-pointer text-[#605d5d] hover:text-[#201e1d]"
              >
                ✕
              </span>
            </div>

            <div class="h-0.5 bg-[#201e1d] my-5"></div>

            {conflictError && (
              <div class="mb-5 p-4 bg-[#fff2ef] border-2 border-[#9e3526] text-[#71261b]">
                <div class="font-bold text-base">時間衝突 (409 Conflict)</div>
                <div class="font-normal text-sm mt-1">{conflictError}</div>
                <div class="font-normal text-xs text-[#71261b]/80 mt-1">
                  請參考右欄時間表改選其他時段或會議室。
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} class="flex flex-col gap-5 text-sm">
              {/* Room & Date */}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">會議地點</label>
                  <select
                    required
                    value={roomId}
                    onChange={(e) => setRoomId((e.target as HTMLSelectElement).value)}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-semibold text-sm outline-none"
                  >
                    {rooms.value.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {rm.name} ({rm.capacity} 人)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">預約日期</label>
                  <input
                    type="date"
                    required
                    value={date}
                    min={today}
                    onChange={(e) => setDate((e.target as HTMLInputElement).value)}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-bold text-sm outline-none"
                  />
                </div>
              </div>

              {/* Quick Time Slots Grid */}
              <div>
                <label class="block font-bold text-xs text-[#444141] mb-2">快捷時段</label>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {quickSlots.map((slot) => {
                    const isSelected = startTime === slot.start && endTime === slot.end;
                    // On today's date the earlier slots have already gone by; showing them
                    // as pickable only to reject the form on submit is worse than greying
                    // them out here.
                    const past = slotIsPast(slot.start);
                    return (
                      <button
                        type="button"
                        key={slot.label}
                        disabled={past}
                        title={past ? '此時段已過去' : undefined}
                        onClick={() => handleShortcut(slot.start, slot.end)}
                        class={`p-2.5 font-semibold text-xs border transition-colors text-center ${
                          past
                            ? 'bg-[#eae9e9] text-[#bab6b6] border-[#d7d3d3] cursor-not-allowed line-through'
                            : isSelected
                            ? 'bg-[#201e1d] text-white border-[#201e1d] font-bold cursor-pointer'
                            : 'bg-white text-[#201e1d] border-[#201e1d] hover:bg-[#eae9e9] cursor-pointer'
                        }`}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Start & End Time */}
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">開始時間</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime((e.target as HTMLInputElement).value)}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-semibold text-base outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">結束時間</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime((e.target as HTMLInputElement).value)}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-semibold text-base outline-none"
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label class="block font-bold text-xs text-[#444141] mb-1.5">會議事由</label>
                <input
                  type="text"
                  required
                  placeholder="例如：局務會議、防疫跨科室協調會"
                  value={reason}
                  onInput={(e) => setReason((e.target as HTMLInputElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 font-normal text-sm outline-none placeholder-[#9b9797]"
                />
              </div>

              {/* Meeting Type & Headcount */}
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">會議類型</label>
                  <select
                    value={meetingType}
                    onChange={(e) => setMeetingType((e.target as HTMLSelectElement).value as any)}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-medium text-sm outline-none"
                  >
                    <option value="internal">局內內部會議 ▾</option>
                    <option value="external">跨機關/外部專家會議 ▾</option>
                    <option value="department">科室內部討論 ▾</option>
                    <option value="other">其他業務 ▾</option>
                  </select>
                </div>

                <div>
                  <label class="block font-bold text-xs text-[#444141] mb-1.5">預估出席人數</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={headcount}
                    onChange={(e) => setHeadcount(parseInt((e.target as HTMLInputElement).value, 10))}
                    class="w-full border border-[#201e1d] bg-white p-2.5 font-medium text-sm outline-none"
                  />
                </div>
              </div>

              {/* Equipment Requirements */}
              <div>
                <label class="block font-bold text-xs text-[#444141] mb-2">設備需求</label>
                <div class="flex flex-wrap gap-2">
                  {equipment.value.map((eq) => {
                    const isChecked = selectedEqIds.includes(eq.id);
                    return (
                      <button
                        type="button"
                        key={eq.id}
                        onClick={() => handleEquipmentToggle(eq.id)}
                        class={`px-3 py-2 font-semibold text-xs border cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-[#201e1d] text-white border-[#201e1d]'
                            : 'bg-white text-[#201e1d] border-[#201e1d] hover:bg-[#eae9e9]'
                        }`}
                      >
                        {eq.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes & Attendees */}
              <div>
                <label class="block font-bold text-xs text-[#444141] mb-1.5">與會同仁 Email</label>
                <input
                  type="text"
                  placeholder="EXPERT@hospital.org.tw; citizen@gmail.com"
                  value={attendeesEmail}
                  onInput={(e) => setAttendeesEmail((e.target as HTMLInputElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 font-normal text-xs outline-none"
                />
              </div>

              <div>
                <label class="block font-bold text-xs text-[#444141] mb-1.5">備註說明</label>
                <textarea
                  rows={2}
                  placeholder="選填，任何準備工作或提醒"
                  value={notes}
                  onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 font-normal text-xs outline-none"
                ></textarea>
              </div>

              {/* Send Email Checkbox */}
              <div>
                <label class="flex items-center gap-2 font-semibold text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail((e.target as HTMLInputElement).checked)}
                    class="w-4 h-4 accent-[#9e3526]"
                  />
                  發送 Email 通知信予與會人員
                </label>
              </div>

              <div class="h-px bg-[#d7d3d3] my-1"></div>

              {/* Actions */}
              {/* Stacked and full-bleed on a phone — 手機版 runs both actions the full
                  width of the screen, primary first. */}
              <div class="flex flex-col md:flex-row gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  class="bg-[#9e3526] hover:bg-[#71261b] disabled:bg-[#bab6b6] text-white px-5 md:px-6 py-3.5 font-bold text-base border-none cursor-pointer text-left md:text-center"
                >
                  {loading ? '處置中...' : editTarget ? '儲存異動' : '確認預約'}
                </button>
                <button
                  type="button"
                  onClick={() => (isReservationModalOpen.value = false)}
                  class="border border-[#201e1d] bg-white text-[#201e1d] px-5 md:px-6 py-3.5 font-semibold text-base hover:bg-[#eae9e9] cursor-pointer text-left md:text-center"
                >
                  取消
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Room Occupancy Schedule View */}
          <div>
            <div class="mono-label">
              {selectedRoomObj?.name || '會議室'} · {date} 佔用情形
            </div>
            <div class="h-0.5 bg-[#201e1d] mt-3 mb-4"></div>

            <div class="flex flex-col">
              {hourBlocks.map((timeSlot) => {
                const info = getSlotStatus(timeSlot);
                return (
                  <div
                    key={timeSlot}
                    class={`flex border-b border-[#201e1d]/20 ${
                      info.status === 'conflict'
                        ? 'bg-[#fff2ef] border-l-4 border-l-[#9e3526]'
                        : info.status === 'planning'
                        ? 'bg-[#eae9e9]'
                        : info.status === 'occupied'
                        ? 'bg-[#fff2ef]'
                        : 'bg-transparent'
                    }`}
                  >
                    <div
                      class={`w-16 py-2.5 font-semibold text-xs flex-none ${
                        info.status === 'conflict' ? 'pl-2 text-[#71261b]' : 'text-[#7d7979]'
                      }`}
                    >
                      {timeSlot}
                    </div>
                    <div
                      class={`flex-1 py-2.5 text-xs truncate ${
                        info.status === 'conflict'
                          ? 'font-bold text-[#71261b]'
                          : 'font-medium text-[#201e1d]'
                      }`}
                    >
                      {info.text}
                    </div>
                  </div>
                );
              })}
            </div>

            <div class="border border-[#9e3526] bg-[#fff2ef] p-3.5 mt-6 text-xs">
              <div class="font-bold text-[#71261b]">衝突檢查在伺服器端執行</div>
              <div class="font-normal text-[#71261b] mt-1 leading-relaxed">
                送出時若與既有預約重疊，會回傳 409 並跳出提示視窗，同時在此處標示衝突時段。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/*
      Sibling of the form overlay, not a child of it. Preact portals re-dispatch events
      through the vdom tree, so a dialog nested inside that overlay would bubble its own
      clicks into the overlay's close-on-backdrop handler and shut the whole form.
    */}
    <Modal
      isOpen={isConflictDialogOpen}
      onClose={() => setIsConflictDialogOpen(false)}
      title="時段衝突，預約尚未送出"
      maxWidth="lg"
      layer="top"
    >
      <div class="flex flex-col gap-4">
        <p class="m-0 font-semibold text-sm text-[#201e1d] leading-relaxed">
          {conflictError}
        </p>

        {conflictInfo && (
          <div class="border-l-4 border-[#9e3526] bg-[#fff2ef] p-4">
            <div class="mono-label text-[#71261b]">既有預約</div>
            <div class="font-extrabold text-lg text-[#201e1d] mt-1">
              {conflictInfo.reason}
            </div>
            <div class="font-semibold text-sm text-[#444141] mt-1">
              {conflictInfo.date} {conflictInfo.startTime} – {conflictInfo.endTime}
              {conflictInfo.roomName ? ` · ${conflictInfo.roomName}` : ''}
            </div>
            <div class="font-normal text-sm text-[#605d5d] mt-0.5">
              登記人：{conflictInfo.userName}
            </div>
          </div>
        )}

        <p class="m-0 font-normal text-sm text-[#605d5d] leading-relaxed">
          您填寫的內容都還保留著。請改選其他時段或會議室後重新送出，右欄的佔用時間表會標示可用的空檔。
        </p>

        <div class="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => setIsConflictDialogOpen(false)}
            class="bg-[#9e3526] hover:bg-[#71261b] text-white px-6 py-3 font-bold text-sm border-none cursor-pointer"
          >
            返回修改時段
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}
