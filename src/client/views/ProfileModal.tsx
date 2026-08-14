import { useState, useEffect } from 'preact/hooks';
import { currentUser, isProfileModalOpen, showToast, departments } from '../state';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { Department } from '../types';

/**
 * Own-profile editor.
 *
 * Extracted from Header so the mobile drawer can raise the same dialog: the drawer is a
 * sibling of the header, and duplicating the form in both chromes meant two copies of the
 * same save path drifting apart.
 */
export function ProfileModal() {
  const user = currentUser.value;
  const isOpen = isProfileModalOpen.value;

  const [name, setName] = useState('');
  const [deptId, setDeptId] = useState('');
  const [ext, setExt] = useState('');
  const [email, setEmail] = useState('');
  const [deptsList, setDeptsList] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed the fields from the account each time the dialog opens, so a cancelled edit does
  // not leave stale values behind for the next one.
  useEffect(() => {
    if (!isOpen || !user) return;
    setName(user.name);
    setDeptId(user.dept_id);
    setExt(user.ext || '');
    setEmail(user.email || '');
    api
      .getDepartments()
      .then((res) => {
        if (res.success) setDeptsList(res.departments);
      })
      .catch(() => {});
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.updateUser(user.id, { name, deptId, ext, email });
      if (res.user) currentUser.value = res.user;
      showToast('個人資料修改成功', 'success');
      isProfileModalOpen.value = false;
    } catch (err: any) {
      showToast(err.message || '更新資料失敗', 'error');
    } finally {
      setSaving(false);
    }
  };

  const options = deptsList.length > 0 ? deptsList : departments.value;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => (isProfileModalOpen.value = false)}
      title="編輯個人資料"
    >
      <form onSubmit={handleSave} class="flex flex-col gap-4">
        <div>
          <label class="block font-bold text-xs text-[#444141] mb-1.5">工號 / 帳號</label>
          <input
            type="text"
            disabled
            value={user.id}
            class="w-full p-3 border border-[#201e1d] bg-[#eae9e9] font-mono text-base text-[#605d5d]"
          />
        </div>
        <div>
          <label class="block font-bold text-xs text-[#444141] mb-1.5">姓名</label>
          <input
            type="text"
            required
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            class="w-full p-3 border border-[#201e1d] bg-white text-base outline-none focus:border-[#9e3526]"
          />
        </div>
        <div>
          <label class="block font-bold text-xs text-[#444141] mb-1.5">所屬科室</label>
          <select
            required
            value={deptId}
            onChange={(e) => setDeptId((e.target as HTMLSelectElement).value)}
            class="w-full p-3 border border-[#201e1d] bg-white text-base outline-none focus:border-[#9e3526]"
          >
            <option value="">-- 請選擇科室 --</option>
            {options.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label class="block font-bold text-xs text-[#444141] mb-1.5">分機號碼</label>
          <input
            type="text"
            value={ext}
            onInput={(e) => setExt((e.target as HTMLInputElement).value)}
            placeholder="例如: 123"
            class="w-full p-3 border border-[#201e1d] bg-white text-base outline-none focus:border-[#9e3526]"
          />
        </div>
        <div>
          <label class="block font-bold text-xs text-[#444141] mb-1.5">Email 信箱</label>
          <input
            type="email"
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            placeholder="例如: user@ems.hccg.gov.tw"
            class="w-full p-3 border border-[#201e1d] bg-white text-base outline-none focus:border-[#9e3526]"
          />
        </div>

        <div class="h-px bg-[#d7d3d3] mt-1"></div>

        {/* Stacked and full-bleed on mobile per 手機版; the desktop dialog keeps the
            right-aligned pair. */}
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            type="button"
            onClick={() => (isProfileModalOpen.value = false)}
            class="border border-[#201e1d] bg-white px-4 py-3.5 sm:py-2 font-semibold text-[#201e1d] text-left sm:text-center"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            class="bg-[#9e3526] hover:bg-[#71261b] disabled:bg-[#bab6b6] text-white px-4 py-3.5 sm:py-2 font-bold text-left sm:text-center"
          >
            {saving ? '儲存中...' : '儲存變更'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
