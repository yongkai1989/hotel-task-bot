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
type PageTab = 'COUNT' | 'BILL_ENTRY' | 'BILL_GRAND' | 'MONTHLY';

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
  bedsheet_single: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

type MonthlyEntryRow = EntryRow & {
  service_date: string;
};

type PaEntryRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  bedsheet_king: number | null;
  bedsheet_single: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

type LinenMapRow = {
  room_type: string;
  bedsheet_king: number;
  bedsheet_single: number;
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
  bedsheet_single: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

type LinenReceivedRow = {
  service_date: string;
  block_no: number;
  bedsheet_king: number | null;
  bedsheet_single: number | null;
  pillow_case: number | null;
  bath_towel: number | null;
  bath_mat: number | null;
  duvet_cover_king: number | null;
  duvet_cover_single: number | null;
};

type LinenTotals = {
  bedsheet_king: number;
  bedsheet_single: number;
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
  paUsed: LinenTotals;
  inBill: LinenTotals;
  difference: LinenTotals;
  returned: LinenTotals;
  returnedDifference: LinenTotals;
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
  floorPaUsedMap: Record<string, LinenTotals>;
  blockPaUsedTotals: Record<string, LinenTotals>;
  blockReceivedTotals: Record<string, LinenTotals>;
  source: 'snapshot' | 'snapshot-next-day-fallback' | 'historical-live-fallback';
  snapshotServiceDate?: string | null;
};

type MonthlyReportData = {
  month: string;
  monthStart: string;
  monthEnd: string;
  actual: LinenTotals;
  inBill: LinenTotals;
  returned: LinenTotals;
  actualRows: number;
  billRows: number;
  returnedRows: number;
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
  { key: 'bedsheet_single', label: 'Bedsheet Single' },
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
  if (value === shiftDateString(today, -1)) return 'Yesterday';

  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  });
}

