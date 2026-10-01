import { ChevronRight, KeyRound, LogOut, UserPen } from 'lucide-preact';
import {
  currentUser,
  currentView,
  isAccountSheetOpen,
  isPasswordModalOpen,
  isProfileModalOpen,
  showToast,
} from '../state';
import { api } from '../api';
import { Modal } from './Modal';
import { roleLabel, avatarInitial } from './navItems';

/**
 * Account actions — 編輯資料 / 變更密碼 / 登出. Raised from the avatar in either chrome;
 * the mobile tab bar has no slot for them and the desktop header keeps its pill to name,
 * department and avatar.
 */
export function AccountSheet() {
  const user = currentUser.value;
  const isOpen = isAccountSheetOpen.value;
  if (!user) return null;

  const close = () => (isAccountSheetOpen.value = false);

  const open = (target: typeof isProfileModalOpen) => {
    close();
    target.value = true;
  };

  const handleLogout = async () => {
    close();
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

  const rowBase =
    'w-full flex items-center gap-3 min-h-[52px] px-4 bg-transparent border-none cursor-pointer text-[17px] text-left';
  const rowClass = `${rowBase} text-black`;

  return (
    <Modal isOpen={isOpen} onClose={close} title="帳號" maxWidth="sm">
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-3.5 px-1">
          <span class="avatar w-14 h-14 text-xl" aria-hidden="true">
            {avatarInitial(user.name)}
          </span>
          <div class="min-w-0">
            <div class="font-semibold text-[17px] leading-snug truncate">{user.name}</div>
            <div class="text-[13px] text-label-2 truncate">
              {user.dept_name || user.dept_id} · {roleLabel(user.role)} · 工號 {user.id}
            </div>
          </div>
        </div>

        <div class="grouped">
          <button type="button" onClick={() => open(isProfileModalOpen)} class={rowClass}>
            <UserPen size={20} class="text-accent flex-none" aria-hidden="true" />
            <span class="flex-1">編輯個人資料</span>
            <ChevronRight size={16} class="text-label-3" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => open(isPasswordModalOpen)} class={rowClass}>
            <KeyRound size={20} class="text-accent flex-none" aria-hidden="true" />
            <span class="flex-1">變更密碼</span>
            <ChevronRight size={16} class="text-label-3" aria-hidden="true" />
          </button>
        </div>

        <div class="grouped">
          <button type="button" onClick={handleLogout} class={`${rowBase} text-danger`}>
            <LogOut size={20} class="flex-none" aria-hidden="true" />
            <span class="flex-1">登出</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
