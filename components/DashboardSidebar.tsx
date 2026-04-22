'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type SidebarProfile = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
  can_access_preventive_maintenance?: boolean;
  can_access_maintenance_ot?: boolean;
  can_access_hk_special_project?: boolean;
  can_access_chambermaid_entry?: boolean;
  can_access_supervisor_update?: boolean;
  can_access_laundry_count?: boolean;
  can_access_stock_card?: boolean;
  can_access_damaged?: boolean;
  can_access_linen_history?: boolean;
  can_access_daily_forms?: boolean;
  can_access_management_tasks?: boolean;
  can_access_admin_settings?: boolean;
  can_access_linen_admin?: boolean;
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
};

type EffectiveProfile = Required<
  Pick<
    SidebarProfile,
    | 'email'
    | 'name'
    | 'role'
    | 'can_create_task'
    | 'can_edit_task'
    | 'can_delete_task'
    | 'can_access_preventive_maintenance'
    | 'can_access_maintenance_ot'
    | 'can_access_hk_special_project'
    | 'can_access_chambermaid_entry'
    | 'can_access_supervisor_update'
    | 'can_access_laundry_count'
    | 'can_access_stock_card'
    | 'can_access_damaged'
    | 'can_access_linen_history'
    | 'can_access_daily_forms'
    | 'can_access_management_tasks'
    | 'can_access_admin_settings'
  >
> & {
  user_id: string;
};

function normalizeProfile(profile: SidebarProfile | null): EffectiveProfile | null {
  if (!profile) return null;

  const role = profile.role;
  const isSuperuser = role === 'SUPERUSER';

  return {
    user_id: String(profile.user_id || ''),
    email: String(profile.email || '').toLowerCase(),
    name: String(profile.name || ''),
    role,
    can_create_task: isSuperuser || profile.can_create_task === true,
    can_edit_task: isSuperuser || profile.can_edit_task === true,
    can_delete_task: isSuperuser || profile.can_delete_task === true,
    can_access_preventive_maintenance:
      isSuperuser || profile.can_access_preventive_maintenance === true,
    can_access_maintenance_ot:
      isSuperuser || profile.can_access_maintenance_ot === true,
    can_access_hk_special_project:
      isSuperuser || profile.can_access_hk_special_project === true,
    can_access_chambermaid_entry:
      isSuperuser || profile.can_access_chambermaid_entry === true,
    can_access_supervisor_update:
      isSuperuser || profile.can_access_supervisor_update === true,
    can_access_laundry_count:
      isSuperuser || profile.can_access_laundry_count === true,
    can_access_stock_card:
      isSuperuser || profile.can_access_stock_card === true,
    can_access_damaged:
      isSuperuser || profile.can_access_damaged === true,
    can_access_linen_history:
      isSuperuser || profile.can_access_linen_history === true,
    can_access_daily_forms:
      isSuperuser || profile.can_access_daily_forms === true,
    can_access_management_tasks:
      isSuperuser || profile.can_access_management_tasks === true,
    can_access_admin_settings:
      isSuperuser || profile.can_access_admin_settings === true,
  };
}

function getEffectiveProfile(profile: EffectiveProfile | null): EffectiveProfile | null {
  return profile;
}

