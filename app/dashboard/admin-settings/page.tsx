'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type UserProfile = {
  user_id: string;
  email: string;
  name: string;
  role: string;

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

export default function AdminSettingsPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const supabase = createBrowserSupabaseClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return;

    const { data: me } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    setProfile(me);

    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    setUsers(data || []);
    setLoading(false);
  }

  if (!profile || profile.role !== 'SUPERUSER') {
    return <div style={{ padding: 40 }}>Access denied</div>;
  }

  async function updateUser(user: UserProfile) {
    setMsg('Saving...');

    const res = await fetch('/api/admin/update-user-profile', {
      method: 'POST',
      body: JSON.stringify(user),
    });

    const data = await res.json();

    if (data.ok !== false) {
      setMsg('Saved');
    } else {
      setMsg(data.error);
    }
  }

  async function deleteUser(user_id: string) {
    if (!confirm('Delete this user?')) return;

    await fetch('/api/admin/delete-user', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    });

    loadData();
  }

  function toggle(user: any, key: string) {
    const updated = { ...user, [key]: !user[key] };
    setUsers((prev) =>
      prev.map((u) => (u.user_id === user.user_id ? updated : u))
    );
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Admin Settings</h1>
      <p style={styles.subtitle}>User & Access Control</p>

      {msg && <div style={styles.msg}>{msg}</div>}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div style={styles.grid}>
          {users.map((user) => (
            <div key={user.user_id} style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.name}>{user.name}</div>
                  <div style={styles.email}>{user.email}</div>
                </div>

                <button
                  style={styles.deleteBtn}
                  onClick={() => deleteUser(user.user_id)}
                >
                  Delete
                </button>
              </div>

              <select
                value={user.role}
                onChange={(e) => {
                  user.role = e.target.value;
                  setUsers([...users]);
                }}
                style={styles.select}
              >
                <option>SUPERUSER</option>
                <option>MANAGER</option>
                <option>SUPERVISOR</option>
                <option>HK</option>
                <option>MT</option>
                <option>FO</option>
              </select>

              <div style={styles.section}>
                <div style={styles.sectionTitle}>Page Access</div>

                {[
                  'can_access_preventive_maintenance',
                  'can_access_maintenance_ot',
                  'can_access_hk_special_project',
                  'can_access_chambermaid_entry',
                  'can_access_supervisor_update',
                  'can_access_laundry_count',
                  'can_access_stock_card',
                  'can_access_damaged',
                  'can_access_linen_history',
                  'can_access_daily_forms',
                  'can_access_management_tasks',
                  'can_access_admin_settings',
                ].map((key) => (
                  <label key={key} style={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={(user as any)[key]}
                      onChange={() => toggle(user, key)}
                    />
                    {key.replace('can_access_', '')}
                  </label>
                ))}
              </div>

              <div style={styles.section}>
                <div style={styles.sectionTitle}>Permissions</div>

                {['can_create_task', 'can_edit_task', 'can_delete_task'].map(
                  (key) => (
                    <label key={key} style={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={(user as any)[key]}
                        onChange={() => toggle(user, key)}
                      />
                      {key}
                    </label>
                  )
                )}
              </div>

              <button
                style={styles.saveBtn}
                onClick={() => updateUser(user)}
              >
                Save Changes
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

const styles: any = {
  page: {
    padding: 20,
    background: '#f8fafc',
    minHeight: '100vh',
  },
  title: { fontSize: 28, fontWeight: 800 },
  subtitle: { color: '#64748b', marginBottom: 20 },
  grid: {
    display: 'grid',
    gap: 16,
  },
  card: {
    background: '#fff',
    padding: 16,
    borderRadius: 16,
    border: '1px solid #e2e8f0',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  name: { fontWeight: 700 },
  email: { fontSize: 12, color: '#64748b' },
  section: { marginTop: 10 },
  sectionTitle: { fontWeight: 700, marginBottom: 6 },
  toggle: {
    display: 'flex',
    gap: 8,
    fontSize: 12,
  },
  saveBtn: {
    marginTop: 10,
    background: '#0f172a',
    color: '#fff',
    padding: 10,
    borderRadius: 10,
  },
  deleteBtn: {
    background: '#ef4444',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: 8,
  },
  select: {
    width: '100%',
    padding: 8,
    borderRadius: 8,
    marginTop: 6,
  },
  msg: {
    background: '#ecfdf5',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
};
