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

type LinenStockRow = {
  linen_type: string;
  in_room_par: number;
  floor_store_stock: number;
  contractor_stock: number;
};

type LinenFloorStockRow = {
  block_no: number;
  floor_no: number;
  linen_type: string;
  qty: number;
};

type DamageRow = {
  linen_type: string;
  qty: number;
};

type ViewMode = 'OVERALL' | 'FLOOR';

type StockItem = {
  linenType: string;
  inRoomPar: number;
  floorStock: number;
  contractorStock: number;
  damaged: number;
  totalUsable: number;
  threeParTarget: number;
  shortfall: number;
};

const FLOOR_OPTIONS = [
  { key: 'B1F1', block: 1, floor: 1, label: 'Block 1 Floor 1' },
  { key: 'B1F2', block: 1, floor: 2, label: 'Block 1 Floor 2' },
  { key: 'B1F3', block: 1, floor: 3, label: 'Block 1 Floor 3' },
  { key: 'B1F5', block: 1, floor: 5, label: 'Block 1 Floor 5' },
  { key: 'B2F3', block: 2, floor: 3, label: 'Block 2 Floor 3' },
  { key: 'B2F5', block: 2, floor: 5, label: 'Block 2 Floor 5' },
  { key: 'B2F6', block: 2, floor: 6, label: 'Block 2 Floor 6' },
  { key: 'B2F7', block: 2, floor: 7, label: 'Block 2 Floor 7' },
] as const;

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

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function shortfallStyle(value: number): React.CSSProperties {
  if (value > 0) return { color: '#b91c1c', fontWeight: 800 };
  return { color: '#166534', fontWeight: 800 };
}