export default function DashboardSidebar({
  profile,
  sidebarOpen,
  setSidebarOpen,
}: {
  profile: SidebarProfile | null;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [resolvedProfile, setResolvedProfile] = useState<EffectiveProfile | null>(
    normalizeProfile(profile)
  );
  const [profileLoading, setProfileLoading] = useState(false);

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [passwordTargetEmail, setPasswordTargetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [housekeepingOpen, setHousekeepingOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);

  useEffect(() => {
    setResolvedProfile(normalizeProfile(profile));
  }, [profile]);

  useEffect(() => {
    let mounted = true;

    async function refreshProfileFromDb() {
      try {
        setProfileLoading(true);

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (!session?.access_token) {
          if (mounted) setResolvedProfile(normalizeProfile(profile));
          return;
        }

        const res = await fetch(`/api/session-profile?t=${Date.now()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: 'no-store',
        });

        const json = await res.json();

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }

        if (mounted) {
          setResolvedProfile(normalizeProfile((json.user as SidebarProfile | null) ?? profile));
        }
      } catch {
        if (mounted) {
          setResolvedProfile(normalizeProfile(profile));
        }
      } finally {
        if (mounted) setProfileLoading(false);
      }
    }

    void refreshProfileFromDb();

    return () => {
      mounted = false;
    };
  }, [profile, supabase]);

  const currentProfile = resolvedProfile;
  const effectiveProfile = getEffectiveProfile(currentProfile);

  const canSeeDashboard = true;
  const canSeePastTask = true;

  const canSeePM = !!effectiveProfile?.can_access_preventive_maintenance;
  const canSeeMaintenanceOT = !!effectiveProfile?.can_access_maintenance_ot;

  const canSeeHkSpecialProject = !!effectiveProfile?.can_access_hk_special_project;
  const canSeeChambermaid = !!effectiveProfile?.can_access_chambermaid_entry;
  const canSeeSupervisorUpdate = !!effectiveProfile?.can_access_supervisor_update;
  const canSeeLaundryCount = !!effectiveProfile?.can_access_laundry_count;
  const canSeeStockCard = !!effectiveProfile?.can_access_stock_card;
  const canSeeDamaged = !!effectiveProfile?.can_access_damaged;
  const canSeeLinenHistory = !!effectiveProfile?.can_access_linen_history;

  const canSeeDailyForms = !!effectiveProfile?.can_access_daily_forms;
  const canSeeManagementTasks = !!effectiveProfile?.can_access_management_tasks;
  const canSeeAdminSettings = !!effectiveProfile?.can_access_admin_settings;

  const showMaintenanceGroup = canSeePM || canSeeMaintenanceOT;
  const showHousekeepingGroup =
    canSeeHkSpecialProject ||
    canSeeChambermaid ||
    canSeeSupervisorUpdate ||
    canSeeLaundryCount ||
    canSeeStockCard ||
    canSeeDamaged ||
    canSeeLinenHistory;
  const showManagementGroup =
    canSeeDailyForms || canSeeManagementTasks || canSeeAdminSettings;

  const canOpenPasswordModal = !!currentProfile;
  const isSuperuser = currentProfile?.role === 'SUPERUSER';

  function closeSidebar() {
    setSidebarOpen(false);
  }

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  }

  async function fetchJson(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs = 15000
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(input, {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
      });

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!isJson) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status})`);
      }

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }

      return json;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function openLoginModal() {
    setLoginError('');
    setLoginEmail('');
    setLoginPassword('');
    setLoginModalOpen(true);
    closeSidebar();
  }

  function closeLoginModal() {
    if (loginBusy) return;
    setLoginModalOpen(false);
    setLoginError('');
    setLoginEmail('');
    setLoginPassword('');
  }

  async function handleLogin() {
    try {
      const email = loginEmail.trim();
      if (!email) throw new Error('Please enter email');
      if (!loginPassword) throw new Error('Please enter password');

      setLoginBusy(true);
      setLoginError('');

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: loginPassword,
      });

      if (error) throw error;

      closeLoginModal();
      window.location.href = '/dashboard';
    } catch (error: any) {
      setLoginError(error?.message || 'Login failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    try {
      setLogoutBusy(true);
      await supabase.auth.signOut();
      closeSidebar();
      window.location.href = '/dashboard';
    } catch (error: any) {
      alert(error?.message || 'Logout failed');
    } finally {
      setLogoutBusy(false);
    }
  }

  async function openPasswordModal() {
    if (!canOpenPasswordModal) return;

    try {
      setPasswordError('');
      setPasswordSuccess('');
      setNewPassword('');
      setAdminUsers([]);
      setPasswordTargetEmail(currentProfile?.email || '');
      setPasswordModalOpen(true);
      closeSidebar();

      if (isSuperuser) {
        const token = await getAccessToken();

        const json = await fetchJson('/api/admin/users', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const users = (json.users || []) as AdminUser[];
        setAdminUsers(users);
        setPasswordTargetEmail(users[0]?.email || currentProfile?.email || '');
      }
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to load users');
    }
  }

  function closePasswordModal() {
    if (passwordBusy) return;
    setPasswordModalOpen(false);
    setPasswordError('');
    setPasswordSuccess('');
    setNewPassword('');
    setAdminUsers([]);
    setPasswordTargetEmail('');
  }

  async function handleChangePassword() {
    try {
      if (!currentProfile) {
        throw new Error('Login required');
      }

      const trimmed = newPassword.trim();

      if (!trimmed) {
        throw new Error('Please enter a new password');
      }

      if (trimmed.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      setPasswordBusy(true);
      setPasswordError('');
      setPasswordSuccess('');

      if (isSuperuser) {
        if (!passwordTargetEmail) {
          throw new Error('Please select a user');
        }

        const token = await getAccessToken();

        await fetchJson('/api/admin/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            targetEmail: passwordTargetEmail,
            newPassword: trimmed,
          }),
        });
      } else {
        const { error } = await supabase.auth.updateUser({
          password: trimmed,
        });

        if (error) throw error;
      }

      setPasswordSuccess('Password updated successfully');
      setNewPassword('');
    } catch (error: any) {
      setPasswordError(error?.message || 'Failed to update password');
    } finally {
      setPasswordBusy(false);
    }
  }

  function GroupSection({
    title,
    open,
    setOpen,
    children,
  }: {
    title: string;
    open: boolean;
    setOpen: (value: boolean) => void;
    children: ReactNode;
  }) {
    return (
      <div style={styles.groupWrap}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={styles.groupBtn}
        >
          <span>{title}</span>
          <span style={styles.groupChevron}>{open ? '▾' : '▸'}</span>
        </button>
        {open ? <div style={styles.groupContent}>{children}</div> : null}
      </div>
    );
  }

  return (
    <>
      {sidebarOpen ? <div onClick={closeSidebar} style={styles.overlay} /> : null}

      <aside
        style={{
          ...styles.drawer,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div style={styles.headerRow}>
          <div style={styles.menuTitle}>Menu</div>
          <button
            type="button"
            onClick={closeSidebar}
            style={styles.closeBtn}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        {profileLoading ? (
          <div style={styles.loadingBox}>Loading access…</div>
        ) : null}

        <nav style={styles.nav}>
          {canSeeDashboard ? (
            <Link href="/dashboard" onClick={closeSidebar} style={styles.navBtn}>
              Dashboard
            </Link>
          ) : null}

          {canSeePastTask ? (
            <Link href="/dashboard?view=past" onClick={closeSidebar} style={styles.navBtn}>
              Past Task
            </Link>
          ) : null}

          {showMaintenanceGroup ? (
            <GroupSection
              title="Maintenance"
              open={maintenanceOpen}
              setOpen={setMaintenanceOpen}
            >
              {canSeePM ? (
                <Link
                  href="/dashboard/preventive-maintenance"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Preventive Maintenance
                </Link>
              ) : null}

              {canSeeMaintenanceOT ? (
                <Link
                  href="/dashboard/maintenance-ot"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Maintenance OT
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showHousekeepingGroup ? (
            <GroupSection
              title="Housekeeping"
              open={housekeepingOpen}
              setOpen={setHousekeepingOpen}
            >
              {canSeeHkSpecialProject ? (
                <Link
                  href="/dashboard/hk-special-project"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  HK Special Project
                </Link>
              ) : null}

              {canSeeChambermaid ? (
                <Link
                  href="/dashboard/chambermaid-entry"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Chambermaid Entry
                </Link>
              ) : null}

              {canSeeSupervisorUpdate ? (
                <Link
                  href="/dashboard/supervisor-update"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Supervisor Update
                </Link>
              ) : null}

              {canSeeLaundryCount ? (
                <Link
                  href="/dashboard/laundry-count"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Laundry Count
                </Link>
              ) : null}

              {canSeeStockCard ? (
                <Link
                  href="/dashboard/stock-card"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Stock Card
                </Link>
              ) : null}

              {canSeeDamaged ? (
                <Link
                  href="/dashboard/damaged"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Damaged
                </Link>
              ) : null}

              {canSeeLinenHistory ? (
                <Link
                  href="/dashboard/linen-history"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Linen History
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showManagementGroup ? (
            <GroupSection
              title="Management"
              open={managementOpen}
              setOpen={setManagementOpen}
            >
              {canSeeDailyForms ? (
                <Link
                  href="/dashboard/daily-forms"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Daily Forms
                </Link>
              ) : null}

              {canSeeManagementTasks ? (
                <Link
                  href="/dashboard/management-tasks"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Management Tasks
                </Link>
              ) : null}

              {canSeeAdminSettings ? (
                <Link
                  href="/dashboard/admin-settings"
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  Admin Settings
                </Link>
              ) : null}
            </GroupSection>
          ) : null}
        </nav>

        <div style={styles.footer}>
          {currentProfile ? (
            <>
              <div style={styles.userBox}>
                <div style={styles.userName}>{currentProfile.name}</div>
                <div style={styles.userRole}>{currentProfile.role}</div>
                <div style={styles.userEmail}>{currentProfile.email}</div>
              </div>

              <button
                type="button"
                onClick={openPasswordModal}
                style={styles.secondaryAction}
              >
                {isSuperuser ? 'Change User Password' : 'Change Password'}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                style={{
                  ...styles.primaryAction,
                  opacity: logoutBusy ? 0.7 : 1,
                }}
                disabled={logoutBusy}
              >
                {logoutBusy ? 'Logging out...' : 'Log Out'}
              </button>
            </>
          ) : (
            <>
              <div style={styles.userBox}>
                <div style={styles.userName}>Not logged in</div>
                <div style={styles.userEmail}>Use the button below to sign in.</div>
              </div>

              <button
                type="button"
                onClick={openLoginModal}
                style={styles.primaryAction}
              >
                Log In
              </button>
            </>
          )}
        </div>
      </aside>

      {loginModalOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>Log In</div>

            <div style={styles.modalLabel}>Email</div>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Enter email"
              style={styles.input}
              disabled={loginBusy}
            />

            <div style={{ ...styles.modalLabel, marginTop: 12 }}>Password</div>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Enter password"
              style={styles.input}
              disabled={loginBusy}
            />

            {loginError ? <div style={styles.errorBox}>{loginError}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeLoginModal}
                style={styles.modalSecondaryBtn}
                disabled={loginBusy}
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleLogin}
                style={{
                  ...styles.modalPrimaryBtn,
                  opacity: loginBusy ? 0.7 : 1,
                }}
                disabled={loginBusy}
              >
                {loginBusy ? 'Logging in...' : 'Log In'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalTitle}>
              {isSuperuser ? 'Change User Password' : 'Change Password'}
            </div>

            {isSuperuser ? (
              <>
                <div style={styles.modalLabel}>User</div>
                <select
                  value={passwordTargetEmail}
                  onChange={(e) => setPasswordTargetEmail(e.target.value)}
                  style={styles.input}
                  disabled={passwordBusy}
                >
                  <option value="">Select user</option>
                  {adminUsers.map((user) => (
                    <option key={user.email} value={user.email}>
                      {user.name} ({user.role}) - {user.email}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <div style={{ ...styles.modalLabel, marginTop: isSuperuser ? 12 : 0 }}>
              New Password
            </div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              style={styles.input}
              disabled={passwordBusy}
            />

            {passwordError ? <div style={styles.errorBox}>{passwordError}</div> : null}
            {passwordSuccess ? <div style={styles.successBox}>{passwordSuccess}</div> : null}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closePasswordModal}
                style={styles.modalSecondaryBtn}
                disabled={passwordBusy}
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleChangePassword}
                style={{
                  ...styles.modalPrimaryBtn,
                  opacity: passwordBusy ? 0.7 : 1,
                }}
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Saving...' : 'Save Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    zIndex: 40,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '280px',
    maxWidth: '86vw',
    height: '100vh',
    background: '#ffffff',
    borderRight: '1px solid #e5e7eb',
    padding: '18px 14px',
    boxSizing: 'border-box',
    overflowY: 'auto',
    zIndex: 50,
    transition: 'transform 0.22s ease',
    boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '18px',
  },
  menuTitle: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#0f172a',
  },
  closeBtn: {
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '10px',
    width: '36px',
    height: '36px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  loadingBox: {
    marginBottom: '10px',
    background: '#eff6ff',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 700,
    fontSize: '13px',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  groupWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  groupBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 800,
    fontSize: '14px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  groupChevron: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#475569',
  },
  groupContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingLeft: '10px',
  },
  subNavBtn: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '11px 14px',
    fontWeight: 700,
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  footer: {
    marginTop: '20px',
    borderTop: '1px solid #e5e7eb',
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  userBox: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '12px',
    background: '#f8fafc',
  },
  userName: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#0f172a',
  },
  userRole: {
    fontSize: '12px',
    color: '#475569',
    fontWeight: 700,
    marginTop: '2px',
  },
  userEmail: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px',
    wordBreak: 'break-word',
  },
  secondaryAction: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryAction: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  modalCard: {
    width: '100%',
    maxWidth: '460px',
    background: '#ffffff',
    borderRadius: '18px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 20px 40px rgba(15,23,42,0.18)',
    padding: '18px',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  modalLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#ffffff',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '14px',
  },
  modalSecondaryBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  modalPrimaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  errorBox: {
    marginTop: '12px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '14px',
  },
  successBox: {
    marginTop: '12px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '14px',
  },
};
