'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Role = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';

type UserProfile = {
  user_id: string;
  email: string;
  name: string;
  role: Role;

  can_access_preventive_maintenance: boolean;
  can_access_maintenance_ot: boolean;
  can_access_hk_special_project: boolean;
  can_access_chambermaid_entry: boolean;
  can_access_supervisor_update: boolean;
  can_access_laundry_count: boolean;
  can_access_stock_card: boolean;
  can_access_damaged: boolean;
  can_access_linen_history: boolean;
  can_access_daily_forms: boolean;
  can_access_management_tasks: boolean;
  can_access_admin_settings: boolean;

  can_create_task: boolean;
  can_edit_task: boolean;
  can_delete_task: boolean;
};

type EditableUser = UserProfile & {
  newPassword?: string;
};

const roleOptions: Role[] = ['SUPERUSER', 'MANAGER', 'SUPERVISOR', 'HK', 'MT', 'FO'];

const accessFieldDefs: Array<{ key: keyof UserProfile; label: string; group: 'Maintenance' | 'Housekeeping' | 'Management' | 'Actions' }> = [
  { key: 'can_access_preventive_maintenance', label: 'Preventive Maintenance', group: 'Maintenance' },
  { key: 'can_access_maintenance_ot', label: 'Maintenance OT', group: 'Maintenance' },

  { key: 'can_access_hk_special_project', label: 'HK Special Project', group: 'Housekeeping' },
  { key: 'can_access_chambermaid_entry', label: 'Chambermaid Entry', group: 'Housekeeping' },
  { key: 'can_access_supervisor_update', label: 'Supervisor Update', group: 'Housekeeping' },
  { key: 'can_access_laundry_count', label: 'Laundry Count', group: 'Housekeeping' },
  { key: 'can_access_stock_card', label: 'Stock Card', group: 'Housekeeping' },
  { key: 'can_access_damaged', label: 'Damaged', group: 'Housekeeping' },
  { key: 'can_access_linen_history', label: 'Linen History', group: 'Housekeeping' },

  { key: 'can_access_daily_forms', label: 'Daily Forms', group: 'Management' },
  { key: 'can_access_management_tasks', label: 'Management Tasks', group: 'Management' },
  { key: 'can_access_admin_settings', label: 'Admin Settings', group: 'Management' },

  { key: 'can_create_task', label: 'Can Create', group: 'Actions' },
  { key: 'can_edit_task', label: 'Can Edit', group: 'Actions' },
  { key: 'can_delete_task', label: 'Can Delete', group: 'Actions' },
];

function emptyPermissions() {
  return {
    can_access_preventive_maintenance: false,
    can_access_maintenance_ot: false,
    can_access_hk_special_project: false,
    can_access_chambermaid_entry: false,
    can_access_supervisor_update: false,
    can_access_laundry_count: false,
    can_access_stock_card: false,
    can_access_damaged: false,
    can_access_linen_history: false,
    can_access_daily_forms: false,
    can_access_management_tasks: false,
    can_access_admin_settings: false,
    can_create_task: false,
    can_edit_task: false,
    can_delete_task: false,
  };
}

function profileWithDefaults(row: any): UserProfile {
  return {
    user_id: row.user_id,
    email: row.email || '',
    name: row.name || '',
    role: (row.role || 'FO') as Role,
    ...emptyPermissions(),
    ...row,
  };
}

