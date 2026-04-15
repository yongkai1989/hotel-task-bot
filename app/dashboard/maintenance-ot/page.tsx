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

type MaintenanceOtEntry = {
  id: string;
  staff_name: string;
  ot_date: string;
  start_time: string;
  end_time: string;
  total_hours: number;
  reason: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const STAFF_OPTIONS = [
  'Izzuddin',
  'Yazid',
  'Panjang',
  'Jimmy',
  'Paiz',
  'Ezwan',
  'Harraz',
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

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function calculateHours(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;

  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  if (
    Number.isNaN(startHour) ||
    Number.isNaN(startMin) ||
    Number.isNaN(endHour) ||
    Number.isNaN(endMin)
  ) {
    return 0;
  }

  const startTotal = startHour * 60 + startMin;
  const endTotal = endHour * 60 + endMin;

  if (endTotal <= startTotal) return 0;

  const diffMinutes = endTotal - startTotal;
  const hours = diffMinutes / 60;

  return Math.round(hours * 100) / 100;
}

export default function MaintenanceOtPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [entries, setEntries] = useState<MaintenanceOtEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [staffName, setStaffName] = useState<string>('');
  const [otDate, setOtDate] = useState<string>(getTodayLocalDateString());
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) {
          throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        }

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
          role: (profileRow?.role || 'MT') as DashboardUser['role'],
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
    return (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'MT'
    );
  }, [profile]);

  const totalHours = useMemo(() => {
    return calculateHours(startTime, endTime);
  }, [startTime, endTime]);

  const needsReason = totalHours > 3;

  async function loadEntries() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setPageLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { data, error } = await supabase
        .from('maintenance_ot_entries')
        .select('*')
        .order('ot_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      setEntries((data || []) as MaintenanceOtEntry[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load OT entries');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setPageLoading(false);
      return;
    }

    void loadEntries();
  }, [profile, canAccess]);

  function resetForm() {
    setEditingId(null);
    setStaffName('');
    setOtDate(getTodayLocalDateString());
    setStartTime('');
    setEndTime('');
    setReason('');
  }

  async function sendTelegramIfNeeded(name: string, hours: number, submitReason: string) {
    if (hours <= 3) return;

    const res = await fetch('/api/maintenance-ot-telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hours, reason: submitReason }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || 'Failed to send Telegram alert');
    }
  }

  async function handleSubmit() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const trimmedStaff = staffName.trim();
    const trimmedReason = reason.trim();

    if (!trimmedStaff) {
      setErrorMsg('Please select a staff name.');
      return;
    }

    if (!otDate) {
      setErrorMsg('Please select OT date.');
      return;
    }

    if (!startTime) {
      setErrorMsg('Please select start time.');
      return;
    }

    if (!endTime) {
      setErrorMsg('Please select end time.');
      return;
    }

    if (totalHours <= 0) {
      setErrorMsg('End time must be later than start time.');
      return;
    }

    if (needsReason && !trimmedReason) {
      setErrorMsg('Reason is required for OT exceeding 3 hours.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (editingId) {
        const { error } = await supabase
          .from('maintenance_ot_entries')
          .update({
            staff_name: trimmedStaff,
            ot_date: otDate,
            start_time: startTime,
            end_time: endTime,
            total_hours: totalHours,
            reason: trimmedReason || null,
          })
          .eq('id', editingId);

        if (error) throw error;

        await sendTelegramIfNeeded(trimmedStaff, totalHours, trimmedReason);

        setSuccessMsg('OT entry updated successfully.');
      } else {
        const { error } = await supabase
          .from('maintenance_ot_entries')
          .insert([
            {
              staff_name: trimmedStaff,
              ot_date: otDate,
              start_time: startTime,
              end_time: endTime,
              total_hours: totalHours,
              reason: trimmedReason || null,
              created_by_user_id: profile.user_id,
              created_by_name: profile.name || profile.email,
            },
          ]);

        if (error) throw error;

        await sendTelegramIfNeeded(trimmedStaff, totalHours, trimmedReason);

        setSuccessMsg('OT entry submitted successfully.');
      }

      resetForm();
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save OT entry');
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(entry: MaintenanceOtEntry) {
    setEditingId(entry.id);
    setStaffName(entry.staff_name);
    setOtDate(entry.ot_date);
    setStartTime(entry.start_time);
    setEndTime(entry.end_time);
    setReason(entry.reason || '');
    setErrorMsg('');
    setSuccessMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(entry: MaintenanceOtEntry) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    const confirmed = window.confirm(
      `Delete OT entry for ${entry.staff_name} on ${formatDate(entry.ot_date)}?`
    );
    if (!confirmed) return;

    try {
      setDeletingId(entry.id);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('maintenance_ot_entries')
        .delete()
        .eq('id', entry.id);

      if (error) throw error;

      if (editingId === entry.id) {
        resetForm();
      }

      setSuccessMsg('OT entry deleted.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete OT entry');
    } finally {
      setDeletingId(null);
    }
  }

  const overThreeCount = useMemo(() => {
    return entries.filter((entry) => safeNumber(entry.total_hours) > 3).length;
  }, [entries]);

  if (authLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>You do not have permission to access Maintenance OT.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Maintenance OT</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) · Record and manage maintenance overtime
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Total Entries</div>
            <div style={styles.summaryValue}>{entries.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Above 3 Hours</div>
            <div style={{ ...styles.summaryValue, color: '#b91c1c' }}>{overThreeCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Current Hours</div>
            <div style={styles.summaryValue}>{totalHours.toFixed(2)}</div>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>
            {editingId ? 'Edit OT Entry' : 'Add OT Entry'}
          </div>

          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Staff Name</label>
              <select
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                style={styles.select}
                disabled={saving}
              >
                <option value="">Select staff</option>
                {STAFF_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>OT Date</label>
              <input
                type="date"
                value={otDate}
                onChange={(e) => setOtDate(e.target.value)}
                style={styles.input}
                disabled={saving}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>From</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={styles.input}
                disabled={saving}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>To</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={styles.input}
                disabled={saving}
              />
            </div>
          </div>

          <div style={styles.hoursBar}>
            <div style={styles.hoursBox}>
              <span style={styles.hoursLabel}>Total OT Hours</span>
              <span style={styles.hoursValue}>{totalHours.toFixed(2)}</span>
            </div>

            {needsReason ? (
              <div style={styles.alertPill}>Reason required for OT above 3 hours</div>
            ) : null}
          </div>

          {needsReason ? (
            <div style={styles.formGroup}>
              <label style={styles.label}>Reason for Exceeding 3 Hours</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={styles.textarea}
                placeholder="This field is compulsory when OT exceeds 3 hours"
                disabled={saving}
              />
            </div>
          ) : (
            <div style={styles.formGroup}>
              <label style={styles.label}>Reason (Optional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={styles.textarea}
                placeholder="Optional if OT is 3 hours or below"
                disabled={saving}
              />
            </div>
          )}

          <div style={styles.actionRow}>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                style={styles.secondaryActionBtn}
                disabled={saving}
              >
                Cancel Edit
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              style={styles.primaryBtn}
              disabled={saving}
            >
              {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Submit Entry'}
            </button>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>OT Entries</div>

          {pageLoading ? (
            <div style={styles.emptyState}>Loading OT entries...</div>
          ) : entries.length === 0 ? (
            <div style={styles.emptyState}>No OT entries yet.</div>
          ) : (
            <div style={styles.cardsWrap}>
              {entries.map((entry) => (
                <article key={entry.id} style={styles.entryCard}>
                  <div style={styles.entryTopRow}>
                    <div>
                      <div style={styles.entryTitle}>{entry.staff_name}</div>
                      <div style={styles.entrySubTitle}>
                        {formatDate(entry.ot_date)} · {entry.start_time} - {entry.end_time}
                      </div>
                    </div>

                    <div
                      style={{
                        ...styles.hourBadge,
                        ...(safeNumber(entry.total_hours) > 3
                          ? styles.hourBadgeAlert
                          : styles.hourBadgeNormal),
                      }}
                    >
                      {safeNumber(entry.total_hours).toFixed(2)} hrs
                    </div>
                  </div>

                  <div style={styles.metaGrid}>
                    <div style={styles.metaItem}>
                      <div style={styles.metaLabel}>Created By</div>
                      <div style={styles.metaValue}>{entry.created_by_name || '-'}</div>
                    </div>
                    <div style={styles.metaItem}>
                      <div style={styles.metaLabel}>Created At</div>
                      <div style={styles.metaValue}>{formatDateTime(entry.created_at)}</div>
                    </div>
                  </div>

                  {entry.reason ? (
                    <div style={styles.reasonBox}>
                      <div style={styles.reasonLabel}>Reason</div>
                      <div style={styles.reasonText}>{entry.reason}</div>
                    </div>
                  ) : null}

                  <div style={styles.cardActions}>
                    <button
                      type="button"
                      onClick={() => handleEdit(entry)}
                      style={styles.secondaryActionBtn}
                      disabled={saving}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDelete(entry)}
                      style={styles.deleteBtn}
                      disabled={deletingId === entry.id}
                    >
                      {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
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
    padding: '20px 16px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
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
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '22px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
    alignItems: 'end',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '14px',
  },
  label: {
    fontSize: '14px',
    color: '#334155',
    fontWeight: 700,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '110px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
  },
  hoursBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  hoursBox: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    borderRadius: '14px',
    padding: '12px 14px',
  },
  hoursLabel: {
    fontSize: '14px',
    color: '#1e3a8a',
    fontWeight: 700,
  },
  hoursValue: {
    fontSize: '22px',
    color: '#1d4ed8',
    fontWeight: 800,
  },
  alertPill: {
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 800,
    fontSize: '13px',
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '6px',
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
  secondaryActionBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: '1px solid #ef4444',
    background: '#fff',
    color: '#ef4444',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
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
  cardsWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '12px',
  },
  entryCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
  },
  entryTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
  },
  entryTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  entrySubTitle: {
    fontSize: '14px',
    color: '#475569',
    marginTop: '6px',
  },
  hourBadge: {
    borderRadius: '999px',
    padding: '8px 12px',
    fontWeight: 800,
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  hourBadgeNormal: {
    background: '#ecfdf5',
    color: '#166534',
  },
  hourBadgeAlert: {
    background: '#fef2f2',
    color: '#b91c1c',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginTop: '14px',
  },
  metaItem: {
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '10px',
    background: '#f8fafc',
  },
  metaLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '4px',
  },
  metaValue: {
    fontSize: '14px',
    color: '#0f172a',
    fontWeight: 800,
    wordBreak: 'break-word',
  },
  reasonBox: {
    marginTop: '12px',
    border: '1px solid #fde68a',
    background: '#fffbeb',
    borderRadius: '12px',
    padding: '12px 14px',
  },
  reasonLabel: {
    fontSize: '12px',
    color: '#92400e',
    fontWeight: 800,
    marginBottom: '4px',
  },
  reasonText: {
    fontSize: '14px',
    color: '#78350f',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  cardActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '14px',
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
