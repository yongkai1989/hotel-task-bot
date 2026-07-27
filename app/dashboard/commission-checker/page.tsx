'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type CsvRow = Record<string, string>;

type ParsedCsv = {
  fileName: string;
  headers: string[];
  rows: CsvRow[];
  targetColumn: string;
  allIds: Array<{ raw: string; normalized: string; rowNumber: number; row: CsvRow }>;
  ids: Array<{ raw: string; normalized: string; rowNumber: number; row: CsvRow }>;
  blankRows: number[];
  noCommissionRows: number[];
  noCommissionIds: Array<{ raw: string; normalized: string; rowNumber: number; row: CsvRow }>;
  duplicateIds: string[];
  error?: string;
};

type CompareResult = {
  matches: ParsedCsv['ids'];
  missing: ParsedCsv['ids'];
  commissionDuplicates: string[];
  pmsDuplicates: string[];
};

type NameMatch = {
  reservationNumber: string;
  commissionGuestName: string;
  commissionRow: number;
  pmsGuestName: string;
  pmsRow: number;
  pmsOtaRef: string;
  matchType: 'Exact' | 'Likely';
};

type ReservationFieldMatch = {
  reservationNumber: string;
  commissionRow: number;
  pmsSourceColumn: 'Guest Name 2' | 'Group' | 'Comment';
  pmsSourceValue: string;
  pmsRow: number;
  pmsOtaRef: string;
};

type ReportRow = CsvRow & {
  normalizedReservation: string;
  matchKind: 'ota' | 'guest-name' | 'reservation-field-id' | 'no-commission' | 'none';
};

const COMMISSION_COLUMN = 'reservation number';
const PMS_COLUMN = 'OTA Ref. No';
const COMMISSION_GUEST_NAME_COLUMN = 'Guest name';
const PMS_GUEST_NAME_COLUMN = 'Guest Name 1';
const PMS_GUEST_NAME_2_COLUMN = 'Guest Name 2';
const PMS_GROUP_COLUMN = 'Group';
const PMS_COMMENT_COLUMN = 'Comment';
const STATUS_COLUMN = 'status';
const COMMISSION_AMOUNT_COLUMN = 'Commission amount';
const REPORT_HEADERS = [
  'Reservation Number',
  'Booked Date',
  'Arrival Date',
  'Departure Date',
  'Booker Name',
  'Guest Name',
  'Number of Rooms',
  'Number of Nights',
  'Commission Amount',
  'Booking Status',
  'PMS Match',
  'Non-match Reason',
];
const DISPUTE_HIDDEN_HEADERS = new Set([
  'reservation number',
  'invoice number',
  'persons',
  'commission%',
  'currency',
  'hotel id',
  'property name',
  'city',
  'country',
  'original amount',
  'booked on',
  'room nights',
  'guest request',
]);
const DISPUTE_BASE_HEADERS = [
  'Dispute Reason',
  'Reservation Number',
  'Folio Number',
  'CSV Row',
];
const NAME_MATCH_HEADERS = [
  'Match Type',
  'Reservation Number',
  'Booking.com Guest Name',
  'Booking.com CSV Row',
  'PMS Guest Name 1',
  'PMS CSV Row',
  'PMS OTA Ref. No',
];
const RESERVATION_FIELD_MATCH_HEADERS = [
  'Match Type',
  'Reservation Number',
  'Booking.com CSV Row',
  'PMS Matched Column',
  'PMS Matched Value',
  'PMS CSV Row',
  'PMS OTA Ref. No',
];

function normalizeHeader(value: string) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

function normalizeBookingId(value: string) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.0$/, '')
    .toUpperCase();
}

function normalizeGuestName(value: string) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|mstr|master|dr|prof)\b\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function guestNameMatchType(left: string, right: string): NameMatch['matchType'] | null {
  const normalizedLeft = normalizeGuestName(left);
  const normalizedRight = normalizeGuestName(right);

  if (!normalizedLeft || !normalizedRight) return null;
  if (normalizedLeft === normalizedRight) return 'Exact';

  const leftTokens = new Set(normalizedLeft.split(' ').filter((token) => token.length > 1));
  const rightTokens = new Set(normalizedRight.split(' ').filter((token) => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) return null;

  const shared = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  const smallerNameTokenCount = Math.min(leftTokens.size, rightTokens.size);
  return shared >= 2 && shared / smallerNameTokenCount >= 0.75 ? 'Likely' : null;
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);

  return rows;
}

function findColumn(headers: string[], wanted: string) {
  const normalizedWanted = normalizeHeader(wanted);
  return headers.find((header) => normalizeHeader(header) === normalizedWanted) || '';
}

function findAnyColumn(headers: string[], wanted: string[]) {
  return wanted.map((header) => findColumn(headers, header)).find(Boolean) || '';
}

function getCell(row: CsvRow, headers: string[], wanted: string[]) {
  const column = findAnyColumn(headers, wanted);
  return column ? String(row[column] || '').trim() : '';
}

function buildDisputeHeaders(headers: string[]) {
  const guestNameHeader = findColumn(headers, COMMISSION_GUEST_NAME_COLUMN);
  const statusHeader = findColumn(headers, STATUS_COLUMN);
  const priorityHeaders = [guestNameHeader, statusHeader].filter(Boolean);
  const extraHeaders = headers.filter((header) => {
    const normalized = normalizeHeader(header);
    if (!normalized || DISPUTE_HIDDEN_HEADERS.has(normalized)) return false;
    if (priorityHeaders.includes(header)) return false;
    return true;
  });

  return [...DISPUTE_BASE_HEADERS, ...priorityHeaders, ...extraHeaders];
}

