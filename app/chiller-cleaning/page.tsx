'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type ChillerKind = 'before' | 'after';

type ChillerWeek = {
  today: string;
  weekStart: string;
  weekEnd: string;
  label: string;
};

type ChillerRecord = {
  id: string;
  week_start: string;
  week_end: string;
  staff_name: string | null;
  before_url?: string | null;
  before_submitted_at: string | null;
  after_url?: string | null;
  after_submitted_at: string | null;
};

const TOKEN_KEY = 'chiller-cleaning-token';

function formatTime(value: string | null) {
  if (!value) return 'Not submitted yet';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}

export default function ChillerCleaningPage() {
  const [passcode, setPasscode] = useState('');
  const [token, setToken] = useState('');
  const [week, setWeek] = useState<ChillerWeek | null>(null);
  const [record, setRecord] = useState<ChillerRecord | null>(null);
  const [staffName, setStaffName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<ChillerKind | null>(null);
  const [sourceMenu, setSourceMenu] = useState<ChillerKind | null>(null);

  const beforeCameraRef = useRef<HTMLInputElement | null>(null);
  const beforeLibraryRef = useRef<HTMLInputElement | null>(null);
  const afterCameraRef = useRef<HTMLInputElement | null>(null);
  const afterLibraryRef = useRef<HTMLInputElement | null>(null);

  async function loadSubmission(accessToken: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/chiller-cleaning/submissions', {
        headers: { 'x-chiller-token': accessToken },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load record');
      setWeek(json.week);
      setRecord(json.record || null);
      if (json.record?.staff_name) setStaffName(json.record.staff_name);
    } catch (err: any) {
      sessionStorage.removeItem(TOKEN_KEY);
      setToken('');
      setError(err?.message || 'Unable to load record');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      loadSubmission(saved);
    }
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/chiller-cleaning/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Incorrect passcode');
      sessionStorage.setItem(TOKEN_KEY, json.token);
      setToken(json.token);
      setWeek(json.week);
      await loadSubmission(json.token);
    } catch (err: any) {
      setError(err?.message || 'Unable to unlock page');
    } finally {
      setLoading(false);
    }
  }

  function openFilePicker(kind: ChillerKind, source: 'camera' | 'library') {
    setSourceMenu(null);
    const input =
      kind === 'before'
        ? source === 'camera'
          ? beforeCameraRef.current
          : beforeLibraryRef.current
        : source === 'camera'
          ? afterCameraRef.current
          : afterLibraryRef.current;
    input?.click();
  }

  async function uploadImage(kind: ChillerKind, file?: File | null) {
    if (!file || !token) return;
    setError('');
    setNotice('');

    if (!staffName.trim()) {
      setError('Please key in the staff name before uploading.');
      return;
    }

    setUploading(kind);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('staff_name', staffName.trim());
      form.append('file', file);

      const res = await fetch('/api/chiller-cleaning/submissions', {
        method: 'POST',
        headers: { 'x-chiller-token': token },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed');
      setWeek(json.week);
      setRecord(json.record);
      setNotice(`${kind === 'before' ? 'Before' : 'After'} photo saved.`);
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  }

  const completion = (record?.before_url ? 1 : 0) + (record?.after_url ? 1 : 0);

  if (!token) {
    return (
      <main className="page">
        <section className="unlock">
          <div className="brand">Hallmark Operations</div>
          <h1>Chiller Cleaning</h1>
          <p>Enter the passcode to submit this week's before and after cleaning photos.</p>
          <form onSubmit={login} className="unlockForm">
            <input
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              type="password"
              placeholder="Passcode"
              autoComplete="current-password"
            />
            <button disabled={loading}>{loading ? 'Checking...' : 'Unlock'}</button>
          </form>
          {error ? <div className="error">{error}</div> : null}
        </section>

        <style jsx>{styles}</style>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="brand">Weekly Chiller Care</div>
          <h1>Chiller Cleaning</h1>
          <p>Submit the before photo, then return after cleaning to upload the final photo.</p>
        </div>
        <div className="weekCard">
          <span>This week</span>
          <strong>{week?.label || 'Loading week...'}</strong>
          <small>Deadline: Sunday before the week closes</small>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      <section className="formCard">
        <div className="cardTop">
          <div>
            <span className="eyebrow">Staff details</span>
            <h2>Cleaning record</h2>
          </div>
          <div className="pill">{completion}/2 submitted</div>
        </div>

        <label className="label">
          Staff name
          <input
            value={staffName}
            onChange={(event) => setStaffName(event.target.value)}
            placeholder="Name of staff who cleaned"
          />
        </label>

        <div className="photoGrid">
          <PhotoPanel
            title="Before cleaning"
            submittedAt={record?.before_submitted_at || null}
            imageUrl={record?.before_url || null}
            isUploading={uploading === 'before'}
            menuOpen={sourceMenu === 'before'}
            onToggleMenu={() => setSourceMenu(sourceMenu === 'before' ? null : 'before')}
            onChooseCamera={() => openFilePicker('before', 'camera')}
            onChooseLibrary={() => openFilePicker('before', 'library')}
          />
          <PhotoPanel
            title="After cleaning"
            submittedAt={record?.after_submitted_at || null}
            imageUrl={record?.after_url || null}
            isUploading={uploading === 'after'}
            menuOpen={sourceMenu === 'after'}
            onToggleMenu={() => setSourceMenu(sourceMenu === 'after' ? null : 'after')}
            onChooseCamera={() => openFilePicker('after', 'camera')}
            onChooseLibrary={() => openFilePicker('after', 'library')}
          />
        </div>

        <input
          ref={beforeCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => uploadImage('before', event.target.files?.[0])}
        />
        <input
          ref={beforeLibraryRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => uploadImage('before', event.target.files?.[0])}
        />
        <input
          ref={afterCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => uploadImage('after', event.target.files?.[0])}
        />
        <input
          ref={afterLibraryRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => uploadImage('after', event.target.files?.[0])}
        />
      </section>

      {loading ? <div className="loading">Refreshing record...</div> : null}
      <style jsx>{styles}</style>
    </main>
  );
}

function PhotoPanel({
  title,
  submittedAt,
  imageUrl,
  isUploading,
  menuOpen,
  onToggleMenu,
  onChooseCamera,
  onChooseLibrary,
}: {
  title: string;
  submittedAt: string | null;
  imageUrl: string | null;
  isUploading: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onChooseCamera: () => void;
  onChooseLibrary: () => void;
}) {
  return (
    <div className="photoPanel">
      <div className="photoHeader">
        <div>
          <h3>{title}</h3>
          <p>{formatTime(submittedAt)}</p>
        </div>
        <span className={imageUrl ? 'status done' : 'status'}>{imageUrl ? 'Saved' : 'Pending'}</span>
      </div>

      {imageUrl ? (
        <a className="preview" href={imageUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={title} />
        </a>
      ) : (
        <div className="emptyPreview">No photo yet</div>
      )}

      <div className="sourceWrap">
        <button className="addButton" type="button" onClick={onToggleMenu} disabled={isUploading}>
          <span>+</span>
          {isUploading ? 'Uploading...' : imageUrl ? 'Replace photo' : 'Add photo'}
        </button>
        {menuOpen ? (
          <div className="sourceMenu">
            <button type="button" onClick={onChooseCamera}>Take photo</button>
            <button type="button" onClick={onChooseLibrary}>Choose from camera roll</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles = `
  .page {
    min-height: 100vh;
    padding: 24px;
    background:
      radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 32rem),
      linear-gradient(135deg, #eef5ff 0%, #f8fbff 48%, #eef3f8 100%);
    color: #07142f;
    font-family: Arial, sans-serif;
  }
  .unlock, .hero, .formCard {
    max-width: 1040px;
    margin: 0 auto;
    border: 1px solid #cfe0f6;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 28px;
    box-shadow: 0 24px 70px rgba(31, 61, 108, 0.12);
  }
  .unlock {
    margin-top: 9vh;
    padding: 34px;
    max-width: 520px;
  }
  .brand, .eyebrow {
    color: #2563eb;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 3px;
  }
  h1, h2, h3, p {
    margin: 0;
  }
  h1 {
    margin-top: 10px;
    font-size: clamp(38px, 7vw, 70px);
    line-height: 0.94;
  }
  .unlock p, .hero p {
    margin-top: 14px;
    color: #516786;
    font-weight: 700;
    line-height: 1.5;
  }
  .unlockForm {
    display: grid;
    gap: 12px;
    margin-top: 26px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    min-height: 54px;
    border: 1px solid #c7d8ee;
    border-radius: 16px;
    padding: 0 16px;
    color: #07142f;
    background: white;
    font-size: 16px;
    font-weight: 800;
  }
  button {
    min-height: 50px;
    border: 0;
    border-radius: 16px;
    cursor: pointer;
    font-weight: 900;
    color: white;
    background: #0f172a;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 22px;
    align-items: center;
    padding: 30px;
  }
  .weekCard {
    min-height: 150px;
    border-radius: 24px;
    padding: 24px;
    color: white;
    background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-shadow: 0 22px 44px rgba(37, 99, 235, 0.22);
  }
  .weekCard span, .weekCard small {
    color: #c7d7ff;
    font-weight: 900;
  }
  .weekCard strong {
    display: block;
    margin: 8px 0;
    font-size: 24px;
  }
  .formCard {
    margin-top: 18px;
    padding: 24px;
  }
  .cardTop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 18px;
  }
  h2 {
    margin-top: 6px;
    font-size: 30px;
  }
  .pill {
    border: 1px solid #b8d4ff;
    background: #eff6ff;
    color: #1d4ed8;
    border-radius: 999px;
    padding: 11px 16px;
    font-weight: 900;
  }
  .label {
    display: grid;
    gap: 8px;
    color: #334866;
    font-weight: 900;
  }
  .photoGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-top: 18px;
  }
  .photoPanel {
    border: 1px solid #d7e4f4;
    border-radius: 24px;
    padding: 16px;
    background: #fbfdff;
  }
  .photoHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  h3 {
    font-size: 22px;
  }
  .photoHeader p {
    margin-top: 5px;
    color: #60738f;
    font-weight: 800;
    font-size: 13px;
  }
  .status {
    border-radius: 999px;
    padding: 8px 11px;
    color: #9a3412;
    background: #fff7ed;
    font-size: 12px;
    font-weight: 900;
  }
  .status.done {
    color: #047857;
    background: #dcfce7;
  }
  .preview, .emptyPreview {
    display: grid;
    place-items: center;
    height: 260px;
    border-radius: 18px;
    overflow: hidden;
    background: #eef5ff;
    border: 1px dashed #adc8ef;
    color: #516786;
    font-weight: 900;
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .sourceWrap {
    position: relative;
    margin-top: 14px;
  }
  .addButton {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: #2563eb;
  }
  .addButton span {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: rgba(255,255,255,0.2);
    font-size: 22px;
  }
  .sourceMenu {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    border: 1px solid #cfe0f6;
    border-radius: 18px;
    background: white;
    box-shadow: 0 18px 42px rgba(17, 24, 39, 0.18);
    overflow: hidden;
  }
  .sourceMenu button {
    width: 100%;
    border-radius: 0;
    color: #07142f;
    background: white;
    text-align: left;
    padding: 0 18px;
  }
  .sourceMenu button + button {
    border-top: 1px solid #e5edf8;
  }
  .error, .notice, .loading {
    max-width: 1040px;
    box-sizing: border-box;
    margin: 16px auto 0;
    padding: 14px 16px;
    border-radius: 18px;
    font-weight: 900;
  }
  .error {
    color: #b91c1c;
    background: #fff1f2;
    border: 1px solid #fecdd3;
  }
  .notice {
    color: #047857;
    background: #ecfdf5;
    border: 1px solid #bbf7d0;
  }
  .loading {
    color: #1d4ed8;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
  }
  @media (max-width: 760px) {
    .page {
      padding: 14px;
    }
    .unlock, .hero, .formCard {
      border-radius: 22px;
    }
    .hero {
      grid-template-columns: 1fr;
      padding: 22px;
    }
    .weekCard {
      min-height: auto;
    }
    .photoGrid {
      grid-template-columns: 1fr;
    }
    .preview, .emptyPreview {
      height: 220px;
    }
    .cardTop {
      align-items: flex-start;
      flex-direction: column;
    }
  }
`;
