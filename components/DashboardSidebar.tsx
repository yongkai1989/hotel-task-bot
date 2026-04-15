'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_access_chambermaid_entry?: boolean;
  can_access_linen_admin?: boolean;
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'FO' | 'HK' | 'MT';
};

const MT_SUPERVISOR_EMAILS = [
  'mtsup1@hotelhallmark.com',
  'mtsup2@hotelhallmark.com',
];

const HK_SUPERVISOR_EMAILS = [
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
];

export default function DashboardSidebar({
  profile,
  sidebarOpen,
  setSidebarOpen,
}: {
  profile: DashboardUser | null;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
}) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

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

  const canSeeChambermaid =
    !!profile &&
    (profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR' ||
      profile.can_access_chambermaid_entry === true);

  const canSeeLinenAdmin =
    !!profile &&
    (profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR' ||
      profile.can_access_linen_admin === true);

  const canSeePM =
    !!profile &&
    (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'MT' ||
      (profile.role === 'SUPERVISOR' &&
        MT_SUPERVISOR_EMAILS.includes(profile.email.toLowerCase()))
    );

  const canSeeHkSpecialProject =
    !!profile &&
    (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      (profile.role === 'SUPERVISOR' &&
        HK_SUPERVISOR_EMAILS.includes(profile.email.toLowerCase()))
    );

  const canOpenPasswordModal = !!profile;
  const isManager = profile?.role === 'MANAGER';

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
      setPasswordTargetEmail(profile?.email || '');
      setPasswordModalOpen(true);
      closeSidebar();

      if (isManager) {
        const token = await getAccessToken();

        const json = await fetchJson('/api/admin/users', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const users = (json.users || []) as AdminUser[];
        setAdminUsers(users);
        setPasswordTargetEmail(users[0]?.email || profile?.email || '');
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
      if (!profile) {
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

      if (isManager) {
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
          <button type="button" onClick={closeSidebar} style={styles.closeBtn} aria-label="Close menu">
            ✕
          </button>
        </div>

        <nav style={styles.nav}>
          <Link href="/dashboard" onClick={closeSidebar} style={styles.navBtn}>
            Dashboard
          </Link>

          <Link href="/dashboard?view=past" onClick={closeSidebar} style={styles.navBtn}>
            Past Task
          </Link>

          {canSeePM ? (
            <Link
              href="/dashboard/preventive-maintenance"
              onClick={closeSidebar}
              style={styles.navBtn}
            >
              Preventive Maintenance
            </Link>
          ) : null}

          {canSeeHkSpecialProject ? (
            <Link
              href="/dashboard/hk-special-project"
              onClick={closeSidebar}
              style={styles.navBtn}
            >
              HK Special Project
            </Link>
          ) : null}

          {canSeeChambermaid ? (
            <Link href="/dashboard/chambermaid-entry" onClick={closeSidebar} style={styles.navBtn}>
              Chambermaid Entry
            </Link>
          ) : null}

          {canSeeLinenAdmin ? (
            <>
              <Link href="/dashboard/supervisor-update" onClick={closeSidebar} style={styles.navBtn}>
                Supervisor Update
              </Link>
              <Link href="/dashboard/laundry-count" onClick={closeSidebar} style={styles.navBtn}>
                Laundry Count
              </Link>
              <Link href="/dashboard/stock-card" onClick={closeSidebar} style={styles.navBtn}>
                Stock Card
              </Link>
              <Link href="/dashboard/damaged" onClick={closeSidebar} style={styles.navBtn}>
                Damaged
              </Link>
              <Link href="/dashboard/linen-history" onClick={closeSidebar} style={styles.navBtn}>
                Linen History
              </Link>
            </>
          ) : null}
        </nav>

        <div style={styles.footer}>
          {profile ? (
            <>
              <div style={styles.userBox}>
                <div style={styles.userName}>{profile.name}</div>
                <div style={styles.userRole}>{profile.role}</div>
                <div style={styles.userEmail}>{profile.email}</div>
              </div>

              <button type="button" onClick={openPasswordModal} style={styles.secondaryAction}>
                {isManager ? 'Change User Password' : 'Change Password'}
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
              {isManager ? 'Change User Password' : 'Change Password'}
            </div>

            {isManager ? (
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

            <div style={{ ...styles.modalLabel, marginTop: isManager ? 12 : 0 }}>New Password</div>
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
