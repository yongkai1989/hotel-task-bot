'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_linen_admin?: boolean;
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

type LinenBillRow = {
  id?: string;
  service_date: string;
  block_no: number;
  floor_no?: number | null;
  bedsheet_king: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
  created_at?: string;
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
  key: string;
  label: string;
  expected: LinenTotals;
  actual: LinenTotals;
  inBill: LinenTotals;
  difference: LinenTotals;
  roomCount: number;
  dndCount: number;
};

type ViewMode = 'FLOOR' | 'BLOCK' | 'GRAND';
type PageTab = 'COUNT' | 'BILL_ENTRY' | 'BILL_GRAND';
type FloorKey = (typeof FLOOR_KEYS)[number];

const FLOOR_KEYS = ['B1F1', 'B1F2', 'B1F3', 'B1F5', 'B2F3', 'B2F5', 'B2F6', 'B2F7'] as const;
const BLOCK_KEYS = ['B1', 'B2'] as const;
const LAUNDRY_ONLY_EMAIL = 'laundry@hotelhallmark.com';
const FLOOR_CONFIG: Array<{ key: FloorKey; blockNo: 1 | 2; floorNo: number; label: string }> = [
  { key: 'B1F1', blockNo: 1, floorNo: 1, label: 'Block 1 Floor 1' },
  { key: 'B1F2', blockNo: 1, floorNo: 2, label: 'Block 1 Floor 2' },
  { key: 'B1F3', blockNo: 1, floorNo: 3, label: 'Block 1 Floor 3' },
  { key: 'B1F5', blockNo: 1, floorNo: 5, label: 'Block 1 Floor 5' },
  { key: 'B2F3', blockNo: 2, floorNo: 3, label: 'Block 2 Floor 3' },
  { key: 'B2F5', blockNo: 2, floorNo: 5, label: 'Block 2 Floor 5' },
  { key: 'B2F6', blockNo: 2, floorNo: 6, label: 'Block 2 Floor 6' },
  { key: 'B2F7', blockNo: 2, floorNo: 7, label: 'Block 2 Floor 7' },
];

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

