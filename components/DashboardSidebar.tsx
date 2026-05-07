'use client';

import { useEffect, useMemo, useState, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  can_access_lost_found?: boolean;
  permissions?: Partial<Record<
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
    | 'can_access_linen_admin'
    | 'can_access_lost_found',
    unknown
  >>;
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
};

type SidebarIconName =
  | 'dashboard'
  | 'archive'
  | 'maintenance'
  | 'calendar'
  | 'clock'
  | 'package'
  | 'alert'
  | 'housekeeping'
  | 'sparkle'
  | 'bed'
  | 'clipboard'
  | 'laundry'
  | 'history'
  | 'management'
  | 'frontOffice'
  | 'lostFound'
  | 'file'
  | 'list'
  | 'settings'
  | 'lock'
  | 'logout'
  | 'login'
  | 'user'
  | 'close'
  | 'chevron';

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
    | 'can_access_lost_found'
  >
> & {
  user_id: string;
};

function normalizeProfile(profile: SidebarProfile | null): EffectiveProfile | null {
  if (!profile) return null;

  const role = profile.role;
  const isSuperuser = role === 'SUPERUSER';
  const hasAccess = (value: unknown) =>
    value === true || value === 'true' || value === 1 || value === '1';
  const permissionValue = (key: Exclude<keyof EffectiveProfile, 'user_id' | 'email' | 'name' | 'role'>) =>
    profile.permissions?.[key] !== undefined ? profile.permissions[key] : profile[key];

  return {
    user_id: String(profile.user_id || ''),
    email: String(profile.email || '').toLowerCase(),
    name: String(profile.name || ''),
    role,
    can_create_task: isSuperuser || hasAccess(permissionValue('can_create_task')),
    can_edit_task: isSuperuser || hasAccess(permissionValue('can_edit_task')),
    can_delete_task: isSuperuser || hasAccess(permissionValue('can_delete_task')),
    can_access_preventive_maintenance:
      isSuperuser || hasAccess(permissionValue('can_access_preventive_maintenance')),
    can_access_maintenance_ot:
      isSuperuser || hasAccess(permissionValue('can_access_maintenance_ot')),
    can_access_hk_special_project:
      isSuperuser || hasAccess(permissionValue('can_access_hk_special_project')),
    can_access_chambermaid_entry:
      isSuperuser || hasAccess(permissionValue('can_access_chambermaid_entry')),
    can_access_supervisor_update:
      isSuperuser || hasAccess(permissionValue('can_access_supervisor_update')),
    can_access_laundry_count:
      isSuperuser || hasAccess(permissionValue('can_access_laundry_count')),
    can_access_stock_card:
      isSuperuser || hasAccess(permissionValue('can_access_stock_card')),
    can_access_damaged:
      isSuperuser || hasAccess(permissionValue('can_access_damaged')),
    can_access_linen_history:
      isSuperuser || hasAccess(permissionValue('can_access_linen_history')),
    can_access_daily_forms:
      isSuperuser || hasAccess(permissionValue('can_access_daily_forms')),
    can_access_management_tasks:
      isSuperuser || hasAccess(permissionValue('can_access_management_tasks')),
    can_access_admin_settings:
      isSuperuser || hasAccess(permissionValue('can_access_admin_settings')),
    can_access_lost_found:
      isSuperuser || hasAccess(permissionValue('can_access_lost_found')),
  };
}

function getEffectiveProfile(profile: EffectiveProfile | null): EffectiveProfile | null {
  return profile;
}

const PROFILE_CACHE_KEY = 'dashboard-session-profile';
const PROFILE_CACHE_TS_KEY = 'dashboard-session-profile-ts';

function clearBrowserAuthState() {
  if (typeof window === 'undefined') return;

  window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
  window.sessionStorage.removeItem(PROFILE_CACHE_TS_KEY);

  Object.keys(window.localStorage).forEach((key) => {
    if (key.startsWith('sb-') || key.includes('supabase.auth.token')) {
      window.localStorage.removeItem(key);
    }
  });
}

