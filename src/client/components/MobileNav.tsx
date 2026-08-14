import { useEffect } from 'preact/hooks';
import {
  currentUser,
  currentView,
  isMobileNavOpen,
  isProfileModalOpen,
  isPasswordModalOpen,
  isReservationModalOpen,
  isDatePanelOpen,
  editingReservation,
  showToast,
} from '../state';
import { api } from '../api';
import { ViewMode } from '../types';

const SCREEN_TITLE: Record<ViewMode, string> = {
  month: '月曆總覽',
  timeline: '時段對照',
  list: '預約清單',
  stats: '使用統計',
  admin: '後台管理',
  public: '公開排程',
};

/**
 * 手機版 chrome: a 56px ink bar plus the left slide-in drawer.
 *
 * Replaces the desktop header below `md`. The two are mutually exclusive rather than one
 * responsive header — the mobile bar carries a single screen title where the desktop one
 * carries brand, inline nav and the account panel, and collapsing those into one tree
 * needed more branches than writing them separately.
 */
export function MobileNav() {
  const user = currentUser.value;
  const view = currentView.value;
  const open = isMobileNavOpen.value;

  // Esc closes the drawer, and the page behind must not scroll under it. Both are skipped
  // while a modal is up: the modal owns Esc and the scroll lock at that point.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') isMobileNavOpen.value = false;
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // The login screen is a bare full-bleed panel in 手機版 — no bar, no drawer.
  if (!user && view !== 'public') return null;

  const navItems: Array<{ key: ViewMode; label: string }> = user
    ? [
        { key: 'month', label: '月曆總覽' },
        { key: 'timeline', label: '時段對照' },
        { key: 'list', label: '預約清單' },
        { key: 'stats', label: '使用統計' },
      ]
    : [{ key: 'public', label: '公開排程' }];

  if (user && (user.role === 'admin' || user.role === 'superadmin')) {
    navItems.push({ key: 'admin', label: '後台管理' });
  }

  const go = (key: ViewMode) => {
    currentView.value = key;
    isMobileNavOpen.value = false;
    // The month view's day panel is a separate mobile screen; leaving it raised would
    // cover whatever tab was just picked.
    isDatePanelOpen.value = false;
  };

  const handleNewReservation = () => {
    if (!user) {
      showToast('請先登入系統後再發起預約', 'error');
      return;
    }
    editingReservation.value = null;
    isReservationModalOpen.value = true;
  };

  const handleLogout = async () => {
    isMobileNavOpen.value = false;
    try {
      await api.logout();
      showToast('已安全登出', 'success');
    } catch (e) {
      // Drop the local session either way — a failed logout call must not leave the UI
      // showing an account the server may already have revoked.
    }
    currentUser.value = null;
    currentView.value = 'public';
  };

  const roleLabel =
    user?.role === 'superadmin' ? '超管' : user?.role === 'admin' ? '管理員' : '同仁';

  return (
    <div class="md:hidden">
      {/* Top bar */}
      <div class="sticky top-0 z-40 flex items-center justify-between h-14 px-4 bg-[#201e1d] text-white">
        <div class="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={() => (isMobileNavOpen.value = true)}
            aria-label="開啟主選單"
            aria-expanded={open}
            class="w-6 flex-none bg-transparent border-none text-white font-bold text-[22px] leading-none cursor-pointer p-0 text-left"
          >
            ☰
          </button>
          <span class="font-extrabold text-base leading-tight truncate">
            {SCREEN_TITLE[view]}
          </span>
        </div>

        {user && (
          <button
            type="button"
            onClick={handleNewReservation}
            aria-label="新增預約"
            class="w-[34px] h-[34px] flex-none flex items-center justify-center bg-[#9e3526] text-white font-extrabold text-xl leading-none border-none cursor-pointer"
          >
            ＋
          </button>
        )}
      </div>

      {/* Scrim */}
      <div
        onClick={() => (isMobileNavOpen.value = false)}
        aria-hidden="true"
        class={`fixed inset-0 z-40 bg-[#201e1d]/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      ></div>

      {/* Drawer */}
      <nav
        aria-label="主選單"
        aria-hidden={!open}
        class={`fixed top-0 left-0 bottom-0 z-50 w-[250px] bg-[#201e1d] text-white flex flex-col transition-transform duration-[260ms] ease-[cubic-bezier(.4,0,.2,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div class="flex items-center justify-between h-14 px-[22px] flex-none">
          <span class="font-extrabold text-base">選單</span>
          <button
            type="button"
            onClick={() => (isMobileNavOpen.value = false)}
            aria-label="關閉主選單"
            class="bg-transparent border-none text-white/70 hover:text-white font-bold text-lg cursor-pointer p-0"
          >
            ✕
          </button>
        </div>

        {user ? (
          <div class="px-[22px] pb-5 border-b border-white/20 mb-2 flex-none">
            <div class="font-bold text-[15px] leading-tight flex items-center gap-1.5">
              <span class="truncate">{user.name}</span>
              <span class="font-semibold text-[11px] bg-[#9e3526] px-1.5 py-0.5 flex-none">
                {roleLabel}
              </span>
            </div>
            <div class="font-normal text-xs text-[#a8a5a5] mt-0.5 truncate">
              {user.dept_name || user.dept_id}
            </div>
          </div>
        ) : (
          <div class="px-[22px] pb-5 border-b border-white/20 mb-2 flex-none">
            <div class="font-bold text-[15px] leading-tight">訪客瀏覽</div>
            <div class="font-normal text-xs text-[#a8a5a5] mt-0.5">
              僅顯示去識別化公開排程
            </div>
          </div>
        )}

        <div class="flex-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item.key)}
                aria-current={active ? 'page' : undefined}
                class={`w-full text-left px-[22px] py-3.5 text-base border-none border-l-[3px] border-solid cursor-pointer text-white ${
                  active
                    ? 'font-bold bg-[#9e3526]/25 border-l-[#9e3526]'
                    : 'font-medium bg-transparent border-l-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {user ? (
          <div class="flex-none">
            <button
              type="button"
              onClick={() => {
                isMobileNavOpen.value = false;
                isProfileModalOpen.value = true;
              }}
              class="w-full text-left px-[22px] py-3.5 border-t border-white/20 border-x-0 border-b-0 border-solid bg-transparent font-semibold text-sm text-[#eae9e9] cursor-pointer"
            >
              編輯資料
            </button>
            <button
              type="button"
              onClick={() => {
                isMobileNavOpen.value = false;
                isPasswordModalOpen.value = true;
              }}
              class="w-full text-left px-[22px] py-3.5 border-none bg-transparent font-semibold text-sm text-[#eae9e9] cursor-pointer"
            >
              變更密碼
            </button>
            <button
              type="button"
              onClick={handleLogout}
              class="w-full text-left px-[22px] pt-3.5 pb-5 border-none bg-transparent font-semibold text-sm text-[#e8a49c] cursor-pointer"
            >
              登出
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              isMobileNavOpen.value = false;
              currentView.value = 'month';
            }}
            class="flex-none w-full text-left px-[22px] pt-3.5 pb-5 border-t border-white/20 border-x-0 border-b-0 border-solid bg-transparent font-semibold text-sm text-[#eae9e9] cursor-pointer"
          >
            同仁登入
          </button>
        )}
      </nav>
    </div>
  );
}
