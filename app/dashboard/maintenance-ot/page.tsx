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

type ViewMode = 'ENTRY' | 'PAST' | 'REPORT';

const STAFF_OPTIONS = [
  'Izzuddin',
  'Yazid',
  'Panjang',
  'Jimmy',
  'Paiz',
  'Ezwan',
  'Harraz',
] as const;

const TIME_OPTIONS = [
  '00:00', '00:30', '01:00', '01:30', '02:00', '02:30',
  '03:00', '03:30', '04:00', '04:30', '05:00', '05:30',
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30',
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

function getYesterdayLocalDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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

  return Math.round(((endTotal - startTotal) / 60) * 100) / 100;
}

function formatHours(hours: number) {
  return safeNumber(hours).toFixed(2);
}

function monthRange(monthStr: string) {
  const [yearStr, monthStrNum] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStrNum);
  if (!year || !month) {
    return { start: '', end: '' };
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  return { start, end };
}

export default function MaintenanceOtPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('ENTRY');

  const [entries, setEntries] = useState<MaintenanceOtEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [staffName, setStaffName] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const [pastDate, setPastDate] = useState<string>(getYesterdayLocalDateString());
  const [reportMonth, setReportMonth] = useState<string>(getCurrentMonthString());

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
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER' || profile.role === 'MT';
  }, [profile]);

  const totalHours = useMemo(() => calculateHours(startTime, endTime), [startTime, endTime]);
  const needsReason = totalHours > 3;
  const today = getTodayLocalDateString();

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
            ot_date: today,
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
              ot_date: today,
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
    setStartTime(entry.start_time);
    setEndTime(entry.end_time);
    setReason(entry.reason || '');
    setViewMode('ENTRY');
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

    const confirmed = window.confirm(`Delete OT entry for ${entry.staff_name} on ${formatDate(entry.ot_date)}?`);
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

  const todayEntries = useMemo(() => entries.filter((entry) => entry.ot_date === today), [entries, today]);
  const pastEntries = useMemo(() => entries.filter((entry) => entry.ot_date === pastDate), [entries, pastDate]);

  const reportEntries = useMemo(() => {
    const { start, end } = monthRange(reportMonth);
    if (!start || !end) return [];
    return entries.filter((entry) => entry.ot_date >= start && entry.ot_date <= end);
  }, [entries, reportMonth]);

  const reportSummary = useMemo(() => {
    const grouped = new Map();

    for (const entry of reportEntries) {
      const existing = grouped.get(entry.staff_name) || { totalHours: 0, entries: [] };
      existing.totalHours += safeNumber(entry.total_hours);
      existing.entries.push(entry);
      grouped.set(entry.staff_name, existing);
    }

    return Array.from(grouped.entries())
      .map(([staffName, data]: any) => ({
        staffName,
        totalHours: Math.round(data.totalHours * 100) / 100,
        entries: data.entries.sort((a: MaintenanceOtEntry, b: MaintenanceOtEntry) => {
          const aKey = `${a.ot_date} ${a.start_time}`;
          const bKey = `${b.ot_date} ${b.start_time}`;
          return aKey.localeCompare(bKey);
        }),
      }))
      .sort((a, b) => a.staffName.localeCompare(b.staffName));
  }, [reportEntries]);

  function handleDownloadReport() {
    const reportWindow = window.open('', '_blank', 'width=1000,height=800');
    if (!reportWindow) {
      setErrorMsg('Popup blocked. Please allow popups to download report.');
      return;
    }

    const rows = reportSummary.length
      ? reportSummary.map((staff) =>
          staff.entries.map((entry) => `
            <tr>
              <td>${entry.staff_name}</td>
              <td>${formatDate(entry.ot_date)}</td>
              <td>${entry.start_time}</td>
              <td>${entry.end_time}</td>
              <td>${formatHours(entry.total_hours)}</td>
              <td>${entry.reason || '-'}</td>
              <td>${formatHours(staff.totalHours)}</td>
            </tr>
          `).join('')
        ).join('')
      : '<tr><td colspan="7" style="text-align:center;">No entries for this month.</td></tr>';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Maintenance OT Report ${reportMonth}</title>
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111827; }
          h1 { margin: 0 0 8px; font-size: 26px; }
          .sub { margin: 0 0 18px; color: #475569; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-weight: 700; }
          .totals { margin: 0 0 18px; font-size: 14px; font-weight: 700; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>Maintenance OT Monthly Report</h1>
        <div class="sub">Month: ${reportMonth}</div>
        <div class="totals">Total Entries: ${reportEntries.length}</div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>OT Hours</th>
              <th>Reason</th>
              <th>Total OT This Month</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <script>window.onload = function(){ window.print(); };</script>
      </body>
      </html>
    `;

    reportWindow.document.open();
    reportWindow.document.write(html);
    reportWindow.document.close();
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
          <p style={styles.centerText}>You do not have permission to access Maintenance OT.</p>
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
            <div style={styles.pageTitle}>Maintenance OT</div>
            <div style={styles.pageSubTitle}>{profile.name} ({profile.role}) · Record and manage maintenance overtime</div>
          </div>
          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Today Entries</div>
            <div style={styles.summaryValue}>{todayEntries.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Above 3 Hours</div>
            <div style={{ ...styles.summaryValue, color: '#b91c1c' }}>{overThreeCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Selected Past Date</div>
            <div style={styles.summaryValueSmall}>{formatDate(pastDate)}</div>
          </div>
        </div>

        <section style={styles.panel}>
          <div style={styles.modeRow}>
            <button type="button" onClick={() => setViewMode('ENTRY')} style={{ ...styles.modeBtn, ...(viewMode === 'ENTRY' ? styles.modeBtnActive : {}) }}>Entry</button>
            <button type="button" onClick={() => setViewMode('PAST')} style={{ ...styles.modeBtn, ...(viewMode === 'PAST' ? styles.modeBtnActive : {}) }}>Past Entries</button>
            <button type="button" onClick={() => setViewMode('REPORT')} style={{ ...styles.modeBtn, ...(viewMode === 'REPORT' ? styles.modeBtnActive : {}) }}>Report</button>
          </div>
        </section>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        {viewMode === 'ENTRY' ? (
          <>
            <section style={styles.panel}>
              <div style={styles.sectionTitle}>{editingId ? 'Edit OT Entry' : 'Add OT Entry'}</div>

              <div style={styles.todayBar}>
                <span style={styles.todayLabel}>OT Date</span>
                <span style={styles.todayValue}>{formatDate(today)}</span>
              </div>

              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Staff Name</label>
                  <select value={staffName} onChange={(e) => setStaffName(e.target.value)} style={styles.select} disabled={saving}>
                    <option value="">Select staff</option>
                    {STAFF_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>From</label>
                  <select value={startTime} onChange={(e) => setStartTime(e.target.value)} style={styles.select} disabled={saving}>
                    <option value="">Select time</option>
                    {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>To</label>
                  <select value={endTime} onChange={(e) => setEndTime(e.target.value)} style={styles.select} disabled={saving}>
                    <option value="">Select time</option>
                    {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>{needsReason ? 'Reason for Exceeding 3 Hours' : 'Reason (Optional)'}</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={styles.textarea}
                  placeholder={needsReason ? 'This field is compulsory when OT exceeds 3 hours' : 'Optional if OT is 3 hours or below'}
                  disabled={saving}
                />
              </div>

              <div style={styles.actionRow}>
                {editingId ? <button type="button" onClick={resetForm} style={styles.secondaryActionBtn} disabled={saving}>Cancel Edit</button> : null}
                <button type="button" onClick={() => void handleSubmit()} style={styles.primaryBtn} disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Entry' : 'Submit Entry'}
                </button>
              </div>
            </section>

            <section style={styles.panel}>
              <div style={styles.sectionTitle}>Today Entries</div>
              {pageLoading ? (
                <div style={styles.emptyState}>Loading OT entries...</div>
              ) : todayEntries.length === 0 ? (
                <div style={styles.emptyState}>No OT entries for today.</div>
              ) : (
                <div style={styles.cardsWrap}>
                  {todayEntries.map((entry) => (
                    <article key={entry.id} style={styles.entryCard}>
                      <div style={styles.entryTopRow}>
                        <div>
                          <div style={styles.entryTitle}>{entry.staff_name}</div>
                          <div style={styles.entrySubTitle}>{entry.start_time} - {entry.end_time}</div>
                        </div>
                        <div style={{ ...styles.hourBadge, ...(safeNumber(entry.total_hours) > 3 ? styles.hourBadgeAlert : styles.hourBadgeNormal) }}>
                          {formatHours(entry.total_hours)} hrs
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
                        <button type="button" onClick={() => handleEdit(entry)} style={styles.secondaryActionBtn} disabled={saving}>Edit</button>
                        <button type="button" onClick={() => void handleDelete(entry)} style={styles.deleteBtn} disabled={deletingId === entry.id}>
                          {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {viewMode === 'PAST' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Past Entries</div>

            <div style={styles.filterRow}>
              <div style={styles.formGroupCompact}>
                <label style={styles.label}>Select Date</label>
                <input type="date" value={pastDate} onChange={(e) => setPastDate(e.target.value)} style={styles.input} />
              </div>
            </div>

            {pageLoading ? (
              <div style={styles.emptyState}>Loading past entries...</div>
            ) : pastEntries.length === 0 ? (
              <div style={styles.emptyState}>No OT entries for {formatDate(pastDate)}.</div>
            ) : (
              <div style={styles.cardsWrap}>
                {pastEntries.map((entry) => (
                  <article key={entry.id} style={styles.entryCard}>
                    <div style={styles.entryTopRow}>
                      <div>
                        <div style={styles.entryTitle}>{entry.staff_name}</div>
                        <div style={styles.entrySubTitle}>{formatDate(entry.ot_date)} · {entry.start_time} - {entry.end_time}</div>
                      </div>
                      <div style={{ ...styles.hourBadge, ...(safeNumber(entry.total_hours) > 3 ? styles.hourBadgeAlert : styles.hourBadgeNormal) }}>
                        {formatHours(entry.total_hours)} hrs
                      </div>
                    </div>

                    {entry.reason ? (
                      <div style={styles.reasonBox}>
                        <div style={styles.reasonLabel}>Reason</div>
                        <div style={styles.reasonText}>{entry.reason}</div>
                      </div>
                    ) : null}

                    <div style={styles.cardActions}>
                      <button type="button" onClick={() => handleEdit(entry)} style={styles.secondaryActionBtn} disabled={saving}>Edit</button>
                      <button type="button" onClick={() => void handleDelete(entry)} style={styles.deleteBtn} disabled={deletingId === entry.id}>
                        {deletingId === entry.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {viewMode === 'REPORT' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Monthly Report</div>

            <div style={styles.filterRow}>
              <div style={styles.formGroupCompact}>
                <label style={styles.label}>Month</label>
                <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} style={styles.input} />
              </div>
              <button type="button" onClick={handleDownloadReport} style={styles.primaryBtn}>Download Report</button>
            </div>

            <div style={styles.reportTableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Total OT This Month</th>
                    <th style={styles.th}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {reportSummary.length === 0 ? (
                    <tr><td colSpan={3} style={styles.emptyTableCell}>No entries for this month.</td></tr>
                  ) : (
                    reportSummary.map((staff) => (
                      <tr key={staff.staffName}>
                        <td style={styles.td}>{staff.staffName}</td>
                        <td style={styles.tdStrong}>{formatHours(staff.totalHours)} hrs</td>
                        <td style={styles.td}>
                          <div style={styles.reportEntryList}>
                            {staff.entries.map((entry) => (
                              <div key={entry.id} style={styles.reportEntryRow}>
                                {formatDate(entry.ot_date)} · {entry.start_time} - {entry.end_time} · {formatHours(entry.total_hours)} hrs{entry.reason ? ` · ${entry.reason}` : ''}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
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
  summaryValueSmall: {
    fontSize: '18px',
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
  modeRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  modeBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  modeBtnActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  todayBar: {
    display: 'inline-flex',
    gap: '10px',
    alignItems: 'center',
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '10px 14px',
    marginBottom: '14px',
  },
  todayLabel: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#475569',
  },
  todayValue: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
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
  formGroupCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: '220px',
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
    cursor: 'pointer',
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
  filterRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'end',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '14px',
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
  reportTableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    textAlign: 'left',
    borderBottom: '1px solid #cbd5e1',
    padding: '12px 10px',
    fontSize: '13px',
    color: '#334155',
    background: '#f8fafc',
  },
  td: {
    borderBottom: '1px solid #e2e8f0',
    padding: '12px 10px',
    fontSize: '14px',
    color: '#0f172a',
    verticalAlign: 'top',
  },
  tdStrong: {
    borderBottom: '1px solid #e2e8f0',
    padding: '12px 10px',
    fontSize: '14px',
    color: '#0f172a',
    verticalAlign: 'top',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  emptyTableCell: {
    borderBottom: '1px solid #e2e8f0',
    padding: '18px 10px',
    fontSize: '14px',
    color: '#64748b',
    textAlign: 'center',
  },
  reportEntryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  reportEntryRow: {
    lineHeight: 1.5,
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
