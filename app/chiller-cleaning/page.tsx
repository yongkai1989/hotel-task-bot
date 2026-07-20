'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ChillerRecord = {
  id: string;
  week_start: string;
  week_end: string;
  chiller_name: string;
  staff_name: string | null;
  before_url?: string | null;
  before_submitted_at?: string | null;
  after_url?: string | null;
  after_submitted_at?: string | null;
};

type Week = { start: string; end: string };
type UploadKind = 'before' | 'after';
type ChillerStatus = 'missing' | 'partial' | 'complete';

const TOKEN_KEY = 'chiller_cleaning_staff_token_v2';
const CHILLERS = ['Chiller 1', 'Chiller 2', 'Chiller 3', 'Chiller 4', 'Chiller 5'];

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not submitted';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusFor(record?: ChillerRecord): ChillerStatus {
  if (record?.before_url && record?.after_url) return 'complete';
  if (record?.before_url || record?.after_url) return 'partial';
  return 'missing';
}

function statusLabel(status: ChillerStatus) {
  if (status === 'complete') return 'Complete';
  if (status === 'partial') return 'Partial';
  return 'Missing';
}

export default function ChillerCleaningPage() {
  const [token, setToken] = useState('');
  const [passcode, setPasscode] = useState('');
  const [staffName, setStaffName] = useState('');
  const [week, setWeek] = useState<Week | null>(null);
  const [records, setRecords] = useState<ChillerRecord[]>([]);
  const [selectedChiller, setSelectedChiller] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<UploadKind | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const beforeCameraRef = useRef<HTMLInputElement | null>(null);
  const beforeLibraryRef = useRef<HTMLInputElement | null>(null);
  const afterCameraRef = useRef<HTMLInputElement | null>(null);
  const afterLibraryRef = useRef<HTMLInputElement | null>(null);

  const recordMap = useMemo(() => {
    const map = new Map<string, ChillerRecord>();
    records.forEach((record) => map.set(record.chiller_name, record));
    return map;
  }, [records]);

  const selectedRecord = selectedChiller ? recordMap.get(selectedChiller) : undefined;
  const selectedStatus = statusFor(selectedRecord);

  async function load(currentToken = token) {
    if (!currentToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/chiller-cleaning/submissions', {
        headers: { 'x-chiller-token': currentToken },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load submissions');
      setWeek(json.week);
      setRecords(json.records || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load submissions');
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedToken = sessionStorage.getItem(TOKEN_KEY) || '';
    setToken(savedToken);
    if (savedToken) {
      load(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  async function login() {
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/chiller-cleaning/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, mode: 'staff' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Invalid passcode');
      sessionStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setPasscode('');
      await load(json.token);
    } catch (err: any) {
      setError(err?.message || 'Unable to login');
    }
  }

  async function upload(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setMessage('');
    if (!staffName.trim()) {
      setError('Please enter staff name before uploading.');
      return;
    }
    if (!selectedChiller) {
      setError('Please choose a chiller before uploading.');
      return;
    }

    setSaving(kind);
    try {
      const form = new FormData();
      form.append('chiller_name', selectedChiller);
      form.append('kind', kind);
      form.append('staff_name', staffName.trim());
      form.append('file', file);

      const res = await fetch('/api/chiller-cleaning/submissions', {
        method: 'POST',
        headers: { 'x-chiller-token': token },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to upload photo');
      setWeek(json.week);
      setRecords(json.records || []);
      setMessage(`${selectedChiller} ${kind === 'before' ? 'before' : 'after'} photo saved.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to upload photo');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <section className="centerCard">Loading chiller cleaning...</section>
        <style jsx>{styles}</style>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="page">
        <section className="loginCard">
          <p className="eyebrow">Weekly Cleaning</p>
          <h1>Chiller Cleaning</h1>
          <p className="muted">Enter the staff passcode to submit this week&apos;s before and after photos.</p>
          <input
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            type="password"
            placeholder="Staff passcode"
            onKeyDown={(event) => {
              if (event.key === 'Enter') login();
            }}
          />
          {error ? <div className="alert error">{error}</div> : null}
          <button className="primaryBtn" onClick={login}>Continue</button>
        </section>
        <style jsx>{styles}</style>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Weekly Chiller Cleaning</p>
          <h1>{week ? `${formatDate(week.start)} - ${formatDate(week.end)}` : 'Current Week'}</h1>
          <p className="muted">Choose a chiller first, then submit before and after cleaning photos.</p>
        </div>
        <button className="ghostBtn" onClick={() => load()}>Refresh</button>
      </section>

      {error ? <div className="alert error">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}

      <section className="card">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Select chiller</h2>
          </div>
          <div className="legend">
            <span><b className="dot missing" />Missing</span>
            <span><b className="dot partial" />Partial</span>
            <span><b className="dot complete" />Complete</span>
          </div>
        </div>

        <div className="chillerGrid">
          {CHILLERS.map((chiller) => {
            const record = recordMap.get(chiller);
            const status = statusFor(record);
            const active = selectedChiller === chiller;
            return (
              <button
                key={chiller}
                className={`chillerTile ${status} ${active ? 'active' : ''}`}
                onClick={() => setSelectedChiller(chiller)}
              >
                <span>{chiller}</span>
                <strong>{statusLabel(status)}</strong>
              </button>
            );
          })}
        </div>
      </section>

      {selectedChiller ? (
        <section className={`uploadCard ${selectedStatus}`}>
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>{selectedChiller}</h2>
              <p className="muted">Submit clear photos. Time is recorded automatically and cannot be edited by staff.</p>
            </div>
            <span className={`statusPill ${selectedStatus}`}>{statusLabel(selectedStatus)}</span>
          </div>

          <label className="fieldLabel">
            Staff name
            <input value={staffName} onChange={(event) => setStaffName(event.target.value)} placeholder="Name of staff who cleaned" />
          </label>

          <div className="photoGrid">
            <PhotoPanel
              title="Before Cleaning"
              url={selectedRecord?.before_url}
              submittedAt={selectedRecord?.before_submitted_at}
              saving={saving === 'before'}
              onCamera={() => beforeCameraRef.current?.click()}
              onLibrary={() => beforeLibraryRef.current?.click()}
            />
            <PhotoPanel
              title="After Cleaning"
              url={selectedRecord?.after_url}
              submittedAt={selectedRecord?.after_submitted_at}
              saving={saving === 'after'}
              onCamera={() => afterCameraRef.current?.click()}
              onLibrary={() => afterLibraryRef.current?.click()}
            />
          </div>

          <input ref={beforeCameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => upload('before', event)} />
          <input ref={beforeLibraryRef} hidden type="file" accept="image/*" onChange={(event) => upload('before', event)} />
          <input ref={afterCameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => upload('after', event)} />
          <input ref={afterLibraryRef} hidden type="file" accept="image/*" onChange={(event) => upload('after', event)} />
        </section>
      ) : (
        <section className="uploadCard chooserPrompt">
          <p className="eyebrow">Step 2</p>
          <h2>Choose a chiller above</h2>
          <p className="muted">Each chiller keeps its own weekly before and after cleaning submission.</p>
        </section>
      )}

      <style jsx>{styles}</style>
    </main>
  );
}

function PhotoPanel({
  title,
  url,
  submittedAt,
  saving,
  onCamera,
  onLibrary,
}: {
  title: string;
  url?: string | null;
  submittedAt?: string | null;
  saving: boolean;
  onCamera: () => void;
  onLibrary: () => void;
}) {
  return (
    <div className="photoPanel">
      <div className="photoTop">
        <h3>{title}</h3>
        <span>{formatDateTime(submittedAt)}</span>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={title} />
        </a>
      ) : (
        <div className="emptyPreview">No photo yet</div>
      )}
      <div className="actionRow">
        <button type="button" onClick={onCamera} disabled={saving}>{saving ? 'Saving...' : 'Take Photo'}</button>
        <button type="button" onClick={onLibrary} disabled={saving}>Choose File</button>
      </div>
    </div>
  );
}

const styles = `
  :global(body) {
    margin: 0;
    background: #eef4fb;
    color: #07152d;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .page {
    min-height: 100vh;
    padding: 28px;
    background:
      radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 32rem),
      linear-gradient(180deg, #f7fbff 0%, #eef4fb 100%);
  }
  .hero, .card, .uploadCard, .loginCard, .centerCard {
    width: min(1120px, 100%);
    margin: 0 auto 18px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid #cfe0f5;
    border-radius: 24px;
    box-shadow: 0 24px 60px rgba(21, 47, 93, 0.10);
  }
  .hero {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: center;
    padding: 26px;
  }
  .card, .uploadCard { padding: 22px; }
  .loginCard, .centerCard {
    max-width: 520px;
    margin-top: 12vh;
    padding: 28px;
  }
  .eyebrow {
    margin: 0 0 6px;
    color: #245cf4;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1, h2, h3 { margin: 0; line-height: 1.05; }
  h1 { font-size: clamp(30px, 5vw, 52px); }
  h2 { font-size: 26px; }
  h3 { font-size: 18px; }
  .muted {
    margin: 8px 0 0;
    color: #57708f;
    font-weight: 700;
  }
  .sectionHead {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 18px;
  }
  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    color: #57708f;
    font-size: 13px;
    font-weight: 800;
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 6px;
  }
  .dot.missing { background: #ef4444; }
  .dot.partial { background: #f59e0b; }
  .dot.complete { background: #22c55e; }
  .chillerGrid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }
  .chillerTile {
    min-height: 104px;
    border-radius: 20px;
    border: 1px solid #d7e4f6;
    background: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 16px;
    text-align: left;
    font: inherit;
    cursor: pointer;
    color: #07152d;
  }
  .chillerTile span { font-weight: 900; font-size: 17px; }
  .chillerTile strong {
    width: fit-content;
    border-radius: 999px;
    padding: 7px 10px;
    font-size: 12px;
  }
  .chillerTile.missing strong { background: #fff1f2; color: #be123c; }
  .chillerTile.partial strong { background: #fff7ed; color: #b45309; }
  .chillerTile.complete strong { background: #ecfdf3; color: #047857; }
  .chillerTile.active {
    border-color: #2563eb;
    box-shadow: inset 0 0 0 1px #2563eb, 0 18px 34px rgba(37, 99, 235, 0.14);
  }
  .uploadCard.missing { border-color: #fecdd3; }
  .uploadCard.partial { border-color: #fed7aa; }
  .uploadCard.complete { border-color: #bbf7d0; }
  .statusPill {
    border-radius: 999px;
    padding: 9px 13px;
    font-size: 13px;
    font-weight: 900;
  }
  .statusPill.missing { background: #fff1f2; color: #be123c; }
  .statusPill.partial { background: #fff7ed; color: #b45309; }
  .statusPill.complete { background: #ecfdf3; color: #047857; }
  input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #c9d8eb;
    border-radius: 16px;
    padding: 15px 16px;
    font: inherit;
    font-weight: 800;
    background: #fff;
    color: #07152d;
  }
  .fieldLabel {
    display: block;
    color: #253b59;
    font-weight: 900;
    margin-bottom: 16px;
  }
  .fieldLabel input { margin-top: 8px; }
  .photoGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .photoPanel {
    border: 1px solid #d7e4f6;
    border-radius: 22px;
    padding: 14px;
    background: #f8fbff;
  }
  .photoTop {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .photoTop span {
    color: #607997;
    font-size: 13px;
    font-weight: 800;
  }
  .preview, .emptyPreview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: 18px;
    overflow: hidden;
    border: 1px dashed #b8cff0;
    background: #eef6ff;
    color: #6a82a0;
    font-weight: 900;
    text-decoration: none;
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .actionRow {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  button {
    border: 0;
    border-radius: 14px;
    padding: 13px 15px;
    font: inherit;
    font-weight: 900;
    cursor: pointer;
  }
  button:disabled {
    cursor: wait;
    opacity: 0.7;
  }
  .primaryBtn, .actionRow button:first-child {
    background: #2563eb;
    color: white;
    box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
  }
  .ghostBtn, .actionRow button:last-child {
    border: 1px solid #c9d8eb;
    background: #fff;
    color: #07152d;
  }
  .alert {
    width: min(1120px, 100%);
    box-sizing: border-box;
    margin: 0 auto 14px;
    border-radius: 16px;
    padding: 14px 16px;
    font-weight: 900;
  }
  .alert.error { border: 1px solid #fecaca; background: #fff1f2; color: #be123c; }
  .alert.success { border: 1px solid #bbf7d0; background: #ecfdf3; color: #047857; }
  @media (max-width: 860px) {
    .page { padding: 14px; }
    .hero, .sectionHead { flex-direction: column; align-items: stretch; }
    .chillerGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .photoGrid { grid-template-columns: 1fr; }
    .hero, .card, .uploadCard, .loginCard { border-radius: 20px; padding: 18px; }
    .ghostBtn { width: 100%; }
  }
  @media (max-width: 420px) {
    .chillerGrid { grid-template-columns: 1fr; }
    .actionRow { grid-template-columns: 1fr; }
  }
`;
