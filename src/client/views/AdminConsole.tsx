import { useState, useEffect } from 'preact/hooks';
import { api } from '../api';
import { currentUser, showToast, departments } from '../state';
import { User, Room, Department, Equipment, AuditLogItem } from '../types';

interface DestructiveRequest {
  title: string;
  body: string;
  confirmLabel: string;
  confirmWord: string;
  run: () => Promise<void>;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: '登入成功',
  LOGIN_FAILED: '登入失敗',
  LOGIN_BLOCKED: '登入遭鎖定',
  LOGOUT: '登出',
  CHANGE_PASSWORD: '變更密碼',
  RESET_PASSWORD: '重置密碼',
  CREATE_USER: '建立帳號',
  UPDATE_USER: '修改帳號',
  CREATE_RESERVATION: '新增預約',
  UPDATE_RESERVATION: '修改預約',
  CANCEL_RESERVATION: '取消預約',
  CREATE_ROOM: '新增會議室',
  UPDATE_ROOM: '修改會議室',
  DELETE_ROOM: '停用會議室',
};

const auditActionLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;

export function AdminConsole() {
  const [activeTab, setActiveTab] = useState<'users' | 'rooms' | 'depts' | 'equipment' | 'audit'>('users');
  const [usersList, setUsersList] = useState<User[]>([]);
  const [roomsList, setRoomsList] = useState<Room[]>([]);
  const [deptsList, setDeptsList] = useState<Department[]>([]);
  const [equipList, setEquipList] = useState<Equipment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);

  // New user form state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserDept, setNewUserDept] = useState('');
  const [newUserExt, setNewUserExt] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'admin' | 'superadmin'>('staff');
  const [tempPasswordModal, setTempPasswordModal] = useState<
    { id: string; pass: string; expiresAt?: string } | null
  >(null);

  // Edit user modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserDept, setEditUserDept] = useState('');
  const [editUserExt, setEditUserExt] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserRole, setEditUserRole] = useState<'staff' | 'admin' | 'superadmin'>('staff');
  const [editUserIsActive, setEditUserIsActive] = useState(true);

  // Create/edit form state for reference-data tabs.
  const [roomForm, setRoomForm] = useState<
    { id: string; name: string; capacity: number; location: string; colorKey: string } | null
  >(null);
  const [deptForm, setDeptForm] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [equipForm, setEquipForm] = useState<{ id: string; name: string } | null>(null);

  // Destructive actions dialog state
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  const user = currentUser.value;
  const isSuperadmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin';

  const requestDestructive = (req: DestructiveRequest) => {
    setConfirmInput('');
    setDestructive(req);
  };

  const runDestructive = async () => {
    if (!destructive) return;
    try {
      await destructive.run();
      setDestructive(null);
      setConfirmInput('');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '操作失敗', 'error');
    }
  };

  const loadAdminData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'users') {
        const res = await api.getUsers();
        if (res.success) setUsersList(res.users);
        const dRes = await api.getDepartments();
        if (dRes.success) setDeptsList(dRes.departments);
      } else if (activeTab === 'rooms') {
        const res = await api.getRooms();
        if (res.success) setRoomsList(res.rooms);
      } else if (activeTab === 'depts') {
        const res = await api.getDepartments();
        if (res.success) setDeptsList(res.departments);
      } else if (activeTab === 'equipment') {
        const res = await api.getEquipment();
        if (res.success) setEquipList(res.equipment);
      } else if (activeTab === 'audit' && isSuperadmin) {
        const res = await api.getAuditLogs();
        if (res.success) setAuditLogs(res.logs);
      }
    } catch (e: any) {
      showToast(e.message || '載入失敗', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, [activeTab]);

  const openRoomForm = (r: Room | null) =>
    setRoomForm({
      id: r?.id ?? '',
      name: r?.name ?? '',
      capacity: r?.capacity ?? 10,
      location: r?.location ?? '',
      colorKey: r?.color_key ?? 'cat-1',
    });

  const handleSaveRoom = async (e: Event) => {
    e.preventDefault();
    if (!roomForm) return;
    try {
      const payload = {
        name: roomForm.name,
        capacity: roomForm.capacity,
        location: roomForm.location,
        colorKey: roomForm.colorKey,
      };
      if (roomForm.id) await api.updateRoom(roomForm.id, payload as any);
      else await api.createRoom(payload);

      showToast(roomForm.id ? '會議室已更新' : '會議室已建立', 'success');
      setRoomForm(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '儲存會議室失敗', 'error');
    }
  };

  const openDeptForm = (d: Department | null) =>
    setDeptForm({ id: d?.id ?? '', name: d?.name ?? '', phone: d?.phone ?? '' });

  const handleSaveDept = async (e: Event) => {
    e.preventDefault();
    if (!deptForm) return;
    try {
      const payload = { name: deptForm.name, phone: deptForm.phone };
      if (deptForm.id) await api.updateDepartment(deptForm.id, payload as any);
      else await api.createDepartment(payload);

      showToast(deptForm.id ? '科室已更新' : '科室已建立', 'success');
      setDeptForm(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '儲存科室失敗', 'error');
    }
  };

  const openEquipForm = (eq: Equipment | null) =>
    setEquipForm({ id: eq?.id ?? '', name: eq?.name ?? '' });

  const handleSaveEquip = async (e: Event) => {
    e.preventDefault();
    if (!equipForm) return;
    try {
      const payload = { name: equipForm.name };
      if (equipForm.id) await api.updateEquipment(equipForm.id, payload as any);
      else await api.createEquipment(payload);

      showToast(equipForm.id ? '設備已更新' : '設備已建立', 'success');
      setEquipForm(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '儲存設備失敗', 'error');
    }
  };

  const handleCreateUser = async (e: Event) => {
    e.preventDefault();
    try {
      const res = await api.createUser({
        id: newUserId,
        name: newUserName,
        deptId: newUserDept,
        ext: newUserExt,
        email: newUserEmail,
        role: newUserRole,
      });

      setIsUserModalOpen(false);
      setTempPasswordModal({ id: newUserId, pass: res.tempPassword });
      setNewUserId('');
      setNewUserName('');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '建立使用者失敗', 'error');
    }
  };

  const handleOpenEditUser = (u: User) => {
    setEditingUser(u);
    setEditUserName(u.name);
    setEditUserDept(u.dept_id);
    setEditUserExt(u.ext || '');
    setEditUserEmail(u.email || '');
    setEditUserRole(u.role);
    setEditUserIsActive(u.is_active !== false);
  };

  const handleUpdateUser = async (e: Event) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const res = await api.updateUser(editingUser.id, {
        name: editUserName,
        deptId: editUserDept,
        ext: editUserExt,
        email: editUserEmail,
        role: editUserRole,
        isActive: editUserIsActive,
      });

      showToast('帳號資料修改成功', 'success');
      setEditingUser(null);

      if (user && user.id === editingUser.id && res.user) {
        currentUser.value = res.user;
      }

      loadAdminData();
    } catch (err: any) {
      showToast(err.message || '更新使用者失敗', 'error');
    }
  };

  const handleResetPassword = (targetUser: User) => {
    requestDestructive({
      title: '重置密碼',
      body: `將為「${targetUser.name}」(${targetUser.id}) 產生一組一次性密碼。該同仁目前在所有裝置上的登入會立刻失效，且必須用新密碼重新登入。`,
      confirmLabel: '重置密碼',
      confirmWord: targetUser.id,
      run: async () => {
        const res = await api.resetUserPassword(targetUser.id);
        setTempPasswordModal({
          id: targetUser.id,
          pass: res.tempPassword,
          expiresAt: (res as any).tempPasswordExpiresAt,
        });
      },
    });
  };

  const canEditUserRow = (target: User) => {
    if (isSuperadmin) return true;
    if (user?.id === target.id) return true;
    if (isAdmin && target.role === 'staff') return true;
    return false;
  };

  // Mirrors the server gate in routes/users.ts. Resetting your *own* password is refused
  // there for everyone — it would hand out a working credential without asking for the
  // current one, which is exactly what a stolen session needs to take the account over
  // for good. Change your own password via 變更密碼 instead.
  const canResetPasswordRow = (target: User) => {
    if (user?.id === target.id) return false;
    if (isSuperadmin) return true;
    if (isAdmin && target.role === 'staff') return true;
    return false;
  };

  return (
    <div class="max-w-[1400px] mx-auto px-4 py-5 md:p-8 min-h-[calc(100vh-5rem)]">
      {/* Header & Tabs. Below md the tab strip scrolls sideways as one row — five
          bordered buttons wrapped onto three lines on a phone. */}
      <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 pb-0 md:pb-4 border-b-2 border-[#201e1d] mb-4 md:mb-6">
        <div class="hidden md:block">
          <h2 class="m-0 font-extrabold text-3xl leading-tight text-[#201e1d]">後台管理控制台</h2>
          <p class="mt-1 mb-0 font-normal text-sm text-[#605d5d]">管理同仁帳號權限、會議室設定、科室資訊與系統軌跡</p>
        </div>

        {/* Tab Selector Buttons */}
        <div class="flex md:flex-wrap items-center overflow-x-auto md:overflow-visible">
          <button
            onClick={() => setActiveTab('users')}
            class={`flex-none whitespace-nowrap px-3.5 md:px-4 py-2.5 font-bold text-[13px] md:text-sm border cursor-pointer border-[#201e1d] ${
              activeTab === 'users' ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d] hover:bg-[#eae9e9]'
            }`}
          >
            帳號管理
          </button>
          <button
            onClick={() => setActiveTab('rooms')}
            class={`flex-none whitespace-nowrap px-3.5 md:px-4 py-2.5 font-bold text-[13px] md:text-sm border border-l-0 border-[#201e1d] cursor-pointer ${
              activeTab === 'rooms' ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d] hover:bg-[#eae9e9]'
            }`}
          >
            會議室
          </button>
          <button
            onClick={() => setActiveTab('depts')}
            class={`flex-none whitespace-nowrap px-3.5 md:px-4 py-2.5 font-bold text-[13px] md:text-sm border border-l-0 border-[#201e1d] cursor-pointer ${
              activeTab === 'depts' ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d] hover:bg-[#eae9e9]'
            }`}
          >
            科室
          </button>
          <button
            onClick={() => setActiveTab('equipment')}
            class={`flex-none whitespace-nowrap px-3.5 md:px-4 py-2.5 font-bold text-[13px] md:text-sm border border-l-0 border-[#201e1d] cursor-pointer ${
              activeTab === 'equipment' ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d] hover:bg-[#eae9e9]'
            }`}
          >
            設備
          </button>
          {isSuperadmin && (
            <button
              onClick={() => setActiveTab('audit')}
              class={`flex-none whitespace-nowrap px-3.5 md:px-4 py-2.5 font-bold text-[13px] md:text-sm border border-l-0 border-[#201e1d] cursor-pointer ${
                activeTab === 'audit' ? 'bg-[#201e1d] text-white' : 'bg-white text-[#201e1d] hover:bg-[#eae9e9]'
              }`}
            >
              稽核軌跡
            </button>
          )}
        </div>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <div class="flex items-center justify-between mb-3.5 md:mb-4 gap-3">
            <h3 class="m-0 font-extrabold text-[15px] md:text-xl text-[#201e1d]">同仁帳號清單</h3>
            <button
              onClick={() => setIsUserModalOpen(true)}
              class="flex-none bg-[#9e3526] hover:bg-[#71261b] text-white px-3 md:px-4 py-2 font-bold text-[13px] md:text-sm cursor-pointer border-none"
            >
              ＋ 新增
            </button>
          </div>

          {/* Mobile card list */}
          <div class="md:hidden flex flex-col gap-3">
            {usersList.map((u) => {
              const canEdit = canEditUserRow(u);
              const canReset = canResetPasswordRow(u);
              const active = u.is_active !== false;

              return (
                <div key={u.id} class="border border-[#201e1d]/30 bg-[#f3f2f2] p-3.5">
                  <div class="flex items-start justify-between gap-2">
                    <div class="font-bold text-base leading-snug text-[#201e1d] min-w-0">
                      <span class="truncate">{u.name}</span>
                      <span class="font-mono font-normal text-xs text-[#605d5d] ml-2">{u.id}</span>
                    </div>
                    <span class="mtag mtag-neutral flex-none">
                      {u.role === 'superadmin' ? '超管' : u.role === 'admin' ? '管理員' : '同仁'}
                    </span>
                  </div>

                  <div class="font-normal text-[13px] leading-normal text-[#605d5d] mt-1">
                    {u.dept_name || u.dept_id} · 分機 {u.ext || '—'}
                  </div>
                  {u.email && (
                    <div class="font-normal text-[13px] leading-normal text-[#7d7979] truncate">
                      {u.email}
                    </div>
                  )}

                  <div class="flex items-center justify-between gap-2 mt-2.5">
                    <span
                      class={`inline-flex items-center gap-1.5 font-bold text-[13px] ${
                        active ? 'text-[#3a6b3a]' : 'text-[#9e3526]'
                      }`}
                    >
                      <span
                        class={`w-[7px] h-[7px] inline-block ${
                          active ? 'bg-[#3a6b3a]' : 'bg-[#9e3526]'
                        }`}
                      ></span>
                      {active ? '正常' : '停用'}
                    </span>

                    <div class="flex gap-2">
                      {canReset && (
                        <button
                          onClick={() => handleResetPassword(u)}
                          class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                        >
                          重置密碼
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => handleOpenEditUser(u)}
                          class="border border-[#201e1d] bg-white px-2.5 py-1.5 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                        >
                          編輯
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="mtable w-full">
              <thead>
                <tr class="bg-[#eae9e9]">
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">工號</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">姓名</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">科室</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">分機</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">Email</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">角色</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">狀態</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d] text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#201e1d]/20 text-sm">
                {usersList.map((u) => {
                  const canEdit = canEditUserRow(u);
                  const canReset = canResetPasswordRow(u);

                  return (
                    <tr key={u.id} class="hover:bg-white transition-colors">
                      <td class="p-3 px-4 font-mono font-bold text-[#201e1d]">{u.id}</td>
                      <td class="p-3 px-4 font-bold text-[#201e1d]">{u.name}</td>
                      <td class="p-3 px-4">{u.dept_name || u.dept_id}</td>
                      <td class="p-3 px-4">{u.ext || '—'}</td>
                      <td class="p-3 px-4">{u.email || '—'}</td>
                      <td class="p-3 px-4">
                        <span class="font-bold text-xs bg-[#201e1d] text-white px-2 py-0.5">
                          {u.role === 'superadmin' ? '超管' : u.role === 'admin' ? '管理員' : '同仁'}
                        </span>
                      </td>
                      <td class="p-3 px-4 font-bold">
                        {u.is_active !== false ? (
                          <span class="inline-flex items-center gap-1.5 text-[#3a6b3a]">
                            <span class="w-2 h-2 bg-[#3a6b3a] inline-block"></span> 啟用
                          </span>
                        ) : (
                          <span class="inline-flex items-center gap-1.5 text-[#9e3526]">
                            <span class="w-2 h-2 bg-[#9e3526] inline-block"></span> 停用
                          </span>
                        )}
                      </td>
                      <td class="p-3 px-4 text-right">
                        <div class="flex justify-end gap-2">
                          {canEdit && (
                            <button
                              onClick={() => handleOpenEditUser(u)}
                              class="border border-[#201e1d] bg-white px-2.5 py-1 font-semibold text-xs text-[#201e1d] hover:bg-[#eae9e9] cursor-pointer"
                            >
                              編輯
                            </button>
                          )}
                          {canReset && (
                            <button
                              onClick={() => handleResetPassword(u)}
                              class="border border-[#201e1d] bg-white px-2.5 py-1 font-semibold text-xs text-[#201e1d] hover:bg-[#eae9e9] cursor-pointer"
                            >
                              重置密碼
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rooms Tab */}
      {activeTab === 'rooms' && (
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <div class="flex items-center justify-between mb-3.5 md:mb-4 gap-3">
            <h3 class="m-0 font-extrabold text-[15px] md:text-xl text-[#201e1d]">會議室管理</h3>
            <button
              onClick={() => openRoomForm(null)}
              class="flex-none bg-[#9e3526] hover:bg-[#71261b] text-white px-3 md:px-4 py-2 font-bold text-[13px] md:text-sm cursor-pointer border-none"
            >
              ＋ 新增
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {roomsList.map((r) => (
              <div key={r.id} class="p-4 border border-[#201e1d] bg-white flex items-center justify-between gap-3">
                <div>
                  <div class="font-extrabold text-base text-[#201e1d]">{r.name}</div>
                  <div class="font-medium text-xs text-[#605d5d] mt-1">
                    容納 {r.capacity} 人 · {r.location || '局內'}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    onClick={() => openRoomForm(r)}
                    class="border border-[#201e1d] bg-white px-3 py-1 font-semibold text-xs cursor-pointer"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() =>
                      requestDestructive({
                        title: '停用會議室',
                        body: `停用「${r.name}」後，同仁將無法再選擇這間會議室。既有預約保留。`,
                        confirmLabel: '停用會議室',
                        confirmWord: r.name,
                        run: async () => {
                          await api.deleteRoom(r.id);
                          showToast(`已停用「${r.name}」`, 'success');
                        },
                      })
                    }
                    class="bg-[#9e3526] text-white px-3 py-1 font-semibold text-xs border-none cursor-pointer"
                  >
                    停用
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === 'depts' && (
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <div class="flex items-center justify-between mb-3.5 md:mb-4 gap-3">
            <h3 class="m-0 font-extrabold text-[15px] md:text-xl text-[#201e1d]">科室管理</h3>
            <button
              onClick={() => openDeptForm(null)}
              class="flex-none bg-[#9e3526] hover:bg-[#71261b] text-white px-3 md:px-4 py-2 font-bold text-[13px] md:text-sm cursor-pointer border-none"
            >
              ＋ 新增
            </button>
          </div>

          {/* Mobile card list */}
          <div class="md:hidden flex flex-col gap-3">
            {deptsList.map((d) => (
              <div key={d.id} class="border border-[#201e1d]/30 bg-[#f3f2f2] p-3.5">
                <div class="font-bold text-base leading-snug text-[#201e1d]">{d.name}</div>
                <div class="font-normal text-[13px] leading-normal text-[#605d5d]">
                  公務專線 {d.phone || '—'}
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2.5">
                  <button
                    onClick={() => openDeptForm(d)}
                    class="border border-[#201e1d] bg-white py-2 font-semibold text-[13px] text-[#201e1d] cursor-pointer"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() =>
                      requestDestructive({
                        title: '刪除科室',
                        body: `確定要刪除科室「${d.name}」嗎？`,
                        confirmLabel: '刪除科室',
                        confirmWord: d.name,
                        run: async () => {
                          await api.deleteDepartment(d.id);
                          showToast(`已刪除「${d.name}」`, 'success');
                        },
                      })
                    }
                    class="bg-[#9e3526] text-white py-2 font-semibold text-[13px] border-none cursor-pointer"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <table class="mtable w-full hidden md:table">
            <thead>
              <tr class="bg-[#eae9e9]">
                <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">科室名稱</th>
                <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">公務專線</th>
                <th class="p-3 px-4 font-bold text-sm text-[#201e1d] text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#201e1d]/20 text-sm">
              {deptsList.map((d) => (
                <tr key={d.id} class="hover:bg-white transition-colors">
                  <td class="p-3 px-4 font-bold text-[#201e1d]">{d.name}</td>
                  <td class="p-3 px-4 text-[#605d5d]">{d.phone || '—'}</td>
                  <td class="p-3 px-4 text-right">
                    <div class="flex justify-end gap-2">
                      <button
                        onClick={() => openDeptForm(d)}
                        class="border border-[#201e1d] bg-white px-3 py-1 font-semibold text-xs text-[#201e1d] cursor-pointer"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() =>
                          requestDestructive({
                            title: '刪除科室',
                            body: `確定要刪除科室「${d.name}」嗎？`,
                            confirmLabel: '刪除科室',
                            confirmWord: d.name,
                            run: async () => {
                              await api.deleteDepartment(d.id);
                              showToast(`已刪除「${d.name}」`, 'success');
                            },
                          })
                        }
                        class="bg-[#9e3526] text-white px-3 py-1 font-semibold text-xs border-none cursor-pointer"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Equipment Tab */}
      {activeTab === 'equipment' && (
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <div class="flex items-center justify-between mb-3.5 md:mb-4 gap-3">
            <h3 class="m-0 font-extrabold text-[15px] md:text-xl text-[#201e1d]">設備項目管理</h3>
            <button
              onClick={() => openEquipForm(null)}
              class="flex-none bg-[#9e3526] hover:bg-[#71261b] text-white px-3 md:px-4 py-2 font-bold text-[13px] md:text-sm cursor-pointer border-none"
            >
              ＋ 新增
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {equipList.map((eq) => (
              <div key={eq.id} class="p-3.5 border border-[#201e1d] bg-white flex items-center justify-between">
                <span class="font-bold text-sm text-[#201e1d]">{eq.name}</span>
                <div class="flex gap-2">
                  <button
                    onClick={() => openEquipForm(eq)}
                    class="border border-[#201e1d] bg-white px-2.5 py-1 font-semibold text-xs cursor-pointer"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() =>
                      requestDestructive({
                        title: '刪除設備',
                        body: `確定要刪除「${eq.name}」嗎？`,
                        confirmLabel: '刪除設備',
                        confirmWord: eq.name,
                        run: async () => {
                          await api.deleteEquipment(eq.id);
                          showToast(`已刪除「${eq.name}」`, 'success');
                        },
                      })
                    }
                    class="bg-[#9e3526] text-white px-2.5 py-1 font-semibold text-xs border-none cursor-pointer"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Tab */}
      {activeTab === 'audit' && isSuperadmin && (
        <div class="md:mcard md:border md:border-[#201e1d] md:p-6 md:bg-[#f3f2f2]">
          <h3 class="m-0 mb-3.5 md:mb-4 font-extrabold text-[15px] md:text-xl text-[#201e1d]">
            系統稽核軌跡
          </h3>

          {/* Mobile card list */}
          <div class="md:hidden flex flex-col gap-3">
            {auditLogs.map((log) => (
              <div key={log.id} class="border border-[#201e1d]/30 bg-[#f3f2f2] p-3.5">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="font-semibold text-sm text-[#9e3526]">
                    {auditActionLabel(log.action)}
                  </span>
                  <span class="font-mono text-[11px] text-[#7d7979] flex-none">
                    {new Date(log.created_at).toLocaleString('zh-TW', { hour12: false })}
                  </span>
                </div>
                <div class="font-bold text-sm text-[#201e1d] mt-1">
                  {log.actor_name || log.actor_id || '—'}
                </div>
                <div class="font-normal text-[13px] leading-normal text-[#605d5d] break-all">
                  {log.entity_type} {log.entity_id ? `/ ${log.entity_id}` : ''}
                </div>
                <div class="font-mono text-[11px] text-[#7d7979] mt-0.5">
                  來源 IP {log.ip || '—'}
                </div>
              </div>
            ))}
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="mtable w-full">
              <thead>
                <tr class="bg-[#eae9e9]">
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">時間</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">操作者</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">動作</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">對象</th>
                  <th class="p-3 px-4 font-bold text-sm text-[#201e1d]">來源 IP</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#201e1d]/20 text-sm">
                {auditLogs.map((log) => (
                  <tr key={log.id} class="hover:bg-white transition-colors">
                    <td class="p-3 px-4 font-mono text-xs text-[#201e1d]">
                      {new Date(log.created_at).toLocaleString('zh-TW', { hour12: false })}
                    </td>
                    <td class="p-3 px-4 font-bold text-[#201e1d]">{log.actor_name || log.actor_id || '—'}</td>
                    <td class="p-3 px-4 font-semibold text-[#9e3526]">{auditActionLabel(log.action)}</td>
                    <td class="p-3 px-4 text-[#605d5d]">{log.entity_type} {log.entity_id ? `/ ${log.entity_id}` : ''}</td>
                    <td class="p-3 px-4 font-mono text-xs text-[#7d7979]">{log.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Room Modal */}
      {roomForm && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">{roomForm.id ? '編輯會議室' : '新增會議室'}</h3>
            <form onSubmit={handleSaveRoom} class="space-y-4 text-xs">
              <div>
                <label class="block font-bold text-[#444141] mb-1">會議室名稱</label>
                <input
                  type="text"
                  required
                  value={roomForm.name}
                  onInput={(e) => setRoomForm({ ...roomForm, name: (e.target as HTMLInputElement).value })}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block font-bold text-[#444141] mb-1">容納人數</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={String(roomForm.capacity)}
                    onInput={(e) => setRoomForm({ ...roomForm, capacity: Number((e.target as HTMLInputElement).value) })}
                    class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                  />
                </div>
                <div>
                  <label class="block font-bold text-[#444141] mb-1">識別色</label>
                  <select
                    value={roomForm.colorKey}
                    onChange={(e) => setRoomForm({ ...roomForm, colorKey: (e.target as HTMLSelectElement).value })}
                    class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                  >
                    {['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">位置</label>
                <input
                  type="text"
                  value={roomForm.location}
                  onInput={(e) => setRoomForm({ ...roomForm, location: (e.target as HTMLInputElement).value })}
                  placeholder="例如: 3 樓 301 室"
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setRoomForm(null)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
                <button type="submit" class="bg-[#9e3526] text-white px-4 py-2 font-bold">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dept Modal */}
      {deptForm && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">{deptForm.id ? '編輯科室' : '新增科室'}</h3>
            <form onSubmit={handleSaveDept} class="space-y-4 text-xs">
              <div>
                <label class="block font-bold text-[#444141] mb-1">科室名稱</label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onInput={(e) => setDeptForm({ ...deptForm, name: (e.target as HTMLInputElement).value })}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">公務專線</label>
                <input
                  type="text"
                  value={deptForm.phone}
                  onInput={(e) => setDeptForm({ ...deptForm, phone: (e.target as HTMLInputElement).value })}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setDeptForm(null)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
                <button type="submit" class="bg-[#9e3526] text-white px-4 py-2 font-bold">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Equip Modal */}
      {equipForm && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">{equipForm.id ? '編輯設備項目' : '新增設備項目'}</h3>
            <form onSubmit={handleSaveEquip} class="space-y-4 text-xs">
              <div>
                <label class="block font-bold text-[#444141] mb-1">設備名稱</label>
                <input
                  type="text"
                  required
                  value={equipForm.name}
                  onInput={(e) => setEquipForm({ ...equipForm, name: (e.target as HTMLInputElement).value })}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setEquipForm(null)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
                <button type="submit" class="bg-[#9e3526] text-white px-4 py-2 font-bold">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Create Modal */}
      {isUserModalOpen && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">新增同仁帳號</h3>
            <form onSubmit={handleCreateUser} class="space-y-4 text-xs">
              <div>
                <label class="block font-bold text-[#444141] mb-1">工號 / 帳號</label>
                <input
                  type="text"
                  required
                  value={newUserId}
                  onInput={(e) => setNewUserId((e.target as HTMLInputElement).value)}
                  placeholder="例如: 88888"
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">同仁姓名</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onInput={(e) => setNewUserName((e.target as HTMLInputElement).value)}
                  placeholder="例如: 張同仁"
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">所屬科室</label>
                <select
                  required
                  value={newUserDept}
                  onChange={(e) => setNewUserDept((e.target as HTMLSelectElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                >
                  <option value="">-- 請選擇科室 --</option>
                  {deptsList.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">分機號碼</label>
                <input
                  type="text"
                  value={newUserExt}
                  onInput={(e) => setNewUserExt((e.target as HTMLInputElement).value)}
                  placeholder="例如: 123"
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">Email 信箱</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onInput={(e) => setNewUserEmail((e.target as HTMLInputElement).value)}
                  placeholder="例如: user@ems.hccg.gov.tw"
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">角色權限</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole((e.target as HTMLSelectElement).value as any)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none font-bold"
                >
                  <option value="staff">一般同仁 (Staff)</option>
                  <option value="admin">系統管理員 (Admin)</option>
                  {isSuperadmin && <option value="superadmin">超級管理者 (Superadmin)</option>}
                </select>
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setIsUserModalOpen(false)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
                <button type="submit" class="bg-[#9e3526] text-white px-4 py-2 font-bold">建立帳號</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">編輯同仁帳號資料 [{editingUser.id}]</h3>
            <form onSubmit={handleUpdateUser} class="space-y-4 text-xs">
              <div>
                <label class="block font-bold text-[#444141] mb-1">工號 / 帳號</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.id}
                  class="w-full border border-[#201e1d] bg-[#eae9e9] p-2.5 font-mono text-[#605d5d]"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">同仁姓名</label>
                <input
                  type="text"
                  required
                  value={editUserName}
                  onInput={(e) => setEditUserName((e.target as HTMLInputElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">所屬科室</label>
                <select
                  required
                  value={editUserDept}
                  onChange={(e) => setEditUserDept((e.target as HTMLSelectElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                >
                  <option value="">-- 請選擇科室 --</option>
                  {deptsList.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">分機號碼</label>
                <input
                  type="text"
                  value={editUserExt}
                  onInput={(e) => setEditUserExt((e.target as HTMLInputElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>
              <div>
                <label class="block font-bold text-[#444141] mb-1">Email 信箱</label>
                <input
                  type="email"
                  value={editUserEmail}
                  onInput={(e) => setEditUserEmail((e.target as HTMLInputElement).value)}
                  class="w-full border border-[#201e1d] bg-white p-2.5 outline-none"
                />
              </div>

              {(isAdmin || isSuperadmin) && (
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block font-bold text-[#444141] mb-1">角色權限</label>
                    <select
                      value={editUserRole}
                      disabled={!isSuperadmin && editingUser.role !== 'staff'}
                      onChange={(e) => setEditUserRole((e.target as HTMLSelectElement).value as any)}
                      class="w-full border border-[#201e1d] bg-white p-2.5 outline-none font-bold"
                    >
                      <option value="staff">一般同仁 (Staff)</option>
                      <option value="admin">系統管理員 (Admin)</option>
                      {isSuperadmin && <option value="superadmin">超級管理者 (Superadmin)</option>}
                    </select>
                  </div>
                  <div>
                    <label class="block font-bold text-[#444141] mb-1">帳號狀態</label>
                    <select
                      value={editUserIsActive ? '1' : '0'}
                      onChange={(e) => setEditUserIsActive((e.target as HTMLSelectElement).value === '1')}
                      class="w-full border border-[#201e1d] bg-white p-2.5 outline-none font-bold"
                    >
                      <option value="1">正常啟用 (Active)</option>
                      <option value="0">暫時停用 (Disabled)</option>
                    </select>
                  </div>
                </div>
              )}

              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setEditingUser(null)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
                <button type="submit" class="bg-[#9e3526] text-white px-4 py-2 font-bold">儲存變更</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Destructive Confirm Modal */}
      {destructive && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#9e3526]">{destructive.title}</h3>
            <p class="font-normal text-sm text-[#201e1d]">{destructive.body}</p>
            <div>
              <label class="block font-bold text-xs text-[#444141] mb-1">
                請輸入「{destructive.confirmWord}」以確認
              </label>
              <input
                type="text"
                value={confirmInput}
                onInput={(e) => setConfirmInput((e.target as HTMLInputElement).value)}
                class="w-full border border-[#201e1d] bg-white p-2.5 outline-none font-mono"
              />
            </div>
            <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
              <button type="button" onClick={() => setDestructive(null)} class="border border-[#201e1d] bg-white px-4 py-2 font-semibold">取消</button>
              <button
                type="button"
                onClick={runDestructive}
                disabled={confirmInput !== destructive.confirmWord}
                class="bg-[#9e3526] disabled:bg-[#bab6b6] text-white px-4 py-2 font-bold border-none cursor-pointer"
              >
                {destructive.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temp Password Modal */}
      {tempPasswordModal && (
        <div class="fixed inset-0 bg-[#2d2b2b]/50 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div class="w-full md:max-w-md bg-[#f3f2f2] border-0 md:border-2 border-[#201e1d] p-5 md:p-6 shadow-2xl space-y-4 text-center overflow-y-auto md:max-h-[90vh]">
            <h3 class="m-0 font-extrabold text-xl text-[#201e1d]">一次性臨時密碼</h3>
            <p class="text-xs text-[#605d5d]">
              已為帳號 <strong class="text-[#201e1d]">{tempPasswordModal.id}</strong> 產生一次性臨時密碼：
            </p>
            <div class="p-4 bg-white border-2 border-[#201e1d] font-mono text-2xl font-extrabold text-[#9e3526] tracking-wider">
              {tempPasswordModal.pass}
            </div>
            <p class="text-xs text-[#9e3526] font-bold">
              ⚠️ 此密碼僅顯示一次，關閉後無法再查看。請儘速轉知同仁。
            </p>
            <button
              type="button"
              onClick={() => setTempPasswordModal(null)}
              class="w-full bg-[#9e3526] text-white p-3 font-bold text-sm border-none cursor-pointer"
            >
              理解並關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
