'use client';

import Link from 'next/link';

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_access_chambermaid_entry?: boolean;
  can_access_linen_admin?: boolean;
};

type SidebarView = 'DASHBOARD' | 'PAST_TASK';

export default function DashboardSidebar({
  profile,
  sidebarOpen,
  setSidebarOpen,
  isMobile,
  activeView = 'DASHBOARD',
}: {
  profile: DashboardUser | null;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean) => void;
  isMobile: boolean;
  activeView?: SidebarView;
}) {
  const canSeeChambermaid =
    !!profile &&
    (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR' ||
      profile.can_access_chambermaid_entry === true
    );

  const canSeeLinenAdmin =
    !!profile &&
    (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR' ||
      profile.can_access_linen_admin === true
    );

  function closeMobileSidebar() {
    if (isMobile) setSidebarOpen(false);
  }

  function sidebarItemStyle(active: boolean): React.CSSProperties {
    return {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      textDecoration: 'none',
      border: '1px solid',
      borderColor: active ? '#0f172a' : '#e5e7eb',
      background: active ? '#0f172a' : '#ffffff',
      color: active ? '#ffffff' : '#0f172a',
      borderRadius: '12px',
      padding: '12px 14px',
      fontWeight: 700,
      fontSize: '14px',
      marginBottom: '8px',
    };
  }

  return (
    <>
      {/* Overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
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
          width: '260px',
          minWidth: '260px',
          height: '100vh',
          background: '#ffffff',
          borderRight: '1px solid #e5e7eb',
          padding: '18px 14px',
          overflowY: 'auto',
          zIndex: 50,
          transform: isMobile
            ? sidebarOpen
              ? 'translateX(0)'
              : 'translateX(-100%)'
            : 'translateX(0)',
          transition: 'transform 0.22s ease',
        }}
      >
        {/* LOGO + HEADER */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ fontSize: '20px', fontWeight: 900 }}>
            Hallmark Crown Hotel
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Operations PMS
          </div>
        </div>

        {/* NAV */}
        <nav>
          <Link
            href="/dashboard"
            onClick={closeMobileSidebar}
            style={sidebarItemStyle(activeView === 'DASHBOARD')}
          >
            Dashboard
          </Link>

          <Link
            href="/dashboard?view=past"
            onClick={closeMobileSidebar}
            style={sidebarItemStyle(activeView === 'PAST_TASK')}
          >
            Past Task
          </Link>

          {canSeeChambermaid && (
            <Link
              href="/dashboard/chambermaid-entry"
              onClick={closeMobileSidebar}
              style={sidebarItemStyle(false)}
            >
              Chambermaid Entry
            </Link>
          )}

          {canSeeLinenAdmin && (
            <>
              <Link
                href="/dashboard/supervisor-update"
                onClick={closeMobileSidebar}
                style={sidebarItemStyle(false)}
              >
                Supervisor Update
              </Link>

              <Link
                href="/dashboard/laundry-count"
                onClick={closeMobileSidebar}
                style={sidebarItemStyle(false)}
              >
                Laundry Count
              </Link>

              <Link
                href="/dashboard/stock-card"
                onClick={closeMobileSidebar}
                style={sidebarItemStyle(false)}
              >
                Stock Card
              </Link>

              <Link
                href="/dashboard/damaged"
                onClick={closeMobileSidebar}
                style={sidebarItemStyle(false)}
              >
                Damaged
              </Link>

              <Link
                href="/dashboard/linen-history"
                onClick={closeMobileSidebar}
                style={sidebarItemStyle(false)}
              >
                Linen History
              </Link>
            </>
          )}
        </nav>

        {/* USER PANEL */}
        <div style={{ marginTop: '20px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
          <div style={{ fontWeight: 700 }}>{profile?.name}</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {profile?.role}
          </div>

          <button style={{ marginTop: '10px', width: '100%' }}>
            Change Password
          </button>

          <button style={{ marginTop: '8px', width: '100%' }}>
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
