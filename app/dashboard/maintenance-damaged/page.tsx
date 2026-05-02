'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_damaged?: boolean;
};

type BranchName = 'Crown' | 'Leisure' | 'Express' | 'View';

type DamagedRow = {
  id: string;
  item_id: string;
  item_name: string | null;
  branch_name: BranchName;
  qty: number;
  reason: string | null;
  used_to: string | null;
  replacement_movement_id: string | null;
  created_at?: string | null;
  created_by_name?: string | null;
};

const BRANCHES: Array<BranchName | 'ALL'> = ['ALL', 'Crown', 'Leisure', 'Express', 'View'];

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
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

export default function MaintenanceDamagedPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [selectedBranch, setSelectedBranch] = useState<(typeof BRANCHES)[number]>('ALL');
  const [damagedRows, setDamagedRows] = useState<DamagedRow[]>([]);

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
          if (mounted) setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role, can_access_damaged')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'MT') as DashboardUser['role'],
          can_access_damaged: profileRow?.can_access_damaged ?? false,
        });
      } catch (err: any) {
        if (mounted) setErrorMsg(err?.message || 'Failed to load session');
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
    if (profile.role === 'SUPERUSER' || profile.role === 'MANAGER' || profile.role === 'SUPERVISOR') return true;
    return profile.can_access_damaged === true;
  }, [profile]);

  async function loadData() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      let query = supabase
        .from('maintenance_damaged_items')
        .select(
          'id, item_id, item_name, branch_name, qty, reason, used_to, replacement_movement_id, created_at, created_by_name'
        )
        .order('created_at', { ascending: false });

      if (selectedBranch !== 'ALL') {
        query = query.eq('branch_name', selectedBranch);
      }

      const { data, error } = await query;
      if (error) throw error;

      setDamagedRows((data || []) as DamagedRow[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load damaged items.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    void loadData();
  }, [profile, canAccess, selectedBranch]);

  const branchSummary = useMemo(() => {
    const base: Record<BranchName, number> = {
      Crown: 0,
      Leisure: 0,
      Express: 0,
      View: 0,
    };

    damagedRows.forEach((row) => {
      base[row.branch_name] += safeNumber(row.qty);
    });

    return base;
  }, [damagedRows]);

  const totalDamaged = useMemo(
    () => damagedRows.reduce((sum, row) => sum + safeNumber(row.qty), 0),
    [damagedRows]
  );

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
          <p style={styles.centerText}>You do not have permission to access Maintenance Damaged.</p>
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
            <div style={styles.pageTitle}>Maintenance Damaged</div>
            <div style={styles.pageSubTitle}>
              Every damaged replacement reported from maintenance stock out is listed here.
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard/maintenance-stock-card" style={styles.secondaryBtn}>
              Maintenance Stock Card
            </Link>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Overview</div>

          <div style={styles.summaryGrid}>
            <article style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Current View</div>
              <div style={styles.summaryValue}>{selectedBranch === 'ALL' ? 'All Branches' : selectedBranch}</div>
            </article>

            <article style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Total Damaged Qty</div>
              <div style={styles.summaryValue}>{totalDamaged}</div>
            </article>

            <article style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Entries Listed</div>
              <div style={styles.summaryValue}>{damagedRows.length}</div>
            </article>
          </div>

          <div style={styles.branchRow}>
            {BRANCHES.map((branch) => (
              <button
                key={branch}
                type="button"
                onClick={() => setSelectedBranch(branch)}
                style={{
                  ...styles.branchBtn,
                  ...(selectedBranch === branch ? styles.branchBtnActive : {}),
                }}
              >
                {branch}
                {branch !== 'ALL' ? (
                  <span style={styles.branchQty}>({branchSummary[branch]})</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Damaged Items Log</div>

          {loading ? (
            <div style={styles.emptyState}>Loading damaged items...</div>
          ) : damagedRows.length === 0 ? (
            <div style={styles.emptyState}>No damaged items reported for this view yet.</div>
          ) : (
            <div style={styles.logList}>
              {damagedRows.map((row) => (
                <article key={row.id} style={styles.logCard}>
                  <div style={styles.logHeader}>
                    <div style={styles.logTitle}>{row.item_name || 'Maintenance Item'}</div>
                    <div style={styles.qtyBadge}>Qty {row.qty}</div>
                  </div>

                  <div style={styles.metaGrid}>
                    <div style={styles.metaCard}>
                      <div style={styles.metaLabel}>Branch</div>
                      <div style={styles.metaValue}>{row.branch_name}</div>
                    </div>

                    <div style={styles.metaCard}>
                      <div style={styles.metaLabel}>Used To Replace</div>
                      <div style={styles.metaValue}>{row.used_to || '-'}</div>
                    </div>

                    <div style={styles.metaCard}>
                      <div style={styles.metaLabel}>Reported By</div>
                      <div style={styles.metaValue}>{row.created_by_name || '-'}</div>
                    </div>

                    <div style={styles.metaCard}>
                      <div style={styles.metaLabel}>Reported At</div>
                      <div style={styles.metaValue}>{formatDateTime(row.created_at)}</div>
                    </div>
                  </div>

                  {row.reason ? (
                    <div style={styles.notesBox}>
                      <div style={styles.notesLabel}>Reason</div>
                      <div style={styles.notesText}>{row.reason}</div>
                    </div>
                  ) : null}
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
    background: '#f4f7fb',
    padding: '18px 14px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1100px',
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
  },
  pageSubTitle: {
    marginTop: '6px',
    color: '#64748b',
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: 1.45,
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #dfe7f2',
    borderRadius: '20px',
    padding: '16px',
    boxShadow: '0 12px 28px rgba(15,23,42,0.05)',
    marginBottom: '14px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '14px',
  },
  summaryCard: {
    background: '#f8fbff',
    border: '1px solid #dbe7f5',
    borderRadius: '16px',
    padding: '14px',
  },
  summaryLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '24px',
    color: '#0f172a',
    fontWeight: 900,
  },
  branchRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  branchBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  branchBtnActive: {
    background: '#dbeafe',
    color: '#1d4ed8',
    borderColor: '#93c5fd',
  },
  branchQty: {
    fontSize: '12px',
    fontWeight: 800,
  },
  logList: {
    display: 'grid',
    gap: '12px',
  },
  logCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  logTitle: {
    fontSize: '18px',
    color: '#0f172a',
    fontWeight: 800,
  },
  qtyBadge: {
    borderRadius: '999px',
    padding: '8px 12px',
    background: '#fef2f2',
    color: '#b91c1c',
    fontSize: '12px',
    fontWeight: 800,
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    marginTop: '14px',
  },
  metaCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    background: '#f8fafc',
    padding: '10px 12px',
  },
  metaLabel: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '6px',
  },
  metaValue: {
    fontSize: '14px',
    color: '#0f172a',
    fontWeight: 800,
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  notesBox: {
    marginTop: '12px',
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: '12px',
    padding: '12px 14px',
  },
  notesLabel: {
    fontSize: '12px',
    color: '#9a3412',
    fontWeight: 800,
    marginBottom: '6px',
  },
  notesText: {
    fontSize: '14px',
    color: '#7c2d12',
    lineHeight: 1.5,
    wordBreak: 'break-word',
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
