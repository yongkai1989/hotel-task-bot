'use client';

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type ChillerRecord = {
  id: string;
  week_start: string;
  week_end: string;
  staff_name: string | null;
  before_url?: string | null;
  before_submitted_at: string | null;
  after_url?: string | null;
  after_submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

const CHILLER_CLEANING_START_WEEK = '2026-07-20';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTime(value: string | null) {
  if (!value) return 'Not submitted';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}

function recordStatus(record: ChillerRecord) {
  if (record.before_submitted_at && record.after_submitted_at) return 'Complete';
  if (record.before_submitted_at || record.after_submitted_at) return 'Partial';
  return 'Missing';
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mondayFor(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
}

function buildCompletedWeeks() {
  const currentMonday = mondayFor(new Date());
  const weeks = Array.from({ length: 18 }, (_, index) => {
    const start = addDays(currentMonday, -7 * (index + 1));
    const end = addDays(start, 6);
    return {
      week_start: localDateKey(start),
      week_end: localDateKey(end),
    };
  });

  return weeks.filter((week) => week.week_start >= CHILLER_CLEANING_START_WEEK);
}

function buildCurrentWeek() {
  const start = mondayFor(new Date());
  const end = addDays(start, 6);
  return {
    week_start: localDateKey(start),
    week_end: localDateKey(end),
  };
}

export default function ChillerCleaningAdminPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [records, setRecords] = useState<ChillerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passcode, setPasscode] = useState('');
  const [savingPasscode, setSavingPasscode] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'overdue'>('all');
  const [expandedPhoto, setExpandedPhoto] = useState<{ label: string; url: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingWeek, setResettingWeek] = useState(false);
  const currentWeek = useMemo(() => buildCurrentWeek(), []);

  async function authHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {};
  }

  async function loadRecords() {
    setLoading(true);
    setError('');

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/chiller-cleaning/admin', {
        headers,
        cache: 'no-store',
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Unable to load chiller records');
      }

      setRecords(json.records || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load chiller records');
    } finally {
      setLoading(false);
    }
  }

  async function updatePasscode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPasscode(true);
    setError('');
    setNotice('');

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/chiller-cleaning/admin', {
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passcode }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Unable to update passcode');
      }

      setPasscode('');
      setNotice('Chiller Cleaning passcode updated successfully.');
    } catch (err: any) {
      setError(err?.message || 'Unable to update passcode');
    } finally {
      setSavingPasscode(false);
    }
  }

  async function resetCurrentWeek() {
    setResettingWeek(true);
    setError('');
    setNotice('');

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/chiller-cleaning/admin', {
        method: 'DELETE',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({ week_start: currentWeek.week_start }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Unable to reset current week');
      }

      setShowResetConfirm(false);
      setNotice(`Current week reset completed. ${json.removedFiles || 0} upload(s) removed.`);
      await loadRecords();
    } catch (err: any) {
      setError(err?.message || 'Unable to reset current week');
    } finally {
      setResettingWeek(false);
    }
  }

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeCount = records.filter((record) => recordStatus(record) === 'Complete').length;
  const partialCount = records.filter((record) => recordStatus(record) === 'Partial').length;
  const recordsByWeek = useMemo(
    () => new Map(records.map((record) => [record.week_start, record])),
    [records]
  );
  const overdueWeeks = useMemo(
    () =>
      buildCompletedWeeks()
        .map((week) => {
          const record = recordsByWeek.get(week.week_start);
          const missingBefore = !record?.before_submitted_at;
          const missingAfter = !record?.after_submitted_at;

          return {
            ...week,
            record,
            missingBefore,
            missingAfter,
            missingText: [
              missingBefore ? 'before photo' : '',
              missingAfter ? 'after photo' : '',
            ].filter(Boolean).join(' + '),
          };
        })
        .filter((week) => week.missingBefore || week.missingAfter),
    [recordsByWeek]
  );
  const visibleRecords =
    viewMode === 'overdue'
      ? (overdueWeeks.map((week) => week.record).filter(Boolean) as ChillerRecord[])
      : records;
  const overdueMissingRecordWeeks = overdueWeeks.filter((week) => !week.record);

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.kicker}>Branch compliance</div>
          <h1 style={styles.title}>Chiller Cleaning Records</h1>
          <p style={styles.subtitle}>
            Review weekly before-and-after cleaning submissions. Records older than 4 months are cleaned automatically.
          </p>
        </div>
        <div style={styles.heroActions}>
          <Link href="/dashboard" style={styles.secondaryButton}>
            Back to Dashboard
          </Link>
          <button type="button" onClick={loadRecords} style={styles.primaryButton}>
            Refresh
          </button>
        </div>
      </section>

      {error ? <div style={styles.error}>{error}</div> : null}
      {notice ? <div style={styles.notice}>{notice}</div> : null}

      <section style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>Total Weeks</span>
          <strong style={styles.metricValue}>{records.length}</strong>
          <span style={styles.metricHint}>Last 4 months</span>
        </div>
        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>Complete</span>
          <strong style={{ ...styles.metricValue, color: '#047857' }}>{completeCount}</strong>
          <span style={styles.metricHint}>Before + after submitted</span>
        </div>
        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>Partial</span>
          <strong style={{ ...styles.metricValue, color: '#b45309' }}>{partialCount}</strong>
          <span style={styles.metricHint}>One photo missing</span>
        </div>
        <button type="button" onClick={() => setViewMode('overdue')} style={styles.metricButton}>
          <span style={styles.metricLabel}>Overdue Weeks</span>
          <strong style={{ ...styles.metricValue, color: overdueWeeks.length ? '#be123c' : '#047857' }}>
            {overdueWeeks.length}
          </strong>
          <span style={styles.metricHint}>Click to show overdue only</span>
        </button>
      </section>

      <section style={styles.controlPanel}>
        <div>
          <div style={styles.kicker}>Staff page</div>
          <h2 style={styles.sectionTitle}>Passcode Control</h2>
          <p style={styles.muted}>
            Public URL: <Link href="/chiller-cleaning">/chiller-cleaning</Link>
          </p>
        </div>
        <form onSubmit={updatePasscode} style={styles.passcodeForm}>
          <input
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="New passcode"
            style={styles.input}
            minLength={4}
          />
          <button type="submit" disabled={savingPasscode} style={styles.primaryButton}>
            {savingPasscode ? 'Saving...' : 'Update Passcode'}
          </button>
        </form>
        <div style={styles.resetBox}>
          <div style={styles.resetIcon}>!</div>
          <div style={styles.resetContent}>
            <div style={styles.dangerKicker}>Controlled reset</div>
            <strong style={styles.resetTitle}>Reset Current Week Submission</strong>
            <p style={styles.resetCopy}>
              Use this only when the current week was uploaded wrongly. It removes this week&apos;s
              before/after photos and clears the current submission record only.
            </p>
            <div style={styles.resetScope}>
              <span>This week</span>
              <strong>
                {formatDate(currentWeek.week_start)} - {formatDate(currentWeek.week_end)}
              </strong>
            </div>
          </div>
          <button type="button" onClick={() => setShowResetConfirm(true)} style={styles.dangerButton}>
            Reset Current Week
          </button>
        </div>
      </section>

      <section style={styles.recordsPanel}>
        <div style={styles.panelHeader}>
          <div>
            <div style={styles.kicker}>History</div>
            <h2 style={styles.sectionTitle}>
              {viewMode === 'overdue' ? 'Overdue Weekly Submissions' : 'Weekly Submissions'}
            </h2>
          </div>
          <div style={styles.historyActions}>
            <button
              type="button"
              onClick={() => setViewMode('all')}
              style={viewMode === 'all' ? styles.activeFilterButton : styles.filterButton}
            >
              All history
            </button>
            <button
              type="button"
              onClick={() => setViewMode('overdue')}
              style={viewMode === 'overdue' ? styles.activeFilterButton : styles.filterButton}
            >
              Overdue only
            </button>
            <span style={styles.pill}>
              {loading
                ? 'Loading'
                : `${viewMode === 'overdue' ? overdueWeeks.length : visibleRecords.length} record(s)`}
            </span>
          </div>
        </div>

        {loading ? (
          <div style={styles.empty}>Loading chiller records...</div>
        ) : viewMode === 'overdue' && overdueWeeks.length === 0 ? (
          <div style={styles.empty}>No overdue chiller cleaning weeks.</div>
        ) : viewMode === 'all' && records.length === 0 ? (
          <div style={styles.empty}>No chiller cleaning records yet.</div>
        ) : (
          <div style={styles.recordGrid}>
            {viewMode === 'overdue'
              ? overdueMissingRecordWeeks.map((week) => (
                  <article key={week.week_start} style={styles.recordCard}>
                    <div style={styles.recordTop}>
                      <div>
                        <div style={styles.weekText}>
                          {formatDate(week.week_start)} - {formatDate(week.week_end)}
                        </div>
                        <div style={styles.staffText}>No submission record</div>
                      </div>
                      <span style={{ ...styles.statusPill, ...styles.statusMissing }}>Missing</span>
                    </div>
                    <div style={styles.emptyCompact}>Missing before photo + after photo</div>
                  </article>
                ))
              : null}

            {visibleRecords.map((record) => {
              const status = recordStatus(record);
              const statusStyle =
                status === 'Complete'
                  ? styles.statusComplete
                  : status === 'Partial'
                    ? styles.statusPartial
                    : styles.statusMissing;

              return (
                <article key={record.id} style={styles.recordCard}>
                  <div style={styles.recordTop}>
                    <div>
                      <div style={styles.weekText}>
                        {formatDate(record.week_start)} - {formatDate(record.week_end)}
                      </div>
                      <div style={styles.staffText}>{record.staff_name || 'No staff name saved'}</div>
                    </div>
                    <span style={{ ...styles.statusPill, ...statusStyle }}>{status}</span>
                  </div>

                  <div style={styles.photoGrid}>
                    <PhotoPanel
                      label="Before Cleaning"
                      url={record.before_url}
                      time={record.before_submitted_at}
                      onExpand={(url) => setExpandedPhoto({ label: 'Before Cleaning', url })}
                    />
                    <PhotoPanel
                      label="After Cleaning"
                      url={record.after_url}
                      time={record.after_submitted_at}
                      onExpand={(url) => setExpandedPhoto({ label: 'After Cleaning', url })}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showResetConfirm ? (
        <div
          style={styles.lightboxBackdrop}
          onClick={() => !resettingWeek && setShowResetConfirm(false)}
        >
          <div style={styles.confirmModal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.confirmHeader}>
              <div style={styles.confirmIcon}>!</div>
              <div>
                <div style={styles.dangerKicker}>Final confirmation</div>
                <h2 style={styles.confirmTitle}>Reset current week submission?</h2>
              </div>
            </div>
            <div style={styles.confirmWeekCard}>
              <span style={styles.confirmWeekLabel}>Week affected</span>
              <strong>
                {formatDate(currentWeek.week_start)} - {formatDate(currentWeek.week_end)}
              </strong>
            </div>
            <div style={styles.confirmImpactGrid}>
              <div style={styles.impactItem}>
                <span>Will be removed</span>
                <strong>Before photo, after photo, and this week&apos;s submission record</strong>
              </div>
              <div style={styles.impactItemSafe}>
                <span>Will stay unchanged</span>
                <strong>All past weeks and older history records</strong>
              </div>
            </div>
            <p style={styles.confirmCopy}>
              This action is meant for correcting the current week only. Once confirmed, staff must
              upload the before and after photos again for this week.
            </p>
            <div style={styles.modalActions}>
              <button
                type="button"
                disabled={resettingWeek}
                onClick={() => setShowResetConfirm(false)}
                style={styles.secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resettingWeek}
                onClick={resetCurrentWeek}
                style={styles.confirmDangerButton}
              >
                {resettingWeek ? 'Resetting...' : 'Yes, Reset Current Week'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {expandedPhoto ? (
        <div style={styles.lightboxBackdrop} onClick={() => setExpandedPhoto(null)}>
          <div style={styles.lightbox} onClick={(event) => event.stopPropagation()}>
            <div style={styles.lightboxHeader}>
              <strong>{expandedPhoto.label}</strong>
              <button type="button" onClick={() => setExpandedPhoto(null)} style={styles.closeButton}>
                Close
              </button>
            </div>
            <img src={expandedPhoto.url} alt={expandedPhoto.label} style={styles.lightboxImage} />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PhotoPanel({
  label,
  url,
  time,
  onExpand,
}: {
  label: string;
  url?: string | null;
  time: string | null;
  onExpand: (url: string) => void;
}) {
  return (
    <div style={styles.photoPanel}>
      <div style={styles.photoMeta}>
        <strong>{label}</strong>
        <span>{formatTime(time)}</span>
      </div>
      {url ? (
        <button type="button" onClick={() => onExpand(url)} style={styles.photoButton}>
          <img src={url} alt={label} style={styles.photo} />
        </button>
      ) : (
        <div style={styles.photoMissing}>No image</div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '32px clamp(16px, 4vw, 56px)',
    background: 'linear-gradient(135deg, #eef5ff 0%, #f8fbff 48%, #f7fbf8 100%)',
    color: '#06152f',
    fontFamily: 'Inter, Aptos, "Segoe UI", Arial, sans-serif',
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'center',
    padding: '26px clamp(20px, 4vw, 38px)',
    border: '1px solid #c8dcf7',
    borderRadius: 26,
    background: 'rgba(255,255,255,0.88)',
    boxShadow: '0 24px 70px rgba(18, 40, 80, 0.12)',
    flexWrap: 'wrap',
  },
  kicker: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    margin: '8px 0 6px',
    fontSize: 'clamp(34px, 5vw, 56px)',
    lineHeight: 1,
  },
  subtitle: {
    margin: 0,
    color: '#48607f',
    fontSize: 16,
    maxWidth: 720,
    lineHeight: 1.5,
  },
  heroActions: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  primaryButton: {
    border: 0,
    borderRadius: 16,
    background: '#0f2ee8',
    color: '#fff',
    fontWeight: 900,
    padding: '14px 18px',
    boxShadow: '0 14px 30px rgba(37, 99, 235, 0.22)',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  secondaryButton: {
    border: '1px solid #c5d6ea',
    borderRadius: 16,
    background: '#fff',
    color: '#07152e',
    fontWeight: 900,
    padding: '14px 18px',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  error: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#be123c',
    fontWeight: 900,
  },
  notice: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    border: '1px solid #bbf7d0',
    background: '#ecfdf5',
    color: '#047857',
    fontWeight: 900,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
    marginTop: 18,
  },
  metricCard: {
    padding: 20,
    borderRadius: 22,
    border: '1px solid #d7e4f4',
    background: 'rgba(255,255,255,0.9)',
  },
  metricButton: {
    padding: 20,
    borderRadius: 22,
    border: '1px solid #fecdd3',
    background: 'rgba(255,255,255,0.94)',
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: '0 18px 48px rgba(190, 18, 60, 0.08)',
  },
  metricLabel: {
    display: 'block',
    color: '#4f6686',
    fontWeight: 900,
    textTransform: 'uppercase',
    fontSize: 12,
    letterSpacing: 1,
  },
  metricValue: {
    display: 'block',
    fontSize: 36,
    lineHeight: 1.1,
    marginTop: 8,
  },
  metricHint: {
    display: 'block',
    color: '#58708e',
    fontWeight: 700,
    marginTop: 6,
  },
  controlPanel: {
    marginTop: 18,
    padding: 22,
    borderRadius: 24,
    border: '1px solid #d5e4f5',
    background: 'rgba(255,255,255,0.92)',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 18,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    margin: '6px 0 4px',
    fontSize: 26,
  },
  muted: {
    margin: 0,
    color: '#526987',
    fontWeight: 700,
  },
  passcodeForm: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  input: {
    minWidth: 220,
    padding: '14px 16px',
    borderRadius: 16,
    border: '1px solid #c8d8ec',
    fontSize: 16,
    fontWeight: 800,
  },
  resetBox: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
    padding: 18,
    borderRadius: 22,
    border: '1px solid #fed7aa',
    background: 'linear-gradient(135deg, #fff7ed 0%, #fff 58%, #fff1f2 100%)',
    boxShadow: '0 18px 44px rgba(180, 83, 9, 0.08)',
  },
  resetIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    display: 'grid',
    placeItems: 'center',
    background: '#ffedd5',
    color: '#c2410c',
    border: '1px solid #fdba74',
    fontSize: 22,
    fontWeight: 1000,
  },
  resetContent: {
    minWidth: 240,
    flex: '1 1 360px',
  },
  dangerKicker: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: 1000,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
  },
  resetTitle: {
    display: 'block',
    marginTop: 5,
    color: '#07152e',
    fontSize: 18,
    fontWeight: 1000,
  },
  resetCopy: {
    margin: '6px 0 0',
    color: '#6b4f2b',
    fontWeight: 800,
    lineHeight: 1.45,
  },
  resetScope: {
    marginTop: 12,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '9px 12px',
    borderRadius: 14,
    background: '#fff',
    border: '1px solid #fed7aa',
    color: '#7c2d12',
    fontWeight: 900,
  },
  dangerButton: {
    border: '1px solid #fca5a5',
    borderRadius: 16,
    background: '#b91c1c',
    color: '#fff',
    fontWeight: 1000,
    padding: '14px 18px',
    cursor: 'pointer',
    boxShadow: '0 16px 34px rgba(185, 28, 28, 0.18)',
    marginLeft: 'auto',
  },
  historyActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  filterButton: {
    border: '1px solid #c5d6ea',
    borderRadius: 999,
    background: '#fff',
    color: '#07152e',
    fontWeight: 900,
    padding: '10px 14px',
    cursor: 'pointer',
  },
  activeFilterButton: {
    border: '1px solid #0f2ee8',
    borderRadius: 999,
    background: '#0f2ee8',
    color: '#fff',
    fontWeight: 900,
    padding: '10px 14px',
    cursor: 'pointer',
  },
  emptyCompact: {
    marginTop: 14,
    padding: 16,
    border: '1px dashed #bdd2ee',
    borderRadius: 16,
    textAlign: 'center',
    color: '#607692',
    fontWeight: 900,
    background: '#f8fbff',
  },
  recordsPanel: {
    marginTop: 18,
    padding: 22,
    borderRadius: 24,
    border: '1px solid #d5e4f5',
    background: 'rgba(255,255,255,0.92)',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  pill: {
    padding: '10px 14px',
    borderRadius: 999,
    background: '#eff6ff',
    color: '#1d4ed8',
    fontWeight: 900,
  },
  empty: {
    marginTop: 16,
    padding: 24,
    border: '1px dashed #bdd2ee',
    borderRadius: 18,
    textAlign: 'center',
    color: '#607692',
    fontWeight: 900,
  },
  recordGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 16,
    marginTop: 16,
  },
  recordCard: {
    padding: 18,
    borderRadius: 22,
    border: '1px solid #d7e4f4',
    background: '#fff',
  },
  recordTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  weekText: {
    fontWeight: 1000,
    fontSize: 18,
  },
  staffText: {
    marginTop: 4,
    color: '#56708f',
    fontWeight: 800,
  },
  statusPill: {
    borderRadius: 999,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 1000,
    whiteSpace: 'nowrap',
  },
  statusComplete: {
    background: '#dcfce7',
    color: '#047857',
  },
  statusPartial: {
    background: '#fef3c7',
    color: '#b45309',
  },
  statusMissing: {
    background: '#fee2e2',
    color: '#b91c1c',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginTop: 16,
  },
  photoPanel: {
    border: '1px solid #d9e5f4',
    borderRadius: 18,
    overflow: 'hidden',
    background: '#f8fbff',
  },
  photoMeta: {
    padding: 12,
    display: 'grid',
    gap: 4,
    color: '#07152e',
  },
  photoButton: {
    display: 'block',
    width: '100%',
    padding: 0,
    border: 0,
    background: 'transparent',
    cursor: 'zoom-in',
  },
  photo: {
    width: '100%',
    height: 118,
    objectFit: 'contain',
    background: '#0f172a',
    display: 'block',
    borderTop: '1px solid #d9e5f4',
  },
  photoMissing: {
    minHeight: 150,
    display: 'grid',
    placeItems: 'center',
    borderTop: '1px solid #d9e5f4',
    color: '#69809b',
    fontWeight: 900,
  },
  lightboxBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(6, 21, 47, 0.78)',
    display: 'grid',
    placeItems: 'center',
    padding: 18,
  },
  confirmModal: {
    width: 'min(560px, 96vw)',
    borderRadius: 26,
    background: '#fff',
    border: '1px solid #fecaca',
    padding: 22,
    boxShadow: '0 30px 90px rgba(0,0,0,0.36)',
  },
  confirmHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  confirmIcon: {
    width: 48,
    height: 48,
    borderRadius: 18,
    display: 'grid',
    placeItems: 'center',
    background: '#fee2e2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    fontSize: 24,
    fontWeight: 1000,
    flex: '0 0 auto',
  },
  confirmTitle: {
    margin: '5px 0 0',
    fontSize: 'clamp(24px, 5vw, 34px)',
    lineHeight: 1.08,
    color: '#07152e',
  },
  confirmWeekCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 18,
    border: '1px solid #fed7aa',
    background: '#fff7ed',
    display: 'grid',
    gap: 4,
    color: '#7c2d12',
  },
  confirmWeekLabel: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: 1000,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  confirmImpactGrid: {
    marginTop: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 10,
  },
  impactItem: {
    padding: 14,
    borderRadius: 16,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#991b1b',
    display: 'grid',
    gap: 5,
    fontWeight: 900,
  },
  impactItemSafe: {
    padding: 14,
    borderRadius: 16,
    border: '1px solid #bbf7d0',
    background: '#ecfdf5',
    color: '#047857',
    display: 'grid',
    gap: 5,
    fontWeight: 900,
  },
  confirmCopy: {
    margin: '14px 0 0',
    color: '#536b89',
    lineHeight: 1.55,
    fontWeight: 800,
  },
  modalActions: {
    marginTop: 18,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  confirmDangerButton: {
    border: '1px solid #991b1b',
    borderRadius: 16,
    background: '#991b1b',
    color: '#fff',
    fontWeight: 1000,
    padding: '14px 18px',
    cursor: 'pointer',
    boxShadow: '0 16px 34px rgba(153, 27, 27, 0.2)',
  },
  lightbox: {
    width: 'min(980px, 96vw)',
    maxHeight: '92vh',
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d7e4f4',
    overflow: 'hidden',
    boxShadow: '0 30px 90px rgba(0,0,0,0.35)',
  },
  lightboxHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderBottom: '1px solid #d9e5f4',
  },
  closeButton: {
    border: '1px solid #c5d6ea',
    borderRadius: 12,
    background: '#fff',
    color: '#07152e',
    fontWeight: 900,
    padding: '10px 12px',
    cursor: 'pointer',
  },
  lightboxImage: {
    width: '100%',
    maxHeight: 'calc(92vh - 62px)',
    objectFit: 'contain',
    display: 'block',
    background: '#0f172a',
  },
};
