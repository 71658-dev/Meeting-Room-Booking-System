import {
  currentUser,
  currentView,
  isReservationModalOpen,
  editingReservation,
  isPasswordModalOpen,
  isProfileModalOpen,
  showToast,
} from '../state';
import { api } from '../api';

/**
 * Desktop chrome. Below `md` this is replaced wholesale by MobileNav's ink bar and
 * drawer — see 手機版.dc.html.
 */
export function Header() {
  const user = currentUser.value;
  const activeView = currentView.value;

  const handleLogout = async () => {
    try {
      await api.logout();
      showToast('已安全登出', 'success');
    } catch (e) {
      // Drop the local session either way — see MobileNav.handleLogout.
    }
    currentUser.value = null;
    currentView.value = 'public';
  };

  const handleOpenNewReservation = () => {
    if (!user) {
      showToast('請先登入系統後再發起預約', 'error');
      return;
    }
    editingReservation.value = null;
    isReservationModalOpen.value = true;
  };

  const navItems = [
    { key: 'month', label: '月曆總覽' },
    { key: 'timeline', label: '時段對照' },
    { key: 'list', label: '預約清單' },
    { key: 'stats', label: '使用統計' },
  ];

  if (user && (user.role === 'admin' || user.role === 'superadmin')) {
    navItems.push({ key: 'admin', label: '後台管理' });
  }

  if (!user) {
    navItems.push({ key: 'public', label: '公開排程' });
  }

  return (
    <header class="hidden md:block sticky top-0 z-40 bg-[#f3f2f2] border-b-2 border-[#201e1d]">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-[72px]">
          {/* Logo & Title */}
          <div
            class="flex items-center gap-4 cursor-pointer"
            onClick={() => (currentView.value = user ? 'month' : 'public')}
          >
            <div class="w-10 h-10 bg-[#9e3526] text-white font-extrabold text-xl flex items-center justify-center flex-none">
              衛
            </div>
            <div>
              <div class="font-extrabold text-base sm:text-lg leading-tight text-[#201e1d]">
                新竹市衛生局 會議室預約系統
              </div>
              <div class="font-medium text-xs text-[#605d5d]">v2.0 公務版</div>
            </div>
          </div>

          {/* Navigation Views */}
          <nav class="flex items-center gap-0">
            {navItems.map((item) => {
              const isActive = activeView === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => (currentView.value = item.key as any)}
                  class={`px-4 py-3 text-sm transition-colors cursor-pointer border-none ${
                    isActive
                      ? 'bg-[#201e1d] text-white font-bold'
                      : 'bg-transparent text-[#444141] font-medium hover:bg-[#eae9e9]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* User Controls & Reservation Action */}
          <div class="flex items-center gap-3 flex-none">
            {user ? (
              <>
                <button
                  onClick={handleOpenNewReservation}
                  class="bg-[#9e3526] hover:bg-[#71261b] text-white px-4 py-2.5 font-bold text-sm cursor-pointer border-none transition-colors"
                >
                  ＋ 新增預約
                </button>

                <div class="flex items-center gap-2.5 border border-[#201e1d] px-3 py-1.5 bg-white">
                  <div
                    class="text-left cursor-pointer"
                    onClick={() => (isProfileModalOpen.value = true)}
                  >
                    <div class="font-bold text-sm text-[#201e1d] flex items-center gap-1.5">
                      {user.name}
                      <span class="font-semibold text-[11px] bg-[#201e1d] text-white px-1.5 py-0.5">
                        {user.role === 'superadmin' ? '超管' : user.role === 'admin' ? '管理員' : '同仁'}
                      </span>
                    </div>
                    <div class="font-normal text-xs text-[#605d5d]">
                      {user.dept_name || user.dept_id}
                    </div>
                  </div>

                  <span
                    onClick={() => (isProfileModalOpen.value = true)}
                    class="font-semibold text-xs border-l border-[#d7d3d3] pl-2.5 text-[#9e3526] cursor-pointer hover:underline"
                    title="編輯個人資料"
                  >
                    編輯資料
                  </span>

                  <span
                    onClick={() => (isPasswordModalOpen.value = true)}
                    class="font-semibold text-xs border-l border-[#d7d3d3] pl-2 text-[#444141] cursor-pointer hover:underline"
                    title="變更密碼"
                  >
                    改密碼
                  </span>

                  <span
                    onClick={handleLogout}
                    class="font-semibold text-xs border-l border-[#d7d3d3] pl-2 text-[#605d5d] cursor-pointer hover:text-[#9e3526]"
                    title="登出"
                  >
                    登出
                  </span>
                </div>
              </>
            ) : (
              <button
                onClick={() => (currentView.value = 'month')}
                class="bg-[#9e3526] hover:bg-[#71261b] text-white px-4 py-2.5 font-bold text-sm cursor-pointer border-none transition-colors"
              >
                同仁登入
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
