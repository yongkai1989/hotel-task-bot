'use client';

import { ReactNode, useEffect, useState } from 'react';
import DashboardSidebar from '../../components/DashboardSidebar';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';

type DashboardUser = {
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
    | 'can_access_linen_admin',
    unknown
  >>;
};

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

const PROFILE_CACHE_KEY = 'dashboard-session-profile';

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const cached =
          typeof window !== 'undefined'
            ? window.sessionStorage.getItem(PROFILE_CACHE_KEY)
            : null;

        if (cached && mounted) {
          try {
            setProfile(JSON.parse(cached) as DashboardUser);
          } catch {}
        }

        const supabase = getSupabaseSafe();
        if (!supabase) return;

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token || !mounted) {
          setProfile(null);
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

        if (!mounted) return;

        if (res.ok && json?.ok && json?.user) {
          const nextProfile = json.user as DashboardUser;
          setProfile(nextProfile);
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(nextProfile));
          }
        } else {
          setProfile(null);
          if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
          }
        }
      } catch {
        if (mounted) setProfile(null);
      }
    }

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: '#f8fafc',
      }}
    >
      <DashboardSidebar
        profile={profile}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: '20px 16px 40px',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            style={{
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 12,
              padding: '12px 16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ☰ Menu
          </button>
        </div>

        {children}
      </main>
    </div>
  );
}