function formatMonthLabel(value: string) {
  const d = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function getMonthStart(value: string) {
  return `${value}-01`;
}

function getMonthEnd(value: string) {
  const [yearRaw, monthRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const d = new Date(year, month, 0);
  const day = String(d.getDate()).padStart(2, '0');
  return `${yearRaw}-${monthRaw}-${day}`;
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function zeroTotals(): LinenTotals {
  return {
    bedsheet_king: 0,
    bedsheet_single: 0,
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
  target.bedsheet_single += safeNumber(source.bedsheet_single);
  target.pillow_case += safeNumber(source.pillow_case);
  target.bath_towel += safeNumber(source.bath_towel);
  target.bath_mat += safeNumber(source.bath_mat);
  target.duvet_cover_king += safeNumber(source.duvet_cover_king);
  target.duvet_cover_single += safeNumber(source.duvet_cover_single);
}

function subtractTotals(left: LinenTotals, right: LinenTotals): LinenTotals {
  return {
    bedsheet_king: left.bedsheet_king - right.bedsheet_king,
    bedsheet_single: left.bedsheet_single - right.bedsheet_single,
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

const EXTRA_BLOCK_1_PILLOW_CASE_FLOORS = new Set(['B1F1', 'B1F2', 'B1F3', 'B1F5']);

function hasExtraBlock1PillowCase(blockNo: number, floorNo: number) {
  return EXTRA_BLOCK_1_PILLOW_CASE_FLOORS.has(floorKey(blockNo, floorNo));
}

function normalizeRoomType(roomType: string) {
  return String(roomType || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isBlock2Floor3(blockNo: number, floorNo: number) {
  return blockNo === 2 && floorNo === 3;
}

function getB2F3BedsheetKingPar(roomType: string) {
  const normalized = normalizeRoomType(roomType);
  if (normalized === 'STR' || normalized.includes('SUPERIORTRIPLE')) return 1;
  if (normalized === 'DDR' || normalized.includes('DELUXEDOUBLE')) return 1;
  return 0;
}

function getB2F3BedsheetSinglePar(roomType: string) {
  const normalized = normalizeRoomType(roomType);
  if (normalized === 'STDT' || normalized.includes('STANDARDTWIN')) return 2;
  if (normalized === 'STR' || normalized.includes('SUPERIORTRIPLE')) return 1;
  return 0;
}

function addExpectedRoomTotals(target: LinenTotals, room: RoomMasterRow, roomTypeMap?: LinenMapRow) {
  if (!roomTypeMap) return;

  if (isBlock2Floor3(room.block_no, room.floor_no)) {
    target.bedsheet_king += getB2F3BedsheetKingPar(room.room_type);
    target.bedsheet_single += getB2F3BedsheetSinglePar(room.room_type);
    target.pillow_case += safeNumber(roomTypeMap.pillow_case);
    target.bath_towel += safeNumber(roomTypeMap.bath_towel);
    target.bath_mat += safeNumber(roomTypeMap.bath_mat);
    target.duvet_cover_king += safeNumber(roomTypeMap.duvet_cover_king);
    target.duvet_cover_single += safeNumber(roomTypeMap.duvet_cover_single);
    return;
  }

  addTotals(target, roomTypeMap);
  if (hasExtraBlock1PillowCase(room.block_no, room.floor_no)) {
    target.pillow_case += 1;
  }
}

function buildBillMaps(rows: LinenBillRow[]) {
  const floorBillMap: Record<string, LinenTotals> = {};
  const blockBillTotals: Record<string, LinenTotals> = {
    B1: zeroTotals(),
    B2: zeroTotals(),
  };
  const detailedRowsByBlock = new Map<string, LinenBillRow[]>();
  const aggregateRowsByBlock = new Map<string, LinenBillRow[]>();

  FLOOR_CONFIG.forEach((floor) => {
    floorBillMap[floor.key] = zeroTotals();
  });

  rows.forEach((row) => {
    const blockKey = `B${row.block_no}`;
    const hasFloor = typeof row.floor_no === 'number' && !Number.isNaN(Number(row.floor_no));

    if (hasFloor) {
      const list = detailedRowsByBlock.get(blockKey) || [];
      list.push(row);
      detailedRowsByBlock.set(blockKey, list);
      return;
    }

    const list = aggregateRowsByBlock.get(blockKey) || [];
    list.push(row);
    aggregateRowsByBlock.set(blockKey, list);
  });

  const blockKeys = new Set<string>([
    ...Array.from(detailedRowsByBlock.keys()),
    ...Array.from(aggregateRowsByBlock.keys()),
  ]);

  blockKeys.forEach((blockKey) => {
    const detailedRows = detailedRowsByBlock.get(blockKey) || [];
    const aggregateRows = aggregateRowsByBlock.get(blockKey) || [];
    const rowsToUse = detailedRows.length > 0 ? detailedRows : aggregateRows;

    rowsToUse.forEach((row) => {
      const totals = parseTotals(row);
      addTotals(blockBillTotals[blockKey] || (blockBillTotals[blockKey] = zeroTotals()), totals);

      if (typeof row.floor_no === 'number' && !Number.isNaN(Number(row.floor_no))) {
        floorBillMap[floorKey(row.block_no, row.floor_no)] = totals;
      }
    });
  });

  return { floorBillMap, blockBillTotals };
}

function getBillRowsForReport(rows: LinenBillRow[]) {
  const rowsByDateBlock = new Map<string, { detailed: LinenBillRow[]; aggregate: LinenBillRow[] }>();
  const latestDetailedRows = new Map<string, LinenBillRow>();
  const latestAggregateRows = new Map<string, LinenBillRow>();

  rows.forEach((row) => {
    const blockKey = `${row.service_date || ''}|B${row.block_no}`;
    const hasFloor = typeof row.floor_no === 'number' && !Number.isNaN(Number(row.floor_no));

    if (hasFloor) {
      latestDetailedRows.set(`${blockKey}|F${row.floor_no}`, row);
    } else {
      latestAggregateRows.set(blockKey, row);
    }
  });

  latestDetailedRows.forEach((row) => {
    const blockKey = `${row.service_date || ''}|B${row.block_no}`;
    const group = rowsByDateBlock.get(blockKey) || { detailed: [], aggregate: [] };
    group.detailed.push(row);
    rowsByDateBlock.set(blockKey, group);
  });

  latestAggregateRows.forEach((row) => {
    const blockKey = `${row.service_date || ''}|B${row.block_no}`;
    const group = rowsByDateBlock.get(blockKey) || { detailed: [], aggregate: [] };
    group.aggregate.push(row);
    rowsByDateBlock.set(blockKey, group);
  });

  return Array.from(rowsByDateBlock.values()).flatMap((group) =>
    group.detailed.length > 0 ? group.detailed : group.aggregate
  );
}

function getEntryRowsForReport(rows: MonthlyEntryRow[]) {
  const latestByDateRoom = new Map<string, MonthlyEntryRow>();

  rows.forEach((row) => {
    latestByDateRoom.set(`${row.service_date || ''}|${row.room_number || ''}`, row);
  });

  return Array.from(latestByDateRoom.values());
}

function getReceivedRowsForReport(rows: LinenReceivedRow[]) {
  const latestByDateBlock = new Map<string, LinenReceivedRow>();

  rows.forEach((row) => {
    latestByDateBlock.set(`${row.service_date || ''}|B${row.block_no}`, row);
  });

  return Array.from(latestByDateBlock.values());
}

function buildReceivedBlockTotals(rows: LinenReceivedRow[]) {
  const blockReceivedTotals: Record<string, LinenTotals> = {
    B1: zeroTotals(),
    B2: zeroTotals(),
  };

  rows.forEach((row) => {
    const blockKey = `B${row.block_no}`;
    blockReceivedTotals[blockKey] = parseTotals(row);
  });

  return blockReceivedTotals;
}

function buildPaUsedMaps(rows: PaEntryRow[]) {
  const floorPaUsedMap: Record<string, LinenTotals> = {};
  const blockPaUsedTotals: Record<string, LinenTotals> = {
    B1: zeroTotals(),
    B2: zeroTotals(),
  };

  FLOOR_CONFIG.forEach((floor) => {
    floorPaUsedMap[floor.key] = zeroTotals();
  });

  rows.forEach((row) => {
    const totals = parseTotals(row);
    const floorGroupKey = floorKey(Number(row.block_no), Number(row.floor_no));
    const blockGroupKey = `B${Number(row.block_no)}`;

    if (!floorPaUsedMap[floorGroupKey]) {
      floorPaUsedMap[floorGroupKey] = zeroTotals();
    }
    if (!blockPaUsedTotals[blockGroupKey]) {
      blockPaUsedTotals[blockGroupKey] = zeroTotals();
    }

    addTotals(floorPaUsedMap[floorGroupKey], totals);
    addTotals(blockPaUsedTotals[blockGroupKey], totals);
  });

  return { floorPaUsedMap, blockPaUsedTotals };
}

function buildEmptySnapshot(serviceDate: string): SnapshotRow {
  return {
    service_date: serviceDate,
    expected_json: {
      floors: {},
      blocks: {},
      grand_total: zeroTotals(),
    },
    actual_json: {
      floors: {},
      blocks: {},
      grand_total: zeroTotals(),
    },
    difference_json: {
      floors: {},
      blocks: {},
      grand_total: zeroTotals(),
    },
  };
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
    if (!isDnd && roomTypeMap) {
      addExpectedRoomTotals(roomExpected, room, roomTypeMap);
    }

    const roomActual = zeroTotals();
    if (entry && !isDnd) {
      addTotals(roomActual, {
        bedsheet_king: entry.bedsheet_king,
        bedsheet_single: entry.bedsheet_single,
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

function applyExtraPillowCaseRuleToSnapshot(
  snapshot: SnapshotRow | null,
  rooms: RoomMasterRow[],
  statuses: StatusRow[],
  entries: EntryRow[]
): SnapshotRow | null {
  if (!snapshot) return null;

  const roomByNumber = new Map<string, RoomMasterRow>();
  const entryByRoom = new Map<string, EntryRow>();
  const extraByFloor: Record<string, number> = {};
  let grandExtra = 0;

  rooms.forEach((room) => roomByNumber.set(room.room_number, room));
  entries.forEach((entry) => entryByRoom.set(entry.room_number, entry));

  statuses.forEach((statusRow) => {
    if (!countNonVacantStatus(statusRow.status)) return;

    const room = roomByNumber.get(statusRow.room_number);
    if (!room) return;

    const entry = entryByRoom.get(room.room_number);
    if (entry?.is_dnd) return;
    if (!hasExtraBlock1PillowCase(room.block_no, room.floor_no)) return;

    const key = floorKey(room.block_no, room.floor_no);
    extraByFloor[key] = safeNumber(extraByFloor[key]) + 1;
    grandExtra += 1;
  });

  if (grandExtra <= 0) return snapshot;

  const expected = snapshot.expected_json || {};
  const floors = { ...(expected.floors || {}) };
  const blocks = { ...(expected.blocks || {}) };
  const grandTotal = parseTotals(expected.grand_total);

  Object.entries(extraByFloor).forEach(([key, qty]) => {
    const floorTotals = parseTotals(floors[key]);
    floorTotals.pillow_case += qty;
    floors[key] = floorTotals;
  });

  const block1Totals = parseTotals(blocks.B1);
  block1Totals.pillow_case += grandExtra;
  blocks.B1 = block1Totals;
  grandTotal.pillow_case += grandExtra;

  return {
    ...snapshot,
    expected_json: {
      ...expected,
      floors,
      blocks,
      grand_total: grandTotal,
    },
  };
}

function parseTotals(raw: any): LinenTotals {
  return {
    bedsheet_king: safeNumber(raw?.bedsheet_king),
    bedsheet_single: safeNumber(raw?.bedsheet_single),
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

function returnedDiffStyle(value: number): React.CSSProperties {
  if (value < 0) return { color: '#b91c1c', fontWeight: 800 };
  return { color: '#166534', fontWeight: 800 };
}

function countDiffStyle(value: number): React.CSSProperties {
  if (value > 0) return { color: '#b91c1c', fontWeight: 800 };
  if (value < 0) return { color: '#166534', fontWeight: 800 };
  return { color: '#166534', fontWeight: 800 };
}

export default function LinenHistoryPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const today = getTodayLocalDateString();
  const yesterday = shiftDateString(today, -1);
  const oldestAllowedDate = shiftDateString(today, -7);
  const currentMonth = yesterday.slice(0, 7);
  const [selectedDate, setSelectedDate] = useState(yesterday);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReportData | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  const [pageTab, setPageTab] = useState<PageTab>('COUNT');
  const [viewMode, setViewMode] = useState<ViewMode>('FLOOR');
  const [selectedFloorKey, setSelectedFloorKey] = useState<string>('B1F1');
  const [selectedBlockKey, setSelectedBlockKey] = useState<string>('B1');

  const historyDateOptions = useMemo(
    () => Array.from({ length: 7 }, (_, index) => shiftDateString(today, -(index + 1))),
    [today]
  );

  useEffect(() => {
    if (selectedDate >= today) {
      setSelectedDate(yesterday);
    }
  }, [selectedDate, today, yesterday]);

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

      if (selectedDate < oldestAllowedDate || selectedDate > yesterday) {
        setHistoryData(null);
        setErrorMsg(`Linen History only keeps the previous 7 days (${oldestAllowedDate} to ${yesterday}).`);
        return;
      }

      const { data: recentSnapshots, error: recentError } = await supabase
        .from('linen_daily_snapshot')
        .select('service_date')
        .gte('service_date', oldestAllowedDate)
        .lte('service_date', yesterday)
        .order('service_date', { ascending: false });

      if (recentError) throw recentError;

      const nextAvailableDates = historyDateOptions.filter((date) => {
        return (recentSnapshots || []).some((row: any) => row.service_date === date || row.service_date === shiftDateString(date, 1));
      });
      setAvailableDates(nextAvailableDates);

      const fallbackSnapshotDate = shiftDateString(selectedDate, 1);

      const [snapshotRes, billRes, roomRes, statusRes, entryRes, mapRes, paEntryRes] = await Promise.all([
        supabase
          .from('linen_daily_snapshot')
          .select('service_date, expected_json, actual_json, difference_json')
          .in('service_date', [selectedDate, fallbackSnapshotDate])
          .order('service_date', { ascending: true }),
        supabase
          .from('linen_laundry_bill')
          .select('service_date, block_no, floor_no, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
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
          .select('room_number, is_dnd, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .eq('service_date', selectedDate),
        supabase
          .from('linen_room_type_map')
          .select('room_type, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single'),
        supabase
          .from('linen_pa_entry')
          .select('room_number, block_no, floor_no, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .eq('service_date', selectedDate),
      ]);

      if (snapshotRes.error) throw snapshotRes.error;
      if (billRes.error) throw billRes.error;
      if (roomRes.error) throw roomRes.error;
      if (statusRes.error) throw statusRes.error;
      if (entryRes.error) throw entryRes.error;
      if (mapRes.error) throw mapRes.error;
      const paRows = paEntryRes.error ? [] : ((paEntryRes.data || []) as PaEntryRow[]);

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
          ((billRes.data || []) as LinenBillRow[]).length > 0 ||
          paRows.length > 0
        );
      const adjustedExactSnapshot = applyExtraPillowCaseRuleToSnapshot(
        exactSnapshot,
        (roomRes.data || []) as RoomMasterRow[],
        (statusRes.data || []) as StatusRow[],
        (entryRes.data || []) as EntryRow[]
      );
      const adjustedNextDayFallbackSnapshot = applyExtraPillowCaseRuleToSnapshot(
        nextDayFallbackSnapshot,
        (roomRes.data || []) as RoomMasterRow[],
        (statusRes.data || []) as StatusRow[],
        (entryRes.data || []) as EntryRow[]
      );
      const hasPaEntries = paRows.length > 0;
      const resolvedSnapshot =
        adjustedExactSnapshot ||
        adjustedNextDayFallbackSnapshot ||
        (hasHistoricalLiveData ? fallbackLiveSnapshot : null) ||
        (hasPaEntries ? buildEmptySnapshot(selectedDate) : null);

      const { floorBillMap, blockBillTotals } = buildBillMaps((billRes.data || []) as LinenBillRow[]);
      const { floorPaUsedMap, blockPaUsedTotals } = buildPaUsedMaps(paRows);
      let blockReceivedTotals: Record<string, LinenTotals> = {
        B1: zeroTotals(),
        B2: zeroTotals(),
      };

      const receivedRes = await supabase
        .from('linen_laundry_received')
        .select('service_date, block_no, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
        .eq('service_date', selectedDate)
        .order('block_no', { ascending: true });

      if (receivedRes.error) throw receivedRes.error;
      blockReceivedTotals = buildReceivedBlockTotals((receivedRes.data || []) as LinenReceivedRow[]);

      setHistoryData({
        snapshot: resolvedSnapshot,
        floorBillMap,
        blockBillTotals,
        floorPaUsedMap,
        blockPaUsedTotals,
        blockReceivedTotals,
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

  async function loadMonthlyReport() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const monthStart = getMonthStart(selectedMonth);
      const monthEnd = getMonthEnd(selectedMonth);

      const [entryRes, billRes, receivedRes] = await Promise.all([
        supabase
          .from('linen_room_entry')
          .select('service_date, room_number, is_dnd, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .gte('service_date', monthStart)
          .lte('service_date', monthEnd)
          .order('service_date', { ascending: true }),
        supabase
          .from('linen_laundry_bill')
          .select('service_date, block_no, floor_no, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .gte('service_date', monthStart)
          .lte('service_date', monthEnd),
        supabase
          .from('linen_laundry_received')
          .select('service_date, block_no, bedsheet_king, bedsheet_single, pillow_case, bath_towel, bath_mat, duvet_cover_king, duvet_cover_single')
          .gte('service_date', monthStart)
          .lte('service_date', monthEnd),
      ]);

      if (entryRes.error) throw entryRes.error;
      if (billRes.error) throw billRes.error;
      if (receivedRes.error) throw receivedRes.error;

      const actual = zeroTotals();
      const entryRowsForReport = getEntryRowsForReport((entryRes.data || []) as MonthlyEntryRow[]);
      entryRowsForReport.forEach((row) => {
        if (row.is_dnd) return;
        addTotals(actual, parseTotals(row));
      });

      const inBill = zeroTotals();
      const billRowsForReport = getBillRowsForReport((billRes.data || []) as LinenBillRow[]);
      billRowsForReport.forEach((row) => {
        addTotals(inBill, parseTotals(row));
      });

      const returned = zeroTotals();
      const receivedRowsForReport = getReceivedRowsForReport((receivedRes.data || []) as LinenReceivedRow[]);
      receivedRowsForReport.forEach((row) => {
        addTotals(returned, parseTotals(row));
      });

      setMonthlyReport({
        month: selectedMonth,
        monthStart,
        monthEnd,
        actual,
        inBill,
        returned,
        actualRows: entryRowsForReport.filter((row) => !row.is_dnd).length,
        billRows: billRowsForReport.length,
        returnedRows: receivedRowsForReport.length,
      });
    } catch (err: any) {
      setMonthlyReport(null);
      setErrorMsg(err?.message || 'Failed to load monthly linen report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    if (pageTab === 'MONTHLY') {
      void loadMonthlyReport();
      return;
    }

    void loadHistory();
  }, [profile, canAccess, selectedDate, selectedMonth, pageTab]);

  const selectedSummary = useMemo(() => {
    const expected = historyData?.snapshot?.expected_json || {};
    const actual = historyData?.snapshot?.actual_json || {};
    const blockBillTotals = historyData?.blockBillTotals || {};
    const floorBillMap = historyData?.floorBillMap || {};
    const floorPaUsedMap = historyData?.floorPaUsedMap || {};
    const blockPaUsedTotals = historyData?.blockPaUsedTotals || {};
    const blockReceivedTotals = historyData?.blockReceivedTotals || {};

    if (viewMode === 'FLOOR') {
      const floorExpected = expected?.floors?.[selectedFloorKey];
      const floorActual = actual?.floors?.[selectedFloorKey];
      const floorInBill = floorBillMap[selectedFloorKey] || zeroTotals();
      const floorPaUsed = floorPaUsedMap[selectedFloorKey] || zeroTotals();
      const floorActualTotals = parseTotals(floorActual);
      const floorTotalUsed = zeroTotals();
      addTotals(floorTotalUsed, floorActualTotals);
      addTotals(floorTotalUsed, floorPaUsed);
      const emptyReturned = zeroTotals();

      return {
        key: selectedFloorKey,
        label: FLOOR_OPTIONS.find((f) => f.key === selectedFloorKey)?.label || selectedFloorKey,
        expected: parseTotals(floorExpected),
        actual: floorActualTotals,
        paUsed: floorPaUsed,
        inBill: floorInBill,
        difference: subtractTotals(floorInBill, floorTotalUsed),
        returned: emptyReturned,
        returnedDifference: subtractTotals(emptyReturned, floorInBill),
      } as GroupSummary;
    }

    if (viewMode === 'BLOCK') {
      const blockExpected = expected?.blocks?.[selectedBlockKey];
      const blockActual = actual?.blocks?.[selectedBlockKey];
      const blockInBill = blockBillTotals[selectedBlockKey] || zeroTotals();
      const blockPaUsed = blockPaUsedTotals[selectedBlockKey] || zeroTotals();
      const blockActualTotals = parseTotals(blockActual);
      const blockTotalUsed = zeroTotals();
      addTotals(blockTotalUsed, blockActualTotals);
      addTotals(blockTotalUsed, blockPaUsed);
      const blockReturnedTotals = blockReceivedTotals[selectedBlockKey] || zeroTotals();

      return {
        key: selectedBlockKey,
        label: BLOCK_OPTIONS.find((b) => b.key === selectedBlockKey)?.label || selectedBlockKey,
        expected: parseTotals(blockExpected),
        actual: blockActualTotals,
        paUsed: blockPaUsed,
        inBill: blockInBill,
        difference: subtractTotals(blockInBill, blockTotalUsed),
        returned: blockReturnedTotals,
        returnedDifference: subtractTotals(blockReturnedTotals, blockInBill),
      } as GroupSummary;
    }

    const grandExpectedTotals = parseTotals(expected?.grand_total);
    const grandActualTotals = parseTotals(actual?.grand_total);
    const grandPaUsedTotals = Object.values(blockPaUsedTotals).reduce((acc, totals) => {
      addTotals(acc, totals);
      return acc;
    }, zeroTotals());
    const grandInBillTotals = Object.values(blockBillTotals).reduce((acc, totals) => {
      addTotals(acc, totals);
      return acc;
    }, zeroTotals());
    const grandTotalUsed = zeroTotals();
    addTotals(grandTotalUsed, grandActualTotals);
    addTotals(grandTotalUsed, grandPaUsedTotals);
    const grandReturnedTotals = Object.values(blockReceivedTotals).reduce((acc, totals) => {
      addTotals(acc, totals);
      return acc;
    }, zeroTotals());

    return {
      key: 'GRAND',
      label: 'Grand Total',
      expected: grandExpectedTotals,
      actual: grandActualTotals,
      paUsed: grandPaUsedTotals,
      inBill: grandInBillTotals,
      difference: subtractTotals(grandInBillTotals, grandTotalUsed),
      returned: grandReturnedTotals,
      returnedDifference: subtractTotals(grandReturnedTotals, grandInBillTotals),
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
          <div style={styles.sectionTitle}>{pageTab === 'MONTHLY' ? 'Month' : 'Date'}</div>
          <div style={styles.historyHint}>
            {pageTab === 'MONTHLY'
              ? 'Monthly Report totals Actual chambermaid entry, In Bill, and Returned linen for the selected month.'
              : "Linen History shows yesterday and the previous 6 days. Today is kept out because returned laundry belongs to yesterday's sent-out linen."}
          </div>

          {pageTab === 'MONTHLY' ? (
            <div style={styles.monthControlRow}>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value || currentMonth)}
                style={styles.monthInput}
              />
              <div style={styles.monthLabel}>{formatMonthLabel(selectedMonth)}</div>
            </div>
          ) : (
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
          )}
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
            <button
              type="button"
              onClick={() => setPageTab('MONTHLY')}
              style={{ ...styles.modeBtn, ...(pageTab === 'MONTHLY' ? styles.modeBtnActive : {}) }}
            >
              Monthly Report
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
        ) : pageTab === 'MONTHLY' ? null : (
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
        ) : pageTab === 'MONTHLY' ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Monthly Report</div>
            <div style={styles.groupMeta}>
              {monthlyReport
                ? `${formatMonthLabel(monthlyReport.month)} | ${monthlyReport.monthStart} to ${monthlyReport.monthEnd} | ${monthlyReport.actualRows} chambermaid row(s)`
                : formatMonthLabel(selectedMonth)}
            </div>

            {!monthlyReport ? (
              <div style={styles.emptyState}>No monthly linen data found.</div>
            ) : (
              <div style={styles.reportTableWrap}>
                <table style={styles.reportTable}>
                  <thead>
                    <tr>
                      <th style={styles.reportTh}>Linen Type</th>
                      <th style={styles.reportTh}>Actual</th>
                      <th style={styles.reportTh}>In Bill</th>
                      <th style={styles.reportTh}>Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ITEM_DEFS.map((item) => (
                      <tr key={item.key}>
                        <td style={{ ...styles.reportTd, ...styles.reportItemCell }}>{item.label}</td>
                        <td style={styles.reportValueTd}>{monthlyReport.actual[item.key]}</td>
                        <td style={styles.reportValueTd}>{monthlyReport.inBill[item.key]}</td>
                        <td style={styles.reportValueTd}>{monthlyReport.returned[item.key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                const returnedDiffValue = selectedSummary.returnedDifference[item.key];
                const totalUsedValue = selectedSummary.actual[item.key] + selectedSummary.paUsed[item.key];
                const countDiffValue = selectedSummary.inBill[item.key] - totalUsedValue;
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
                      <span style={styles.metricLabel}>PA Used</span>
                      <span style={styles.metricValue}>{selectedSummary.paUsed[item.key]}</span>
                    </div>

                    <div style={styles.metricRow}>
                      <span style={styles.metricLabel}>Total Used</span>
                      <span style={styles.metricValue}>{totalUsedValue}</span>
                    </div>

                    <div style={styles.metricRow}>
                      <span style={styles.metricLabel}>In Bill</span>
                      <span style={styles.metricValue}>{selectedSummary.inBill[item.key]}</span>
                    </div>

                    {viewMode === 'FLOOR' ? (
                      <div style={styles.metricRow}>
                        <span style={styles.metricLabel}>Difference</span>
                        <span style={{ ...styles.metricValue, ...diffStyle(diffValue) }}>
                          {formatDiff(diffValue)}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div style={styles.metricRow}>
                          <span style={styles.metricLabel}>Count Difference</span>
                          <span style={{ ...styles.metricValue, ...countDiffStyle(countDiffValue) }}>
                            {formatDiff(countDiffValue)}
                          </span>
                        </div>

                        <div style={styles.metricRow}>
                          <span style={styles.metricLabel}>Returned</span>
                          <span style={styles.metricValue}>{selectedSummary.returned[item.key]}</span>
                        </div>

                        <div style={styles.metricRow}>
                          <span style={styles.metricLabel}>Returned Difference</span>
                          <span style={{ ...styles.metricValue, ...returnedDiffStyle(returnedDiffValue) }}>
                            {formatDiff(returnedDiffValue)}
                          </span>
                        </div>
                      </>
                    )}
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
  monthControlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  monthInput: {
    width: '220px',
    maxWidth: '100%',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 14px',
    fontSize: '15px',
    fontWeight: 700,
    outline: 'none',
  },
  monthLabel: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '10px 14px',
    fontSize: '14px',
    fontWeight: 800,
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
  reportTableWrap: {
    width: '100%',
    overflowX: 'auto',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
  },
  reportTable: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    minWidth: '640px',
  },
  reportTh: {
    textAlign: 'left',
    background: '#f8fafc',
    color: '#475569',
    fontSize: '12px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '14px 16px',
    borderBottom: '1px solid #e2e8f0',
  },
  reportTd: {
    padding: '14px 16px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
  },
  reportItemCell: {
    fontWeight: 800,
    fontSize: '15px',
  },
  reportValueTd: {
    padding: '14px 16px',
    borderBottom: '1px solid #f1f5f9',
    color: '#0f172a',
    fontSize: '20px',
    fontWeight: 900,
    textAlign: 'left',
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
