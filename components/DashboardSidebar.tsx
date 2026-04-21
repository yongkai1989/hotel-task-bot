'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

export default function DashboardSidebar() {
  const [profile, setProfile] = useState<any>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const supabase = createBrowserSupabaseClient();

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    setProfile(data);
  }

  function toggleGroup(name: string) {
    setOpenGroup(openGroup === name ? null : name);
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.title}>Dashboard</div>

      {/* MANAGEMENT */}
      {(profile?.role === 'MANAGER' || profile?.role === 'SUPERUSER') && (
        <div>
          <div style={styles.group} onClick={() => toggleGroup('management')}>
            Management
          </div>

          {openGroup === 'management' && (
            <div style={styles.sub}>
              {profile?.can_access_daily_forms && (
                <Link href="/dashboard/daily-forms" style={styles.link}>
                  Daily Forms
                </Link>
              )}

              {profile?.can_access_management_tasks && (
                <Link href="/dashboard/management-tasks" style={styles.link}>
                  Management Tasks
                </Link>
              )}

              {profile?.role === 'SUPERUSER' && (
                <Link href="/dashboard/admin-settings" style={styles.link}>
                  Admin Settings
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* MAINTENANCE */}
      <div>
        <div style={styles.group} onClick={() => toggleGroup('maintenance')}>
          Maintenance
        </div>

        {openGroup === 'maintenance' && (
          <div style={styles.sub}>
            {profile?.can_access_preventive_maintenance && (
              <Link href="/dashboard/preventive-maintenance" style={styles.link}>
                Preventive Maintenance
              </Link>
            )}

            {profile?.can_access_maintenance_ot && (
              <Link href="/dashboard/maintenance-ot" style={styles.link}>
                Maintenance OT
              </Link>
            )}
          </div>
        )}
      </div>

      {/* HOUSEKEEPING */}
      <div>
        <div style={styles.group} onClick={() => toggleGroup('hk')}>
          Housekeeping
        </div>

        {openGroup === 'hk' && (
          <div style={styles.sub}>
            {profile?.can_access_hk_special_project && (
              <Link href="/dashboard/hk-special-project" style={styles.link}>
                HK Special Project
              </Link>
            )}

            {profile?.can_access_chambermaid_entry && (
              <Link href="/dashboard/chambermaid-entry" style={styles.link}>
                Chambermaid Entry
              </Link>
            )}

            {profile?.can_access_supervisor_update && (
              <Link href="/dashboard/supervisor-update" style={styles.link}>
                Supervisor Update
              </Link>
            )}

            {profile?.can_access_laundry_count && (
              <Link href="/dashboard/laundry-count" style={styles.link}>
                Laundry Count
              </Link>
            )}

            {profile?.can_access_stock_card && (
              <Link href="/dashboard/stock-card" style={styles.link}>
                Stock Card
              </Link>
            )}

            {profile?.can_access_damaged && (
              <Link href="/dashboard/damaged" style={styles.link}>
                Damaged
              </Link>
            )}

            {profile?.can_access_linen_history && (
              <Link href="/dashboard/linen-history" style={styles.link}>
                Linen History
              </Link>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

const styles: any = {
  sidebar: {
    width: 250,
    background: '#0f172a',
    color: '#fff',
    height: '100vh',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 800,
    marginBottom: 20,
  },
  group: {
    fontWeight: 700,
    marginTop: 10,
    cursor: 'pointer',
  },
  sub: {
    marginLeft: 10,
    marginTop: 5,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  link: {
    color: '#cbd5f5',
    textDecoration: 'none',
    fontSize: 14,
  },
};
