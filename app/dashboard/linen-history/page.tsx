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

type ViewMode = 'FLOOR' | 'BLOCK' | 'GRAND';

type LinenTotals = {
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

type GroupSummary = {
  key: string;
  label: string;
  expected: LinenTotals;
  actual: LinenTotals;
  difference: LinenTotals;
};

type SnapshotRow = {
  service_date: string;
  expected_json: any;
  actual_json: any;
  difference_json: any;
};

const FLOOR_OPTIONS = [
  { key: 'B1F1', label: 'Block 1 Floor 1' },
  { key: 'B1F2', label: 'Block 1 Floor 2' },
  { key: 'B1F3', label: 'Block 1 Floor 3' },
  { key: 'B1F5', label: 'Block 1 Floor 5' },
  { key: 'B2F3', label: 'Block 2 Floor 3' },
  { key: 'B2F5', label: 'Block 2 Floor 5' },
  { key: 'B2F6', label: 'Block 2 Floor 6' },
  { key: 'B2F7', label: 'Block 2 Floor 7' },
] as const;

const BLOCK_OPTIONS = [
  { key: 'B1', label: 'Block 1' },
  { key: 'B2', label: 'Block 2' },
] as const;

const ITEM_DEFS: Array<{
  key: keyof LinenTotals;
  label: string;
}> = [
  { key: 'bedsheet_king', label: 'Bedsheet King' },
  { key: 'pillow_case', label: 'Pillow Case' },
  { key: 'bath_towel', label: 'Bath Towel' },
  { key: 'bath_mat', label: 'Bath Mat' },
  { key: 'duvet_cover_king', label: 'Duvet Cover King' },
  { key: 'duvet_cover_single', label: 'Duvet Cover Single' },
];

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

function parseTotals(raw: any): LinenTotals {
  return {
    bedsheet_king: safeNumber(raw?.bedsheet_king),
    pillow_case: safeNumber(raw?.pillow_case),
    bath_towel: safeNumber(raw?.bath_towel),
    bath_mat: safeNumber(raw?.bath_mat),
    duvet_cover_king: safeNumber(raw?.duvet_cover_king),
    duvet_cover_single: safeNumber(raw?.duvet_cover_single),
  };
}

function formatDiff(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function diffStyle(value: number): React.CSSProperties {
  if (value > 0) return { color: '#b45309', fontWeight: 800 };
  if (value < 0) return { color: '#b91c1c', fontWeight: 800 };
  return { color: '#166534', fontWeight: 800 };
}

export default function LinenHistoryPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedDate, setSelectedDate] = useState(getTodayLocalDateString());
  const [snapshot, setSnapshot] = useState<SnapshotRow | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('FLOOR');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');
  const [selectedBlockKey, setSelectedBlockKey] = useState<string>('B1');

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
    return (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR'
    );
  }, [profile]);

  async function loadSnapshot() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const { data, error } = await supabase
        .from('linen_daily_snapshot')
        .select('service_date, expected_json, actual_json, difference_json')
        .eq('service_date', selectedDate)
        .maybeSingle();

      if (error) throw error;

      setSnapshot((data || null) as SnapshotRow | null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load linen history');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    void loadSnapshot();
  }, [profile, canAccess, selectedDate]);

  const selectedSummary = useMemo(() => {
    const expected = snapshot?.expected_json || {};
    const actual = snapshot?.actual_json || {};
    const difference = snapshot?.difference_json || {};

    if (viewMode === 'FLOOR') {
      const floorExpected = expected?.floors?.[selectedFloorKey];
      const floorActual = actual?.floors?.[selectedFloorKey];
      const floorDifference = difference?.floors?.[selectedFloorKey];

      return {
        key: selectedFloorKey,
        label: FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey)?.label || selectedFloorKey,
        expected: parseTotals(floorExpected),
        actual: parseTotals(floorActual),
        difference: parseTotals(floorDifference),
      } as GroupSummary;
    }

    if (viewMode === 'BLOCK') {
      const blockExpected = expected?.blocks?.[selectedBlockKey];
      const blockActual = actual?.blocks?.[selectedBlockKey];
      const blockDifference = difference?.blocks?.[selectedBlockKey];

      return {
        key: selectedBlockKey,
        label: BLOCK_OPTIONS.find((b) => b.key === selectedBlockKey)?.label || selectedBlockKey,
        expected: parseTotals(blockExpected),
        actual: parseTotals(blockActual),
        difference: parseTotals(blockDifference),
      } as GroupSummary;
    }

    return {
      key: 'GRAND',
      label: 'Grand Total',
      expected: parseTotals(expected?.grand_total),
      actual: parseTotals(actual?.grand_total),
      difference: parseTotals(difference?.grand_total),
    } as GroupSummary;
  }, [snapshot, viewMode, selectedFloorKey, selectedBlockKey]);

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
          <p style={styles.centerText}>
            Only Supervisor, Manager, and Superuser can access Linen History.
          </p>
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
            <div style={styles.pageTitle}>Linen History</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role})
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Date</div>

          <div style={styles.dateRow}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={styles.dateInput}
            />
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>View</div>

          <div style={styles.modeRow}>
            <button
              type="button"
              onClick={() => setViewMode('FLOOR')}
              style={{ ...styles.modeBtn, ...(viewMode === 'FLOOR' ? styles.modeBtnActive : {}) }}
            >
              By Floor
            </button>
            <button
              type="button"
              onClick={() => setViewMode('BLOCK')}
              style={{ ...styles.modeBtn, ...(viewMode === 'BLOCK' ? styles.modeBtnActive : {}) }}
            >
              By Block
            </button>
            <button
              type="button"
              onClick={() => setViewMode('GRAND')}
              style={{ ...styles.modeBtn, ...(viewMode === 'GRAND' ? styles.modeBtnActive : {}) }}
            >
              Grand Total
            </button>
          </div>

          {viewMode === 'FLOOR' ? (
            <div style={styles.selectorRow}>
              {FLOOR_OPTIONS.map((floor) => (
                <button
                  key={floor.key}
                  type="button"
                  onClick={() => setSelectedFloorKey(floor.key)}
                  style={{
                    ...styles.selectorBtn,
                    ...(selectedFloorKey === floor.key ? styles.selectorBtnActive : {}),
                  }}
                >
                  {floor.label}
                </button>
              ))}
            </div>
          ) : null}

          {viewMode === 'BLOCK' ? (
            <div style={styles.selectorRow}>
              {BLOCK_OPTIONS.map((block) => (
                <button
                  key={block.key}
                  type="button"
                  onClick={() => setSelectedBlockKey(block.key)}
                  style={{
                    ...styles.selectorBtn,
                    ...(selectedBlockKey === block.key ? styles.selectorBtnActive : {}),
                  }}
                >
                  {block.label}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {loading ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>Loading linen history...</div>
          </section>
        ) : !snapshot ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>No snapshot found for this date.</div>
          </section>
        ) : (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>{selectedSummary.label}</div>

            <div style={styles.itemGrid}>
              {ITEM_DEFS.map((item) => {
                const diffValue = selectedSummary.difference[item.key];
                return (
                  <div key={item.key} style={styles.itemCard}>
                    <div style={styles.itemTitle}>{item.label}</div>

                    <div style={styles.metricRow}>
                      <span style={styles.metricLabel}>Expected</span>
                      <span style={styles.metricValue}>{selectedSummary.expected[item.key]}</span>
                    </div>

                    <div style={styles.metricRow}>
                      <span style={styles.metricLabel}>Actual</span>
                      <span style={styles.metricValue}>{selectedSummary.actual[item.key]}</span>
                    </div>

                    <div style={styles.metricRow}>
                      <span style={styles.metricLabel}>Difference</span>
                      <span style={{ ...styles.metricValue, ...diffStyle(diffValue) }}>
                        {formatDiff(diffValue)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
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
    maxWidth: '1080px',
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
    marginBottom: '12px',
  },
  dateRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  dateInput: {
    width: '220px',
    maxWidth: '100%',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  modeRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '14px',
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
  selectorRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  selectorBtn: {
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  selectorBtnActive: {
    background: '#dbeafe',
    color: '#1d4ed8',
    borderColor: '#93c5fd',
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '12px',
  },
  itemCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
  },
  itemTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '12px',
    lineHeight: 1.2,
  },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    padding: '10px 0',
    borderTop: '1px solid #f1f5f9',
  },
  metricLabel: {
    fontSize: '14px',
    color: '#64748b',
    fontWeight: 700,
  },
  metricValue: {
    fontSize: '22px',
    color: '#0f172a',
    fontWeight: 800,
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
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
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