export default function StockCardPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('OVERALL');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');

  const [linenStock, setLinenStock] = useState<LinenStockRow[]>([]);
  const [floorStock, setFloorStock] = useState<LinenFloorStockRow[]>([]);
  const [draftFloorQty, setDraftFloorQty] = useState<Record<string, number>>({});
  const [damageRows, setDamageRows] = useState<DamageRow[]>([]);

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

  async function loadData() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const [stockRes, floorRes, damageRes] = await Promise.all([
        supabase
          .from('linen_stock')
          .select('linen_type, in_room_par, floor_store_stock, contractor_stock')
          .order('linen_type', { ascending: true }),
        supabase
          .from('linen_floor_stock')
          .select('block_no, floor_no, linen_type, qty'),
        supabase
          .from('linen_damage_log')
          .select('linen_type, qty'),
      ]);

      if (stockRes.error) throw stockRes.error;
      if (floorRes.error) throw floorRes.error;
      if (damageRes.error) throw damageRes.error;

      const stockRows = (stockRes.data || []) as LinenStockRow[];
      const floorRows = (floorRes.data || []) as LinenFloorStockRow[];
      const damage = (damageRes.data || []) as DamageRow[];

      setLinenStock(stockRows);
      setFloorStock(floorRows);
      setDamageRows(damage);

      const selectedFloor = FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey) || FLOOR_OPTIONS[0];
      const draft: Record<string, number> = {};

      floorRows
        .filter((row) => row.block_no === selectedFloor.block && row.floor_no === selectedFloor.floor)
        .forEach((row) => {
          draft[row.linen_type] = safeNumber(row.qty);
        });

      LINEN_TYPES.forEach((type) => {
        if (typeof draft[type] === 'undefined') draft[type] = 0;
      });

      setDraftFloorQty(draft);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load stock card');
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
  }, [profile, canAccess]);

  useEffect(() => {
    const selectedFloor = FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey) || FLOOR_OPTIONS[0];
    const draft: Record<string, number> = {};

    floorStock
      .filter((row) => row.block_no === selectedFloor.block && row.floor_no === selectedFloor.floor)
      .forEach((row) => {
        draft[row.linen_type] = safeNumber(row.qty);
      });

    LINEN_TYPES.forEach((type) => {
      if (typeof draft[type] === 'undefined') draft[type] = 0;
    });

    setDraftFloorQty(draft);
  }, [selectedFloorKey, floorStock]);

  const stockItems = useMemo(() => {
    const damageMap = new Map<string, number>();
    damageRows.forEach((row) => {
      damageMap.set(row.linen_type, safeNumber(damageMap.get(row.linen_type)) + safeNumber(row.qty));
    });

    const overallFloorMap = new Map<string, number>();
    floorStock.forEach((row) => {
      overallFloorMap.set(row.linen_type, safeNumber(overallFloorMap.get(row.linen_type)) + safeNumber(row.qty));
    });

    const selectedFloor = FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey) || FLOOR_OPTIONS[0];
    const selectedFloorMap = new Map<string, number>();
    floorStock
      .filter((row) => row.block_no === selectedFloor.block && row.floor_no === selectedFloor.floor)
      .forEach((row) => {
        selectedFloorMap.set(row.linen_type, safeNumber(row.qty));
      });

    const items: StockItem[] = LINEN_TYPES.map((linenType) => {
      const stockRow = linenStock.find((row) => row.linen_type === linenType);

      const inRoomPar = safeNumber(stockRow?.in_room_par);
      const contractorStock = safeNumber(stockRow?.contractor_stock);
      const damaged = safeNumber(damageMap.get(linenType));
      const floorValue =
        viewMode === 'OVERALL'
          ? safeNumber(overallFloorMap.get(linenType))
          : safeNumber(selectedFloorMap.get(linenType));

      const totalUsable = Math.max(0, inRoomPar + floorValue + contractorStock - damaged);
      const threeParTarget = inRoomPar * 3;
      const shortfall = Math.max(0, threeParTarget - totalUsable);

      return {
        linenType,
        inRoomPar,
        floorStock: floorValue,
        contractorStock,
        damaged,
        totalUsable,
        threeParTarget,
        shortfall,
      };
    });

    return items;
  }, [linenStock, floorStock, damageRows, viewMode, selectedFloorKey]);

  const headerLabel = useMemo(() => {
    if (viewMode === 'OVERALL') return 'Overall Stock';
    return FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey)?.label || 'Selected Floor';
  }, [viewMode, selectedFloorKey]);

  async function saveSelectedFloorStock() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    const selectedFloor = FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey) || FLOOR_OPTIONS[0];

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const rows = LINEN_TYPES.map((linenType) => ({
        block_no: selectedFloor.block,
        floor_no: selectedFloor.floor,
        linen_type: linenType,
        qty: safeNumber(draftFloorQty[linenType]),
      }));

      const { error } = await supabase
        .from('linen_floor_stock')
        .upsert(rows, {
          onConflict: 'block_no,floor_no,linen_type',
        });

      if (error) throw error;

      setSuccessMsg(`Saved stock for ${selectedFloor.label}.`);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save selected floor stock');
    } finally {
      setSaving(false);
    }
  }

  function changeDraftQty(linenType: string, delta: number) {
    setDraftFloorQty((prev) => ({
      ...prev,
      [linenType]: Math.max(0, safeNumber(prev[linenType]) + delta),
    }));
  }

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
            Only Supervisor, Manager, and Superuser can access Stock Card.
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
            <div style={styles.pageTitle}>Stock Card</div>
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

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>View</div>

          <div style={styles.modeRow}>
            <button
              type="button"
              onClick={() => setViewMode('OVERALL')}
              style={{
                ...styles.modeBtn,
                ...(viewMode === 'OVERALL' ? styles.modeBtnActive : {}),
              }}
            >
              Overall
            </button>

            <button
              type="button"
              onClick={() => setViewMode('FLOOR')}
              style={{
                ...styles.modeBtn,
                ...(viewMode === 'FLOOR' ? styles.modeBtnActive : {}),
              }}
            >
              By Floor
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
        </section>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>{headerLabel}</div>

          {loading ? (
            <div style={styles.emptyState}>Loading stock card...</div>
          ) : (
            <div style={styles.itemGrid}>
              {stockItems.map((item) => (
                <article key={item.linenType} style={styles.itemCard}>
                  <div style={styles.itemTitle}>{item.linenType}</div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>1 Par in Room</span>
                    <span style={styles.metricValue}>{item.inRoomPar}</span>
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>
                      {viewMode === 'OVERALL' ? 'Floor Stock Total' : 'Selected Floor Stock'}
                    </span>
                    {viewMode === 'OVERALL' ? (
                      <span style={styles.metricValue}>{item.floorStock}</span>
                    ) : (
                      <div style={styles.stepperWrap}>
                        <button
                          type="button"
                          onClick={() => changeDraftQty(item.linenType, -1)}
                          style={styles.stepBtn}
                          disabled={saving}
                        >
                          -
                        </button>
                        <span style={styles.stepValue}>
                          {safeNumber(draftFloorQty[item.linenType])}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeDraftQty(item.linenType, 1)}
                          style={styles.stepBtn}
                          disabled={saving}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>With Laundry Contractor</span>
                    <span style={styles.metricValue}>{item.contractorStock}</span>
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>Damaged</span>
                    <span style={styles.metricValue}>{item.damaged}</span>
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>Total Usable</span>
                    <span style={styles.metricValue}>{item.totalUsable}</span>
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>3 Par Target</span>
                    <span style={styles.metricValue}>{item.threeParTarget}</span>
                  </div>

                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>Shortfall to 3 Par</span>
                    <span style={{ ...styles.metricValue, ...shortfallStyle(item.shortfall) }}>
                      {item.shortfall}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}

          {viewMode === 'FLOOR' ? (
            <div style={styles.saveRow}>
              <button
                type="button"
                onClick={saveSelectedFloorStock}
                disabled={saving || loading}
                style={{
                  ...styles.primaryBtn,
                  opacity: saving || loading ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Save Floor Stock'}
              </button>
            </div>
          ) : null}
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
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
  stepperWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  stepBtn: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    fontWeight: 800,
    cursor: 'pointer',
  },
  stepValue: {
    minWidth: '34px',
    textAlign: 'center',
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
  },
  saveRow: {
    display: 'flex',
    justifyContent: 'flex-end',
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
