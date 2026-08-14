import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import { PublicScheduleItem } from '../types';

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
    <div class="max-w-[1400px] mx-auto px-4 py-5 md:p-8 min-h-[calc(100vh-5rem)]">
      {/* Banner */}
      <div class="mb-5 md:mb-6 bg-[#9e3526] text-white p-5 md:p-6 md:mcard border border-[#201e1d]">
        <div class="mono-label text-white/90 text-xs">PUBLIC SCHEDULE</div>
        <h2 class="font-extrabold text-xl md:text-3xl mt-1 leading-tight">
          新竹市衛生局 會議室公開排程看板
        </h2>
        <p class="font-normal text-[13px] md:text-sm text-white/90 mt-1 mb-0">
          本頁面提供去識別化之公開排程查詢（民眾與外部單位檢視專用）
        </p>
      </div>

      {/* Mobile card list */}
      <div class="md:hidden flex flex-col gap-3">
        {schedule.length === 0 ? (
          <div class="font-normal text-sm text-[#7d7979] py-8 text-center">
            目前無公開預約紀錄
          </div>
        ) : (
          schedule.map((item) => (
            <div key={item.id} class="border border-[#201e1d]/30 bg-[#f3f2f2] p-3.5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="mtag mtag-accent-2 truncate">{item.roomName}</span>
                <span class="mtag mtag-ink flex-none">{item.title}</span>
              </div>
              <div class="font-bold text-base leading-snug text-[#201e1d]">
                {item.date} · {item.startTime} – {item.endTime}
              </div>
              <div class="font-medium text-[13px] leading-normal text-[#444141]">
                {item.deptName}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table — desktop */}
      <div class="hidden md:block mcard border border-[#201e1d] overflow-x-auto bg-[#f3f2f2]">
        <table class="mtable w-full text-sm">
          <thead>
            <tr class="bg-[#eae9e9]">
              <th class="p-3.5 px-4 font-bold text-[#201e1d]">會議地點</th>
              <th class="p-3.5 px-4 font-bold text-[#201e1d]">預約日期</th>
              <th class="p-3.5 px-4 font-bold text-[#201e1d]">使用時段</th>
              <th class="p-3.5 px-4 font-bold text-[#201e1d]">登記科室</th>
              <th class="p-3.5 px-4 font-bold text-[#201e1d]">使用狀態</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#201e1d]/20">
            {schedule.length === 0 ? (
              <tr>
                <td colSpan={5} class="text-center py-10 font-normal text-[#7d7979]">
                  目前無公開預約紀錄
                </td>
              </tr>
            ) : (
              schedule.map((item) => (
                <tr key={item.id} class="hover:bg-white transition-colors">
                  <td class="p-3.5 px-4">
                    <span class="mtag mtag-accent-2">{item.roomName}</span>
                  </td>
                  <td class="p-3.5 px-4 font-semibold text-[#201e1d]">{item.date}</td>
                  <td class="p-3.5 px-4 font-semibold text-[#201e1d]">
                    {item.startTime} – {item.endTime}
                  </td>
                  <td class="p-3.5 px-4 font-medium text-[#444141]">{item.deptName}</td>
                  <td class="p-3.5 px-4">
                    <span class="mtag mtag-ink">{item.title}</span>
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
