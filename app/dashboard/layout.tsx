'use client';

import { ReactNode, useEffect, useState } from 'react';
import DashboardSidebar from '../../components/DashboardSidebar';
import PushNotificationControl from '../../components/PushNotificationControl';
import TaskAlertOverlay from '../../components/TaskAlertOverlay';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';
import { loadDashboardSessionProfile } from '../../lib/dashboardSessionProfileClient';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
  can_access_preventive_maintenance?: boolean;
  can_access_maintenance_manager_room_check?: boolean;
  can_access_maintenance_ot?: boolean;
  can_access_maintenance_stock_card?: boolean;
  can_access_maintenance_damaged?: boolean;
  can_access_hk_schedule?: boolean;
  can_access_hk_special_project?: boolean;
  can_access_hk_manager_room_check?: boolean;
  can_access_chambermaid_entry?: boolean;
  chambermaid_access_until?: string | null;
  can_access_supervisor_update?: boolean;
  can_access_laundry_count?: boolean;
  can_access_laundry_received?: boolean;
  can_access_stock_card?: boolean;
  can_access_damaged?: boolean;
  can_access_linen_history?: boolean;
  can_access_daily_forms?: boolean;
  can_access_management_tasks?: boolean;
  can_access_online_purchasing?: boolean;
  can_access_daily_operations_summary?: boolean;
  can_access_bank_in_cash?: boolean;
  can_access_admin_settings?: boolean;
  can_access_linen_admin?: boolean;
  can_access_lost_found?: boolean;
  can_access_fo_checklist?: boolean;
  can_access_fo_quick_actions?: boolean;
  can_access_fo_schedule?: boolean;
  can_access_supervisor_checklist?: boolean;
  can_access_guest_shop_orders?: boolean;
  permissions?: Partial<Record<
    | 'can_create_task'
    | 'can_edit_task'
    | 'can_delete_task'
    | 'can_access_preventive_maintenance'
    | 'can_access_maintenance_manager_room_check'
    | 'can_access_maintenance_ot'
    | 'can_access_maintenance_stock_card'
    | 'can_access_maintenance_damaged'
    | 'can_access_hk_schedule'
    | 'can_access_hk_special_project'
    | 'can_access_hk_manager_room_check'
    | 'can_access_chambermaid_entry'
    | 'can_access_supervisor_update'
    | 'can_access_laundry_count'
    | 'can_access_laundry_received'
    | 'can_access_stock_card'
    | 'can_access_damaged'
    | 'can_access_linen_history'
    | 'can_access_daily_forms'
    | 'can_access_management_tasks'
    | 'can_access_online_purchasing'
    | 'can_access_daily_operations_summary'
    | 'can_access_bank_in_cash'
    | 'can_access_admin_settings'
    | 'can_access_linen_admin'
    | 'can_access_lost_found'
    | 'can_access_fo_checklist'
    | 'can_access_fo_quick_actions'
    | 'can_access_fo_schedule'
    | 'can_access_breakfast_vouchers'
    | 'can_access_staff_meal'
    | 'can_access_supervisor_checklist'
    | 'can_access_guest_shop_orders',
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
        const supabase = getSupabaseSafe();
        if (!supabase) return;

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token || !mounted) {
          setProfile(null);
          return;
        }

        const nextProfile = await loadDashboardSessionProfile<DashboardUser>(session.access_token);
        if (!mounted) return;
        setProfile(nextProfile);
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
        background: 'linear-gradient(180deg, #f4f8ff 0%, #eef4fb 100%)',
      }}
    >
      <DashboardSidebar
        profile={profile}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <TaskAlertOverlay userId={profile?.user_id} />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: '18px 18px 40px',
        }}
      >
        <div
          style={{
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              border: '1px solid #d7e3f2',
              background: 'rgba(255,255,255,0.92)',
              color: '#0f172a',
              borderRadius: 14,
              padding: '12px 16px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>||</span>
            <span>Menu</span>
          </button>
          <PushNotificationControl userId={profile?.user_id} />
        </div>

        {children}
      </main>
    </div>
  );
}
