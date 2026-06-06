'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Profile = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_access_management_tasks?: boolean;
};

type CsvRow = Record<string, string>;

type ParsedCsv = {
  fileName: string;
  headers: string[];
  rows: CsvRow[];
  targetColumn: string;
  ids: Array<{ raw: string; normalized: string; rowNumber: number; row: CsvRow }>;
  blankRows: number[];
  ignoredCancelledRows: number[];
  duplicateIds: string[];
  error?: string;
};

type CompareResult = {
  matches: ParsedCsv['ids'];
  missing: ParsedCsv['ids'];
  commissionDuplicates: string[];
  pmsDuplicates: string[];
};

const COMMISSION_COLUMN = 'reservation number';
const PMS_COLUMN = 'ota ref';
const STATUS_COLUMN = 'status';
const COMMISSION_CHECKER_ALLOWED_EMAILS = [
  'walter@hotelhallmark.com',
  'fenny@hotelhallmark.com',
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

function duplicateValues(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function isCancelledStatus(value: string) {
  return normalizeHeader(value) === 'cancelled' || normalizeHeader(value) === 'canceled';
}

async function readCsvFile(
  file: File,
  targetColumn: string,
  options: { ignoreCancelledStatus?: boolean } = {}
): Promise<ParsedCsv> {
  const text = await file.text();
  const matrix = parseCsvText(text);

  if (matrix.length === 0) {
    return {
      fileName: file.name,
      headers: [],
      rows: [],
      targetColumn,
      ids: [],
      blankRows: [],
      ignoredCancelledRows: [],
      duplicateIds: [],
      error: 'CSV file is empty.',
    };
  }

  const headers = matrix[0].map((header) => header.trim());
  const matchedColumn = findColumn(headers, targetColumn);
  const statusColumn = findColumn(headers, STATUS_COLUMN);

  if (!matchedColumn) {
    return {
      fileName: file.name,
      headers,
      rows: [],
      targetColumn,
      ids: [],
      blankRows: [],
      ignoredCancelledRows: [],
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

  const ids: ParsedCsv['ids'] = [];
  const blankRows: number[] = [];
  const ignoredCancelledRows: number[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    if (options.ignoreCancelledStatus && statusColumn && isCancelledStatus(row[statusColumn])) {
      ignoredCancelledRows.push(rowNumber);
      return;
    }

    const raw = String(row[matchedColumn] || '').trim();
    const normalized = normalizeBookingId(raw);
    if (!normalized) {
      blankRows.push(rowNumber);
      return;
    }
    ids.push({ raw, normalized, rowNumber, row });
  });

  return {
    fileName: file.name,
    headers,
    rows,
    targetColumn: matchedColumn,
    ids,
    blankRows,
    ignoredCancelledRows,
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
  hint,
  parsed,
  onFile,
}: {
  title: string;
  hint: string;
  parsed: ParsedCsv | null;
  onFile: (file: File) => void;
}) {
  return (
    <section className="cc-card cc-file-card">
      <div>
        <div className="cc-eyebrow">CSV Upload</div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <label className="cc-upload">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.currentTarget.value = '';
          }}
        />
        <span>Choose CSV</span>
      </label>
      {parsed ? (
        <div className={parsed.error ? 'cc-file-status cc-file-error' : 'cc-file-status'}>
          <strong>{parsed.fileName}</strong>
          <span>
            {parsed.error
            ? parsed.error
              : `${parsed.ids.length} usable IDs, ${parsed.blankRows.length} blank row${parsed.blankRows.length === 1 ? '' : 's'}${parsed.ignoredCancelledRows.length ? `, ${parsed.ignoredCancelledRows.length} cancelled ignored` : ''}`}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export default function CommissionCheckerPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [commissionCsv, setCommissionCsv] = useState<ParsedCsv | null>(null);
  const [pmsCsv, setPmsCsv] = useState<ParsedCsv | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    fetch(`/api/session-profile?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!mounted) return;
        setProfile(json?.user || null);
      })
      .catch(() => {
        if (mounted) setProfile(null);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const profileEmail = String(profile?.email || '').toLowerCase();
  const profileRole = String(profile?.role || '').toUpperCase();
  const canAccess =
    !!profile &&
    (
      profileRole === 'SUPERUSER' ||
      !!profile.can_access_management_tasks ||
      COMMISSION_CHECKER_ALLOWED_EMAILS.includes(profileEmail)
    );

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

  async function handleFile(file: File, type: 'commission' | 'pms') {
    setBusy(true);
    setErrorMsg('');
    try {
      const parsed = await readCsvFile(
        file,
        type === 'commission' ? COMMISSION_COLUMN : PMS_COLUMN,
        { ignoreCancelledStatus: type === 'commission' }
      );
      if (type === 'commission') setCommissionCsv(parsed);
      else setPmsCsv(parsed);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to read CSV.');
    } finally {
      setBusy(false);
    }
  }

  const visibleHeaders = result?.missing.length
    ? ['Dispute Reason', 'Reservation Number', 'CSV Row', ...commissionCsv!.headers]
    : ['Dispute Reason', 'Reservation Number', 'CSV Row'];

  const disputeRows: CsvRow[] = result?.missing.map((item) => ({
    'Dispute Reason': 'Reservation number not found in PMS OTA Ref',
    'Reservation Number': item.raw,
    'CSV Row': String(item.rowNumber),
    ...item.row,
  })) || [];

  if (authLoading) {
    return <main className="cc-shell"><div className="cc-center-card">Checking access...</div></main>;
  }

  if (!canAccess) {
    return (
      <main className="cc-shell">
        <div className="cc-center-card">
          <h1>Access denied</h1>
          <p>Commission Checker is available to Superuser, Walter, Fenny, and users with Management access.</p>
          <Link href="/dashboard" className="cc-primary-link">Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="cc-shell">
      <section className="cc-hero">
        <div>
          <div className="cc-eyebrow">Management Workspace</div>
          <h1>Commission Checker</h1>
          <p>Compare Booking.com commission reservations against PMS OTA references before approving payment.</p>
        </div>
        <Link href="/dashboard" className="cc-secondary-link">Back to Dashboard</Link>
      </section>

      {errorMsg ? <div className="cc-error">{errorMsg}</div> : null}

      <section className="cc-grid">
        <FileBox
          title="Booking.com Commission CSV"
          hint={`Required column: "${COMMISSION_COLUMN}". Rows with status "cancelled" are ignored.`}
          parsed={commissionCsv}
          onFile={(file) => void handleFile(file, 'commission')}
        />
        <FileBox
          title="PMS Transaction CSV"
          hint={`Required column: "${PMS_COLUMN}"`}
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
              <StatCard label="Commission IDs" value={commissionCsv?.ids.length || 0} tone="blue" />
              <StatCard label="Matched PMS" value={result.matches.length} tone="green" />
              <StatCard label="Possible Disputes" value={result.missing.length} tone={result.missing.length ? 'red' : 'green'} />
              <StatCard label="PMS IDs" value={pmsCsv?.ids.length || 0} tone="amber" />
              <StatCard label="Cancelled Ignored" value={commissionCsv?.ignoredCancelledRows.length || 0} tone="amber" />
            </div>

            <div className="cc-actions">
              <button
                type="button"
                className="cc-primary-btn"
                disabled={!disputeRows.length}
                onClick={() => downloadCsv('booking-commission-disputes.csv', visibleHeaders, disputeRows)}
              >
                Export Dispute CSV
              </button>
              <button
                type="button"
                className="cc-secondary-btn"
                onClick={() => {
                  setCommissionCsv(null);
                  setPmsCsv(null);
                }}
              >
                Clear Files
              </button>
            </div>

            {(result.commissionDuplicates.length || result.pmsDuplicates.length || commissionCsv?.blankRows.length || pmsCsv?.blankRows.length || commissionCsv?.ignoredCancelledRows.length) ? (
              <div className="cc-warnings">
                {commissionCsv?.ignoredCancelledRows.length ? <p>Booking.com cancelled rows ignored: {commissionCsv.ignoredCancelledRows.slice(0, 8).join(', ')}{commissionCsv.ignoredCancelledRows.length > 8 ? '...' : ''}</p> : null}
                {result.commissionDuplicates.length ? <p>Booking.com duplicate IDs: {result.commissionDuplicates.slice(0, 8).join(', ')}{result.commissionDuplicates.length > 8 ? '...' : ''}</p> : null}
                {result.pmsDuplicates.length ? <p>PMS duplicate IDs: {result.pmsDuplicates.slice(0, 8).join(', ')}{result.pmsDuplicates.length > 8 ? '...' : ''}</p> : null}
                {commissionCsv?.blankRows.length ? <p>Booking.com blank reservation rows: {commissionCsv.blankRows.slice(0, 8).join(', ')}{commissionCsv.blankRows.length > 8 ? '...' : ''}</p> : null}
                {pmsCsv?.blankRows.length ? <p>PMS blank OTA ref rows: {pmsCsv.blankRows.slice(0, 8).join(', ')}{pmsCsv.blankRows.length > 8 ? '...' : ''}</p> : null}
              </div>
            ) : null}

            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>{visibleHeaders.map((header) => <th key={header}>{header}</th>)}</tr>
                </thead>
                <tbody>
                  {disputeRows.length ? (
                    disputeRows.slice(0, 300).map((row, index) => (
                      <tr key={`${row['Reservation Number']}-${index}`}>
                        {visibleHeaders.map((header) => <td key={header}>{row[header] || '-'}</td>)}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={visibleHeaders.length}>No dispute IDs found. Every commission reservation number exists in PMS OTA Ref.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {disputeRows.length > 300 ? <div className="cc-footnote">Showing first 300 dispute rows. Export CSV for the full list.</div> : null}
          </>
        ) : (
          <div className="cc-empty">
            Upload both CSV files to compare <strong>{COMMISSION_COLUMN}</strong> against <strong>{PMS_COLUMN}</strong>.
          </div>
        )}
      </section>

      <style jsx>{`
        .cc-shell {
          min-height: 100vh;
          padding: clamp(16px, 3vw, 34px);
          background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 34%),
            linear-gradient(180deg, #f4f8ff 0%, #eef4fb 100%);
          color: #0f172a;
          box-sizing: border-box;
        }
        .cc-hero,
        .cc-card,
        .cc-center-card {
          border: 1px solid #d6e3f5;
          background: rgba(255,255,255,0.92);
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.95);
        }
        .cc-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: clamp(18px, 2.4vw, 28px);
          max-width: 1180px;
          margin: 0 auto 16px;
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
        .cc-card { max-width: 1180px; margin: 0 auto; padding: clamp(16px, 2.3vw, 24px); }
        .cc-file-card { margin: 0; }
        .cc-file-card {
          padding: clamp(16px, 2.2vw, 24px);
          display: grid;
          gap: 14px;
        }
        .cc-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }
        .cc-upload {
          min-height: 78px;
          border: 1px dashed #93c5fd;
          background: linear-gradient(180deg, #ffffff 0%, #eff6ff 100%);
          color: #1d4ed8;
          border-radius: 18px;
          display: grid;
          place-items: center;
          font-weight: 950;
          cursor: pointer;
        }
        .cc-upload input { display: none; }
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
        .cc-badge {
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 900;
        }
        .cc-warnings,
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
        .cc-warnings p { margin: 4px 0; }
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
