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

type RoomMasterRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
};

type StatusRow = {
  room_number: string;
  status: 'VACANT' | 'CHECKOUT' | 'STAYOVER';
};

type EntryRow = {
  room_number: string;
  is_dnd: boolean;
  bedsheet_king: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

type LinenMapRow = {
  room_type: string;
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

type LinenTotals = {
  bedsheet_king: number;
  pillow_case: number;
  bath_towel: number;
  bath_mat: number;
  duvet_cover_king: number;
  duvet_cover_single: number;
};

type GroupSummary = {
  label: string;
  expected: LinenTotals;
  actual: LinenTotals;
  difference: LinenTotals;
  roomCount: number;
  dndCount: number;
};

type ViewMode = 'FLOOR' | 'BLOCK' | 'GRAND_TOTAL';

const FLOORS_BY_BLOCK: Record<number, number[]> = {
  1: [1, 2, 3, 5],
  2: [3, 5, 6, 7],
};

const ITEM_DEFS: Array<{ key: keyof LinenTotals; label: string }> = [
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

function zeroTotals(): LinenTotals {
  return {
    bedsheet_king: 0,
    pillow_case: 0,
    bath_towel: 0,
    bath_mat: 0,
    duvet_cover_king: 0,
    duvet_cover_single: 0,
  };
}

function addTotals(target: LinenTotals, source: Partial<LinenTotals> | null | undefined) {
  if (!source) return;
  target.bedsheet_king += Number(source.bedsheet_king || 0);
  target.pillow_case += Number(source.pillow_case || 0);
  target.bath_towel += Number(source.bath_towel || 0);
  target.bath_mat += Number(source.bath_mat || 0);
  target.duvet_cover_king += Number(source.duvet_cover_king || 0);
  target.duvet_cover_single += Number(source.duvet_cover_single || 0);
}

function subtractTotals(actual: LinenTotals, expected: LinenTotals): LinenTotals {
  return {
    bedsheet_king: actual.bedsheet_king - expected.bedsheet_king,
    pillow_case: actual.pillow_case - expected.pillow_case,
    bath_towel: actual.bath_towel - expected.bath_towel,
    bath_mat: actual.bath_mat - expected.bath_mat,
    duvet_cover_king: actual.duvet_cover_king - expected.duvet_cover_king,
    duvet_cover_single: actual.duvet_cover_single - expected.duvet_cover_single,
  };
}

function countNonVacantStatus(status: StatusRow['status']) {
  return status === 'CHECKOUT' || status === 'STAYOVER';
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

export default function LaundryCountPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('FLOOR');

  const [rooms, setRooms] = useState<RoomMasterRow[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [linenMap, setLinenMap] = useState<LinenMapRow[]>([]);

  const serviceDate = getTodayLocalDateString();

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

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    let mounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setErrorMsg('');

        const supabase = getSupabaseSafe();
        if (!supabase) {
          throw new Error('Supabase is not configured.');
        }

        const [roomRes, statusRes, entryRes, mapRes] = await Promise.all([
          supabase
            .from('room_master')
            .select('room_number, block_no, floor_no, room_type')
            .eq('is_active', true)
            .order('room_number', { ascending: true }),
          supabase
            .from('linen_room_status')
            .select('room_number, status')
            .eq('service_date', serviceDate)
            .in('status', ['CHECKOUT', 'STAYOVER']),
          supabase
            .from('linen_room_entry')
            .select(
              'room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'
            )
            .eq('service_date', serviceDate),
          supabase
            .from('linen_room_type_map')
            .select(
              'room_type, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'
            ),
        ]);

        if (roomRes.error) throw roomRes.error;
        if (statusRes.error) throw statusRes.error;
        if (entryRes.error) throw entryRes.error;
        if (mapRes.error) throw mapRes.error;

        if (!mounted) return;

        setRooms((roomRes.data || []) as RoomMasterRow[]);
        setStatuses((statusRes.data || []) as StatusRow[]);
        setEntries((entryRes.data || []) as EntryRow[]);
        setLinenMap((mapRes.data || []) as LinenMapRow[]);
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load laundry count');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadData();

    return () => {
      mounted = false;
    };
  }, [profile, canAccess, serviceDate]);

  const data = useMemo(() => {
    const roomByNumber = new Map<string, RoomMasterRow>();
    const mapByRoomType = new Map<string, LinenMapRow>();
    const entryByRoom = new Map<string, EntryRow>();

    rooms.forEach((room) => roomByNumber.set(room.room_number, room));
    linenMap.forEach((row) => mapByRoomType.set(row.room_type, row));
    entries.forEach((row) => entryByRoom.set(row.room_number, row));

    const floorGroups = new Map<string, GroupSummary>();
    const blockGroups = new Map<string, GroupSummary>();
    const grandExpected = zeroTotals();
    const grandActual = zeroTotals();
    let grandRoomCount = 0;
    let grandDndCount = 0;

    function getOrCreateGroup(map: Map<string, GroupSummary>, label: string) {
      const existing = map.get(label);
      if (existing) return existing;

      const next: GroupSummary = {
        label,
        expected: zeroTotals(),
        actual: zeroTotals(),
        difference: zeroTotals(),
        roomCount: 0,
        dndCount: 0,
      };

      map.set(label, next);
      return next;
    }

    statuses.forEach((statusRow) => {
      if (!countNonVacantStatus(statusRow.status)) return;

      const room = roomByNumber.get(statusRow.room_number);
      if (!room) return;

      const roomTypeMap = mapByRoomType.get(room.room_type);
      const entry = entryByRoom.get(room.room_number);
      const isDnd = Boolean(entry?.is_dnd);

      const expectedForRoom = zeroTotals();
      if (!isDnd && roomTypeMap) {
        addTotals(expectedForRoom, roomTypeMap);
      }

      const actualForRoom = zeroTotals();
      if (entry && !isDnd) {
        addTotals(actualForRoom, {
          bedsheet_king: entry.bedsheet_king || 0,
          pillow_case: entry.pillow_case || 0,
          bath_towel: entry.bath_towel || 0,
          bath_mat: entry.bath_mat || 0,
          duvet_cover_king: entry.duvet_cover_king || 0,
          duvet_cover_single: entry.duvet_cover_single || 0,
        });
      }

      const floorLabel = `Block ${room.block_no} · Floor ${room.floor_no}`;
      const blockLabel = `Block ${room.block_no}`;

      const floorGroup = getOrCreateGroup(floorGroups, floorLabel);
      const blockGroup = getOrCreateGroup(blockGroups, blockLabel);

      addTotals(floorGroup.expected, expectedForRoom);
      addTotals(floorGroup.actual, actualForRoom);
      addTotals(blockGroup.expected, expectedForRoom);
      addTotals(blockGroup.actual, actualForRoom);
      addTotals(grandExpected, expectedForRoom);
      addTotals(grandActual, actualForRoom);

      floorGroup.roomCount += 1;
      blockGroup.roomCount += 1;
      grandRoomCount += 1;

      if (isDnd) {
        floorGroup.dndCount += 1;
        blockGroup.dndCount += 1;
        grandDndCount += 1;
      }
    });

    floorGroups.forEach((group) => {
      group.difference = subtractTotals(group.actual, group.expected);
    });

    blockGroups.forEach((group) => {
      group.difference = subtractTotals(group.actual, group.expected);
    });

    const grandSummary: GroupSummary = {
      label: 'Grand Total',
      expected: grandExpected,
      actual: grandActual,
      difference: subtractTotals(grandActual, grandExpected),
      roomCount: grandRoomCount,
      dndCount: grandDndCount,
    };

    const orderedFloorGroups: GroupSummary[] = [];
    Object.entries(FLOORS_BY_BLOCK).forEach(([blockStr, floors]) => {
      const blockNo = Number(blockStr);
      floors.forEach((floorNo) => {
        const label = `Block ${blockNo} · Floor ${floorNo}`;
        const group = floorGroups.get(label);
        if (group) orderedFloorGroups.push(group);
      });
    });

    const orderedBlockGroups: GroupSummary[] = [1, 2]
      .map((blockNo) => blockGroups.get(`Block ${blockNo}`))
      .filter(Boolean) as GroupSummary[];

    return {
      floorGroups: orderedFloorGroups,
      blockGroups: orderedBlockGroups,
      grandSummary,
    };
  }, [rooms, statuses, entries, linenMap]);

  const visibleGroups = useMemo(() => {
    if (viewMode === 'FLOOR') return data.floorGroups;
    if (viewMode === 'BLOCK') return data.blockGroups;
    return [data.grandSummary];
  }, [data, viewMode]);

  const currentHeading =
    viewMode === 'FLOOR' ? 'By Floor' : viewMode === 'BLOCK' ? 'By Block' : 'Grand Total';

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
            Only Supervisor, Manager, and Superuser can access Laundry Count.
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
            <div style={styles.pageTitle}>Laundry Count</div>
            <div style={styles.pageSubTitle}>
              Service Date: {serviceDate} · {profile.name} ({profile.role})
            </div>
          </div>

          <div style={styles.topBarActions}>
            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Rooms to Service</div>
            <div style={styles.summaryValue}>{data.grandSummary.roomCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>DND Rooms</div>
            <div style={styles.summaryValue}>{data.grandSummary.dndCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Floors Active</div>
            <div style={styles.summaryValue}>{data.floorGroups.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Blocks Active</div>
            <div style={styles.summaryValue}>{data.blockGroups.length}</div>
          </div>
        </div>

        <section style={styles.panel}>
          <div style={styles.toggleRow}>
            <button
              type="button"
              onClick={() => setViewMode('FLOOR')}
              style={{ ...styles.toggleBtn, ...(viewMode === 'FLOOR' ? styles.toggleBtnActive : {}) }}
            >
              By Floor
            </button>
            <button
              type="button"
              onClick={() => setViewMode('BLOCK')}
              style={{ ...styles.toggleBtn, ...(viewMode === 'BLOCK' ? styles.toggleBtnActive : {}) }}
            >
              By Block
            </button>
            <button
              type="button"
              onClick={() => setViewMode('GRAND_TOTAL')}
              style={{ ...styles.toggleBtn, ...(viewMode === 'GRAND_TOTAL' ? styles.toggleBtnActive : {}) }}
            >
              Grand Total
            </button>
          </div>

          <div style={styles.sectionTitle}>{currentHeading}</div>

          {loading ? (
            <div style={styles.emptyState}>Loading laundry count...</div>
          ) : visibleGroups.length === 0 ? (
            <div style={styles.emptyState}>No supervisor-marked rooms for today yet.</div>
          ) : (
            <div style={styles.groupGrid}>
              {visibleGroups.map((group) => (
                <GroupCard key={group.label} group={group} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <article style={styles.groupCard}>
      <div style={styles.groupHeader}>
        <div>
          <div style={styles.groupTitle}>{group.label}</div>
          <div style={styles.groupMeta}>
            Rooms: {group.roomCount} · DND: {group.dndCount}
          </div>
        </div>
      </div>

      <div style={styles.itemList}>
        {ITEM_DEFS.map((item) => {
          const diffValue = group.difference[item.key];
          return (
            <div key={item.key} style={styles.itemCard}>
              <div style={styles.itemTitle}>{item.label}</div>
              <div style={styles.metricRow}>
                <div style={styles.metricBox}>
                  <div style={styles.metricLabel}>Expected</div>
                  <div style={styles.metricValue}>{group.expected[item.key]}</div>
                </div>
                <div style={styles.metricBox}>
                  <div style={styles.metricLabel}>Actual</div>
                  <div style={styles.metricValue}>{group.actual[item.key]}</div>
                </div>
                <div style={styles.metricBox}>
                  <div style={styles.metricLabel}>Difference</div>
                  <div style={{ ...styles.metricValue, ...diffStyle(diffValue) }}>{formatDiff(diffValue)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
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
    marginBottom: '14px',
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  summaryCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '14px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '30px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1,
  },
  toggleRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '16px',
  },
  toggleBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  toggleBtnActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  groupGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '14px',
  },
  groupCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
  },
  groupHeader: {
    marginBottom: '12px',
  },
  groupTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  groupMeta: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
    fontWeight: 600,
  },
  itemList: {
    display: 'grid',
    gap: '10px',
  },
  itemCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '12px',
    background: '#f8fafc',
  },
  itemTitle: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  metricRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '10px',
  },
  metricBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '10px',
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '6px',
  },
  metricValue: {
    fontSize: '24px',
    color: '#0f172a',
    fontWeight: 800,
    lineHeight: 1,
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
