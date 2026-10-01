import { Plus } from 'lucide-preact';
import {
  currentUser,
  currentView,
  isReservationModalOpen,
  editingReservation,
  isAccountSheetOpen,
  showToast,
} from '../state';
import { navItemsFor, roleLabel, avatarInitial } from './navItems';

/**
 * Desktop chrome (Glass Header): three floating glass pills — brand, nav, account.
 * Below `md` this is replaced by MobileNav's tab bar.
 */
export function Header() {
  const user = currentUser.value;
  const activeView = currentView.value;

  const handleOpenNewReservation = () => {
    if (!user) {
      showToast('請先登入系統後再發起預約', 'error');
      return;
    }
    editingReservation.value = null;
    isReservationModalOpen.value = true;
  };

  return (
    <header class="hidden md:block sticky top-0 z-40">
      <div class="max-w-[1400px] mx-auto flex items-center justify-between gap-4 px-6 py-4">
        {/* Brand */}
        <button
          type="button"
          onClick={() => (currentView.value = user ? 'month' : 'public')}
          class="glass flex items-center gap-3 h-14 pl-2 pr-5 rounded-full border-none cursor-pointer flex-none text-left"
        >
          <span class="w-10 h-10 rounded-xl bg-accent text-white font-bold text-[19px] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.35)]">
            衛
          </span>
          <span class="flex flex-col">
            <span class="font-semibold text-[15px] leading-5 text-black">
              新竹市衛生局 會議室預約
            </span>
            <span class="text-xs leading-4 text-label-2">v2.0 公務版</span>
          </span>
        </button>

        {/* Navigation */}
        <nav aria-label="主選單" class="glass flex items-center gap-0.5 h-14 px-1.5 rounded-full min-w-0 overflow-x-auto">
          {navItemsFor(user).map(({ key, label, Icon }) => {
            const active = activeView === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => (currentView.value = key)}
                aria-current={active ? 'page' : undefined}
                class={`flex items-center gap-[7px] h-11 px-4 rounded-full border-none cursor-pointer text-[15px] whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-white/90 text-accent font-semibold shadow-[0_3px_8px_rgba(0,0,0,.12),0_1px_1px_rgba(0,0,0,.10)]'
                    : 'bg-transparent text-black/80 font-medium hover:bg-white/50'
                }`}
              >
                <Icon size={17} strokeWidth={2} aria-hidden="true" />
                <span class="hidden lg:inline">{label}</span>
                <span class="lg:hidden sr-only">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Account */}
        <div class="flex items-center gap-2.5 flex-none">
          {user ? (
            <>
              <button type="button" onClick={handleOpenNewReservation} class="btn btn-primary h-11 px-[18px] text-[15px]">
                <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
                <span class="hidden xl:inline">新增預約</span>
                <span class="xl:hidden sr-only">新增預約</span>
              </button>

              <button
                type="button"
                onClick={() => (isAccountSheetOpen.value = true)}
                aria-haspopup="dialog"
                title="帳號設定"
                class="glass flex items-center gap-2.5 h-14 pl-4 pr-2 rounded-full border-none cursor-pointer"
              >
                <span class="hidden lg:flex flex-col items-end">
                  <span class="font-semibold text-sm leading-[18px] text-black">{user.name}</span>
                  <span class="text-xs leading-4 text-label-2">
                    {user.dept_name || user.dept_id} · {roleLabel(user.role)}
                  </span>
                </span>
                <span class="avatar w-10 h-10 text-[15px]" aria-hidden="true">
                  {avatarInitial(user.name)}
                </span>
                <span class="sr-only lg:hidden">{user.name} 帳號設定</span>
              </button>
            </>
          ) : (
            <button type="button" onClick={() => (currentView.value = 'month')} class="btn btn-primary h-11 px-5 text-[15px]">
              同仁登入
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