function SidebarIcon({
  name,
  size = 18,
}: {
  name: SidebarIconName;
  size?: number;
}) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.15,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  };

  if (name === 'dashboard') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <rect x="13" y="13" width="7" height="7" rx="2" />
      </svg>
    );
  }

  if (name === 'archive') {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M5 7l1 13h12l1-13" />
        <path d="M8 4h8l1 3H7l1-3Z" />
        <path d="M9 12h6" />
      </svg>
    );
  }

  if (name === 'maintenance') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a4 4 0 0 0-5.1 5.1L4.5 16.5a2.1 2.1 0 0 0 3 3l5.1-5.1a4 4 0 0 0 5.1-5.1l-2.6 2.6-3-3 2.6-2.6Z" />
      </svg>
    );
  }

  if (name === 'calendar') {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 10h16" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    );
  }

  if (name === 'clock') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (name === 'package') {
    return (
      <svg {...common}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4.5 8 7.5 4 7.5-4" />
        <path d="M12 12v9" />
      </svg>
    );
  }

  if (name === 'alert') {
    return (
      <svg {...common}>
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
        <path d="M10.4 3.8 2.7 17.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.6 3.8a1.85 1.85 0 0 0-3.2 0Z" />
      </svg>
    );
  }

  if (name === 'housekeeping') {
    return (
      <svg {...common}>
        <path d="M15 4 4 15" />
        <path d="m14 5 5 5" />
        <path d="M5 14c2 0 5 3 5 5" />
        <path d="M4 20h7" />
      </svg>
    );
  }

  if (name === 'sparkle') {
    return (
      <svg {...common}>
        <path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" />
        <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z" />
      </svg>
    );
  }

  if (name === 'bed') {
    return (
      <svg {...common}>
        <path d="M4 19V7" />
        <path d="M20 19v-6a3 3 0 0 0-3-3H4" />
        <path d="M4 14h16" />
        <path d="M7 10V8h4v2" />
      </svg>
    );
  }

  if (name === 'clipboard') {
    return (
      <svg {...common}>
        <path d="M9 5h6" />
        <path d="M9 3h6a2 2 0 0 1 2 2v1H7V5a2 2 0 0 1 2-2Z" />
        <path d="M7 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }

  if (name === 'laundry') {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M8 7h.01" />
        <path d="M12 7h4" />
        <circle cx="12" cy="14" r="4" />
        <path d="M9.5 14c1.6-1.2 3.4 1.2 5 0" />
      </svg>
    );
  }

  if (name === 'history') {
    return (
      <svg {...common}>
        <path d="M4 12a8 8 0 1 0 2.3-5.7" />
        <path d="M4 5v5h5" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  }

  if (name === 'management') {
    return (
      <svg {...common}>
        <rect x="4" y="7" width="16" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        <path d="M4 12h16" />
      </svg>
    );
  }

  if (name === 'frontOffice') {
    return (
      <svg {...common}>
        <path d="M4 20V8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V20" />
        <path d="M8 20v-6h8v6" />
        <path d="M8 10h.01" />
        <path d="M12 10h.01" />
        <path d="M16 10h.01" />
        <path d="M3 20h18" />
      </svg>
    );
  }

  if (name === 'lostFound') {
    return (
      <svg {...common}>
        <path d="M5 8.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1.5" />
        <path d="M4 8.5h16l-1 11H5L4 8.5Z" />
        <path d="M9.5 13a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.2 1.1-1.2 2" />
        <path d="M12.5 18.8h.01" />
      </svg>
    );
  }

  if (name === 'file') {
    return (
      <svg {...common}>
        <path d="M7 3h7l4 4v14H7V3Z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    );
  }

  if (name === 'list') {
    return (
      <svg {...common}>
        <path d="M8 6h12" />
        <path d="M8 12h12" />
        <path d="M8 18h12" />
        <path d="M4 6h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18h.01" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.8 1.8 0 0 0-2 .1 1.8 1.8 0 0 0-.9 1.7V22H9.3v-.2a1.8 1.8 0 0 0-.9-1.7 1.8 1.8 0 0 0-2-.1l-.2.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.9 1.8 1.8 0 0 0-1.5-1.1H3V10h.2a1.8 1.8 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.8 1.8 0 0 0 2-.1 1.8 1.8 0 0 0 .9-1.7V2h5.4v.2a1.8 1.8 0 0 0 .9 1.7 1.8 1.8 0 0 0 2 .1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 1.8 1.8 0 0 0 1.5 1.1h.2V14h-.2a1.8 1.8 0 0 0-1.6 1Z" />
      </svg>
    );
  }

  if (name === 'lock') {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg {...common}>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M12 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      </svg>
    );
  }

  if (name === 'login') {
    return (
      <svg {...common}>
        <path d="M14 7l5 5-5 5" />
        <path d="M19 12H7" />
        <path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
      </svg>
    );
  }

  if (name === 'user') {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }

  if (name === 'close') {
    return (
      <svg {...common}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SidebarNavContent({
  icon,
  children,
  sub = false,
}: {
  icon: SidebarIconName;
  children: ReactNode;
  sub?: boolean;
}) {
  return (
    <>
      <span style={sub ? styles.subNavIcon : styles.navIcon}>
        <SidebarIcon name={icon} size={sub ? 15 : 17} />
      </span>
      <span style={styles.navText}>{children}</span>
    </>
  );
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
  const pathname = usePathname();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [resolvedProfile, setResolvedProfile] = useState<EffectiveProfile | null>(
    normalizeProfile(profile)
  );

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
  const [frontOfficeOpen, setFrontOfficeOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);

  useEffect(() => {
    const next = normalizeProfile(profile);
    setResolvedProfile(next);

    if (!next && typeof window !== 'undefined') {
      const cached = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        try {
          setResolvedProfile(normalizeProfile(JSON.parse(cached) as SidebarProfile));
        } catch {}
      }
    }
  }, [profile]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

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
  const canSeeLostFound =
    effectiveProfile?.role === 'SUPERUSER' ||
    (effectiveProfile?.role === 'FO' && !!effectiveProfile?.can_access_lost_found);

  const showMaintenanceGroup = canSeePM || canSeeMaintenanceOT || canSeeStockCard || canSeeDamaged;
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
  const showFrontOfficeGroup = canSeeLostFound;

  const enabledAccessCount = [
    effectiveProfile?.can_access_preventive_maintenance,
    effectiveProfile?.can_access_maintenance_ot,
    effectiveProfile?.can_access_hk_special_project,
    effectiveProfile?.can_access_chambermaid_entry,
    effectiveProfile?.can_access_supervisor_update,
    effectiveProfile?.can_access_laundry_count,
    effectiveProfile?.can_access_stock_card,
    effectiveProfile?.can_access_damaged,
    effectiveProfile?.can_access_linen_history,
    effectiveProfile?.can_access_daily_forms,
    effectiveProfile?.can_access_management_tasks,
    effectiveProfile?.can_access_admin_settings,
    effectiveProfile?.can_access_lost_found,
    effectiveProfile?.can_create_task,
    effectiveProfile?.can_edit_task,
    effectiveProfile?.can_delete_task,
  ].filter(Boolean).length;

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
    setLogoutBusy(true);
    clearBrowserAuthState();
    setResolvedProfile(null);
    closeSidebar();

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error: any) {
      console.warn('Logout completed with local cache clear after signOut warning:', error?.message || error);
    } finally {
      window.location.replace('/dashboard');
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
    icon,
    open,
    setOpen,
    children,
  }: {
    title: string;
    icon: SidebarIconName;
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
          <span
            style={{
              ...styles.groupChevronIcon,
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            <SidebarIcon name="chevron" size={15} />
          </span>
          <span style={styles.groupBtnLeft}>
            <span style={styles.navIcon}>
              <SidebarIcon name={icon} size={17} />
            </span>
            <span style={styles.navText}>{title}</span>
          </span>
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
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}
      >
        <div style={styles.headerRow}>
          <div style={styles.menuTitle}>
            <span style={styles.menuTitleIcon}>
              <SidebarIcon name="dashboard" size={17} />
            </span>
            <span>Menu</span>
          </div>
          <button
            type="button"
            onClick={closeSidebar}
            style={styles.closeBtn}
            aria-label="Close menu"
          >
            <SidebarIcon name="close" size={18} />
            ✕
          </button>
        </div>

        {!currentProfile ? (
          <div style={styles.loadingBox}>Loading access...</div>
        ) : null}

        <nav style={styles.nav}>
          {canSeeDashboard ? (
            <Link href="/dashboard" prefetch={false} onClick={closeSidebar} style={styles.navBtn}>
              <SidebarNavContent icon="dashboard">Dashboard</SidebarNavContent>
            </Link>
          ) : null}

          {canSeePastTask ? (
            <Link href="/dashboard?view=past" prefetch={false} onClick={closeSidebar} style={styles.navBtn}>
              <SidebarNavContent icon="archive">Past Task</SidebarNavContent>
            </Link>
          ) : null}

          {showMaintenanceGroup ? (
            <GroupSection
              title="Maintenance"
              icon="maintenance"
              open={maintenanceOpen}
              setOpen={setMaintenanceOpen}
            >
              {canSeePM ? (
                <Link
                  href="/dashboard/preventive-maintenance"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="calendar" sub>Preventive Maintenance</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeMaintenanceOT ? (
                <Link
                  href="/dashboard/maintenance-ot"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clock" sub>Maintenance OT</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeStockCard ? (
                <Link
                  href="/dashboard/maintenance-stock-card"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Maintenance Stock Card</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeDamaged ? (
                <Link
                  href="/dashboard/maintenance-damaged"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="alert" sub>Maintenance Damaged</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showHousekeepingGroup ? (
            <GroupSection
              title="Housekeeping"
              icon="housekeeping"
              open={housekeepingOpen}
              setOpen={setHousekeepingOpen}
            >
              {canSeeHkSpecialProject ? (
                <Link
                  href="/dashboard/hk-special-project"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="sparkle" sub>HK Special Project</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeChambermaid ? (
                <Link
                  href="/dashboard/chambermaid-entry"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="bed" sub>Chambermaid Entry</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeSupervisorUpdate ? (
                <Link
                  href="/dashboard/supervisor-update"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="clipboard" sub>Supervisor Update</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeLaundryCount ? (
                <Link
                  href="/dashboard/laundry-count"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="laundry" sub>Laundry Count</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeStockCard ? (
                <Link
                  href="/dashboard/stock-card"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="package" sub>Stock Card</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeDamaged ? (
                <Link
                  href="/dashboard/damaged"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="alert" sub>Damaged Linen</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeLinenHistory ? (
                <Link
                  href="/dashboard/linen-history"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="history" sub>Linen History</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showFrontOfficeGroup ? (
            <GroupSection
              title="Front Office"
              icon="frontOffice"
              open={frontOfficeOpen}
              setOpen={setFrontOfficeOpen}
            >
              {canSeeLostFound ? (
                <Link
                  href="/dashboard/lost-found"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="lostFound" sub>Lost & Found</SidebarNavContent>
                </Link>
              ) : null}
            </GroupSection>
          ) : null}

          {showManagementGroup ? (
            <GroupSection
              title="Management"
              icon="management"
              open={managementOpen}
              setOpen={setManagementOpen}
            >
              {canSeeDailyForms ? (
                <Link
                  href="/dashboard/daily-forms"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="file" sub>Daily Forms</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeManagementTasks ? (
                <Link
                  href="/dashboard/management-tasks"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="list" sub>Management Tasks</SidebarNavContent>
                </Link>
              ) : null}

              {canSeeAdminSettings ? (
                <Link
                  href="/dashboard/admin-settings"
                  prefetch={false}
                  onClick={closeSidebar}
                  style={styles.subNavBtn}
                >
                  <SidebarNavContent icon="settings" sub>Admin Settings</SidebarNavContent>
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
                <div style={styles.userAccessCount}>Access: {enabledAccessCount}/16</div>
              </div>

              <button
                type="button"
                onClick={openPasswordModal}
                style={styles.secondaryAction}
              >
                <span style={styles.actionIcon}>
                  <SidebarIcon name="lock" size={16} />
                </span>
                <span>{isSuperuser ? 'Change User Password' : 'Change Password'}</span>
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
                <span style={styles.actionIcon}>
                  <SidebarIcon name="logout" size={16} />
                </span>
                <span>{logoutBusy ? 'Logging out...' : 'Log Out'}</span>
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
                <span style={styles.actionIcon}>
                  <SidebarIcon name="login" size={16} />
                </span>
                <span>Log In</span>
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
    background: 'rgba(3, 8, 23, 0.56)',
    backdropFilter: 'blur(6px)',
    zIndex: 40,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '280px',
    maxWidth: '86vw',
    height: '100vh',
    background: '#08162f',
    borderRight: '1px solid rgba(148, 163, 184, 0.24)',
    padding: '20px 16px',
    boxSizing: 'border-box',
    overflowY: 'auto',
    zIndex: 50,
    transition: 'transform 0.22s ease',
    boxShadow: '0 18px 44px rgba(15,23,42,0.34)',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  menuTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
  },
  menuTitleIcon: {
    width: '34px',
    height: '34px',
    borderRadius: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(37, 99, 235, 0.20)',
    color: '#93c5fd',
    border: '1px solid rgba(147, 197, 253, 0.26)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  },
  closeBtn: {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    borderRadius: '12px',
    width: '36px',
    height: '36px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    marginBottom: '10px',
    background: 'rgba(255,255,255,0.08)',
    color: '#dbeafe',
    border: '1px solid rgba(147,197,253,0.28)',
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
    gap: '10px',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    fontSize: '14px',
    boxSizing: 'border-box',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  navIcon: {
    width: '30px',
    height: '30px',
    borderRadius: '11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(59, 130, 246, 0.14)',
    color: '#93c5fd',
    border: '1px solid rgba(147, 197, 253, 0.14)',
    flexShrink: 0,
  },
  navText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
    border: '1px solid rgba(148, 163, 184, 0.14)',
    background: 'rgba(255,255,255,0.04)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    fontSize: '14px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  groupBtnLeft: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
    flex: 1,
    order: 1,
  },
  groupChevron: {
    display: 'none',
  },
  groupChevronIcon: {
    color: '#bfdbfe',
    width: '24px',
    height: '24px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'transform 0.18s ease',
    order: 2,
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
    gap: '9px',
    width: '100%',
    textDecoration: 'none',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    background: 'rgba(255,255,255,0.03)',
    color: '#dbeafe',
    borderRadius: '12px',
    padding: '11px 14px',
    fontWeight: 700,
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  subNavIcon: {
    width: '26px',
    height: '26px',
    borderRadius: '10px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.06)',
    color: '#bfdbfe',
    border: '1px solid rgba(147, 197, 253, 0.10)',
    flexShrink: 0,
  },
  footer: {
    marginTop: '20px',
    borderTop: '1px solid rgba(148, 163, 184, 0.18)',
    paddingTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  userBox: {
    border: '1px solid rgba(148, 163, 184, 0.18)',
    borderRadius: '16px',
    padding: '14px',
    background: 'rgba(255,255,255,0.05)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },
  userName: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#ffffff',
  },
  userRole: {
    fontSize: '12px',
    color: '#bfdbfe',
    fontWeight: 700,
    marginTop: '2px',
  },
  userEmail: {
    fontSize: '12px',
    color: '#cbd5e1',
    marginTop: '4px',
    wordBreak: 'break-word',
  },
  userAccessCount: {
    fontSize: '12px',
    color: '#ffffff',
    marginTop: '8px',
    fontWeight: 800,
  },
  secondaryAction: {
    border: '1px solid rgba(191,219,254,0.24)',
    background: 'rgba(255,255,255,0.05)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  primaryAction: {
    border: 'none',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 14px 24px rgba(29,78,216,0.34)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  actionIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '8px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.14)',
    color: '#ffffff',
    flexShrink: 0,
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

