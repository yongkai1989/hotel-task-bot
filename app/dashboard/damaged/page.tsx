'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
};

type DamageRow = {
  id: string;
  linen_type: string;
  qty: number;
  notes?: string | null;
  updated_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const LINEN_TYPES = [
  'Bedsheet King',
  'Pillow Case',
  'Bath Towel',
  'Bath Mat',
  'Duvet Cover King',
  'Duvet Cover Single',
] as const;

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

export default function DamagedPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [selectedDate, setSelectedDate] = useState(getTodayLocalDateString());
  const [damageRows, setDamageRows] = useState<DamageRow[]>([]);

  const [formLinenType, setFormLinenType] = useState<string>(LINEN_TYPES[0]);
  const [formQty, setFormQty] = useState<string>('');
  const [formNotes, setFormNotes] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'HK') as DashboardUser['role'],
        });
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER' || profile.role === 'SUPERVISOR';
  }, [profile]);

  async function loadDamageRows() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const { data, error } = await supabase
        .from('linen_damage_log')
        .select('id, linen_type, qty, notes, updated_by_name, created_at, updated_at, log_date')
        .eq('log_date', selectedDate)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDamageRows((data || []) as DamageRow[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load damage log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }
    void loadDamageRows();
  }, [profile, canAccess, selectedDate]);

  function resetForm() {
    setEditingId(null);
    setFormLinenType(LINEN_TYPES[0]);
    setFormQty('');
    setFormNotes('');
  }

  async function submitDamage() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const qty = Math.max(0, safeNumber(formQty));
    if (!formLinenType) {
      setErrorMsg('Please select a linen type.');
      return;
    }
    if (qty <= 0) {
      setErrorMsg('Please enter a damage quantity above 0.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (editingId) {
        const { error } = await supabase
          .from('linen_damage_log')
          .update({
            linen_type: formLinenType,
            qty,
            notes: formNotes.trim() || null,
            updated_by_user_id: profile.user_id,
            updated_by_name: profile.name || profile.email,
            log_date: selectedDate,
          })
          .eq('id', editingId);

        if (error) throw error;
        setSuccessMsg('Damage entry updated.');
      } else {
        const { error } = await supabase
          .from('linen_damage_log')
          .insert([
            {
              linen_type: formLinenType,
              qty,
              notes: formNotes.trim() || null,
              log_date: selectedDate,
              updated_by_user_id: profile.user_id,
              updated_by_name: profile.name || profile.email,
            },
          ]);

        if (error) throw error;
        setSuccessMsg('Damage entry submitted.');
      }

      resetForm();
      await loadDamageRows();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save damage entry');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: DamageRow) {
    setEditingId(row.id);
    setFormLinenType(row.linen_type);
    setFormQty(String(row.qty));
    setFormNotes(row.notes || '');
    setSuccessMsg('');
    setErrorMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteRow(rowId: string) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase.from('linen_damage_log').delete().eq('id', rowId);
      if (error) throw error;

      if (editingId === rowId) resetForm();
      setSuccessMsg('Damage entry deleted.');
      await loadDamageRows();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete damage entry');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <main style={styles.page}><div style={styles.centerCard}>Loading...</div></main>;
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>Only Supervisor, Manager, and Superuser can access Damaged.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Damaged</div>
            <div style={styles.pageSubTitle}>{profile.name} ({profile.role})</div>
          </div>
          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>{editingId ? 'Edit Damage' : 'Add Damage'}</div>

          <div style={styles.formGrid}>
            <div style={styles.fieldWrap}>
              <label style={styles.label}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={styles.input}
                disabled={saving}
              />
            </div>

            <div style={styles.fieldWrap}>
              <label style={styles.label}>Linen Type</label>
              <select
                value={formLinenType}
                onChange={(e) => setFormLinenType(e.target.value)}
                style={styles.input}
                disabled={saving}
              >
                {LINEN_TYPES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldWrap}>
              <label style={styles.label}>Quantity</label>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={formQty}
                onChange={(e) => setFormQty(e.target.value)}
                placeholder="Enter quantity"
                style={styles.input}
                disabled={saving}
              />
            </div>
          </div>

          <div style={{ ...styles.fieldWrap, marginTop: 14 }}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Optional notes"
              style={styles.textarea}
              disabled={saving}
            />
          </div>

          <div style={styles.actionRow}>
            <button
              type="button"
              onClick={submitDamage}
              disabled={saving}
              style={{ ...styles.primaryBtn, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Submit Damage'}
            </button>

            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                style={styles.secondaryGhostBtn}
              >
                Cancel Edit
              </button>
            ) : null}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Damage Log</div>

          {loading ? (
            <div style={styles.emptyState}>Loading damage log...</div>
          ) : damageRows.length === 0 ? (
            <div style={styles.emptyState}>No damage entries for this date.</div>
          ) : (
            <div style={styles.logList}>
              {damageRows.map((row) => (
                <article key={row.id} style={styles.logCard}>
                  <div style={styles.logHeader}>
                    <div style={styles.logInfo}>
                      <div style={styles.logTitle}>{row.linen_type}</div>
                      <div style={styles.logMeta}>Qty: {row.qty}</div>
                      <div style={styles.logMeta}>By: {row.updated_by_name || '-'}</div>
                      <div style={styles.logMeta}>{formatDateTime(row.updated_at || row.created_at)}</div>
                    </div>

                    <div style={styles.logActions}>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        disabled={saving}
                        style={styles.editBtn}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteRow(row.id)}
                        disabled={saving}
                        style={styles.deleteBtn}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {row.notes ? <div style={styles.notesBox}>{row.notes}</div> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px 14px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '980px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '22px',
    padding: '18px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '16px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '14px',
  },
  fieldWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  },
  label: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
  },
  input: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  textarea: {
    width: '100%',
    minHeight: '120px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  actionRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '16px',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryGhostBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
  logList: {
    display: 'grid',
    gap: '12px',
  },
  logCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '16px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  logInfo: {
    minWidth: 0,
    flex: 1,
  },
  logTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
    marginBottom: '8px',
    wordBreak: 'break-word',
  },
  logMeta: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 600,
    marginTop: '3px',
    wordBreak: 'break-word',
  },
  logActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  editBtn: {
    border: '1px solid #2563eb',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: '1px solid #dc2626',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  notesBox: {
    marginTop: '12px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '12px 14px',
    color: '#334155',
    fontSize: '14px',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 600,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  centerText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
};
