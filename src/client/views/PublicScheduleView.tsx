import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import { ShieldCheck } from 'lucide-preact';
import { PublicScheduleItem } from '../types';
import { roomColor, roomStyle } from '../lib/roomColor';

export function PublicScheduleView() {
  const [schedule, setSchedule] = useState<PublicScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getPublicSchedule()
      .then((res) => {
        if (res.success) setSchedule(res.schedule);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 min-h-[calc(100vh-88px)]">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-2 md:gap-4 mb-4 md:mb-5">
        <div>
          <div class="hidden md:block lg-eyebrow">本頁面提供去識別化之公開排程查詢（民眾與外部單位檢視專用）</div>
          <h1 class="m-0 lg-title-1">
            <span class="hidden md:inline">會議室公開排程看板</span>
            <span class="md:hidden">公開排程</span>
          </h1>
          <p class="md:hidden mt-1 mb-0 mx-0.5 text-[13px] leading-[18px] text-label-2">
            去識別化之公開排程查詢，民眾與外部單位檢視專用。
          </p>
        </div>
        <span class="hidden md:inline-flex glass items-center gap-1.5 h-8 px-3.5 rounded-full text-[13px] text-label-2 flex-none">
          <ShieldCheck size={14} aria-hidden="true" />
          無需登入 · 已去識別化
        </span>
      </div>

      {loading && <p class="text-[15px] text-label-2 py-2 m-0">資料載入中…</p>}

      {/* Phone list */}
      <div class="md:hidden surface rounded-[24px] overflow-hidden">
        {schedule.length === 0 ? (
          <div class="px-4 py-8 text-center text-[15px] text-label-2">目前無公開預約紀錄</div>
        ) : (
          schedule.map((item, idx) => (
            <div key={item.id} class={`flex gap-3 px-4 py-3 ${idx > 0 ? 'shadow-[inset_0_.5px_0_rgba(0,0,0,.08)]' : ''}`}>
              <span class="w-1 rounded-sm flex-none" style={{ background: roomColor(item.roomColor).color }}></span>
              <div class="flex-1 min-w-0">
                <div class="text-[17px] font-semibold tabular-nums">
                  {item.date.slice(5).replace('-', '/')} · {item.startTime}–{item.endTime}
                </div>
                <div class="text-[13px] text-label-2 truncate">
                  {item.roomName} · {item.deptName}
                </div>
              </div>
              <span class="self-center text-xs text-label-2 flex-none">{item.title}</span>
            </div>
          ))
        )}
      </div>

      {/* Table — desktop */}
      <div class="hidden md:block surface rounded-[28px] overflow-x-auto">
        <table class="lg-table">
          <thead>
            <tr>
              <th>會議地點</th>
              <th>預約日期</th>
              <th>使用時段</th>
              <th>登記科室</th>
              <th>使用狀態</th>
            </tr>
          </thead>
          <tbody>
            {schedule.length === 0 ? (
              <tr>
                <td colSpan={5} class="text-center py-10 text-label-2">
                  目前無公開預約紀錄
                </td>
              </tr>
            ) : (
              schedule.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span class="room-pill" style={roomStyle(item.roomColor)}>
                      {item.roomName}
                    </span>
                  </td>
                  <td class="tabular-nums">{item.date}</td>
                  <td class="tabular-nums">
                    {item.startTime} – {item.endTime}
                  </td>
                  <td>{item.deptName}</td>
                  <td class="text-sm text-label-2">{item.title}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
