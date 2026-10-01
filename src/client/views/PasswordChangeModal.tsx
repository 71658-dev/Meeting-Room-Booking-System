import { useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { api } from '../api';
import { isPasswordModalOpen, currentUser, showToast } from '../state';

export function PasswordChangeModal() {
  const isOpen = isPasswordModalOpen.value;
  const user = currentUser.value;

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setErrorMsg('');

    if (newPassword.length < 12) {
      setErrorMsg('新密碼長度至少需 12 個字元');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('兩次輸入的新密碼不一致');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      showToast('密碼變更成功！請以新密碼登入', 'success');
      isPasswordModalOpen.value = false;
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (currentUser.value) {
        currentUser.value = { ...currentUser.value, must_change_password: false };
      }
    } catch (err: any) {
      setErrorMsg(err.message || '密碼變更失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="lg-overlay" role="dialog" aria-modal="true" aria-label="變更登入密碼">
      <div class="lg-dialog glass-sheet space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="m-0 font-bold text-[22px] leading-tight">安全變更登入密碼</h3>
          {!user.must_change_password && (
            <button
              type="button"
              onClick={() => (isPasswordModalOpen.value = false)}
              aria-label="關閉"
              class="btn btn-plain btn-icon w-9 h-9 text-label-2"
            >
              <X size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>

        {user.must_change_password && (
          <div class="px-4 py-3 rounded-2xl bg-danger/10 text-danger-ink text-[13px] font-semibold">
            系統要求：此帳號目前為臨時密碼或首次登入，請立即設定自訂新密碼。
          </div>
        )}

        {errorMsg && (
          <div class="px-4 py-3 rounded-2xl bg-danger/10 text-danger-ink text-[13px] font-semibold">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="field-label">目前舊密碼</label>
            <input
              type="password"
              required
              value={oldPassword}
              onInput={(e) => setOldPassword((e.target as HTMLInputElement).value)}
              placeholder="請輸入目前密碼"
              class="field"
            />
          </div>

          <div>
            <label class="field-label">新設定密碼 (至少 12 字元)</label>
            <input
              type="password"
              required
              minlength={12}
              value={newPassword}
              onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="長度至少 12 字元"
              class="field"
            />
          </div>

          <div>
            <label class="field-label">再次確認新密碼</label>
            <input
              type="password"
              required
              minlength={12}
              value={confirmPassword}
              onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="再次輸入新密碼"
              class="field"
            />
          </div>

          <div class="pt-3 flex flex-col-reverse md:flex-row md:justify-end gap-2">
            {!user.must_change_password && (
              <button
                type="button"
                onClick={() => (isPasswordModalOpen.value = false)}
                class="btn btn-plain btn-md"
              >
                取消
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              class="btn btn-primary btn-md"
            >
              {loading ? '更新密碼中...' : '確認修改密碼'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