export default function AdminSettingsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [me, setMe] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [draft, setDraft] = useState<EditableUser | null>(null);

  const [search, setSearch] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<Role>('FO');

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      user.name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      user.role.toLowerCase().includes(q)
    );
  }, [users, search]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      setDraft(null);
      return;
    }

    const selected = users.find((user) => user.user_id === selectedUserId);
    setDraft(selected ? { ...selected, newPassword: '' } : null);
  }, [selectedUserId, users]);

  async function bootstrap() {
    try {
      setLoading(true);
      setErrorMsg('');
      setStatusMsg('');

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;
      if (!session?.user) {
        setMe(null);
        return;
      }

      const { data: meRow, error: meError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (meError) throw meError;
      if (!meRow) {
        setMe(null);
        return;
      }

      const meProfile = profileWithDefaults(meRow);
      setMe(meProfile);

      const { data: userRows, error: usersError } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;

      const nextUsers = (userRows || []).map(profileWithDefaults);
      setUsers(nextUsers);

      if (!selectedUserId && nextUsers.length > 0) {
        setSelectedUserId(nextUsers[0].user_id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load admin settings');
    } finally {
      setLoading(false);
    }
  }

  function setDraftField<K extends keyof EditableUser>(key: K, value: EditableUser[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function refreshUsers(keepSelectedId?: string) {
    const { data: userRows, error: usersError } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (usersError) throw usersError;

    const nextUsers = (userRows || []).map(profileWithDefaults);
    setUsers(nextUsers);

    const targetId = keepSelectedId || selectedUserId;
    const stillExists = nextUsers.some((u) => u.user_id === targetId);

    if (stillExists) {
      setSelectedUserId(targetId);
    } else {
      setSelectedUserId(nextUsers[0]?.user_id || '');
    }
  }

  async function handleCreateUser() {
    try {
      if (!createName.trim()) throw new Error('Please enter name');
      if (!createEmail.trim()) throw new Error('Please enter email');
      if (!createPassword.trim()) throw new Error('Please enter password');
      if (createPassword.trim().length < 6) throw new Error('Password must be at least 6 characters');

      setCreating(true);
      setErrorMsg('');
      setStatusMsg('');

      const payload = {
        name: createName.trim(),
        email: createEmail.trim().toLowerCase(),
        password: createPassword.trim(),
        role: createRole,
        ...emptyPermissions(),
        can_access_admin_settings: createRole === 'SUPERUSER',
      };

      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create user');
      }

      setStatusMsg('User created successfully');
      setCreateName('');
      setCreateEmail('');
      setCreatePassword('');
      setCreateRole('FO');
      await refreshUsers(json.user_id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveUser() {
    try {
      if (!draft) throw new Error('No user selected');
      if (!draft.name.trim()) throw new Error('Name cannot be blank');
      if (!draft.email.trim()) throw new Error('Email cannot be blank');

      setSaving(true);
      setErrorMsg('');
      setStatusMsg('');

      const payload = {
        email: draft.email,
        name: draft.name.trim(),
        role: draft.role,
        can_access_preventive_maintenance: !!draft.can_access_preventive_maintenance,
        can_access_maintenance_ot: !!draft.can_access_maintenance_ot,
        can_access_hk_special_project: !!draft.can_access_hk_special_project,
        can_access_chambermaid_entry: !!draft.can_access_chambermaid_entry,
        can_access_supervisor_update: !!draft.can_access_supervisor_update,
        can_access_laundry_count: !!draft.can_access_laundry_count,
        can_access_stock_card: !!draft.can_access_stock_card,
        can_access_damaged: !!draft.can_access_damaged,
        can_access_linen_history: !!draft.can_access_linen_history,
        can_access_daily_forms: !!draft.can_access_daily_forms,
        can_access_management_tasks: !!draft.can_access_management_tasks,
        can_access_admin_settings: !!draft.can_access_admin_settings,
        can_create_task: !!draft.can_create_task,
        can_edit_task: !!draft.can_edit_task,
        can_delete_task: !!draft.can_delete_task,
      };

      const res = await fetch('/api/admin/update-user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || (!json?.ok && !json?.success)) {
        throw new Error(json?.error || 'Failed to update user');
      }

      setStatusMsg('User access updated successfully');
      await refreshUsers(draft.user_id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser() {
    try {
      if (!draft) throw new Error('No user selected');
      if (draft.user_id === me?.user_id) throw new Error('You cannot delete your own account');
      if (!window.confirm(`Delete ${draft.name} (${draft.email})?`)) return;

      setDeleting(true);
      setErrorMsg('');
      setStatusMsg('');

      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: draft.user_id }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to delete user');
      }

      setStatusMsg('User deleted successfully');
      await refreshUsers('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  }

  async function handleResetPassword() {
    try {
      if (!draft) throw new Error('No user selected');
      const nextPassword = (draft.newPassword || '').trim();
      if (!nextPassword) throw new Error('Please enter a new password');
      if (nextPassword.length < 6) throw new Error('Password must be at least 6 characters');

      setChangingPassword(true);
      setErrorMsg('');
      setStatusMsg('');

      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEmail: draft.email,
          newPassword: nextPassword,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to change password');
      }

      setDraft((prev) => (prev ? { ...prev, newPassword: '' } : prev));
      setStatusMsg('Password updated successfully');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  }

  function renderToggle(key: keyof UserProfile, label: string) {
    if (!draft) return null;

    return (
      <label key={String(key)} style={styles.toggleRow}>
        <div>
          <div style={styles.toggleLabel}>{label}</div>
          <div style={styles.toggleSubtext}>
            {draft[key] ? 'Allowed' : 'Hidden / blocked'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraftField(key as keyof EditableUser, !draft[key] as any)}
          style={{
            ...styles.toggleBtn,
            ...(draft[key] ? styles.toggleBtnOn : styles.toggleBtnOff),
          }}
        >
          <span
            style={{
              ...styles.toggleKnob,
              transform: draft[key] ? 'translateX(22px)' : 'translateX(0)',
            }}
          />
        </button>
      </label>
    );
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!me || me.role !== 'SUPERUSER') {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>Only superuser can access Admin Settings.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  const maintenanceToggles = accessFieldDefs.filter((f) => f.group === 'Maintenance');
  const housekeepingToggles = accessFieldDefs.filter((f) => f.group === 'Housekeeping');
  const managementToggles = accessFieldDefs.filter((f) => f.group === 'Management');
  const actionToggles = accessFieldDefs.filter((f) => f.group === 'Actions');

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.hero}>
          <div>
            <div style={styles.heroTitle}>Admin Settings</div>
            <div style={styles.heroSub}>
              Manage users, department roles, passwords, page access, and create/edit/delete permissions.
            </div>
          </div>

          <Link href="/dashboard" style={styles.backBtn}>
            Back to Dashboard
          </Link>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {statusMsg ? <div style={styles.successBox}>{statusMsg}</div> : null}

        <div style={styles.layout}>
          <section style={styles.panel}>
            <div style={styles.panelTitle}>Create User</div>

            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Full Name</label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  style={styles.input}
                  placeholder="Enter name"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Email</label>
                <input
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  style={styles.input}
                  placeholder="name@hotelhallmark.com"
                  type="email"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Temporary Password</label>
                <input
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  style={styles.input}
                  placeholder="Minimum 6 characters"
                  type="password"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Department / Role</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as Role)}
                  style={styles.input}
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={styles.panelActions}>
              <button
                type="button"
                onClick={() => void handleCreateUser()}
                style={{ ...styles.primaryBtn, opacity: creating ? 0.65 : 1 }}
                disabled={creating}
              >
                {creating ? 'Creating...' : 'Add User'}
              </button>
            </div>
          </section>

          <section style={styles.leftRail}>
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Users</div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Search</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={styles.input}
                  placeholder="Search by name, email, role"
                />
              </div>

              <div style={styles.userList}>
                {filteredUsers.map((user) => (
                  <button
                    key={user.user_id}
                    type="button"
                    onClick={() => setSelectedUserId(user.user_id)}
                    style={{
                      ...styles.userListItem,
                      ...(selectedUserId === user.user_id ? styles.userListItemActive : {}),
                    }}
                  >
                    <div style={styles.userListName}>{user.name || 'Unnamed User'}</div>
                    <div style={styles.userListEmail}>{user.email}</div>
                    <div style={styles.userListRole}>{user.role}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section style={styles.rightRail}>
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Selected User</div>

              {!draft ? (
                <div style={styles.emptyState}>Select a user to view and edit current access.</div>
              ) : (
                <>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Name</label>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraftField('name', e.target.value)}
                        style={styles.input}
                        placeholder="User name"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Email</label>
                      <input
                        value={draft.email}
                        readOnly
                        style={{ ...styles.input, background: '#f8fafc', color: '#64748b' }}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Department / Role</label>
                      <select
                        value={draft.role}
                        onChange={(e) => setDraftField('role', e.target.value as Role)}
                        style={styles.input}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Reset Password</label>
                      <div style={styles.inlineActionRow}>
                        <input
                          value={draft.newPassword || ''}
                          onChange={(e) => setDraftField('newPassword', e.target.value)}
                          style={styles.input}
                          placeholder="Enter new password"
                          type="password"
                        />
                        <button
                          type="button"
                          onClick={() => void handleResetPassword()}
                          style={{ ...styles.secondaryBtn, opacity: changingPassword ? 0.65 : 1 }}
                          disabled={changingPassword}
                        >
                          {changingPassword ? 'Saving...' : 'Update'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={styles.permissionGrid}>
                    <div style={styles.permissionCard}>
                      <div style={styles.permissionTitle}>Maintenance Access</div>
                      {maintenanceToggles.map((item) => renderToggle(item.key, item.label))}
                    </div>

                    <div style={styles.permissionCard}>
                      <div style={styles.permissionTitle}>Housekeeping Access</div>
                      {housekeepingToggles.map((item) => renderToggle(item.key, item.label))}
                    </div>

                    <div style={styles.permissionCard}>
                      <div style={styles.permissionTitle}>Management Access</div>
                      {managementToggles.map((item) => renderToggle(item.key, item.label))}
                    </div>

                    <div style={styles.permissionCard}>
                      <div style={styles.permissionTitle}>Task Permissions</div>
                      {actionToggles.map((item) => renderToggle(item.key, item.label))}
                    </div>
                  </div>

                  <div style={styles.bottomActions}>
                    <button
                      type="button"
                      onClick={() => void handleDeleteUser()}
                      style={{ ...styles.deleteBtn, opacity: deleting ? 0.65 : 1 }}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting...' : 'Delete User'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleSaveUser()}
                      style={{ ...styles.primaryBtn, opacity: saving ? 0.65 : 1 }}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px 16px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1380px',
    margin: '0 auto',
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  heroTitle: {
    fontSize: '30px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  heroSub: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
    maxWidth: '840px',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '1.05fr 0.9fr 1.55fr',
    gap: '16px',
  },
  leftRail: {
    minWidth: 0,
  },
  rightRail: {
    minWidth: 0,
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '24px',
    padding: '18px',
    boxShadow: '0 16px 36px rgba(15,23,42,0.06)',
  },
  panelTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
  },
  label: {
    fontSize: '13px',
    color: '#334155',
    fontWeight: 800,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  panelActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '6px',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    border: '1px solid #ef4444',
    background: '#ffffff',
    color: '#ef4444',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  userList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxHeight: '880px',
    overflowY: 'auto',
  },
  userListItem: {
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: '18px',
    padding: '14px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  userListItemActive: {
    borderColor: '#93c5fd',
    boxShadow: '0 12px 28px rgba(37,99,235,0.12)',
    background: '#f8fbff',
  },
  userListName: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
  },
  userListEmail: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
    wordBreak: 'break-word',
  },
  userListRole: {
    display: 'inline-flex',
    marginTop: '8px',
    borderRadius: '999px',
    background: '#eef2ff',
    color: '#3730a3',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 800,
  },
  permissionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '12px',
    marginTop: '8px',
  },
  permissionCard: {
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    borderRadius: '20px',
    padding: '14px',
  },
  permissionTitle: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '8px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '10px 0',
    borderBottom: '1px solid #e5e7eb',
  },
  toggleLabel: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#0f172a',
  },
  toggleSubtext: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
  },
  toggleBtn: {
    position: 'relative',
    width: '52px',
    height: '30px',
    border: 'none',
    borderRadius: '999px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  toggleBtnOn: {
    background: '#0f172a',
  },
  toggleBtnOff: {
    background: '#cbd5e1',
  },
  toggleKnob: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    width: '22px',
    height: '22px',
    background: '#ffffff',
    borderRadius: '999px',
    transition: 'transform 0.2s ease',
  },
  inlineActionRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  bottomActions: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '16px',
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 700,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 700,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '16px',
    padding: '26px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 700,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '20px',
    padding: '26px',
    textAlign: 'center',
    boxShadow: '0 14px 32px rgba(15,23,42,0.08)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  centerText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: 1.6,
    marginBottom: '16px',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
  },
};