function subtractTotals(left: LinenTotals, right: LinenTotals): LinenTotals {
  return {
    bedsheet_king: left.bedsheet_king - right.bedsheet_king,
    pillow_case: left.pillow_case - right.pillow_case,
    bath_towel: left.bath_towel - right.bath_towel,
    bath_mat: left.bath_mat - right.bath_mat,
    duvet_cover_king: left.duvet_cover_king - right.duvet_cover_king,
    duvet_cover_single: left.duvet_cover_single - right.duvet_cover_single,
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

function floorKey(blockNo: number, floorNo: number) {
  return `B${blockNo}F${floorNo}`;
}

function toTotalsFromBillRow(row?: Partial<LinenBillRow> | null): LinenTotals {
  return {
    bedsheet_king: Number(row?.bedsheet_king || 0),
    pillow_case: Number(row?.pillow_case || 0),
    bath_towel: Number(row?.bath_towel || 0),
    bath_mat: Number(row?.bath_mat || 0),
    duvet_cover_king: Number(row?.duvet_cover_king || 0),
    duvet_cover_single: Number(row?.duvet_cover_single || 0),
  };
}

function emptyBillEntryMap(): Record<FloorKey, LinenTotals> {
  return FLOOR_CONFIG.reduce((acc, floor) => {
    acc[floor.key] = zeroTotals();
    return acc;
  }, {} as Record<FloorKey, LinenTotals>);
}

function aggregateBillEntriesByBlock(entryMap: Record<FloorKey, LinenTotals>) {
  const block1 = zeroTotals();
  const block2 = zeroTotals();

  FLOOR_CONFIG.forEach((floor) => {
    const source = entryMap[floor.key] || zeroTotals();
    if (floor.blockNo === 1) {
      addTotals(block1, source);
    } else {
      addTotals(block2, source);
    }
  });

  return { block1, block2 };
}

export default function LaundryCountPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [runningNewDay, setRunningNewDay] = useState(false);
  const [alreadyRanToday, setAlreadyRanToday] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [rooms, setRooms] = useState<RoomMasterRow[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [linenMap, setLinenMap] = useState<LinenMapRow[]>([]);
  const [billRows, setBillRows] = useState<LinenBillRow[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>('FLOOR');
  const [pageTab, setPageTab] = useState<PageTab>('COUNT');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');
  const [selectedBlockKey, setSelectedBlockKey] = useState<string>('B1');
  const [savingBill, setSavingBill] = useState(false);

  const [billEntryMap, setBillEntryMap] = useState<Record<FloorKey, LinenTotals>>(emptyBillEntryMap());

  const serviceDate = getTodayLocalDateString();

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role, can_access_linen_admin')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'HK') as DashboardUser['role'],
          can_access_linen_admin: profileRow?.can_access_linen_admin ?? false,
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

  const isLaundryOnlyUser = useMemo(() => {
    return (profile?.email || '').trim().toLowerCase() === LAUNDRY_ONLY_EMAIL;
  }, [profile]);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    if (isLaundryOnlyUser) return true;

    if (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      profile.role === 'SUPERVISOR'
    ) {
      return true;
    }

    return profile.can_access_linen_admin === true;
  }, [profile, isLaundryOnlyUser]);

  const canRunNewDay = useMemo(() => {
    if (!profile || isLaundryOnlyUser) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER';
  }, [profile, isLaundryOnlyUser]);

  async function checkAlreadyRanToday() {
    const supabase = getSupabaseSafe();
    if (!supabase) return;

    const { data, error } = await supabase
      .from('linen_daily_snapshot')
      .select('service_date')
      .eq('service_date', serviceDate)
      .maybeSingle();

    if (!error) {
      setAlreadyRanToday(!!data);
    }
  }

  async function loadData() {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const supabase = getSupabaseSafe();
      if (!supabase) throw new Error('Supabase is not configured.');

      const [roomRes, statusRes, entryRes, mapRes, billRes] = await Promise.all([
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
          .select('room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .eq('service_date', serviceDate),
        supabase
          .from('linen_room_type_map')
          .select('room_type, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'),
        supabase
          .from('linen_laundry_bill')
          .select('*')
          .eq('service_date', serviceDate)
          .order('block_no', { ascending: true }),
      ]);

      if (roomRes.error) throw roomRes.error;
      if (statusRes.error) throw statusRes.error;
      if (entryRes.error) throw entryRes.error;
      if (mapRes.error) throw mapRes.error;
      if (billRes.error) throw billRes.error;

      setRooms((roomRes.data || []) as RoomMasterRow[]);
      setStatuses((statusRes.data || []) as StatusRow[]);
      setEntries((entryRes.data || []) as EntryRow[]);
      setLinenMap((mapRes.data || []) as LinenMapRow[]);
      setBillRows((billRes.data || []) as LinenBillRow[]);

      const nextBillEntryMap = emptyBillEntryMap();
      const detailedRows = (billRes.data || []).filter((row: any) =>
        typeof row.floor_no === 'number' && !Number.isNaN(Number(row.floor_no))
      );

      detailedRows.forEach((row: any) => {
        const key = floorKey(Number(row.block_no), Number(row.floor_no)) as FloorKey;
        if (!FLOOR_KEYS.includes(key)) return;
        nextBillEntryMap[key] = toTotalsFromBillRow(row);
      });

      setBillEntryMap(nextBillEntryMap);

      await checkAlreadyRanToday();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load laundry count');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [profile, canAccess, serviceDate]);

  useEffect(() => {
    if (isLaundryOnlyUser) {
      setPageTab('BILL_ENTRY');
    }
  }, [isLaundryOnlyUser]);

  const summaries = useMemo(() => {
    const roomByNumber = new Map<string, RoomMasterRow>();
    const mapByRoomType = new Map<string, LinenMapRow>();
    const entryByRoom = new Map<string, EntryRow>();

    rooms.forEach((room) => roomByNumber.set(room.room_number, room));
    linenMap.forEach((row) => mapByRoomType.set(row.room_type, row));
    entries.forEach((row) => entryByRoom.set(row.room_number, row));

    const { block1: billBlock1, block2: billBlock2 } = aggregateBillEntriesByBlock(billEntryMap);
    const billByBlock = new Map<number, LinenTotals>([
      [1, billBlock1],
      [2, billBlock2],
    ]);

    const floorGroups = new Map<string, GroupSummary>();
    const blockGroups = new Map<string, GroupSummary>();
    const grandExpected = zeroTotals();
    const grandActual = zeroTotals();
    const grandInBill = zeroTotals();
    let grandRoomCount = 0;
    let grandDndCount = 0;

    function getOrCreateFloorGroup(blockNo: number, floorNo: number) {
      const key = floorKey(blockNo, floorNo);
      const existing = floorGroups.get(key);
      if (existing) return existing;
      const next: GroupSummary = {
        key,
        label: `Block ${blockNo} · Floor ${floorNo}`,
        expected: zeroTotals(),
        actual: zeroTotals(),
        inBill: zeroTotals(),
        difference: zeroTotals(),
        roomCount: 0,
        dndCount: 0,
      };
      floorGroups.set(key, next);
      return next;
    }

    function getOrCreateBlockGroup(blockNo: number) {
      const key = `B${blockNo}`;
      const existing = blockGroups.get(key);
      if (existing) return existing;
      const next: GroupSummary = {
        key,
        label: `Block ${blockNo}`,
        expected: zeroTotals(),
        actual: zeroTotals(),
        inBill: toTotalsFromBillRow(billByBlock.get(blockNo)),
        difference: zeroTotals(),
        roomCount: 0,
        dndCount: 0,
      };
      blockGroups.set(key, next);
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
      if (!isDnd && roomTypeMap) addTotals(expectedForRoom, roomTypeMap);

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

      const floorGroup = getOrCreateFloorGroup(room.block_no, room.floor_no);
      const blockGroup = getOrCreateBlockGroup(room.block_no);

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

    addTotals(grandInBill, billBlock1);
    addTotals(grandInBill, billBlock2);

    floorGroups.forEach((group) => {
      group.difference = subtractTotals(group.actual, group.expected);
    });
    blockGroups.forEach((group) => {
      group.difference = subtractTotals(group.inBill, group.actual);
    });

    const floorList = FLOOR_KEYS.map((key) => floorGroups.get(key)).filter(Boolean) as GroupSummary[];
    const blockList = BLOCK_KEYS.map((key) => blockGroups.get(key)).filter(Boolean) as GroupSummary[];

    const grand: GroupSummary = {
      key: 'GRAND',
      label: 'Grand Total',
      expected: grandExpected,
      actual: grandActual,
      inBill: grandInBill,
      difference: subtractTotals(grandInBill, grandActual),
      roomCount: grandRoomCount,
      dndCount: grandDndCount,
    };

    return { floorList, blockList, grand };
  }, [rooms, statuses, entries, linenMap, billEntryMap]);

  useEffect(() => {
    if (summaries.floorList.length > 0 && !summaries.floorList.find((g) => g.key === selectedFloorKey)) {
      setSelectedFloorKey(summaries.floorList[0].key);
    }
    if (summaries.blockList.length > 0 && !summaries.blockList.find((g) => g.key === selectedBlockKey)) {
      setSelectedBlockKey(summaries.blockList[0].key);
    }
  }, [summaries.floorList, summaries.blockList, selectedFloorKey, selectedBlockKey]);

  const selectedSummary = useMemo(() => {
    if (viewMode === 'FLOOR') {
      return summaries.floorList.find((g) => g.key === selectedFloorKey) || summaries.floorList[0] || null;
    }
    if (viewMode === 'BLOCK') {
      return summaries.blockList.find((g) => g.key === selectedBlockKey) || summaries.blockList[0] || null;
    }
    return summaries.grand;
  }, [viewMode, selectedFloorKey, selectedBlockKey, summaries]);

  async function handleNewDay() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    const { data: existing } = await supabase
      .from('linen_daily_snapshot')
      .select('service_date')
      .eq('service_date', serviceDate)
      .maybeSingle();

    if (existing) {
      setAlreadyRanToday(true);
      window.alert('New Day already run today.');
      return;
    }

    const confirmed = window.confirm(
      "Run New Day now? This will snapshot yesterday, clean old history, and reset today's live linen data."
    );
    if (!confirmed) return;

    try {
      setRunningNewDay(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase.rpc('run_linen_daily_automation');
      if (error) throw error;

      setAlreadyRanToday(true);
      setSuccessMsg('New Day completed successfully.');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to run New Day');
    } finally {
      setRunningNewDay(false);
    }
  }

  function updateBillValue(floorKeyValue: FloorKey, key: keyof LinenTotals, rawValue: string) {
    const parsed = rawValue === '' ? 0 : Math.max(0, Number(rawValue || 0));
    if (Number.isNaN(parsed)) return;

    setBillEntryMap((prev) => ({
      ...prev,
      [floorKeyValue]: {
        ...(prev[floorKeyValue] || zeroTotals()),
        [key]: parsed,
      },
    }));
  }

  async function handleSaveBill() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setSavingBill(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error: deleteError } = await supabase
        .from('linen_laundry_bill')
        .delete()
        .eq('service_date', serviceDate);

      if (deleteError) throw deleteError;

      const rows = FLOOR_CONFIG.map((floor) => ({
        service_date: serviceDate,
        block_no: floor.blockNo,
        floor_no: floor.floorNo,
        ...billEntryMap[floor.key],
      }));

      const { error: insertError } = await supabase
        .from('linen_laundry_bill')
        .insert(rows);

      if (insertError) throw insertError;

      setSuccessMsg('Laundry Bill saved successfully.');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save Laundry Bill');
    } finally {
      setSavingBill(false);
    }
  }

  function renderBillEditor(floor: { key: FloorKey; blockNo: 1 | 2; floorNo: number; label: string }, totals: LinenTotals) {
    return (
      <section style={styles.billCard}>
        <div style={styles.billCardTitle}>{floor.label}</div>
        <div style={styles.billGrid}>
          {ITEM_DEFS.map((item) => (
            <div key={`${floor.key}-${item.key}`} style={styles.formGroup}>
              <label style={styles.formLabel}>{item.label}</label>
              <input
                type="number"
                min="0"
                value={totals[item.key]}
                onChange={(e) => updateBillValue(floor.key, item.key, e.target.value)}
                style={styles.numberInput}
              />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const billGrandTotals = useMemo(() => aggregateBillEntriesByBlock(billEntryMap), [billEntryMap]);

  function renderBillGrandTotalCard(
    label: string,
    totals: LinenTotals,
    accent: React.CSSProperties
  ) {
    return (
      <section style={{ ...styles.billCard, ...styles.billGrandCard }}>
        <div style={{ ...styles.billCardTitle, marginBottom: '12px' }}>{label}</div>
        <div style={styles.billGrandGrid}>
          {ITEM_DEFS.map((item) => (
            <div key={`${label}-${item.key}`} style={styles.billGrandMetric}>
              <div style={styles.billGrandMetricLabel}>{item.label}</div>
              <div style={{ ...styles.billGrandMetricValue, ...accent }}>
                {totals[item.key]}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
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
          <p style={styles.centerText}>You do not have permission to access Laundry Count.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (isLaundryOnlyUser) {
    return (
      <main style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.topBar}>
            <div>
              <div style={styles.pageTitle}>Laundry Bill</div>
              <div style={styles.pageSubTitle}>Service Date: {serviceDate} · {profile.name}</div>
            </div>
          </div>

          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
          {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Laundry Bill</div>
            <div style={styles.modeRow}>
              <button
                type="button"
                onClick={() => setPageTab('BILL_ENTRY')}
                style={{ ...styles.modeBtn, ...(pageTab === 'BILL_ENTRY' ? styles.modeBtnActive : {}) }}
              >
                Laundry Bill Entry
              </button>
              <button
                type="button"
                onClick={() => setPageTab('BILL_GRAND')}
                style={{ ...styles.modeBtn, ...(pageTab === 'BILL_GRAND' ? styles.modeBtnActive : {}) }}
              >
                Laundry Bill Grand Total
              </button>
            </div>

            {pageTab === 'BILL_GRAND' ? (
              <>
                <div style={styles.groupMeta}>Only Laundry Bill tabs are available for this account.</div>
                {renderBillGrandTotalCard('Block 1 Grand Total', billGrandTotals.block1, { color: '#166534' })}
                {renderBillGrandTotalCard('Block 2 Grand Total', billGrandTotals.block2, { color: '#1d4ed8' })}
              </>
            ) : (
              <>
                <div style={styles.groupMeta}>Only Laundry Bill tabs are available for this account.</div>
                {FLOOR_CONFIG.map((floor) => renderBillEditor(floor, billEntryMap[floor.key] || zeroTotals()))}

                <div style={styles.billActionRow}>
                  <button
                    type="button"
                    onClick={handleSaveBill}
                    disabled={savingBill}
                    style={{ ...styles.primaryBtn, opacity: savingBill ? 0.55 : 1 }}
                  >
                    {savingBill ? 'Saving...' : 'Save Laundry Bill'}
                  </button>
                </div>
              </>
            )}
          </section>
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
            <div style={styles.pageSubTitle}>Service Date: {serviceDate} · {profile.name} ({profile.role})</div>
          </div>
          <div style={styles.topBarActions}>
            {canRunNewDay ? (
              <button
                type="button"
                onClick={handleNewDay}
                disabled={runningNewDay || alreadyRanToday}
                style={{ ...styles.newDayBtn, opacity: runningNewDay || alreadyRanToday ? 0.55 : 1 }}
              >
                {alreadyRanToday ? 'Already Ran Today' : runningNewDay ? 'Running...' : 'New Day'}
              </button>
            ) : null}
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <div style={styles.summaryRow}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Rooms to Service</div>
            <div style={styles.summaryValue}>{summaries.grand.roomCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>DND Rooms</div>
            <div style={styles.summaryValue}>{summaries.grand.dndCount}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Floors Active</div>
            <div style={styles.summaryValue}>{summaries.floorList.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Blocks Active</div>
            <div style={styles.summaryValue}>{summaries.blockList.length}</div>
          </div>
        </div>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Page</div>

          <div style={styles.modeRow}>
            <button
              type="button"
              onClick={() => setPageTab('COUNT')}
              style={{ ...styles.modeBtn, ...(pageTab === 'COUNT' ? styles.modeBtnActive : {}) }}
            >
              Laundry Count
            </button>
            <button
              type="button"
              onClick={() => setPageTab('BILL_ENTRY')}
              style={{ ...styles.modeBtn, ...(pageTab === 'BILL_ENTRY' ? styles.modeBtnActive : {}) }}
            >
              Laundry Bill Entry
            </button>
            <button
              type="button"
              onClick={() => setPageTab('BILL_GRAND')}
              style={{ ...styles.modeBtn, ...(pageTab === 'BILL_GRAND' ? styles.modeBtnActive : {}) }}
            >
              Laundry Bill Grand Total
            </button>
          </div>
        </section>

        {pageTab === 'BILL_ENTRY' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Laundry Bill Entry</div>
            <div style={styles.groupMeta}>
              Enter each floor's count accordingly
            </div>

            {FLOOR_CONFIG.map((floor) => renderBillEditor(floor, billEntryMap[floor.key] || zeroTotals()))}

            <div style={styles.billActionRow}>
              <button
                type="button"
                onClick={handleSaveBill}
                disabled={savingBill}
                style={{ ...styles.primaryBtn, opacity: savingBill ? 0.55 : 1 }}
              >
                {savingBill ? 'Saving...' : 'Save Laundry Bill'}
              </button>
            </div>
          </section>
        ) : pageTab === 'BILL_GRAND' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Laundry Bill Grand Total</div>
            <div style={styles.groupMeta}>
              Totals below add up all floors in Block 1 and Block 2 from Laundry Bill Entry.
            </div>
            {renderBillGrandTotalCard('Block 1 Grand Total', billGrandTotals.block1, { color: '#166534' })}
            {renderBillGrandTotalCard('Block 2 Grand Total', billGrandTotals.block2, { color: '#1d4ed8' })}
          </section>
        ) : (
          <>
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
                  {summaries.floorList.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setSelectedFloorKey(group.key)}
                      style={{ ...styles.selectorBtn, ...(selectedFloorKey === group.key ? styles.selectorBtnActive : {}) }}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {viewMode === 'BLOCK' ? (
                <div style={styles.selectorRow}>
                  {summaries.blockList.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setSelectedBlockKey(group.key)}
                      style={{ ...styles.selectorBtn, ...(selectedBlockKey === group.key ? styles.selectorBtnActive : {}) }}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            {loading ? (
              <section style={styles.panel}>
                <div style={styles.emptyState}>Loading laundry count...</div>
              </section>
            ) : !selectedSummary ? (
              <section style={styles.panel}>
                <div style={styles.emptyState}>No supervisor-marked rooms for today yet.</div>
              </section>
            ) : (
              <section style={styles.panel}>
                <div style={styles.sectionTitle}>{selectedSummary.label}</div>
                <div style={styles.groupMeta}>Rooms: {selectedSummary.roomCount} · DND: {selectedSummary.dndCount}</div>

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
                          <span style={styles.metricLabel}>Actual Maid Used</span>
                          <span style={styles.metricValue}>{selectedSummary.actual[item.key]}</span>
                        </div>

                        {viewMode !== 'FLOOR' ? (
                          <>
                            <div style={styles.metricRow}>
                              <span style={styles.metricLabel}>In Bill</span>
                              <span style={styles.metricValue}>{selectedSummary.inBill[item.key]}</span>
                            </div>
                            <div style={styles.metricRow}>
                              <span style={styles.metricLabel}>Difference</span>
                              <span style={{ ...styles.metricValue, ...diffStyle(diffValue) }}>
                                {formatDiff(diffValue)}
                              </span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
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
  groupMeta: {
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '14px',
    fontWeight: 700,
  },
  itemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
  newDayBtn: {
    border: 'none',
    background: '#16a34a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
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
  billCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
    marginBottom: '14px',
  },
  billCardTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  billGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  billGrandCard: {
    background: '#f8fafc',
  },
  billGrandGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
  },
  billGrandMetric: {
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    background: '#ffffff',
    padding: '14px',
  },
  billGrandMetricLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
    lineHeight: 1.35,
  },
  billGrandMetricValue: {
    fontSize: '28px',
    color: '#0f172a',
    fontWeight: 800,
    lineHeight: 1,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  formLabel: {
    fontSize: '14px',
    color: '#334155',
    fontWeight: 700,
  },
  numberInput: {
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
  billActionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '16px',
  },
};
