import { useState, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Building2, DoorOpen, History, Monitor, Plus, Users } from 'lucide-preact';
import { api } from '../api';
import { currentUser, showToast, departments } from '../state';
import { User, Room, Department, Equipment, AuditLogItem } from '../types';
import { roomColor, ROOM_COLOR_KEYS } from '../lib/roomColor';

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

// Names for the room colour picker; the swatch values themselves live in lib/roomColor.
const ROOM_COLOR_NAMES: Record<string, string> = {
  'cat-1': '藍色',
  'cat-2': '靛色',
  'cat-3': '青綠',
  'cat-4': '橘色',
  'cat-5': '粉紅',
  'cat-6': '綠色',
};

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

  const tabs = [
    { key: 'users' as const, label: '帳號管理', short: '帳號', Icon: Users },
    { key: 'rooms' as const, label: '會議室', short: '會議室', Icon: DoorOpen },
    { key: 'depts' as const, label: '科室', short: '科室', Icon: Building2 },
    { key: 'equipment' as const, label: '設備', short: '設備', Icon: Monitor },
    ...(isSuperadmin ? [{ key: 'audit' as const, label: '稽核軌跡', short: '稽核', Icon: History }] : []),
  ];

  const roleClass = (role: User['role']) =>
    role === 'superadmin' ? 'role-superadmin' : role === 'admin' ? 'role-admin' : 'role-staff';
  const roleName = (role: User['role']) => (role === 'superadmin' ? '超管' : role === 'admin' ? '管理員' : '同仁');

  const addButton = (label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} class="btn btn-primary h-[38px] px-4 text-[15px] shadow-none">
      <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
      {label}
    </button>
  );

  const panelHeader = (title: string, action?: ComponentChildren) => (
    <div class="flex items-center justify-between gap-3 px-4 md:px-6 pt-4 md:pt-[18px] pb-2.5">
      <h2 class="m-0 text-[17px] md:text-xl leading-[25px] font-semibold">{title}</h2>
      {action}
    </div>
  );

  const statusDot = (active: boolean) => (
    <span class="inline-flex items-center gap-1.5">
      <span class={`w-2 h-2 rounded-full ${active ? 'bg-success' : 'bg-danger'}`}></span>
      {active ? '啟用' : '停用'}
    </span>
  );

  const rowSeparator = (idx: number) => (idx > 0 ? 'shadow-[inset_0_.5px_0_rgba(0,0,0,.08)]' : '');

  return (
    <div class="max-w-[1400px] mx-auto px-4 md:px-8 pt-2 md:pt-4 pb-8 min-h-[calc(100vh-88px)]">
      {/* Title + section switcher */}
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3 md:gap-4 mb-4 md:mb-5">
        <div>
          <div class="hidden md:block lg-eyebrow">管理同仁帳號權限、會議室設定、科室資訊與系統軌跡</div>
          <h1 class="m-0 lg-title-1">後台管理</h1>
        </div>

        <div role="tablist" aria-label="管理項目" class="segmented md:glass w-full md:w-auto h-8 md:h-12">
          {tabs.map(({ key, label, short, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              class="flex-1 md:flex-none md:px-[18px] md:text-[15px]"
            >
              <Icon size={16} class="hidden md:block" aria-hidden="true" />
              <span class="md:hidden">{short}</span>
              <span class="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Users */}
      {activeTab === 'users' && (
        <section class="surface rounded-[24px] md:rounded-[28px] overflow-hidden">
          {panelHeader('同仁帳號清單', addButton('新增帳號', () => setIsUserModalOpen(true)))}

          {/* Phone list */}
          <div class="md:hidden">
            {usersList.map((u, idx) => {
              const canEdit = canEditUserRow(u);
              const canReset = canResetPasswordRow(u);
              const active = u.is_active !== false;

              return (
                <div key={u.id} class={`px-4 py-3 ${rowSeparator(idx)}`}>
                  <div class="flex items-center gap-3">
                    <span class="avatar w-10 h-10 text-[15px]" aria-hidden="true">
                      {u.name.slice(-1)}
                    </span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5 text-[17px] font-semibold">
                        <span class="truncate">{u.name}</span>
                        <span class="font-mono text-xs font-normal text-label-2">{u.id}</span>
                      </div>
                      <div class="text-[13px] text-label-2 truncate">
                        {u.dept_name || u.dept_id} · 分機 {u.ext || '—'}
                      </div>
                    </div>
                    <div class="flex flex-col items-end gap-1 flex-none">
                      <span class={`role-pill h-[22px] px-2 text-[11px] ${roleClass(u.role)}`}>{roleName(u.role)}</span>
                      <span class="text-xs text-label-2">{statusDot(active)}</span>
                    </div>
                  </div>
                  {(canEdit || canReset) && (
                    <div class="flex justify-end gap-1.5 mt-2">
                      {canEdit && (
                        <button type="button" onClick={() => handleOpenEditUser(u)} class="btn btn-tinted btn-sm">
                          編輯
                        </button>
                      )}
                      {canReset && (
                        <button type="button" onClick={() => handleResetPassword(u)} class="btn btn-tinted btn-sm">
                          重置密碼
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="lg-table min-w-[960px]">
              <thead>
                <tr>
                  <th>工號</th>
                  <th>姓名</th>
                  <th>科室</th>
                  <th>分機</th>
                  <th>Email</th>
                  <th>角色</th>
                  <th>狀態</th>
                  <th class="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => {
                  const canEdit = canEditUserRow(u);
                  const canReset = canResetPasswordRow(u);

                  return (
                    <tr key={u.id}>
                      <td class="font-mono text-sm">{u.id}</td>
                      <td class="font-semibold whitespace-nowrap">{u.name}</td>
                      <td>{u.dept_name || u.dept_id}</td>
                      <td class="tabular-nums">{u.ext || '—'}</td>
                      <td class="text-sm text-label-2">{u.email || '—'}</td>
                      <td>
                        <span class={`role-pill ${roleClass(u.role)}`}>{roleName(u.role)}</span>
                      </td>
                      <td class="text-sm whitespace-nowrap">{statusDot(u.is_active !== false)}</td>
                      <td>
                        <div class="flex justify-end gap-1.5">
                          {canEdit && (
                            <button type="button" onClick={() => handleOpenEditUser(u)} class="btn btn-tinted btn-sm">
                              編輯
                            </button>
                          )}
                          {canReset && (
                            <button type="button" onClick={() => handleResetPassword(u)} class="btn btn-tinted btn-sm">
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
        </section>
      )}

      {/* Rooms */}
      {activeTab === 'rooms' && (
        <section class="surface rounded-[24px] md:rounded-[28px] overflow-hidden pb-4 md:pb-6">
          {panelHeader('會議室管理', addButton('新增', () => openRoomForm(null)))}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 md:px-6 pt-1">
            {roomsList.map((r) => (
              <div key={r.id} class="rounded-[20px] bg-white/85 shadow-[inset_0_0_0_.5px_rgba(0,0,0,.06)] p-4 flex items-center gap-3">
                <span
                  class="w-9 h-9 rounded-[10px] text-white flex items-center justify-center flex-none"
                  style={{ background: roomColor(r.color_key).color }}
                >
                  <DoorOpen size={18} aria-hidden="true" />
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-[17px] font-semibold truncate">{r.name}</div>
                  <div class="text-[13px] text-label-2 truncate">
                    容納 {r.capacity} 人 · {r.location || '局內'}
                  </div>
                </div>
                <div class="flex items-center gap-1.5 flex-none">
                  <button type="button" onClick={() => openRoomForm(r)} class="btn btn-tinted btn-sm">
                    編輯
                  </button>
                  <button
                    type="button"
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
                    class="btn btn-danger btn-sm"
                  >
                    停用
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Departments */}
      {activeTab === 'depts' && (
        <section class="surface rounded-[24px] md:rounded-[28px] overflow-hidden">
          {panelHeader('科室管理', addButton('新增', () => openDeptForm(null)))}

          {/* Phone list */}
          <div class="md:hidden">
            {deptsList.map((d, idx) => (
              <div key={d.id} class={`flex items-center gap-3 px-4 py-3 ${rowSeparator(idx)}`}>
                <div class="flex-1 min-w-0">
                  <div class="text-[17px] font-semibold truncate">{d.name}</div>
                  <div class="text-[13px] text-label-2">公務專線 {d.phone || '—'}</div>
                </div>
                <button type="button" onClick={() => openDeptForm(d)} class="btn btn-tinted btn-sm">
                  編輯
                </button>
                <button
                  type="button"
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
                  class="btn btn-danger btn-sm"
                >
                  刪除
                </button>
              </div>
            ))}
          </div>

          <table class="lg-table hidden md:table">
            <thead>
              <tr>
                <th>科室名稱</th>
                <th>公務專線</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {deptsList.map((d) => (
                <tr key={d.id}>
                  <td class="font-semibold">{d.name}</td>
                  <td class="text-label-2 tabular-nums">{d.phone || '—'}</td>
                  <td>
                    <div class="flex justify-end gap-1.5">
                      <button type="button" onClick={() => openDeptForm(d)} class="btn btn-tinted btn-sm">
                        編輯
                      </button>
                      <button
                        type="button"
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
                        class="btn btn-danger btn-sm"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Equipment */}
      {activeTab === 'equipment' && (
        <section class="surface rounded-[24px] md:rounded-[28px] overflow-hidden pb-4 md:pb-6">
          {panelHeader('設備項目管理', addButton('新增', () => openEquipForm(null)))}

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-4 md:px-6 pt-1">
            {equipList.map((eq) => (
              <div key={eq.id} class="rounded-[20px] bg-white/85 shadow-[inset_0_0_0_.5px_rgba(0,0,0,.06)] pl-4 pr-3 py-3 flex items-center justify-between gap-3">
                <span class="text-[15px] font-semibold truncate">{eq.name}</span>
                <div class="flex gap-1.5 flex-none">
                  <button type="button" onClick={() => openEquipForm(eq)} class="btn btn-tinted btn-sm">
                    編輯
                  </button>
                  <button
                    type="button"
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
                    class="btn btn-danger btn-sm"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Audit */}
      {activeTab === 'audit' && isSuperadmin && (
        <section class="surface rounded-[24px] md:rounded-[28px] overflow-hidden">
          {panelHeader('系統稽核軌跡')}

          {/* Phone list */}
          <div class="md:hidden">
            {auditLogs.map((log, idx) => (
              <div key={log.id} class={`px-4 py-3 ${rowSeparator(idx)}`}>
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-[15px] font-semibold text-accent-ink">{auditActionLabel(log.action)}</span>
                  <span class="font-mono text-[11px] text-label-2 flex-none">
                    {new Date(log.created_at).toLocaleString('zh-TW', { hour12: false })}
                  </span>
                </div>
                <div class="text-[15px] font-semibold mt-0.5">{log.actor_name || log.actor_id || '—'}</div>
                <div class="text-[13px] text-label-2 break-all">
                  {log.entity_type} {log.entity_id ? `/ ${log.entity_id}` : ''}
                </div>
                <div class="font-mono text-[11px] text-label-2 mt-0.5">來源 IP {log.ip || '—'}</div>
              </div>
            ))}
          </div>

          <div class="hidden md:block overflow-x-auto">
            <table class="lg-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>操作者</th>
                  <th>動作</th>
                  <th>對象</th>
                  <th>來源 IP</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td class="font-mono text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('zh-TW', { hour12: false })}
                    </td>
                    <td class="font-semibold">{log.actor_name || log.actor_id || '—'}</td>
                    <td class="font-semibold text-accent-ink">{auditActionLabel(log.action)}</td>
                    <td class="text-label-2">
                      {log.entity_type} {log.entity_id ? `/ ${log.entity_id}` : ''}
                    </td>
                    <td class="font-mono text-xs text-label-2">{log.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Room Modal */}
      {roomForm && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight">{roomForm.id ? '編輯會議室' : '新增會議室'}</h3>
            <form onSubmit={handleSaveRoom} class="space-y-4">
              <div>
                <label class="field-label">會議室名稱</label>
                <input
                  type="text"
                  required
                  value={roomForm.name}
                  onInput={(e) => setRoomForm({ ...roomForm, name: (e.target as HTMLInputElement).value })}
                  class="field"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="field-label">容納人數</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={String(roomForm.capacity)}
                    onInput={(e) => setRoomForm({ ...roomForm, capacity: Number((e.target as HTMLInputElement).value) })}
                    class="field"
                  />
                </div>
                <div>
                  <label class="field-label">識別色</label>
                  <select
                    value={roomForm.colorKey}
                    onChange={(e) => setRoomForm({ ...roomForm, colorKey: (e.target as HTMLSelectElement).value })}
                    class="field"
                  >
                    {ROOM_COLOR_KEYS.map((c) => (
                      <option key={c} value={c}>{ROOM_COLOR_NAMES[c] ?? c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label class="field-label">位置</label>
                <input
                  type="text"
                  value={roomForm.location}
                  onInput={(e) => setRoomForm({ ...roomForm, location: (e.target as HTMLInputElement).value })}
                  placeholder="例如: 3 樓 301 室"
                  class="field"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setRoomForm(null)} class="btn btn-plain btn-md">取消</button>
                <button type="submit" class="btn btn-primary btn-md">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dept Modal */}
      {deptForm && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight">{deptForm.id ? '編輯科室' : '新增科室'}</h3>
            <form onSubmit={handleSaveDept} class="space-y-4">
              <div>
                <label class="field-label">科室名稱</label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onInput={(e) => setDeptForm({ ...deptForm, name: (e.target as HTMLInputElement).value })}
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">公務專線</label>
                <input
                  type="text"
                  value={deptForm.phone}
                  onInput={(e) => setDeptForm({ ...deptForm, phone: (e.target as HTMLInputElement).value })}
                  class="field"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setDeptForm(null)} class="btn btn-plain btn-md">取消</button>
                <button type="submit" class="btn btn-primary btn-md">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Equip Modal */}
      {equipForm && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight">{equipForm.id ? '編輯設備項目' : '新增設備項目'}</h3>
            <form onSubmit={handleSaveEquip} class="space-y-4">
              <div>
                <label class="field-label">設備名稱</label>
                <input
                  type="text"
                  required
                  value={equipForm.name}
                  onInput={(e) => setEquipForm({ ...equipForm, name: (e.target as HTMLInputElement).value })}
                  class="field"
                />
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setEquipForm(null)} class="btn btn-plain btn-md">取消</button>
                <button type="submit" class="btn btn-primary btn-md">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Create Modal */}
      {isUserModalOpen && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight">新增同仁帳號</h3>
            <form onSubmit={handleCreateUser} class="space-y-4">
              <div>
                <label class="field-label">工號 / 帳號</label>
                <input
                  type="text"
                  required
                  value={newUserId}
                  onInput={(e) => setNewUserId((e.target as HTMLInputElement).value)}
                  placeholder="例如: 88888"
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">同仁姓名</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onInput={(e) => setNewUserName((e.target as HTMLInputElement).value)}
                  placeholder="例如: 張同仁"
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">所屬科室</label>
                <select
                  required
                  value={newUserDept}
                  onChange={(e) => setNewUserDept((e.target as HTMLSelectElement).value)}
                  class="field"
                >
                  <option value="">-- 請選擇科室 --</option>
                  {deptsList.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label class="field-label">分機號碼</label>
                <input
                  type="text"
                  value={newUserExt}
                  onInput={(e) => setNewUserExt((e.target as HTMLInputElement).value)}
                  placeholder="例如: 123"
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">Email 信箱</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onInput={(e) => setNewUserEmail((e.target as HTMLInputElement).value)}
                  placeholder="例如: user@ems.hccg.gov.tw"
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">角色權限</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole((e.target as HTMLSelectElement).value as any)}
                  class="field"
                >
                  <option value="staff">一般同仁 (Staff)</option>
                  <option value="admin">系統管理員 (Admin)</option>
                  {isSuperadmin && <option value="superadmin">超級管理者 (Superadmin)</option>}
                </select>
              </div>
              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setIsUserModalOpen(false)} class="btn btn-plain btn-md">取消</button>
                <button type="submit" class="btn btn-primary btn-md">建立帳號</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight">編輯同仁帳號資料 [{editingUser.id}]</h3>
            <form onSubmit={handleUpdateUser} class="space-y-4">
              <div>
                <label class="field-label">工號 / 帳號</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.id}
                  class="field font-mono"
                />
              </div>
              <div>
                <label class="field-label">同仁姓名</label>
                <input
                  type="text"
                  required
                  value={editUserName}
                  onInput={(e) => setEditUserName((e.target as HTMLInputElement).value)}
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">所屬科室</label>
                <select
                  required
                  value={editUserDept}
                  onChange={(e) => setEditUserDept((e.target as HTMLSelectElement).value)}
                  class="field"
                >
                  <option value="">-- 請選擇科室 --</option>
                  {deptsList.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label class="field-label">分機號碼</label>
                <input
                  type="text"
                  value={editUserExt}
                  onInput={(e) => setEditUserExt((e.target as HTMLInputElement).value)}
                  class="field"
                />
              </div>
              <div>
                <label class="field-label">Email 信箱</label>
                <input
                  type="email"
                  value={editUserEmail}
                  onInput={(e) => setEditUserEmail((e.target as HTMLInputElement).value)}
                  class="field"
                />
              </div>

              {(isAdmin || isSuperadmin) && (
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="field-label">角色權限</label>
                    <select
                      value={editUserRole}
                      disabled={!isSuperadmin && editingUser.role !== 'staff'}
                      onChange={(e) => setEditUserRole((e.target as HTMLSelectElement).value as any)}
                      class="field"
                    >
                      <option value="staff">一般同仁 (Staff)</option>
                      <option value="admin">系統管理員 (Admin)</option>
                      {isSuperadmin && <option value="superadmin">超級管理者 (Superadmin)</option>}
                    </select>
                  </div>
                  <div>
                    <label class="field-label">帳號狀態</label>
                    <select
                      value={editUserIsActive ? '1' : '0'}
                      onChange={(e) => setEditUserIsActive((e.target as HTMLSelectElement).value === '1')}
                      class="field"
                    >
                      <option value="1">正常啟用 (Active)</option>
                      <option value="0">暫時停用 (Disabled)</option>
                    </select>
                  </div>
                </div>
              )}

              <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
                <button type="button" onClick={() => setEditingUser(null)} class="btn btn-plain btn-md">取消</button>
                <button type="submit" class="btn btn-primary btn-md">儲存變更</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Destructive Confirm Modal */}
      {destructive && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4">
            <h3 class="m-0 font-bold text-[22px] leading-tight text-danger-ink">{destructive.title}</h3>
            <p class="m-0 text-[15px] leading-relaxed">{destructive.body}</p>
            <div>
              <label class="field-label">
                請輸入「{destructive.confirmWord}」以確認
              </label>
              <input
                type="text"
                value={confirmInput}
                onInput={(e) => setConfirmInput((e.target as HTMLInputElement).value)}
                class="field font-mono"
              />
            </div>
            <div class="pt-2 flex flex-col-reverse md:flex-row md:justify-end gap-2">
              <button type="button" onClick={() => setDestructive(null)} class="btn btn-plain btn-md">取消</button>
              <button
                type="button"
                onClick={runDestructive}
                disabled={confirmInput !== destructive.confirmWord}
                class="btn btn-danger-solid btn-md"
              >
                {destructive.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temp Password Modal */}
      {tempPasswordModal && (
        <div class="lg-overlay">
          <div class="lg-dialog glass-sheet space-y-4 text-center">
            <h3 class="m-0 font-bold text-[22px] leading-tight">一次性臨時密碼</h3>
            <p class="m-0 text-[13px] text-label-2">
              已為帳號 <strong class="text-black">{tempPasswordModal.id}</strong> 產生一次性臨時密碼：
            </p>
            <div class="p-4 rounded-2xl bg-white/85 font-mono text-2xl font-bold text-accent-ink tracking-wider select-all">
              {tempPasswordModal.pass}
            </div>
            <p class="m-0 text-[13px] text-danger-ink font-semibold">
              此密碼僅顯示一次，關閉後無法再查看。請儘速轉知同仁。
            </p>
            <button
              type="button"
              onClick={() => setTempPasswordModal(null)}
              class="btn btn-primary btn-md w-full"
            >
              理解並關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
