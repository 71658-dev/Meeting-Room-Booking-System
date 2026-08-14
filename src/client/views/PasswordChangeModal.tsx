import { useState } from 'preact/hooks';
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
    <div className="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
      <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
        <div class="flex items-center justify-between">
          <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">安全變更登入密碼</h3>
          {!user.must_change_password && (
            <span
              onClick={() => (isPasswordModalOpen.value = false)}
              class="font-bold text-xl cursor-pointer text-[#605d5d]"
            >
              ✕
            </span>
          )}
        </div>

        {user.must_change_password && (
          <div class="p-3 bg-[#fff2ef] border border-[#9e3526] text-[#71261b] text-xs font-semibold">
            ⚠️ 系統要求：此帳號目前為臨時密碼或首次登入，請立即設定自訂新密碼。
          </div>
        )}

        {errorMsg && (
          <div class="p-3 bg-[#fff2ef] border border-[#9e3526] text-[#71261b] text-xs font-semibold">
            ⚠️ {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} class="space-y-4 text-xs">
          <div>
            <label class="block font-bold text-[#444141] mb-1">目前舊密碼</label>
            <input
              type="password"
              required
              value={oldPassword}
              onInput={(e) => setOldPassword((e.target as HTMLInputElement).value)}
              placeholder="請輸入目前密碼"
              class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
            />
          </div>

          <div>
            <label class="block font-bold text-[#444141] mb-1">新設定密碼 (至少 12 字元)</label>
            <input
              type="password"
              required
              minlength={12}
              value={newPassword}
              onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
              placeholder="長度至少 12 字元"
              class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
            />
          </div>

          <div>
            <label class="block font-bold text-[#444141] mb-1">再次確認新密碼</label>
            <input
              type="password"
              required
              minlength={12}
              value={confirmPassword}
              onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="再次輸入新密碼"
              class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
            />
          </div>

          <div class="pt-3 flex flex-col-reverse md:flex-row md:justify-end gap-2">
            {!user.must_change_password && (
              <button
                type="button"
                onClick={() => (isPasswordModalOpen.value = false)}
                class="border border-[#201e1d] bg-white px-4 py-2 font-semibold text-[#201e1d]"
              >
                取消
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              class="bg-[#9e3526] hover:bg-[#71261b] text-white px-4 py-2 font-bold cursor-pointer border-none"
            >
              {loading ? '更新密碼中...' : '確認修改密碼'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
