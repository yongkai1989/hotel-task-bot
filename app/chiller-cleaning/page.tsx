'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../../lib/dateDisplay';

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
type BranchId = 'regency' | 'grand';

const ALL_CHILLERS = [
  'Chiller 1',
  'Chiller 2',
  'Chiller 3',
  'Chiller 4',
  'Chiller 5',
  'Grease Trap 1',
  'Grease Trap 2',
  'Grease Trap 3',
  'Microwave 1',
  'Microwave 2',
];

const CHILLERS_BY_BRANCH: Record<BranchId, string[]> = {
  regency: ALL_CHILLERS,
  grand: ALL_CHILLERS.filter((name) => name !== 'Grease Trap 3'),
};

const BRANCH_DETAILS: Record<BranchId, { name: string; shortName: string }> = {
  regency: { name: 'Regency F&B Routine Duties', shortName: 'Regency' },
  grand: { name: 'Grand F&B Routine Duties', shortName: 'Grand' },
};

function formatDate(value?: string) {
  return formatDateDDMMYYYY(value);
}

function formatDateTime(value?: string | null) {
  return formatDateTimeDDMMYYYY(value, 'Not submitted');
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

async function compressRoutinePhoto(file: File) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('This photo format cannot be optimized on this device.'));
      nextImage.src = sourceUrl;
    });

    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'routine-photo';
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // Preserve compatibility with HEIC or other formats the browser cannot decode.
    return file;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function ChillerCleaningPage({ branch = 'regency' }: { branch?: BranchId } = {}) {
  const branchDetails = BRANCH_DETAILS[branch];
  const chillers = CHILLERS_BY_BRANCH[branch];
  const tokenKey = `chiller_cleaning_staff_token_v3_${branch}`;
  const [token, setToken] = useState('');
  const [passcode, setPasscode] = useState('');
  const [staffName, setStaffName] = useState('');
  const [week, setWeek] = useState<Week | null>(null);
  const [records, setRecords] = useState<ChillerRecord[]>([]);
  const [selectedChiller, setSelectedChiller] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [saving, setSaving] = useState<UploadKind | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const beforeCameraRef = useRef<HTMLInputElement | null>(null);
  const afterCameraRef = useRef<HTMLInputElement | null>(null);

  const recordMap = useMemo(() => {
    const map = new Map<string, ChillerRecord>();
    records.forEach((record) => map.set(record.chiller_name, record));
    return map;
  }, [records]);

  const selectedRecord = selectedChiller ? recordMap.get(selectedChiller) : undefined;
  const selectedStatus = statusFor(selectedRecord);
  const lockedStaffName = String(selectedRecord?.staff_name || '').trim();
  const effectiveStaffName = lockedStaffName || staffName.trim();

  async function load(currentToken = token) {
    if (!currentToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/chiller-cleaning/submissions', {
        headers: { 'x-chiller-token': currentToken, 'x-chiller-branch': branch },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load submissions');
      setWeek(json.week);
      setRecords(json.records || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load submissions');
      sessionStorage.removeItem(tokenKey);
      setToken('');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const savedToken = sessionStorage.getItem(tokenKey) || '';
    setToken(savedToken);
    if (savedToken) {
      load(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  async function login() {
    if (loginBusy) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setLoginBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/chiller-cleaning/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, mode: 'staff', branch }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Invalid passcode');
      sessionStorage.setItem(tokenKey, json.token);
      setToken(json.token);
      setPasscode('');
      await load(json.token);
    } catch (err: any) {
      setError(err?.name === 'AbortError'
        ? 'The database is temporarily busy. Please wait a moment and try once.'
        : err?.message || 'Unable to login');
    } finally {
      window.clearTimeout(timeout);
      setLoginBusy(false);
    }
  }

  async function upload(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setMessage('');
    if (!effectiveStaffName) {
      setError('Please enter staff name before uploading.');
      return;
    }
    if (!selectedChiller) {
      setError('Please choose a routine duty before uploading.');
      return;
    }

    setSaving(kind);
    try {
      const optimizedFile = await compressRoutinePhoto(file);
      const form = new FormData();
      form.append('chiller_name', selectedChiller);
      form.append('kind', kind);
      form.append('staff_name', effectiveStaffName);
      form.append('file', optimizedFile, optimizedFile.name);

      const res = await fetch('/api/chiller-cleaning/submissions', {
        method: 'POST',
        headers: { 'x-chiller-token': token, 'x-chiller-branch': branch },
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
        <section className="centerCard">Loading {branchDetails.name}...</section>
        <style jsx>{styles}</style>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="page">
      <section className="loginCard">
        <div className="loginBadge">{branchDetails.shortName} staff access</div>
        <p className="eyebrow">Weekly Cleaning</p>
        <h1>{branchDetails.name}</h1>
        <p className="muted loginIntro">
          Enter the staff passcode to submit this week&apos;s before and after photos.
        </p>
        <div className="loginForm">
          <label className="loginLabel" htmlFor="chiller-staff-passcode">
            Staff passcode
          </label>
          <input
            id="chiller-staff-passcode"
            className="loginInput"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="Enter passcode"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !loginBusy) login();
            }}
            disabled={loginBusy}
          />
          {error ? <div className="alert error loginAlert">{error}</div> : null}
          <button className="primaryBtn loginButton" onClick={login} disabled={loginBusy}>
            {loginBusy ? 'Checking...' : 'Continue'}
          </button>
        </div>
      </section>
        <style jsx>{styles}</style>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">{branchDetails.name}</p>
          <h1>{week ? `${formatDate(week.start)} - ${formatDate(week.end)}` : 'Current Week'}</h1>
          <p className="muted">Choose a routine duty first, then submit before and after cleaning photos.</p>
        </div>
        <button className="ghostBtn" onClick={() => load()}>Refresh</button>
      </section>

      {error ? <div className="alert error">{error}</div> : null}
      {message ? <div className="alert success">{message}</div> : null}

      <section className="card">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Select routine duty</h2>
          </div>
          <div className="legend">
            <span><b className="dot missing" />Missing</span>
            <span><b className="dot partial" />Partial</span>
            <span><b className="dot complete" />Complete</span>
          </div>
        </div>

        <div className="chillerGrid">
          {chillers.map((chiller) => {
            const record = recordMap.get(chiller);
            const status = statusFor(record);
            const active = selectedChiller === chiller;
            return (
              <button
                key={chiller}
                className={`chillerTile ${status} ${active ? 'active' : ''}`}
                onClick={() => {
                  setSelectedChiller(chiller);
                  setStaffName('');
                  setError('');
                  setMessage('');
                }}
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
            <input
              value={lockedStaffName || staffName}
              onChange={(event) => setStaffName(event.target.value)}
              readOnly={Boolean(lockedStaffName)}
              aria-readonly={Boolean(lockedStaffName)}
              placeholder="Name of staff who cleaned"
            />
            <span className={`fieldHint ${lockedStaffName ? 'locked' : ''}`}>
              {lockedStaffName
                ? `First submitted by ${lockedStaffName}. This name is locked for this chiller and week.`
                : 'The first submitted name will be locked for this duty and week.'}
            </span>
          </label>

          <div className="photoGrid">
            <PhotoPanel
              title="Before Cleaning"
              url={selectedRecord?.before_url}
              submittedAt={selectedRecord?.before_submitted_at}
              saving={saving === 'before'}
              onCamera={() => beforeCameraRef.current?.click()}
            />
            <PhotoPanel
              title="After Cleaning"
              url={selectedRecord?.after_url}
              submittedAt={selectedRecord?.after_submitted_at}
              saving={saving === 'after'}
              onCamera={() => afterCameraRef.current?.click()}
            />
          </div>

          <input ref={beforeCameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => upload('before', event)} />
          <input ref={afterCameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => upload('after', event)} />
        </section>
      ) : (
        <section className="uploadCard chooserPrompt">
          <p className="eyebrow">Step 2</p>
          <h2>Choose a routine duty above</h2>
          <p className="muted">Each duty keeps its own weekly before and after cleaning submission.</p>
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
}: {
  title: string;
  url?: string | null;
  submittedAt?: string | null;
  saving: boolean;
  onCamera: () => void;
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
  .loginBadge {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    margin-bottom: 18px;
    padding: 0 11px;
    border: 1px solid #bed3fa;
    border-radius: 999px;
    background: #eef5ff;
    color: #1249b8;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .loginIntro { max-width: 420px; }
  .loginForm {
    display: grid;
    gap: 12px;
    margin-top: 22px;
  }
  .loginLabel {
    color: #253b59;
    font-size: 13px;
    font-weight: 900;
  }
  .loginInput {
    min-width: 0;
    min-height: 52px;
  }
  .loginButton {
    width: 100%;
    min-height: 52px;
    margin: 0;
  }
  .loginAlert {
    width: 100%;
    margin: 0;
  }
  .fieldLabel {
    display: block;
    color: #253b59;
    font-weight: 900;
    margin-bottom: 16px;
  }
  .fieldLabel input { margin-top: 8px; }
  .fieldLabel input[readonly] {
    background: #eef4ff;
    border-color: #bfd3f7;
    color: #0f274d;
    cursor: not-allowed;
  }
  .fieldHint {
    display: block;
    margin-top: 8px;
    color: #64748b;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.45;
  }
  .fieldHint.locked { color: #1d4ed8; }
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
    grid-template-columns: 1fr;
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
  .primaryBtn, .actionRow button {
    background: #2563eb;
    color: white;
    box-shadow: 0 14px 30px rgba(37, 99, 235, 0.22);
  }
  .ghostBtn {
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
  @media (max-width: 520px) {
    .loginCard {
      width: 100%;
      max-width: none;
      margin-top: max(18px, 5vh);
      padding: 22px 18px;
      border-radius: 20px;
    }
    .loginCard h1 {
      font-size: 34px;
      line-height: 1.04;
    }
    .loginBadge { margin-bottom: 14px; }
    .loginForm {
      gap: 10px;
      margin-top: 18px;
    }
    .loginInput, .loginButton { min-height: 50px; }
  }
  @media (max-width: 420px) {
    .chillerGrid { grid-template-columns: 1fr; }
    .actionRow { grid-template-columns: 1fr; }
  }
`;
