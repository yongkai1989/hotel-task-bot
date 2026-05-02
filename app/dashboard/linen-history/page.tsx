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
type PageTab = 'COUNT' | 'BILL_ENTRY' | 'BILL_GRAND';

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
  service_date: string;
  block_no: number;
  floor_no?: number | null;
  bedsheet_king: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
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
};

type SnapshotRow = {
  service_date: string;
  expected_json: any;
  actual_json: any;
  difference_json: any;
};

type HistoryData = {
  snapshot: SnapshotRow | null;
  floorBillMap: Record<string, LinenTotals>;
  blockBillTotals: Record<string, LinenTotals>;
  source: 'live' | 'snapshot' | 'snapshot-next-day-fallback' | 'historical-live-fallback';
  snapshotServiceDate?: string | null;
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

const FLOOR_CONFIG = [
  { key: 'B1F1', blockNo: 1, floorNo: 1, label: 'Block 1 Floor 1' },
  { key: 'B1F2', blockNo: 1, floorNo: 2, label: 'Block 1 Floor 2' },
  { key: 'B1F3', blockNo: 1, floorNo: 3, label: 'Block 1 Floor 3' },
  { key: 'B1F5', blockNo: 1, floorNo: 5, label: 'Block 1 Floor 5' },
  { key: 'B2F3', blockNo: 2, floorNo: 3, label: 'Block 2 Floor 3' },
  { key: 'B2F5', blockNo: 2, floorNo: 5, label: 'Block 2 Floor 5' },
  { key: 'B2F6', blockNo: 2, floorNo: 6, label: 'Block 2 Floor 6' },
  { key: 'B2F7', blockNo: 2, floorNo: 7, label: 'Block 2 Floor 7' },
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

function shiftDateString(baseDate: string, offsetDays: number) {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatHistoryDateLabel(value: string, today: string) {
  if (value === today) return 'Today';
  if (value === shiftDateString(today, -1)) return 'Yesterday';

  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  });
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
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
  target.bedsheet_king += safeNumber(source.bedsheet_king);
  target.pillow_case += safeNumber(source.pillow_case);
  target.bath_towel += safeNumber(source.bath_towel);
  target.bath_mat += safeNumber(source.bath_mat);
  target.duvet_cover_king += safeNumber(source.duvet_cover_king);
  target.duvet_cover_single += safeNumber(source.duvet_cover_single);
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

function floorKey(blockNo: number, floorNo: number) {
  return `B${blockNo}F${floorNo}`;
}

function buildBillMaps(rows: LinenBillRow[]) {
  const floorBillMap: Record<string, LinenTotals> = {};
  const blockBillTotals: Record<string, LinenTotals> = {
    B1: zeroTotals(),
    B2: zeroTotals(),
  };

  FLOOR_CONFIG.forEach((floor) => {
    floorBillMap[floor.key] = zeroTotals();
  });

  rows.forEach((row) => {
    const totals = parseTotals(row);
    const blockKey = `B${row.block_no}`;

    addTotals(blockBillTotals[blockKey] || (blockBillTotals[blockKey] = zeroTotals()), totals);

    if (typeof row.floor_no === 'number') {
      floorBillMap[floorKey(row.block_no, row.floor_no)] = totals;
    }
  });

  return { floorBillMap, blockBillTotals };
}

function buildSnapshotFromLiveData(
  rooms: RoomMasterRow[],
  statuses: StatusRow[],
  entries: EntryRow[],
  linenMap: LinenMapRow[],
  serviceDate: string
): SnapshotRow {
  const roomByNumber = new Map<string, RoomMasterRow>();
  const mapByRoomType = new Map<string, LinenMapRow>();
  const entryByRoom = new Map<string, EntryRow>();

  rooms.forEach((room) => roomByNumber.set(room.room_number, room));
  linenMap.forEach((row) => mapByRoomType.set(row.room_type, row));
  entries.forEach((row) => entryByRoom.set(row.room_number, row));

  const expectedFloors: Record<string, LinenTotals> = {};
  const actualFloors: Record<string, LinenTotals> = {};
  const expectedBlocks: Record<string, LinenTotals> = {};
  const actualBlocks: Record<string, LinenTotals> = {};
  const grandExpected = zeroTotals();
  const grandActual = zeroTotals();

  const ensureTotals = (container: Record<string, LinenTotals>, key: string) => {
    if (!container[key]) {
      container[key] = zeroTotals();
    }
    return container[key];
  };

  statuses.forEach((statusRow) => {
    if (!countNonVacantStatus(statusRow.status)) return;

    const room = roomByNumber.get(statusRow.room_number);
    if (!room) return;

    const roomTypeMap = mapByRoomType.get(room.room_type);
    const entry = entryByRoom.get(room.room_number);
    const isDnd = Boolean(entry?.is_dnd);

    const roomExpected = zeroTotals();
    if (!isDnd && roomTypeMap) addTotals(roomExpected, roomTypeMap);

    const roomActual = zeroTotals();
    if (entry && !isDnd) {
      addTotals(roomActual, {
        bedsheet_king: entry.bedsheet_king,
        pillow_case: entry.pillow_case,
        bath_towel: entry.bath_towel,
        bath_mat: entry.bath_mat,
        duvet_cover_king: entry.duvet_cover_king,
        duvet_cover_single: entry.duvet_cover_single,
      });
    }

    const floorGroupKey = floorKey(room.block_no, room.floor_no);
    const blockGroupKey = `B${room.block_no}`;

    addTotals(ensureTotals(expectedFloors, floorGroupKey), roomExpected);
    addTotals(ensureTotals(actualFloors, floorGroupKey), roomActual);
    addTotals(ensureTotals(expectedBlocks, blockGroupKey), roomExpected);
    addTotals(ensureTotals(actualBlocks, blockGroupKey), roomActual);
    addTotals(grandExpected, roomExpected);
    addTotals(grandActual, roomActual);
  });

  const differenceFloors: Record<string, LinenTotals> = {};
  const differenceBlocks: Record<string, LinenTotals> = {};

  Object.keys(expectedFloors).forEach((key) => {
    differenceFloors[key] = subtractTotals(actualFloors[key] || zeroTotals(), expectedFloors[key] || zeroTotals());
  });

  Object.keys(actualFloors).forEach((key) => {
    if (!differenceFloors[key]) {
      differenceFloors[key] = subtractTotals(actualFloors[key] || zeroTotals(), expectedFloors[key] || zeroTotals());
    }
  });

  Object.keys(expectedBlocks).forEach((key) => {
    differenceBlocks[key] = subtractTotals(actualBlocks[key] || zeroTotals(), expectedBlocks[key] || zeroTotals());
  });

  Object.keys(actualBlocks).forEach((key) => {
    if (!differenceBlocks[key]) {
      differenceBlocks[key] = subtractTotals(actualBlocks[key] || zeroTotals(), expectedBlocks[key] || zeroTotals());
    }
  });

  return {
    service_date: serviceDate,
    expected_json: {
      floors: expectedFloors,
      blocks: expectedBlocks,
      grand_total: grandExpected,
    },
    actual_json: {
      floors: actualFloors,
      blocks: actualBlocks,
      grand_total: grandActual,
    },
    difference_json: {
      floors: differenceFloors,
      blocks: differenceBlocks,
      grand_total: subtractTotals(grandActual, grandExpected),
    },
  };
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

  const today = getTodayLocalDateString();
  const oldestAllowedDate = shiftDateString(today, -6);
  const [selectedDate, setSelectedDate] = useState(today);
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  const [pageTab, setPageTab] = useState<PageTab>('COUNT');
  const [viewMode, setViewMode] = useState<ViewMode>('FLOOR');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');
  const [selectedBlockKey, setSelectedBlockKey] = useState<string>('B1');

  const historyDateOptions = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftDateString(today, -index)),
    [today]
  );

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

  async function loadHistory() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      if (selectedDate < oldestAllowedDate || selectedDate > today) {
        setHistoryData(null);
        setErrorMsg(`Linen History only keeps the last 7 days (${oldestAllowedDate} to ${today}).`);
        return;
      }

      const { data: recentSnapshots, error: recentError } = await supabase
        .from('linen_daily_snapshot')
        .select('service_date')
        .gte('service_date', oldestAllowedDate)
        .lte('service_date', today)
        .order('service_date', { ascending: false });

      if (recentError) throw recentError;

      const nextAvailableDates = historyDateOptions.filter((date) => {
        if (date === today) return true;
        return (recentSnapshots || []).some((row: any) => row.service_date === date || row.service_date === shiftDateString(date, 1));
      });
      setAvailableDates(nextAvailableDates);

      if (selectedDate === today) {
        const [roomRes, statusRes, entryRes, mapRes, billRes] = await Promise.all([
          supabase
            .from('room_master')
            .select('room_number, block_no, floor_no, room_type')
            .eq('is_active', true)
            .order('room_number', { ascending: true }),
          supabase
            .from('linen_room_status')
            .select('room_number, status')
            .eq('service_date', selectedDate),
          supabase
            .from('linen_room_entry')
            .select('room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
            .eq('service_date', selectedDate),
          supabase
            .from('linen_room_type_map')
            .select('room_type, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'),
          supabase
            .from('linen_laundry_bill')
            .select('service_date, block_no, floor_no, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
            .eq('service_date', selectedDate)
            .order('block_no', { ascending: true }),
        ]);

        if (roomRes.error) throw roomRes.error;
        if (statusRes.error) throw statusRes.error;
        if (entryRes.error) throw entryRes.error;
        if (mapRes.error) throw mapRes.error;
        if (billRes.error) throw billRes.error;

        const liveSnapshot = buildSnapshotFromLiveData(
          (roomRes.data || []) as RoomMasterRow[],
          (statusRes.data || []) as StatusRow[],
          (entryRes.data || []) as EntryRow[],
          (mapRes.data || []) as LinenMapRow[],
          selectedDate
        );

        const { floorBillMap, blockBillTotals } = buildBillMaps((billRes.data || []) as LinenBillRow[]);

        setHistoryData({
          snapshot: liveSnapshot,
          floorBillMap,
          blockBillTotals,
          source: 'live',
        });
        return;
      }

      const fallbackSnapshotDate = shiftDateString(selectedDate, 1);

      const [snapshotRes, billRes, roomRes, statusRes, entryRes, mapRes] = await Promise.all([
        supabase
          .from('linen_daily_snapshot')
          .select('service_date, expected_json, actual_json, difference_json')
          .in('service_date', [selectedDate, fallbackSnapshotDate])
          .order('service_date', { ascending: true }),
        supabase
          .from('linen_laundry_bill')
          .select('service_date, block_no, floor_no, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .eq('service_date', selectedDate)
          .order('block_no', { ascending: true }),
        supabase
          .from('room_master')
          .select('room_number, block_no, floor_no, room_type')
          .eq('is_active', true)
          .order('room_number', { ascending: true }),
        supabase
          .from('linen_room_status')
          .select('room_number, status')
          .eq('service_date', selectedDate),
        supabase
          .from('linen_room_entry')
          .select('room_number, is_dnd, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .eq('service_date', selectedDate),
        supabase
          .from('linen_room_type_map')
          .select('room_type, bedsheet_king, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'),
      ]);

      if (snapshotRes.error) throw snapshotRes.error;
      if (billRes.error) throw billRes.error;
      if (roomRes.error) throw roomRes.error;
      if (statusRes.error) throw statusRes.error;
      if (entryRes.error) throw entryRes.error;
      if (mapRes.error) throw mapRes.error;

      const snapshotRows = (snapshotRes.data || []) as SnapshotRow[];
      const exactSnapshot =
        snapshotRows.find((row) => row.service_date === selectedDate) || null;
      const nextDayFallbackSnapshot =
        !exactSnapshot
          ? snapshotRows.find((row) => row.service_date === fallbackSnapshotDate) || null
          : null;
      const fallbackLiveSnapshot =
        !exactSnapshot && !nextDayFallbackSnapshot
          ? buildSnapshotFromLiveData(
              (roomRes.data || []) as RoomMasterRow[],
              (statusRes.data || []) as StatusRow[],
              (entryRes.data || []) as EntryRow[],
              (mapRes.data || []) as LinenMapRow[],
              selectedDate
            )
          : null;
      const hasHistoricalLiveData =
        !!fallbackLiveSnapshot &&
        (
          Object.keys(fallbackLiveSnapshot.expected_json?.floors || {}).length > 0 ||
          Object.keys(fallbackLiveSnapshot.actual_json?.floors || {}).length > 0 ||
          ((billRes.data || []) as LinenBillRow[]).length > 0
        );
      const resolvedSnapshot = exactSnapshot || nextDayFallbackSnapshot || (hasHistoricalLiveData ? fallbackLiveSnapshot : null);

      const { floorBillMap, blockBillTotals } = buildBillMaps((billRes.data || []) as LinenBillRow[]);

      setHistoryData({
        snapshot: resolvedSnapshot,
        floorBillMap,
        blockBillTotals,
        source: exactSnapshot
          ? 'snapshot'
          : nextDayFallbackSnapshot
            ? 'snapshot-next-day-fallback'
            : hasHistoricalLiveData
              ? 'historical-live-fallback'
              : 'snapshot',
        snapshotServiceDate: resolvedSnapshot?.service_date || selectedDate || null,
      });
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

    void loadHistory();
  }, [profile, canAccess, selectedDate]);

  const selectedSummary = useMemo(() => {
    const expected = historyData?.snapshot?.expected_json || {};
    const actual = historyData?.snapshot?.actual_json || {};
    const blockBillTotals = historyData?.blockBillTotals || {};
    const floorBillMap = historyData?.floorBillMap || {};

    if (viewMode === 'FLOOR') {
      const floorExpected = expected?.floors?.[selectedFloorKey];
      const floorActual = actual?.floors?.[selectedFloorKey];
      const floorInBill = floorBillMap[selectedFloorKey] || zeroTotals();
      const floorActualTotals = parseTotals(floorActual);

      return {
        key: selectedFloorKey,
        label: FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey)?.label || selectedFloorKey,
        expected: parseTotals(floorExpected),
        actual: floorActualTotals,
        inBill: floorInBill,
        difference: subtractTotals(floorInBill, floorActualTotals),
      } as GroupSummary;
    }

    if (viewMode === 'BLOCK') {
      const blockExpected = expected?.blocks?.[selectedBlockKey];
      const blockActual = actual?.blocks?.[selectedBlockKey];
      const blockInBill = blockBillTotals[selectedBlockKey] || zeroTotals();
      const blockActualTotals = parseTotals(blockActual);

      return {
        key: selectedBlockKey,
        label: BLOCK_OPTIONS.find((b) => b.key === selectedBlockKey)?.label || selectedBlockKey,
        expected: parseTotals(blockExpected),
        actual: blockActualTotals,
        inBill: blockInBill,
        difference: subtractTotals(blockInBill, blockActualTotals),
      } as GroupSummary;
    }

    const grandExpectedTotals = parseTotals(expected?.grand_total);
    const grandActualTotals = parseTotals(actual?.grand_total);
    const grandInBillTotals = Object.values(blockBillTotals).reduce((acc, totals) => {
      addTotals(acc, totals);
      return acc;
    }, zeroTotals());

    return {
      key: 'GRAND',
      label: 'Grand Total',
      expected: grandExpectedTotals,
      actual: grandActualTotals,
      inBill: grandInBillTotals,
      difference: subtractTotals(grandInBillTotals, grandActualTotals),
    } as GroupSummary;
  }, [historyData, viewMode, selectedFloorKey, selectedBlockKey]);

  const selectedBillTotals = useMemo(() => {
    if (!historyData) return zeroTotals();

    if (pageTab === 'BILL_ENTRY') {
      return historyData.floorBillMap[selectedFloorKey] || zeroTotals();
    }

    if (pageTab === 'BILL_GRAND') {
      return historyData.blockBillTotals[selectedBlockKey] || zeroTotals();
    }

    return zeroTotals();
  }, [historyData, pageTab, selectedFloorKey, selectedBlockKey]);

  const historySourceLabel = useMemo(() => {
    if (!historyData) return '';
    if (historyData.source === 'live') return 'Today live data';
    if (historyData.source === 'snapshot-next-day-fallback') {
      return historyData.snapshotServiceDate
        ? `Archived day snapshot (loaded from ${historyData.snapshotServiceDate})`
        : 'Archived day snapshot (next-day fallback)';
    }
    if (historyData.source === 'historical-live-fallback') {
      return historyData.snapshotServiceDate
        ? `Historical live-data fallback (${historyData.snapshotServiceDate})`
        : 'Historical live-data fallback';
    }
    return 'Archived day snapshot';
  }, [historyData]);

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
          <div style={styles.historyHint}>
            Linen History shows the current day plus the previous 6 days. Older history is cleaned by the New Day archive flow.
          </div>

          <div style={styles.selectorRow}>
            {historyDateOptions.map((date) => {
              const isAvailable = availableDates.includes(date);
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  style={{
                    ...styles.selectorBtn,
                    ...(selectedDate === date ? styles.selectorBtnActive : {}),
                    opacity: isAvailable ? 1 : 0.55,
                  }}
                  title={isAvailable ? date : `${date} (no archived snapshot found yet)`}
                >
                  {formatHistoryDateLabel(date, today)}
                </button>
              );
            })}
          </div>
        </section>

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

        {pageTab === 'COUNT' ? (
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
        ) : (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>
              {pageTab === 'BILL_ENTRY' ? 'Laundry Bill Entry History' : 'Laundry Bill Grand Total History'}
            </div>
            <div style={styles.modeRow}>
              {pageTab === 'BILL_ENTRY' ? (
                FLOOR_OPTIONS.map((floor) => (
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
                ))
              ) : (
                BLOCK_OPTIONS.map((block) => (
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
                ))
              )}
            </div>
          </section>
        )}

        {loading ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>Loading linen history...</div>
          </section>
        ) : !historyData?.snapshot ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>No snapshot found for this date.</div>
          </section>
        ) : pageTab !== 'COUNT' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>
              {pageTab === 'BILL_ENTRY'
                ? FLOOR_OPTIONS.find((floor) => floor.key === selectedFloorKey)?.label || selectedFloorKey
                : BLOCK_OPTIONS.find((block) => block.key === selectedBlockKey)?.label || selectedBlockKey}
            </div>
            <div style={styles.groupMeta}>
              Source: {historySourceLabel}
            </div>
            <div style={styles.itemGrid}>
              {ITEM_DEFS.map((item) => (
                <div key={item.key} style={styles.itemCard}>
                  <div style={styles.itemTitle}>{item.label}</div>
                  <div style={styles.metricRow}>
                    <span style={styles.metricLabel}>
                      {pageTab === 'BILL_ENTRY' ? 'Saved Floor Total' : 'Saved Block Total'}
                    </span>
                    <span style={styles.metricValue}>{selectedBillTotals[item.key]}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>{selectedSummary.label}</div>
            <div style={styles.groupMeta}>
              Source: {historySourceLabel}
            </div>

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
                      <span style={styles.metricLabel}>In Bill</span>
                      <span style={styles.metricValue}>{selectedSummary.inBill[item.key]}</span>
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
  historyHint: {
    fontSize: '14px',
    color: '#64748b',
    marginBottom: '12px',
    fontWeight: 700,
    lineHeight: 1.5,
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
