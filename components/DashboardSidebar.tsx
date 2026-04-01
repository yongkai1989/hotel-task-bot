'use client';

import Link from 'next/link';

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_access_chambermaid_entry?: boolean;
  can_access_linen_admin?: boolean;
};

export default function DashboardSidebar({
  profile,
  sidebarOpen,
  setSidebarOpen,
  isMobile,
}: {
  profile: DashboardUser | null;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  isMobile: boolean;
}) {
  function sidebarItemStyle(active = false): React.CSSProperties {
    return {
      padding: '12px 14px',
      borderRadius: 12,
      border: '1px solid #e5e7eb',
      background: active ? '#0f172a' : '#ffffff',
      color: active ? '#ffffff' : '#0f172a',
      fontWeight: 700,
      textDecoration: 'none',
      display: 'block',
      marginBottom: 8,
    };
  }

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 40,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          position: isMobile ? 'fixed' : 'sticky',
          top: 0,
          left: 0,
          height: '100vh',
          width: 240,
          background: '#ffffff',
          borderRight: '1px solid #e5e7eb',
          padding: 16,
          zIndex: 50,
          transform: isMobile
            ? sidebarOpen
              ? 'translateX(0)'
              : 'translateX(-100%)'
            : 'none',
          transition: '0.2s ease',
        }}
      >
        {/* Title */}
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 16 }}>
          Hallmark Dashboard
        </div>

        {/* Always visible */}
        <Link href="/dashboard" style={sidebarItemStyle()}>
          Dashboard
        </Link>

        <Link href="/dashboard?view=past" style={sidebarItemStyle()}>
          Past Task
        </Link>

        {/* Chambermaid */}
        {profile?.can_access_chambermaid_entry && (
          <Link href="/dashboard/chambermaid-entry" style={sidebarItemStyle()}>
            Chambermaid Entry
          </Link>
        )}

        {/* Linen Admin */}
        {profile?.can_access_linen_admin && (
          <>
            <Link href="/dashboard/supervisor-update" style={sidebarItemStyle()}>
              Supervisor Update
            </Link>

            <Link href="/dashboard/laundry-count" style={sidebarItemStyle()}>
              Laundry Count
            </Link>

            <Link href="/dashboard/stock-card" style={sidebarItemStyle()}>
              Stock Card
            </Link>

            <Link href="/dashboard/damaged" style={sidebarItemStyle()}>
              Damaged
            </Link>

            <Link href="/dashboard/linen-history" style={sidebarItemStyle()}>
              Linen History
            </Link>
          </>
        )}
      </aside>
    </>
  );
}
