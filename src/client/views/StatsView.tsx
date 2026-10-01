import { useState, useEffect } from 'preact/hooks';
import { TriangleAlert } from 'lucide-preact';
import { api } from '../api';
import { reservations, rooms, departments } from '../state';
import { roomColor } from '../lib/roomColor';

export function StatsView() {
  const [loading, setLoading] = useState(false);
  // Set when the server capped the result. These figures are sums over every row returned,
  // so a capped list would otherwise be presented as a complete total — wrong, and with no
  // sign that it is. The request itself is deliberately unfiltered: 統計 means everything.
  const [truncated, setTruncated] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resData, roomData, deptData] = await Promise.all([
        api.getReservations(),
        api.getRooms(),
        api.getDepartments(),
      ]);
      if (resData.success) reservations.value = resData.reservations;
      setTruncated(!!resData.truncated);
      if (roomData.success) rooms.value = roomData.rooms;
      if (deptData.success) departments.value = deptData.departments;
    } catch (e) {
      console.error('Failed to load stats data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const totalBookings = reservations.value.length;
  let totalMinutes = 0;
  // colorKey comes off the reservation row rather than the rooms list, which omits
  // deactivated rooms that still have bookings to count.
  const roomStats: Record<string, { name: string; colorKey?: string; count: number; minutes: number }> = {};
  const deptStats: Record<string, number> = {};

  for (const r of reservations.value) {
    const duration = r.end_min - r.start_min;
    totalMinutes += duration;

    const rName = r.room_name || r.room_id;
    if (!roomStats[r.room_id]) {
      roomStats[r.room_id] = { name: rName, colorKey: r.room_color, count: 0, minutes: 0 };
    }
    roomStats[r.room_id].count++;
    roomStats[r.room_id].minutes += duration;

    const dName = r.dept_name || '其他科室';
    deptStats[dName] = (deptStats[dName] || 0) + 1;
  }

  const totalHours = (totalMinutes / 60).toFixed(1);
  const deptRanking = Object.entries(deptStats).sort((a, b) => b[1] - a[1]);

  const kpis = [
    { label: '總預約筆數', value: String(totalBookings), unit: '筆', accent: false },
    { label: '累計借用總時數', value: totalHours, unit: '小時', accent: true },
    { label: '啟用會議室數', value: String(rooms.value.length), unit: '間', accent: false },
  ];

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 min-h-[calc(100vh-88px)]">
      <div class="mb-4 md:mb-5">
        <div class="hidden md:block lg-eyebrow">提供機關內部會議室使用趨勢與數據統計報表</div>
        <h1 class="m-0 lg-title-1">
          <span class="hidden md:inline">會議室使用率統計分析</span>
          <span class="md:hidden">使用統計</span>
        </h1>
      </div>

      {truncated && (
        <div role="alert" class="flex items-start gap-3 rounded-[18px] bg-danger/10 px-4 py-3.5 mb-4 md:mb-5">
          <TriangleAlert size={20} class="flex-none mt-px text-danger" aria-hidden="true" />
          <div>
            <div class="text-[15px] font-semibold text-danger-ink">統計資料未涵蓋全部預約</div>
            <div class="text-[13px] leading-[18px] text-black/75 mt-0.5">
              預約筆數已達單次查詢上限，以下數字僅計入取回的部分。請縮小日期範圍後再看。
            </div>
          </div>
        </div>
      )}

      {/* KPI cards. The third drops on a phone, where two fit a row — the room count is
          already plain from the ranking below. */}
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5 mb-3 md:mb-5">
        {kpis.map((k, i) => (
          <div key={k.label} class={`glass rounded-[24px] md:rounded-[28px] p-4 md:p-6 ${i === 2 ? 'hidden md:block' : ''}`}>
            <div class="text-[13px] md:text-[15px] font-semibold text-label-2">{k.label}</div>
            <div
              class={`text-[34px] leading-[41px] md:text-[56px] md:leading-[64px] font-bold tabular-nums ${
                k.accent ? 'text-accent' : 'text-black'
              }`}
            >
              {k.value}
              <span class="text-[15px] md:text-[17px] font-medium text-label-2 ml-1 md:ml-1.5">{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
        {/* Room breakdown */}
        <section class="surface rounded-[24px] md:rounded-[28px] p-4 md:p-6">
          <h2 class="m-0 mb-3 md:mb-[18px] text-[17px] md:text-xl leading-[25px] font-semibold">各會議室使用頻率排行</h2>
          <div class="flex flex-col gap-3 md:gap-[18px]">
            {Object.keys(roomStats).length === 0 ? (
              <div class="text-[15px] text-label-2 py-6 text-center">尚無預約數據</div>
            ) : (
              Object.entries(roomStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([roomId, st]) => {
                  const percent = totalBookings > 0 ? Math.round((st.count / totalBookings) * 100) : 0;
                  return (
                    <div key={roomId}>
                      <div class="flex justify-between gap-3 text-[15px] mb-1.5 md:mb-2">
                        <span class="font-semibold">{st.name}</span>
                        <span class="text-label-2 tabular-nums">
                          {st.count} 筆 · {(st.minutes / 60).toFixed(1)} 小時
                        </span>
                      </div>
                      <div class="h-2 md:h-2.5 rounded-full bg-fill overflow-hidden">
                        <div
                          class="h-full rounded-full"
                          style={{ width: `${percent}%`, background: roomColor(st.colorKey).color }}
                        ></div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </section>

        {/* Department breakdown */}
        <section class="surface rounded-[24px] md:rounded-[28px] p-4 md:p-6">
          <h2 class="m-0 mb-3 md:mb-[18px] text-[17px] md:text-xl leading-[25px] font-semibold">科室借用排行分析</h2>
          <div class="flex flex-col gap-2.5 md:gap-3.5">
            {deptRanking.length === 0 ? (
              <div class="text-[15px] text-label-2 py-6 text-center">尚無預約數據</div>
            ) : (
              deptRanking.map(([deptName, count]) => {
                const percent = totalBookings > 0 ? Math.round((count / totalBookings) * 100) : 0;
                return (
                  <div key={deptName} class="grid grid-cols-[96px_1fr_40px] md:grid-cols-[120px_1fr_48px] items-center gap-2.5 md:gap-3 text-[15px]">
                    <span class="truncate" title={deptName}>
                      {deptName}
                    </span>
                    <div class="h-2 md:h-2.5 rounded-full bg-fill overflow-hidden">
                      <div class="h-full rounded-full bg-accent" style={{ width: `${percent}%` }}></div>
                    </div>
                    <span class="text-right text-label-2 tabular-nums">{count} 筆</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
