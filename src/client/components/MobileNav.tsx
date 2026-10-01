import { CircleUser, Plus } from 'lucide-preact';
import {
  currentUser,
  currentView,
  isAccountSheetOpen,
  isReservationModalOpen,
  isDatePanelOpen,
  editingReservation,
  showToast,
} from '../state';
import { ViewMode } from '../types';
import { navItemsFor, avatarInitial } from './navItems';

/**
 * 手機版 chrome (Glass Tab Bar): a floating glass tab bar with a separate ＋ button,
 * plus a top row carrying the account avatar (or 同仁登入 for a visitor).
 *
 * Replaces the desktop header below `md`. Profile, password and logout live in the
 * account sheet the avatar opens — five tabs and the ＋ already fill the bar.
 */
export function MobileNav() {
  const user = currentUser.value;
  const view = currentView.value;

  // The login screen is a bare full-bleed panel in 手機版 — no bar.
  if (!user && view !== 'public') return null;

  const go = (key: ViewMode) => {
    currentView.value = key;
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

  const tabs: Array<{ key: ViewMode | 'login'; short: string; Icon: typeof Plus }> = user
    ? navItemsFor(user)
    : [
        ...navItemsFor(null).filter((i) => i.key === 'public'),
        { key: 'login', short: '登入', Icon: CircleUser },
      ];

  return (
    <div class="md:hidden">
      {/* Top row */}
      <div class="flex justify-end items-center h-11 px-4 mt-3">
        {user ? (
          <button
            type="button"
            onClick={() => (isAccountSheetOpen.value = true)}
            aria-label={`${user.name} 帳號設定`}
            aria-haspopup="dialog"
            class="glass w-11 h-11 rounded-full border-none cursor-pointer flex items-center justify-center font-semibold text-[15px] text-black"
          >
            {avatarInitial(user.name)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (currentView.value = 'month')}
            class="glass btn h-11 px-[18px] text-[15px] text-accent"
          >
            同仁登入
          </button>
        )}
      </div>

      {/* Tab bar */}
      <nav
        aria-label="主選單"
        class="fixed left-0 right-0 bottom-[max(16px,env(safe-area-inset-bottom))] z-40 flex items-center gap-2 px-4 pointer-events-none"
      >
        <div class="glass pointer-events-auto flex-1 flex items-center h-[62px] px-1 rounded-full min-w-0">
          {tabs.map(({ key, short, Icon }) => {
            const active = key === view;
            return (
              <button
                key={key}
                type="button"
                onClick={() => (key === 'login' ? (currentView.value = 'month') : go(key))}
                aria-current={active ? 'page' : undefined}
                class={`flex-1 min-w-0 h-[54px] flex flex-col items-center justify-center gap-[3px] rounded-full border-none cursor-pointer text-[10px] ${
                  active ? 'bg-fill text-accent font-semibold' : 'bg-transparent text-black/70 font-medium'
                }`}
              >
                <Icon size={21} strokeWidth={2} aria-hidden="true" />
                <span class="truncate max-w-full">{short}</span>
              </button>
            );
          })}
        </div>

        {user && (
          <button
            type="button"
            onClick={handleNewReservation}
            aria-label="新增預約"
            class="btn btn-primary pointer-events-auto w-[54px] h-[54px] p-0 flex-none"
          >
            <Plus size={24} strokeWidth={2.4} aria-hidden="true" />
          </button>
        )}
      </nav>
    </div>
  );
}
