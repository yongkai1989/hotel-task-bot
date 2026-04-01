'use client';

import { ReactNode, useEffect, useState } from 'react';
import DashboardSidebar from '../../components/DashboardSidebar';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_access_chambermaid_entry?: boolean;
  can_access_linen_admin?: boolean;
};

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 920;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) return;

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token || !mounted) {
          setProfile(null);
          return;
        }

        const res = await fetch('/api/session-profile', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: 'no-store',
        });

        const json = await res.json();

        if (!mounted) return;

        if (res.ok && json?.ok && json?.user) {
          setProfile(json.user);
        } else {
          setProfile(null);
        }
      } catch {
        if (mounted) setProfile(null);
      }
    }

    loadProfile();

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
