import { useState, useEffect } from 'preact/hooks';
import { Check, Minus, Plus, TriangleAlert, X } from 'lucide-preact';
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
import { roomColor } from '../lib/roomColor';
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
      return { status: 'conflict', text: `與「${occ.reason}」時段重疊` };
    }
    if (occ) {
      return { status: 'occupied', text: `${occ.reason} (${occ.dept_name} ${occ.user_name})` };
    }
    if (inPlanned) {
      return { status: 'planning', text: '本次預約（規劃中）' };
    }
    return { status: 'free', text: '空閒' };
  };

  const close = () => (isReservationModalOpen.value = false);
  const timeInvalid = !!conflictError;
  const roomTint = roomColor(selectedRoomObj?.color_key).color;

  const OCC_STYLES: Record<string, { row: string; time: string; text: string; dot: string }> = {
    free: { row: '', time: 'text-label-2', text: 'text-label-2 font-normal', dot: 'bg-[rgba(60,60,67,.18)]' },
    planning: { row: 'bg-accent/[.08]', time: 'text-accent-ink', text: 'text-accent-ink font-semibold', dot: 'bg-accent' },
    occupied: { row: '', time: 'text-label-2', text: 'text-black font-medium', dot: '' },
    conflict: { row: 'bg-danger/10', time: 'text-danger-ink', text: 'text-danger-ink font-semibold', dot: 'bg-danger' },
  };

  const [, dm, dd] = date.split('-');
  const shortDateLabel = dm && dd ? `${dm}/${dd}` : date;

  return (
    <>
    <div
      onClick={close}
      class="fixed inset-0 lg-scrim z-50 flex items-end md:items-start justify-center p-0 md:p-8 overflow-y-auto"
    >
      {/* Bottom sheet below md (M7), floating glass panel above it (D7). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reservation-title"
        onClick={(e) => e.stopPropagation()}
        class="glass-sheet w-full mt-[62px] md:mt-0 md:max-w-[1040px] rounded-t-[38px] md:rounded-[36px] md:my-auto grid grid-cols-1 lg:grid-cols-[1fr_340px]"
      >
        {/* Left: the form */}
        <div class="px-4 md:px-8 pt-2 md:pt-7 pb-7 flex flex-col gap-[18px]">
          <div class="md:hidden w-9 h-[5px] rounded-full bg-label-3 mx-auto" aria-hidden="true"></div>

          <div class="flex items-center justify-between gap-3">
            <button type="button" onClick={close} class="hidden md:inline-flex btn btn-plain h-9 px-4 text-[15px]">
              取消
            </button>
            <button type="button" onClick={close} aria-label="取消" class="md:hidden btn btn-icon-lg bg-white/75 text-black/70 shadow-[0_2px_8px_rgba(0,0,0,.08)]">
              <X size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>

            <h2 id="reservation-title" class="m-0 text-[17px] font-semibold">
              {editTarget ? '編輯會議室預約' : '發起會議室預約'}
            </h2>

            <button type="submit" form="reservation-form" disabled={loading} class="hidden md:inline-flex btn btn-primary h-9 px-[18px] text-[15px] shadow-none">
              {loading ? '處置中…' : editTarget ? '儲存異動' : '確認預約'}
            </button>
            <button
              type="submit"
              form="reservation-form"
              disabled={loading}
              aria-label={editTarget ? '儲存異動' : '確認預約'}
              class="md:hidden btn btn-primary btn-icon-lg shadow-none"
            >
              <Check size={22} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>

          {conflictError && (
            <div role="alert" class="flex gap-3 items-start px-4 py-3.5 rounded-[18px] bg-danger/10">
              <TriangleAlert size={20} class="flex-none mt-px text-danger" aria-hidden="true" />
              <div>
                <div class="text-[15px] font-semibold text-danger-ink">時段衝突，預約尚未送出</div>
                <div class="text-[13px] leading-[18px] text-black/75 mt-0.5">
                  {conflictError} 您填寫的內容都還保留著，請改選其他時段或會議室。
                </div>
              </div>
            </div>
          )}

          <form id="reservation-form" onSubmit={handleSubmit} class="flex flex-col gap-[18px]">
            {/* Room & Date */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label for="rsv-room" class="field-label">會議地點</label>
                <select
                  id="rsv-room"
                  required
                  value={roomId}
                  onChange={(e) => setRoomId((e.target as HTMLSelectElement).value)}
                  class="field"
                >
                  {rooms.value.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.name}（{rm.capacity} 人）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label for="rsv-date" class="field-label">預約日期</label>
                <input
                  id="rsv-date"
                  type="date"
                  required
                  value={date}
                  min={today}
                  onChange={(e) => setDate((e.target as HTMLInputElement).value)}
                  class="field tabular-nums"
                />
              </div>
            </div>

            {/* Quick time slots */}
            <div>
              <div class="field-label">快捷時段</div>
              <div class="flex gap-2 overflow-x-auto md:flex-wrap -mx-4 px-4 md:mx-0 md:px-0">
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
                      aria-pressed={isSelected}
                      onClick={() => handleShortcut(slot.start, slot.end)}
                      class={`chip flex-none ${past ? '' : 'chip-solid max-md:bg-white max-md:aria-pressed:bg-accent'}`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Start, end, headcount */}
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label for="rsv-start" class="field-label">開始時間</label>
                <input
                  id="rsv-start"
                  type="time"
                  required
                  value={startTime}
                  aria-invalid={timeInvalid}
                  onChange={(e) => setStartTime((e.target as HTMLInputElement).value)}
                  class={`field tabular-nums ${timeInvalid ? 'field-invalid' : ''}`}
                />
              </div>
              <div>
                <label for="rsv-end" class="field-label">結束時間</label>
                <input
                  id="rsv-end"
                  type="time"
                  required
                  value={endTime}
                  aria-invalid={timeInvalid}
                  onChange={(e) => setEndTime((e.target as HTMLInputElement).value)}
                  class={`field tabular-nums ${timeInvalid ? 'field-invalid' : ''}`}
                />
              </div>
              <div class="col-span-2 sm:col-span-1">
                <label for="rsv-headcount" class="field-label">預估出席人數</label>
                <div class="field flex items-center justify-between gap-2 pr-1.5">
                  <input
                    id="rsv-headcount"
                    type="number"
                    min={1}
                    required
                    value={headcount}
                    onChange={(e) => setHeadcount(parseInt((e.target as HTMLInputElement).value, 10))}
                    class="w-full min-w-0 bg-transparent border-none outline-none text-[17px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span class="flex flex-none w-[92px] h-8 rounded-full bg-fill overflow-hidden">
                    <button
                      type="button"
                      aria-label="減少人數"
                      onClick={() => setHeadcount((h) => Math.max(1, (Number.isFinite(h) ? h : 1) - 1))}
                      class="flex-1 flex items-center justify-center bg-transparent border-none cursor-pointer text-black"
                    >
                      <Minus size={16} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="增加人數"
                      onClick={() => setHeadcount((h) => (Number.isFinite(h) ? h : 0) + 1)}
                      class="flex-1 flex items-center justify-center bg-transparent border-none cursor-pointer text-black shadow-[inset_.5px_0_0_rgba(0,0,0,.12)]"
                    >
                      <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </div>
            </div>

            {/* Reason & type */}
            <div class="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr] gap-3">
              <div>
                <label for="rsv-reason" class="field-label">會議事由</label>
                <input
                  id="rsv-reason"
                  type="text"
                  required
                  placeholder="例如：局務會議、防疫跨科室協調會"
                  value={reason}
                  onInput={(e) => setReason((e.target as HTMLInputElement).value)}
                  class="field"
                />
              </div>
              <div>
                <label for="rsv-type" class="field-label">會議類型</label>
                <select
                  id="rsv-type"
                  value={meetingType}
                  onChange={(e) => setMeetingType((e.target as HTMLSelectElement).value as any)}
                  class="field"
                >
                  <option value="internal">局內內部會議</option>
                  <option value="external">跨機關/外部專家會議</option>
                  <option value="department">科室內部討論</option>
                  <option value="other">其他業務</option>
                </select>
              </div>
            </div>

            {/* Equipment */}
            <div>
              <div class="field-label">設備需求</div>
              <div class="flex flex-wrap gap-2">
                {equipment.value.map((eq) => {
                  const isChecked = selectedEqIds.includes(eq.id);
                  return (
                    <button
                      type="button"
                      key={eq.id}
                      aria-pressed={isChecked}
                      onClick={() => handleEquipmentToggle(eq.id)}
                      class="chip max-md:bg-white max-md:aria-pressed:bg-accent/[.14]"
                    >
                      {isChecked && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
                      {eq.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Attendees, notes, notify */}
            <div class="grouped max-md:bg-white">
              <label class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-h-12 px-4 py-2.5 sm:py-0">
                <span class="sm:w-[120px] flex-none text-[15px]">與會同仁 Email</span>
                <input
                  type="text"
                  placeholder="expert@hospital.org.tw; …"
                  value={attendeesEmail}
                  onInput={(e) => setAttendeesEmail((e.target as HTMLInputElement).value)}
                  class="flex-1 min-w-0 sm:h-12 bg-transparent border-none outline-none text-[15px] placeholder:text-label-3"
                />
              </label>
              <label class="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 min-h-12 px-4 py-2.5 sm:py-3">
                <span class="sm:w-[120px] flex-none text-[15px] sm:leading-6">備註說明</span>
                <textarea
                  rows={2}
                  placeholder="選填，任何準備工作或提醒"
                  value={notes}
                  onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
                  class="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] leading-6 resize-y placeholder:text-label-3 p-0"
                ></textarea>
              </label>
              <div class="flex items-center justify-between gap-3 min-h-12 px-4">
                <span id="rsv-send-email" class="text-[15px]">發送 Email 通知信予與會人員</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sendEmail}
                  aria-labelledby="rsv-send-email"
                  onClick={() => setSendEmail(!sendEmail)}
                  class="switch w-16"
                ></button>
              </div>
            </div>
          </form>
        </div>

        {/* Right: occupancy for the chosen room and date */}
        <div class="px-4 md:px-6 pt-1 lg:pt-7 pb-7 lg:border-l-[0.5px] lg:border-separator flex flex-col gap-3">
          <div>
            <div class="text-[13px] font-semibold text-label-2">佔用情形</div>
            <div class="flex items-center gap-2 text-xl leading-[25px] font-semibold">
              <span class="w-2.5 h-2.5 rounded-full flex-none" style={{ background: roomTint }}></span>
              {selectedRoomObj?.name || '會議室'} · {shortDateLabel}
            </div>
          </div>

          <div class="rounded-[18px] bg-white/75 overflow-hidden">
            {hourBlocks.map((timeSlot, idx) => {
              const info = getSlotStatus(timeSlot);
              const st = OCC_STYLES[info.status];
              return (
                <div
                  key={timeSlot}
                  class={`flex items-center gap-2.5 min-h-11 px-3.5 ${st.row} ${idx > 0 ? 'shadow-[inset_0_.5px_0_rgba(0,0,0,.08)]' : ''}`}
                >
                  <span class={`w-11 flex-none text-[13px] font-semibold tabular-nums ${st.time}`}>{timeSlot}</span>
                  <span
                    class={`w-2 h-2 rounded-full flex-none ${st.dot}`}
                    style={info.status === 'occupied' ? { background: roomTint } : undefined}
                  ></span>
                  <span class={`text-[13px] truncate ${st.text}`}>{info.text}</span>
                </div>
              );
            })}
          </div>

          <p class="m-0 px-1 text-xs leading-4 text-label-2">
            衝突檢查在伺服器端執行。送出時若與既有預約重疊，會回傳 409 並跳出提示，同時在此標示衝突時段。
          </p>
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
        <p class="m-0 text-[15px] font-semibold leading-relaxed">{conflictError}</p>

        {conflictInfo && (
          <div class="rounded-[18px] bg-danger/10 px-4 py-3.5">
            <div class="text-[13px] font-semibold text-danger-ink">既有預約</div>
            <div class="text-[17px] font-semibold mt-0.5">{conflictInfo.reason}</div>
            <div class="text-[15px] text-black/75 mt-0.5 tabular-nums">
              {conflictInfo.date} {conflictInfo.startTime} – {conflictInfo.endTime}
              {conflictInfo.roomName ? ` · ${conflictInfo.roomName}` : ''}
            </div>
            <div class="text-[13px] text-label-2 mt-0.5">登記人：{conflictInfo.userName}</div>
          </div>
        )}

        <p class="m-0 text-[15px] text-label-2 leading-relaxed">
          您填寫的內容都還保留著。請改選其他時段或會議室後重新送出，右欄的佔用時間表會標示可用的空檔。
        </p>

        <button type="button" onClick={() => setIsConflictDialogOpen(false)} class="btn btn-primary btn-lg w-full md:w-auto md:self-end">
          返回修改時段
        </button>
      </div>
    </Modal>
    </>
  );
}
