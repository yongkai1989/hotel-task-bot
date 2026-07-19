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

export default function ChillerCleaningAdminPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [records, setRecords] = useState<ChillerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passcode, setPasscode] = useState('');
  const [savingPasscode, setSavingPasscode] = useState(false);

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

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeCount = records.filter((record) => recordStatus(record) === 'Complete').length;
  const partialCount = records.filter((record) => recordStatus(record) === 'Partial').length;

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.kicker}>Branch compliance</div>
          <h1 style={styles.title}>Chiller Cleaning Records</h1>
          <p style={styles.subtitle}>
            Review weekly before-and-after cleaning submissions. Records older than 3 months are cleaned automatically.
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
          <span style={styles.metricHint}>Last 3 months</span>
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
      </section>

      <section style={styles.recordsPanel}>
        <div style={styles.panelHeader}>
          <div>
            <div style={styles.kicker}>History</div>
            <h2 style={styles.sectionTitle}>Weekly Submissions</h2>
          </div>
          <span style={styles.pill}>{loading ? 'Loading' : `${records.length} record(s)`}</span>
        </div>

        {loading ? (
          <div style={styles.empty}>Loading chiller records...</div>
        ) : records.length === 0 ? (
          <div style={styles.empty}>No chiller cleaning records yet.</div>
        ) : (
          <div style={styles.recordGrid}>
            {records.map((record) => {
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
                    />
                    <PhotoPanel
                      label="After Cleaning"
                      url={record.after_url}
                      time={record.after_submitted_at}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function PhotoPanel({
  label,
  url,
  time,
}: {
  label: string;
  url?: string | null;
  time: string | null;
}) {
  return (
    <div style={styles.photoPanel}>
      <div style={styles.photoMeta}>
        <strong>{label}</strong>
        <span>{formatTime(time)}</span>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" style={styles.photoLink}>
          <img src={url} alt={label} style={styles.photo} />
        </a>
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
  photoLink: {
    display: 'block',
  },
  photo: {
    width: '100%',
    aspectRatio: '4 / 3',
    objectFit: 'cover',
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
};
