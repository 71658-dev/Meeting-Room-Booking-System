import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import { reservations, rooms, departments } from '../state';

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
  const roomStats: Record<string, { name: string; count: number; minutes: number }> = {};
  const deptStats: Record<string, number> = {};

  for (const r of reservations.value) {
    const duration = r.end_min - r.start_min;
    totalMinutes += duration;

    const rName = r.room_name || r.room_id;
    if (!roomStats[r.room_id]) {
      roomStats[r.room_id] = { name: rName, count: 0, minutes: 0 };
    }
    roomStats[r.room_id].count++;
    roomStats[r.room_id].minutes += duration;

    const dName = r.dept_name || '其他科室';
    deptStats[dName] = (deptStats[dName] || 0) + 1;
  }

  const totalHours = (totalMinutes / 60).toFixed(1);

  return (
    <div class="max-w-[1400px] mx-auto px-4 py-5 md:p-8 min-h-[calc(100vh-5rem)]">
      {/* Title — the desktop heading block; 手機版 gets its title from the ink bar. */}
      <div class="hidden md:block pb-4 border-b-2 border-[#201e1d] mb-6">
        <h2 class="m-0 font-extrabold text-3xl leading-tight text-[#201e1d]">會議室使用率統計分析</h2>
        <p class="mt-1.5 mb-0 font-normal text-sm text-[#605d5d]">提供機關內部會議室使用趨勢與數據統計報表</p>
      </div>

      {truncated && (
        <div class="border-2 border-[#9e3526] bg-[#fdf3f1] p-3 md:p-4 mb-5 md:mb-6">
          <div class="font-bold text-sm text-[#9e3526]">統計資料未涵蓋全部預約</div>
          <div class="font-normal text-[13px] leading-normal text-[#605d5d] mt-1">
            預約筆數已達單次查詢上限，以下數字僅計入取回的部分。請縮小日期範圍後再看。
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-6 mb-6 md:mb-8">
        <div class="md:mcard border border-[#201e1d] p-4 md:p-6 bg-[#f3f2f2]">
          <div class="font-bold text-xs text-[#605d5d] tracking-wider uppercase">總預約筆數</div>
          <div class="font-extrabold text-[32px] md:text-5xl leading-tight mt-1 md:mt-2 text-[#201e1d]">
            {totalBookings} <span class="font-semibold text-sm md:text-base text-[#605d5d]">筆</span>
          </div>
        </div>

        <div class="md:mcard border border-[#201e1d] p-4 md:p-6 bg-[#f3f2f2]">
          <div class="font-bold text-xs text-[#605d5d] tracking-wider uppercase">累計借用總時數</div>
          <div class="font-extrabold text-[32px] md:text-5xl leading-tight mt-1 md:mt-2 text-[#9e3526]">
            {totalHours} <span class="font-semibold text-sm md:text-base text-[#605d5d]">小時</span>
          </div>
        </div>

        <div class="md:mcard border border-[#201e1d] p-4 md:p-6 bg-[#f3f2f2]">
          <div class="font-bold text-xs text-[#605d5d] tracking-wider uppercase">啟用會議室數</div>
          <div class="font-extrabold text-[32px] md:text-5xl leading-tight mt-1 md:mt-2 text-[#201e1d]">
            {rooms.value.length} <span class="font-semibold text-sm md:text-base text-[#605d5d]">間</span>
          </div>
        </div>
      </div>

      {/* Breakdown Charts Grid. Below md the panels lose their frame and run as plain
          sections — a bordered card inside a 16px gutter wastes most of the width. */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8">
        {/* Room breakdown */}
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <h3 class="m-0 mb-3.5 md:mb-4 pb-2.5 md:pb-3 border-b-2 border-[#201e1d] font-extrabold text-[15px] md:text-lg text-[#201e1d]">
            各會議室使用頻率排行
          </h3>
          <div class="flex flex-col gap-3.5 md:gap-4">
            {Object.values(roomStats).length === 0 ? (
              <div class="font-normal text-sm text-[#7d7979] py-6 text-center">尚無預約數據</div>
            ) : (
              Object.values(roomStats).map((st) => {
                const percent = totalBookings > 0 ? Math.round((st.count / totalBookings) * 100) : 0;
                return (
                  <div key={st.name}>
                    <div class="flex justify-between font-bold text-sm text-[#201e1d] mb-1.5">
                      <span>{st.name}</span>
                      <span class="text-[#605d5d]">{st.count} 筆 ({(st.minutes / 60).toFixed(1)} 小時)</span>
                    </div>
                    <div class="h-2.5 md:h-3 border border-[#201e1d] bg-white">
                      <div
                        class="h-full bg-[#9e3526]"
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Department breakdown */}
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <h3 class="m-0 mb-3.5 md:mb-4 pb-2.5 md:pb-3 border-b-2 border-[#201e1d] font-extrabold text-[15px] md:text-lg text-[#201e1d]">
            科室借用排行分析
          </h3>
          <div class="flex flex-col gap-3.5 md:gap-4">
            {Object.entries(deptStats).length === 0 ? (
              <div class="font-normal text-sm text-[#7d7979] py-6 text-center">尚無預約數據</div>
            ) : (
              Object.entries(deptStats)
                .sort((a, b) => b[1] - a[1])
                .map(([deptName, count]) => {
                  const percent = totalBookings > 0 ? Math.round((count / totalBookings) * 100) : 0;
                  return (
                    <div key={deptName}>
                      <div class="flex justify-between font-bold text-sm text-[#201e1d] mb-1.5">
                        <span>{deptName}</span>
                        <span class="text-[#9e3526]">{count} 筆</span>
                      </div>
                      <div class="h-2.5 md:h-3 border border-[#201e1d] bg-white">
                        <div
                          class="h-full bg-[#201e1d]"
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