function duplicateValues(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function parseMoneyAmount(value: string) {
  const text = String(value || '')
    .replace(/^\uFEFF/, '')
    .trim();

  if (!text) return null;

  const isNegative = text.startsWith('(') && text.endsWith(')');
  const cleaned = text
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .replace(/[^\d.+\-eE]/g, '')
    .trim();

  if (!cleaned) return null;

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;

  return isNegative ? -numeric : numeric;
}

function parseSortableDate(value: string) {
  const text = String(value || '').trim();
  if (!text) return 0;

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const parsed = new Date(year, month, day).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function bookingStatusRank(status: string) {
  const normalized = normalizeHeader(status).replace(/[\s_-]+/g, ' ');
  if (normalized === 'ok') return 0;
  if (normalized === 'no show' || normalized === 'noshow') return 1;
  if (normalized === 'cancelled' || normalized === 'canceled') return 2;
  return 3;
}

function buildCommissionReportRows(
  commissionCsv: ParsedCsv | null,
  pmsCsv: ParsedCsv | null,
  folioByReservation: Record<string, string>
): ReportRow[] {
  if (!commissionCsv || !pmsCsv) return [];

  const pmsOtaSet = new Set(pmsCsv.ids.map((item) => item.normalized));
  const noCommissionSet = new Set(commissionCsv.noCommissionIds.map((item) => item.normalized));
  const reservationFieldMatchedSet = new Set(
    findReservationFieldMatches(
      commissionCsv.ids.filter((item) => !pmsOtaSet.has(item.normalized)),
      pmsCsv
    ).map((match) => normalizeBookingId(match.reservationNumber))
  );
  const guestName1Candidates = commissionCsv.ids.filter(
    (item) => !pmsOtaSet.has(item.normalized) && !reservationFieldMatchedSet.has(item.normalized)
  );
  const guestName1MatchedSet = new Set(
    findGuestNameMatches(guestName1Candidates, commissionCsv, pmsCsv)
      .map((match) => normalizeBookingId(match.reservationNumber))
      .filter(Boolean)
  );

  return commissionCsv.allIds
    .map((item) => {
      const row = item.row;
      const reservationNumber = item.raw;
      const normalizedReservation = item.normalized;
      const bookedDate = getCell(row, commissionCsv.headers, ['Booked on', 'Booked date', 'Booking date']);
      const arrivalDate = getCell(row, commissionCsv.headers, ['Arrival date', 'Check-in', 'Check in', 'Arrival']);
      const departureDate = getCell(row, commissionCsv.headers, ['Departure date', 'Check-out', 'Check out', 'Departure']);
      const bookerName = getCell(row, commissionCsv.headers, ['Booker name', 'Booker']);
      const guestName = getCell(row, commissionCsv.headers, [COMMISSION_GUEST_NAME_COLUMN, 'Guest']);
      const numberOfRooms = getCell(row, commissionCsv.headers, ['Number of rooms', 'Rooms']);
      const numberOfNights = getCell(row, commissionCsv.headers, ['Number of nights', 'Room nights', 'Nights']);
      const commissionAmount = getCell(row, commissionCsv.headers, [COMMISSION_AMOUNT_COLUMN]);
      const bookingStatus = getCell(row, commissionCsv.headers, [STATUS_COLUMN, 'Booking status']);

      const isNoCommission = noCommissionSet.has(normalizedReservation);
      const otaMatched = pmsOtaSet.has(normalizedReservation);
      const reservationFieldIdMatched = reservationFieldMatchedSet.has(normalizedReservation);
      const guestNameMatched = guestName1MatchedSet.has(normalizedReservation);
      const isMatched = otaMatched || reservationFieldIdMatched || guestNameMatched;
      const folio = folioByReservation[normalizedReservation] || '';

      const matchKind: ReportRow['matchKind'] = isNoCommission
        ? 'no-commission'
        : otaMatched
          ? 'ota'
          : reservationFieldIdMatched
              ? 'reservation-field-id'
              : guestNameMatched
                ? 'guest-name'
                : 'none';

      return {
        normalizedReservation,
        matchKind,
        'Reservation Number': reservationNumber,
        'Booked Date': bookedDate,
        'Arrival Date': arrivalDate,
        'Departure Date': departureDate,
        'Booker Name': bookerName,
        'Guest Name': guestName,
        'Number of Rooms': numberOfRooms,
        'Number of Nights': numberOfNights,
        'Commission Amount': commissionAmount,
        'Booking Status': bookingStatus,
        'PMS Match': isNoCommission ? 'Not required' : isMatched ? 'Matched' : 'No Match',
        'Non-match Reason': isNoCommission
          ? 'No commission'
          : isMatched
            ? matchKind === 'ota'
              ? 'Matched by PMS OTA Ref. No'
              : matchKind === 'guest-name'
                ? 'Matched by guest name'
                : 'Reservation number found in ABS Guest Name 2, Group, or Comment'
            : folio
              ? `Folio: ${folio}`
              : 'Click to add folio number',
      };
    })
    .sort((left, right) => {
      const noMatchDiff = (left.matchKind === 'none' ? 0 : 1) - (right.matchKind === 'none' ? 0 : 1);
      if (noMatchDiff !== 0) return noMatchDiff;
      const statusDiff = bookingStatusRank(left['Booking Status']) - bookingStatusRank(right['Booking Status']);
      if (statusDiff !== 0) return statusDiff;
      return parseSortableDate(left['Arrival Date']) - parseSortableDate(right['Arrival Date']);
    });
}

function findGuestNameMatches(
  disputes: ParsedCsv['ids'],
  commissionCsv: ParsedCsv | null,
  pmsCsv: ParsedCsv | null
): NameMatch[] {
  if (!commissionCsv || !pmsCsv || !disputes.length) return [];

  const commissionGuestColumn = findColumn(commissionCsv.headers, COMMISSION_GUEST_NAME_COLUMN);
  const pmsGuestColumn = findColumn(pmsCsv.headers, PMS_GUEST_NAME_COLUMN);
  const pmsOtaColumn = findColumn(pmsCsv.headers, PMS_COLUMN);
  if (!commissionGuestColumn || !pmsGuestColumn) return [];

  const pmsRows = pmsCsv.rows
    .map((row, index) => ({
      row,
      rowNumber: index + 2,
      guestName: String(row[pmsGuestColumn] || '').trim(),
      otaRef: pmsOtaColumn ? String(row[pmsOtaColumn] || '').trim() : '',
    }))
    .filter((item) => normalizeGuestName(item.guestName));

  return disputes.flatMap((dispute) => {
    const commissionGuestName = String(dispute.row[commissionGuestColumn] || '').trim();
    if (!normalizeGuestName(commissionGuestName)) return [];

    return pmsRows.flatMap((pmsRow) => {
      const matchType = guestNameMatchType(commissionGuestName, pmsRow.guestName);
      if (!matchType) return [];

      return [{
        reservationNumber: dispute.raw,
        commissionGuestName,
        commissionRow: dispute.rowNumber,
        pmsGuestName: pmsRow.guestName,
        pmsRow: pmsRow.rowNumber,
        pmsOtaRef: pmsRow.otaRef,
        matchType,
      }];
    });
  });
}

function findReservationFieldMatches(
  disputes: ParsedCsv['ids'],
  pmsCsv: ParsedCsv | null
): ReservationFieldMatch[] {
  if (!pmsCsv || !disputes.length) return [];

  const pmsOtaColumn = findColumn(pmsCsv.headers, PMS_COLUMN);
  const sourceColumns: Array<{
    label: ReservationFieldMatch['pmsSourceColumn'];
    column: string;
  }> = [
    { label: 'Guest Name 2', column: findColumn(pmsCsv.headers, PMS_GUEST_NAME_2_COLUMN) },
    { label: 'Group', column: findColumn(pmsCsv.headers, PMS_GROUP_COLUMN) },
    { label: 'Comment', column: findColumn(pmsCsv.headers, PMS_COMMENT_COLUMN) },
  ].filter((source) => !!source.column);

  if (!sourceColumns.length) return [];

  return disputes.flatMap((dispute) => {
    const normalizedReservationNumber = normalizeBookingId(dispute.raw);
    if (!normalizedReservationNumber) return [];

    for (const source of sourceColumns) {
      for (let index = 0; index < pmsCsv.rows.length; index += 1) {
        const row = pmsCsv.rows[index];
        const sourceValue = String(row[source.column] || '').trim();
        const normalizedSourceValue = normalizeBookingId(sourceValue);
        if (!normalizedSourceValue.includes(normalizedReservationNumber)) continue;

        return [{
          reservationNumber: dispute.raw,
          commissionRow: dispute.rowNumber,
          pmsSourceColumn: source.label,
          pmsSourceValue: sourceValue,
          pmsRow: index + 2,
          pmsOtaRef: pmsOtaColumn ? String(row[pmsOtaColumn] || '').trim() : '',
        }];
      }
    }

    return [];
  });
}

async function readCsvFile(
  file: File,
  targetColumn: string,
  options: { ignoreZeroCommission?: boolean } = {}
): Promise<ParsedCsv> {
  const text = await file.text();
  const matrix = parseCsvText(text);

  if (matrix.length === 0) {
    return {
      fileName: file.name,
      headers: [],
      rows: [],
      targetColumn,
      allIds: [],
      ids: [],
      blankRows: [],
      noCommissionRows: [],
      noCommissionIds: [],
      duplicateIds: [],
      error: 'CSV file is empty.',
    };
  }

  const headers = matrix[0].map((header) => header.trim());
  const matchedColumn = findColumn(headers, targetColumn);
  const commissionAmountColumn = findColumn(headers, COMMISSION_AMOUNT_COLUMN);

  if (!matchedColumn) {
    return {
      fileName: file.name,
      headers,
      rows: [],
      targetColumn,
      allIds: [],
      ids: [],
      blankRows: [],
      noCommissionRows: [],
      noCommissionIds: [],
      duplicateIds: [],
      error: `Column "${targetColumn}" was not found.`,
    };
  }

  const rows = matrix.slice(1).map((cells) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = String(cells[index] || '').trim();
    });
    return row;
  });

  const allIds: ParsedCsv['ids'] = [];
  const ids: ParsedCsv['ids'] = [];
  const blankRows: number[] = [];
  const noCommissionRows: number[] = [];
  const noCommissionIds: ParsedCsv['ids'] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    const raw = String(row[matchedColumn] || '').trim();
    const normalized = normalizeBookingId(raw);
    if (!normalized) {
      blankRows.push(rowNumber);
      return;
    }

    const idItem = { raw, normalized, rowNumber, row };
    allIds.push(idItem);

    const commissionAmount = commissionAmountColumn ? parseMoneyAmount(row[commissionAmountColumn]) : null;
    if (options.ignoreZeroCommission && commissionAmount === 0) {
      noCommissionRows.push(rowNumber);
      noCommissionIds.push(idItem);
      return;
    }

    ids.push(idItem);
  });

  return {
    fileName: file.name,
    headers,
    rows,
    targetColumn: matchedColumn,
    allIds,
    ids,
    blankRows,
    noCommissionRows,
    noCommissionIds,
    duplicateIds: duplicateValues(ids.map((item) => item.normalized)),
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(fileName: string, headers: string[], rows: CsvRow[]) {
  const csv = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: 'blue' | 'green' | 'amber' | 'red' }) {
  return (
    <div className={`cc-stat cc-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FileBox({
  title,
  eyebrow,
  description,
  variant,
  parsed,
  onFile,
}: {
  title: string;
  eyebrow: string;
  description: string;
  variant: 'commission' | 'pms';
  parsed: ParsedCsv | null;
  onFile: (file: File) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  function handlePickedFile(file?: File) {
    if (!file) return;
    onFile(file);
  }

  return (
    <section className={`cc-card cc-file-card cc-file-card-${variant}`}>
      <div className="cc-file-top">
        <div className={`cc-file-icon cc-file-icon-${variant}`}>
          {variant === 'commission' ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
              <path d="M8 4v16M16 4v16" />
            </svg>
          )}
        </div>
        <div className="cc-file-copy">
          <div className="cc-eyebrow">{eyebrow}</div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <label
        className={`cc-upload ${dragActive ? 'cc-upload-active' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          handlePickedFile(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            handlePickedFile(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <span className="cc-upload-main">Drop CSV here</span>
        <span className="cc-upload-sub">or tap to choose file</span>
      </label>
      {parsed ? (
        <div className={parsed.error ? 'cc-file-status cc-file-error' : 'cc-file-status'}>
          <strong>{parsed.fileName}</strong>
          <span>
            {parsed.error
            ? parsed.error
              : `${parsed.ids.length} payable IDs, ${parsed.blankRows.length} blank row${parsed.blankRows.length === 1 ? '' : 's'}${parsed.noCommissionRows.length ? `, ${parsed.noCommissionRows.length} no commission` : ''}`}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export default function CommissionCheckerPage() {
  const [commissionCsv, setCommissionCsv] = useState<ParsedCsv | null>(null);
  const [pmsCsv, setPmsCsv] = useState<ParsedCsv | null>(null);
  const [folioByReservation, setFolioByReservation] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const result = useMemo<CompareResult | null>(() => {
    if (!commissionCsv || !pmsCsv || commissionCsv.error || pmsCsv.error) return null;
    const pmsSet = new Set(pmsCsv.ids.map((item) => item.normalized));
    const matches = commissionCsv.ids.filter((item) => pmsSet.has(item.normalized));
    const missing = commissionCsv.ids.filter((item) => !pmsSet.has(item.normalized));
    return {
      matches,
      missing,
      commissionDuplicates: commissionCsv.duplicateIds,
      pmsDuplicates: pmsCsv.duplicateIds,
    };
  }, [commissionCsv, pmsCsv]);

  const reportRows = useMemo(
    () => buildCommissionReportRows(commissionCsv, pmsCsv, folioByReservation),
    [commissionCsv, pmsCsv, folioByReservation]
  );

  const reservationFieldMatches = useMemo(
    () => findReservationFieldMatches(result?.missing || [], pmsCsv),
    [pmsCsv, result]
  );
  const reservationFieldMatchSet = useMemo(
    () => new Set(reservationFieldMatches.map((match) => normalizeBookingId(match.reservationNumber))),
    [reservationFieldMatches]
  );
  const guestName1Candidates = useMemo(
    () => (result?.missing || []).filter((item) => !reservationFieldMatchSet.has(item.normalized)),
    [reservationFieldMatchSet, result]
  );
  const nameMatches = useMemo(
    () => findGuestNameMatches(guestName1Candidates, commissionCsv, pmsCsv),
    [commissionCsv, guestName1Candidates, pmsCsv]
  );
  const nameMatchSet = useMemo(
    () => new Set(nameMatches.map((match) => normalizeBookingId(match.reservationNumber))),
    [nameMatches]
  );
  const finalUnmatchedCount = useMemo(
    () => (result?.missing || []).filter(
      (item) => !reservationFieldMatchSet.has(item.normalized) && !nameMatchSet.has(item.normalized)
    ).length,
    [nameMatchSet, reservationFieldMatchSet, result]
  );
  const visibleDisputeHeaders = useMemo(
    () => (commissionCsv ? buildDisputeHeaders(commissionCsv.headers) : DISPUTE_BASE_HEADERS),
    [commissionCsv]
  );
  const disputeRows = useMemo(() => {
    if (!result) return [];

    return result.missing
      .map((item) => ({
        'Dispute Reason': 'Reservation number not found in PMS OTA Ref. No',
        'Reservation Number': item.raw,
        'Folio Number': folioByReservation[item.normalized] || '',
        'CSV Row': String(item.rowNumber),
        ...item.row,
      }))
      .sort((left, right) => {
        const leftId = normalizeBookingId(left['Reservation Number']);
        const rightId = normalizeBookingId(right['Reservation Number']);
        const leftNoMatch = !nameMatchSet.has(leftId) && !reservationFieldMatchSet.has(leftId);
        const rightNoMatch = !nameMatchSet.has(rightId) && !reservationFieldMatchSet.has(rightId);
        if (leftNoMatch !== rightNoMatch) return leftNoMatch ? -1 : 1;

        const leftArrival = getCell(left, commissionCsv?.headers || [], ['Arrival date', 'Check-in', 'Check in', 'Arrival']);
        const rightArrival = getCell(right, commissionCsv?.headers || [], ['Arrival date', 'Check-in', 'Check in', 'Arrival']);
        return parseSortableDate(leftArrival) - parseSortableDate(rightArrival);
      });
  }, [commissionCsv, folioByReservation, nameMatchSet, reservationFieldMatchSet, result]);
  const nameMatchRows = useMemo(
    () => nameMatches.map((match) => ({
      'Match Type': match.matchType,
      'Reservation Number': match.reservationNumber,
      'Booking.com Guest Name': match.commissionGuestName,
      'Booking.com CSV Row': String(match.commissionRow),
      'PMS Guest Name 1': match.pmsGuestName,
      'PMS CSV Row': String(match.pmsRow),
      'PMS OTA Ref. No': match.pmsOtaRef || '-',
    })),
    [nameMatches]
  );
  const reservationFieldMatchRows = useMemo(
    () => reservationFieldMatches.map((match) => ({
      'Match Type': 'Reservation number found outside OTA Ref.',
      'Reservation Number': match.reservationNumber,
      'Booking.com CSV Row': String(match.commissionRow),
      'PMS Matched Column': match.pmsSourceColumn,
      'PMS Matched Value': match.pmsSourceValue,
      'PMS CSV Row': String(match.pmsRow),
      'PMS OTA Ref. No': match.pmsOtaRef || '-',
    })),
    [reservationFieldMatches]
  );

  async function handleFile(file: File, type: 'commission' | 'pms') {
    setBusy(true);
    setErrorMsg('');
    try {
      const parsed = await readCsvFile(
        file,
        type === 'commission' ? COMMISSION_COLUMN : PMS_COLUMN,
        { ignoreZeroCommission: type === 'commission' }
      );
      if (type === 'commission') setCommissionCsv(parsed);
      else setPmsCsv(parsed);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to read CSV.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="cc-shell">
      <section className="cc-hero">
        <div>
          <div className="cc-eyebrow">Management Workspace</div>
          <h1>Commission Checker</h1>
          <p>Cross-check Booking.com reservations against ABS OTA Ref., Guest Name 2, Group, Comment, and Guest Name 1.</p>
        </div>
        <Link href="/dashboard" className="cc-secondary-link">Back to Dashboard</Link>
      </section>

      {errorMsg ? <div className="cc-error">{errorMsg}</div> : null}

      <section className="cc-grid">
        <FileBox
          title="Booking.com Commission CSV"
          eyebrow="Booking.com Statement"
          description="Upload the reservation statement exported from Booking.com."
          variant="commission"
          parsed={commissionCsv}
          onFile={(file) => void handleFile(file, 'commission')}
        />
        <FileBox
          title="PMS Transaction CSV"
          eyebrow="PMS Export"
          description="Upload the ABS Transaction Enquiry file containing OTA Ref., Guest Name 1/2, Group, and Comment."
          variant="pms"
          parsed={pmsCsv}
          onFile={(file) => void handleFile(file, 'pms')}
        />
      </section>

      <section className="cc-card">
        <div className="cc-card-head">
          <div>
            <div className="cc-eyebrow">Result</div>
            <h2>Commission Reconciliation</h2>
          </div>
          {busy ? <span className="cc-badge">Reading CSV...</span> : null}
        </div>

        {result ? (
          <>
            <div className="cc-stats">
              <StatCard label="Payable IDs" value={commissionCsv?.ids.length || 0} tone="blue" />
              <StatCard label="OTA Ref Matches" value={result.matches.length} tone="green" />
              <StatCard label="OTA Ref Missing" value={result.missing.length} tone={result.missing.length ? 'amber' : 'green'} />
              <StatCard label="Reservation Field Matches" value={reservationFieldMatches.length} tone={reservationFieldMatches.length ? 'blue' : 'green'} />
              <StatCard label="Guest Name 1 Matches" value={nameMatches.length} tone={nameMatches.length ? 'blue' : 'green'} />
              <StatCard label="Final Unmatched" value={finalUnmatchedCount} tone={finalUnmatchedCount ? 'red' : 'green'} />
              <StatCard label="No Commission" value={commissionCsv?.noCommissionRows.length || 0} tone="amber" />
            </div>

            <div className="cc-actions">
              <button
                type="button"
                className="cc-primary-btn"
                disabled={!reportRows.length}
                onClick={() => downloadCsv('booking-commission-full-report.csv', REPORT_HEADERS, reportRows)}
              >
                Export Full Report CSV
              </button>
              <button
                type="button"
                className="cc-secondary-btn"
                onClick={() => {
                  setCommissionCsv(null);
                  setPmsCsv(null);
                  setFolioByReservation({});
                }}
              >
                Clear Files
              </button>
            </div>

            <section className="cc-subsection cc-subsection-purple">
              <div className="cc-subhead">
                <div>
                  <div className="cc-eyebrow">Reservation Number Fallback</div>
                  <h3>Found in Guest Name 2, Group, or Comment</h3>
                </div>
                <span className="cc-soft-badge cc-soft-badge-purple">{reservationFieldMatchRows.length} match(es)</span>
              </div>
              <div className="cc-table-wrap">
                <table className="cc-table cc-name-table">
                  <thead>
                    <tr>{RESERVATION_FIELD_MATCH_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {reservationFieldMatchRows.length ? (
                      reservationFieldMatchRows.map((row, index) => (
                        <tr key={`${row['Reservation Number']}-${index}`} className="cc-dispute-row-guest-name-2-match">
                          {RESERVATION_FIELD_MATCH_HEADERS.map((header) => <td key={header}>{row[header] || '-'}</td>)}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={RESERVATION_FIELD_MATCH_HEADERS.length}>No reservation numbers were found in ABS Guest Name 2, Group, or Comment.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="cc-subsection">
              <div className="cc-subhead">
                <div>
                  <div className="cc-eyebrow">Final Fallback</div>
                  <h3>Guest Name 1 Cross-Check</h3>
                </div>
                <span className="cc-soft-badge">{nameMatchRows.length} match(es)</span>
              </div>
              <div className="cc-table-wrap">
                <table className="cc-table cc-name-table">
                  <thead>
                    <tr>{NAME_MATCH_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {nameMatchRows.length ? (
                      nameMatchRows.map((row, index) => (
                        <tr key={`${row['Reservation Number']}-${index}`} className="cc-dispute-row-name-match">
                          {NAME_MATCH_HEADERS.map((header) => <td key={header}>{row[header] || '-'}</td>)}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={NAME_MATCH_HEADERS.length}>No exact or similar Guest Name 1 matches were found after the reservation-number checks.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="cc-subsection">
              <div className="cc-subhead">
                <div>
                  <div className="cc-eyebrow">Dispute Review</div>
                  <h3>Possible Disputes</h3>
                </div>
                <span className="cc-soft-badge">{disputeRows.length} row(s)</span>
              </div>
              <div className="cc-table-wrap">
                <table className="cc-table cc-dispute-table">
                  <thead>
                    <tr>{visibleDisputeHeaders.map((header) => <th key={header}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {disputeRows.length ? (
                      disputeRows.map((row, index) => {
                        const reservationId = normalizeBookingId(row['Reservation Number']);
                        const hasNameMatch = nameMatchSet.has(reservationId);
                        const hasReservationFieldMatch = reservationFieldMatchSet.has(reservationId);
                        const isNoMatch = !hasNameMatch && !hasReservationFieldMatch;
                        const rowClassName = isNoMatch
                          ? 'cc-dispute-row-no-match'
                          : hasReservationFieldMatch
                            ? 'cc-dispute-row-guest-name-2-match'
                            : 'cc-dispute-row-name-match';

                        return (
                          <tr
                            key={`${row['Reservation Number']}-${index}`}
                            className={rowClassName}
                            onClick={() => {
                              if (!isNoMatch) return;
                              const currentFolio = folioByReservation[reservationId] || '';
                              const folio = window.prompt(`Enter folio number for reservation ${row['Reservation Number']}`, currentFolio);
                              if (folio === null) return;
                              setFolioByReservation((current) => ({
                                ...current,
                                [reservationId]: folio.trim(),
                              }));
                            }}
                          >
                            {visibleDisputeHeaders.map((header) => (
                              <td key={header}>
                                {header === 'Dispute Reason'
                                  ? isNoMatch
                                    ? 'No match found anywhere in PMS'
                                    : hasReservationFieldMatch
                                      ? 'Reservation found in ABS Guest Name 2, Group, or Comment'
                                      : 'Guest name matched PMS Guest Name 1'
                                  : row[header] || '-'}
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={visibleDisputeHeaders.length}>No payable disputes found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="cc-footnote">Red rows have no ABS match and can be clicked to key in a folio number. Blue rows matched by reservation number in Guest Name 2, Group, or Comment, or by Guest Name 1.</div>
            </section>
          </>
        ) : (
          <div className="cc-empty">
            Upload both CSV files to compare <strong>{COMMISSION_COLUMN}</strong> against <strong>{PMS_COLUMN}</strong>.
          </div>
        )}
      </section>

      <style jsx global>{`
        .cc-shell {
          min-height: 100vh;
          padding: clamp(16px, 3vw, 34px);
          background:
            radial-gradient(circle at 8% 4%, rgba(37, 99, 235, 0.13), transparent 28%),
            radial-gradient(circle at 92% 2%, rgba(14, 165, 233, 0.1), transparent 24%),
            linear-gradient(180deg, #f6f9ff 0%, #edf3fb 100%);
          color: #0f172a;
          box-sizing: border-box;
        }
        .cc-hero,
        .cc-card,
        .cc-center-card {
          border: 1px solid rgba(191, 211, 238, 0.9);
          background: rgba(255,255,255,0.94);
          border-radius: 24px;
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.95);
        }
        .cc-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: clamp(18px, 2.4vw, 28px);
          max-width: 1180px;
          margin: 0 auto 16px;
          background:
            linear-gradient(135deg, rgba(255,255,255,0.98), rgba(240,246,255,0.94)),
            radial-gradient(circle at 90% 0%, rgba(37,99,235,.12), transparent 36%);
        }
        .cc-hero h1,
        .cc-card h2,
        .cc-center-card h1,
        .cc-file-card h2 {
          margin: 0;
          color: #071225;
          letter-spacing: 0;
        }
        .cc-hero h1 { font-size: clamp(30px, 4vw, 46px); line-height: 1.05; }
        .cc-card h2,
        .cc-file-card h2 { font-size: 24px; line-height: 1.1; }
        .cc-hero p,
        .cc-file-card p,
        .cc-center-card p {
          color: #526783;
          font-weight: 700;
          margin: 8px 0 0;
          line-height: 1.45;
        }
        .cc-eyebrow {
          color: #2563eb;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.9px;
          font-weight: 950;
          margin-bottom: 8px;
        }
        .cc-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          max-width: 1180px;
          margin: 0 auto 16px;
        }
        .cc-hero,
        .cc-grid,
        .cc-card {
          width: min(100%, 1760px);
          max-width: 1760px;
        }
        .cc-card { margin: 0 auto; padding: clamp(16px, 2.3vw, 24px); }
        .cc-file-card { margin: 0; position: relative; overflow: hidden; }
        .cc-file-card {
          padding: clamp(16px, 2.2vw, 24px);
          display: grid;
          gap: 16px;
          min-height: 274px;
          align-content: start;
        }
        .cc-file-card:before {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 5px;
        }
        .cc-file-card-commission:before {
          background: linear-gradient(180deg, #2563eb, #7c3aed);
        }
        .cc-file-card-pms:before {
          background: linear-gradient(180deg, #0891b2, #16a34a);
        }
        .cc-file-card-commission {
          background:
            linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,251,255,.96)),
            radial-gradient(circle at 100% 0%, rgba(37,99,235,.12), transparent 34%);
        }
        .cc-file-card-pms {
          background:
            linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,251,255,.96)),
            radial-gradient(circle at 100% 0%, rgba(16,185,129,.11), transparent 34%);
        }
        .cc-file-top {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr);
          gap: 14px;
          align-items: start;
        }
        .cc-file-icon {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
        }
        .cc-file-icon svg {
          width: 25px;
          height: 25px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .cc-file-icon-commission {
          color: #1d4ed8;
          background: linear-gradient(135deg, #eff6ff, #dbeafe);
          border: 1px solid #bfdbfe;
        }
        .cc-file-icon-pms {
          color: #047857;
          background: linear-gradient(135deg, #ecfeff, #dcfce7);
          border: 1px solid #bbf7d0;
        }
        .cc-file-copy {
          min-width: 0;
        }
        .cc-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }
        .cc-upload {
          min-height: 112px;
          border: 1px dashed #9eb8dc;
          background:
            linear-gradient(180deg, rgba(255,255,255,.98) 0%, rgba(239,246,255,.86) 100%),
            radial-gradient(circle at top left, rgba(37,99,235,.10), transparent 34%);
          color: #1d4ed8;
          border-radius: 22px;
          display: grid;
          gap: 5px;
          place-items: center;
          align-content: center;
          font-weight: 950;
          cursor: pointer;
          transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease, background .18s ease;
        }
        .cc-upload:hover,
        .cc-upload-active {
          border-color: #2563eb;
          background: linear-gradient(180deg, #ffffff 0%, #dbeafe 100%);
          box-shadow: 0 18px 44px rgba(37,99,235,.14);
          transform: translateY(-1px);
        }
        .cc-upload input { display: none; }
        .cc-upload-main {
          font-size: 17px;
          color: #0f172a;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .cc-upload-main:before {
          content: '+';
          width: 25px;
          height: 25px;
          border-radius: 10px;
          display: inline-grid;
          place-items: center;
          background: #2563eb;
          color: #fff;
          box-shadow: 0 8px 20px rgba(37,99,235,.22);
          font-size: 18px;
          line-height: 1;
        }
        .cc-upload-sub {
          color: #64748b;
          font-size: 13px;
          font-weight: 850;
        }
        .cc-file-status {
          padding: 12px;
          border: 1px solid #bfdbfe;
          border-radius: 16px;
          background: #eff6ff;
          color: #1e3a8a;
          display: grid;
          gap: 4px;
          font-size: 13px;
          font-weight: 800;
          overflow-wrap: anywhere;
        }
        .cc-file-error {
          border-color: #fecaca;
          background: #fef2f2;
          color: #b91c1c;
        }
        .cc-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .cc-stat {
          border: 1px solid #dbe7f6;
          border-radius: 18px;
          padding: 14px;
          background: #fff;
          display: grid;
          gap: 8px;
        }
        .cc-stat span {
          color: #64748b;
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.55px;
          font-weight: 950;
        }
        .cc-stat strong {
          font-size: 30px;
          line-height: 1;
          color: #0f172a;
        }
        .cc-stat-blue { box-shadow: inset 4px 0 0 #2563eb; }
        .cc-stat-green { box-shadow: inset 4px 0 0 #16a34a; }
        .cc-stat-amber { box-shadow: inset 4px 0 0 #d97706; }
        .cc-stat-red { box-shadow: inset 4px 0 0 #dc2626; }
        .cc-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }
        .cc-primary-btn,
        .cc-secondary-btn,
        .cc-primary-link,
        .cc-secondary-link {
          border-radius: 15px;
          min-height: 46px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 950;
          text-decoration: none;
          cursor: pointer;
          box-sizing: border-box;
        }
        .cc-primary-btn,
        .cc-primary-link {
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 55%, #3b82f6 100%);
          box-shadow: 0 16px 30px rgba(37,99,235,.22);
        }
        .cc-primary-btn:disabled {
          opacity: .45;
          cursor: not-allowed;
          box-shadow: none;
        }
        .cc-secondary-btn,
        .cc-secondary-link {
          border: 1px solid #cbd9eb;
          background: #fff;
          color: #0f172a;
        }
        .cc-secondary-btn:disabled {
          opacity: .45;
          cursor: not-allowed;
        }
        .cc-badge {
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 900;
        }
        .cc-error {
          border: 1px solid #fed7aa;
          background: #fffbeb;
          color: #92400e;
          border-radius: 16px;
          padding: 12px 14px;
          font-weight: 800;
          margin-bottom: 14px;
        }
        .cc-error {
          max-width: 1180px;
          margin: 0 auto 14px;
          border-color: #fecaca;
          background: #fef2f2;
          color: #b91c1c;
        }
        .cc-subsection {
          border: 1px solid #dbe7f6;
          border-radius: 20px;
          background:
            linear-gradient(180deg, #ffffff, #f8fbff);
          padding: 14px;
          margin: 4px 0 14px;
        }
        .cc-subsection-purple {
          border-color: #ddd6fe;
          background: linear-gradient(180deg, #ffffff, #faf5ff);
        }
        .cc-subhead {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          margin-bottom: 12px;
        }
        .cc-subhead h3 {
          margin: 0;
          font-size: 20px;
          color: #071225;
          letter-spacing: 0;
        }
        .cc-soft-badge {
          border-radius: 999px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 7px 11px;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }
        .cc-soft-badge-purple {
          border-color: #ddd6fe;
          background: #f5f3ff;
          color: #6d28d9;
        }
        .cc-table-wrap {
          overflow: auto;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: #fff;
        }
        .cc-table {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
          font-size: 13px;
        }
        .cc-table th,
        .cc-table td {
          padding: 11px 12px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: top;
        }
        .cc-table th {
          background: #f8fbff;
          color: #334155;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          font-weight: 950;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .cc-report-table {
          min-width: 1180px;
        }
        .cc-dispute-table {
          min-width: 980px;
        }
        .cc-name-table th {
          background: #f0f7ff;
        }
        .cc-dispute-row-name-match td {
          background: #eff6ff;
          color: #0f2f6e;
        }
        .cc-dispute-row-name-match td:first-child {
          border-left: 4px solid #2563eb;
        }
        .cc-dispute-row-guest-name-2-match td {
          background: #f5f3ff;
          color: #4c1d95;
        }
        .cc-dispute-row-guest-name-2-match td:first-child {
          border-left: 4px solid #7c3aed;
        }
        .cc-dispute-row-no-match {
          cursor: pointer;
        }
        .cc-dispute-row-no-match td {
          background: #fff1f2;
          color: #7f1d1d;
        }
        .cc-dispute-row-no-match:hover td {
          background: #ffe4e6;
        }
        .cc-dispute-row-no-match td:first-child {
          border-left: 4px solid #e11d48;
        }
        .cc-report-row-matched td {
          background: #f0fdf4;
          color: #14532d;
        }
        .cc-report-row-matched td:first-child {
          border-left: 4px solid #16a34a;
        }
        .cc-report-row-no-commission td {
          background: #fffbeb;
          color: #78350f;
        }
        .cc-report-row-no-commission td:first-child {
          border-left: 4px solid #d97706;
        }
        .cc-report-row-no-match {
          cursor: pointer;
        }
        .cc-report-row-no-match td {
          background: #fff1f2;
          color: #7f1d1d;
        }
        .cc-report-row-no-match:hover td {
          background: #ffe4e6;
        }
        .cc-report-row-no-match td:first-child {
          border-left: 4px solid #e11d48;
        }
        .cc-match-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
        }
        .cc-match-pill-matched {
          background: #dcfce7;
          color: #166534;
          border: 1px solid #bbf7d0;
        }
        .cc-match-pill-no-match {
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }
        .cc-match-pill-muted {
          background: #fef3c7;
          color: #92400e;
          border: 1px solid #fde68a;
        }
        .cc-empty {
          padding: 28px;
          border: 1px dashed #cbd9eb;
          border-radius: 18px;
          background: #f8fbff;
          color: #64748b;
          text-align: center;
          font-weight: 800;
        }
        .cc-footnote {
          margin-top: 10px;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
        .cc-center-card {
          max-width: 560px;
          margin: 16vh auto 0;
          padding: 28px;
          text-align: center;
        }
        @media (max-width: 760px) {
          .cc-shell { padding: 12px; }
          .cc-hero {
            align-items: stretch;
            flex-direction: column;
            border-radius: 20px;
          }
          .cc-grid,
          .cc-stats {
            grid-template-columns: 1fr;
          }
          .cc-card,
          .cc-file-card {
            border-radius: 20px;
          }
          .cc-file-top {
            grid-template-columns: 44px minmax(0, 1fr);
            gap: 10px;
          }
          .cc-file-icon {
            width: 44px;
            height: 44px;
            border-radius: 15px;
          }
          .cc-upload {
            min-height: 104px;
            border-radius: 18px;
          }
          .cc-actions {
            display: grid;
            grid-template-columns: 1fr;
          }
          .cc-secondary-link,
          .cc-primary-btn,
          .cc-secondary-btn {
            width: 100%;
          }
          .cc-stat strong {
            font-size: 26px;
          }
        }
      `}</style>
    </main>
  );
}
