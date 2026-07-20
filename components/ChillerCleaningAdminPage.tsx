'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

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
  created_at?: string;
  updated_at?: string;
};

type Week = { start: string; end: string };
type Tab = 'history' | 'settings' | 'reset';
type HistoryMode = 'all' | 'overdue';

const ADMIN_TOKEN_KEY = 'chiller_cleaning_admin_token_v2';
const CHILLERS = ['Chiller 1', 'Chiller 2', 'Chiller 3', 'Chiller 4', 'Chiller 5'];
const TRACKING_START = '2026-07-20';

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(value?: string | null) {
  if (!value) return 'Not submitted';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusFor(record?: ChillerRecord) {
  if (record?.before_url && record?.after_url) return 'complete';
  if (record?.before_url || record?.after_url) return 'partial';
  return 'missing';
}

function statusLabel(status: string) {
  if (status === 'complete') return 'Complete';
  if (status === 'partial') return 'Partial';
  return 'Missing';
}

function buildPastWeeks(currentWeekStart?: string) {
  if (!currentWeekStart) return [];
  const weeks: Week[] = [];
  let cursor = TRACKING_START;
  while (cursor < currentWeekStart) {
    weeks.push({ start: cursor, end: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
  }
  return weeks.reverse();
}

export default function ChillerCleaningAdminPage() {
  const [token, setToken] = useState('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ChillerRecord[]>([]);
  const [currentWeek, setCurrentWeek] = useState<Week | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [activeChiller, setActiveChiller] = useState('Chiller 1');
  const [historyMode, setHistoryMode] = useState<HistoryMode>('all');
  const [staffPasscode, setStaffPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [resetChiller, setResetChiller] = useState('Chiller 1');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const recordMap = useMemo(() => {
    const map = new Map<string, ChillerRecord>();
    records.forEach((record) => map.set(`${record.week_start}|${record.chiller_name}`, record));
    return map;
  }, [records]);

  const currentRecords = useMemo(
    () => CHILLERS.map((chiller) => recordMap.get(`${currentWeek?.start}|${chiller}`)),
    [currentWeek?.start, recordMap],
  );

  const pastWeeks = useMemo(() => buildPastWeeks(currentWeek?.start), [currentWeek?.start]);

  const overdueItems = useMemo(() => {
    return pastWeeks.flatMap((week) =>
      CHILLERS.map((chiller) => {
        const record = recordMap.get(`${week.start}|${chiller}`);
        return { week, chiller, record, status: statusFor(record) };
      }).filter((item) => item.status !== 'complete'),
    );
  }, [pastWeeks, recordMap]);

  const selectedHistory = useMemo(() => {
    if (historyMode === 'overdue') {
      return overdueItems.filter((item) => item.chiller === activeChiller);
    }

    return records
      .filter((record) => record.chiller_name === activeChiller)
      .map((record) => ({
        week: { start: record.week_start, end: record.week_end },
        chiller: record.chiller_name,
        record,
        status: statusFor(record),
      }))
      .sort((a, b) => b.week.start.localeCompare(a.week.start));
  }, [activeChiller, historyMode, overdueItems, records]);

  async function load(nextToken = token) {
    if (!nextToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/chiller-cleaning/admin', {
        cache: 'no-store',
        headers: { 'x-chiller-token': nextToken },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load chiller records');
      setRecords(Array.isArray(json.records) ? json.records : []);
      setCurrentWeek(json.week || json.current_week || null);
      setToken(nextToken);
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, nextToken);
    } catch (err: any) {
      setToken('');
      window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setError(err?.message || 'Unable to load chiller records');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
    if (saved) {
      setToken(saved);
      load(saved);
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/chiller-cleaning/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'admin', passcode }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Wrong admin passcode');
      setPasscode('');
      await load(json.token);
    } catch (err: any) {
      setError(err?.message || 'Wrong admin passcode');
    } finally {
      setBusy(false);
    }
  }

  async function savePasscodes(event: FormEvent) {
    event.preventDefault();
    if (!staffPasscode.trim() && !adminPasscode.trim()) {
      setError('Enter at least one new passcode to update.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/chiller-cleaning/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-chiller-token': token },
        body: JSON.stringify({
          staff_passcode: staffPasscode,
          admin_passcode: adminPasscode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to update passcodes');
      if (json.token) {
        setToken(json.token);
        window.sessionStorage.setItem(ADMIN_TOKEN_KEY, json.token);
      }
      setStaffPasscode('');
      setAdminPasscode('');
      setNotice('Passcodes updated successfully.');
      await load(json.token || token);
    } catch (err: any) {
      setError(err?.message || 'Unable to update passcodes');
    } finally {
      setBusy(false);
    }
  }

  async function resetSelectedChiller() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/chiller-cleaning/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-chiller-token': token },
        body: JSON.stringify({ chiller_name: resetChiller }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to reset chiller');
      setRecords(Array.isArray(json.records) ? json.records : []);
      setConfirmReset(false);
      setNotice(`${resetChiller} reset for the current week. ${json.removedFiles || 0} upload(s) removed.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to reset chiller');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="adminPage">
        <div className="loginCard">Loading chiller admin...</div>
        <style jsx>{styles}</style>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="adminPage">
        <form className="loginCard" onSubmit={login}>
          <span>Branch Admin</span>
          <h1>Chiller Cleaning Admin</h1>
          <p>Enter the admin passcode to review records, reset selected chillers, and manage passcodes.</p>
          {error ? <div className="alert error">{error}</div> : null}
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Admin passcode"
            required
          />
          <button type="submit" disabled={busy}>{busy ? 'Checking...' : 'Unlock Admin'}</button>
        </form>
        <style jsx>{styles}</style>
      </main>
    );
  }

  const selectedCurrentRecord = recordMap.get(`${currentWeek?.start}|${resetChiller}`);

  return (
    <main className="adminPage">
      <section className="hero">
        <div>
          <span>Chiller Workspace</span>
          <h1>Chiller Cleaning Admin</h1>
          <p>
            Current week: {formatDate(currentWeek?.start)} - {formatDate(currentWeek?.end)}
          </p>
        </div>
        <div className="heroActions">
          <button type="button" className="ghostBtn" onClick={() => load()} disabled={loading}>Refresh</button>
          <button
            type="button"
            className={overdueItems.length ? 'dangerBtn' : 'softBtn'}
            onClick={() => {
              setActiveTab('history');
              setHistoryMode('overdue');
            }}
          >
            Overdue Weeks {overdueItems.length}
          </button>
        </div>
      </section>

      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <section className="statusGrid">
        {CHILLERS.map((chiller) => {
          const record = recordMap.get(`${currentWeek?.start}|${chiller}`);
          const status = statusFor(record);
          return (
            <button
              key={chiller}
              type="button"
              className={`statusCard ${status}`}
              onClick={() => {
                setActiveTab('history');
                setHistoryMode('all');
                setActiveChiller(chiller);
              }}
            >
              <span>{chiller}</span>
              <strong>{statusLabel(status)}</strong>
              <small>{record?.staff_name || 'No staff name yet'}</small>
            </button>
          );
        })}
      </section>

      <nav className="tabs">
        <button type="button" className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
          History
        </button>
        <button type="button" className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
          Passcodes
        </button>
        <button type="button" className={activeTab === 'reset' ? 'active' : ''} onClick={() => setActiveTab('reset')}>
          Reset Options
        </button>
      </nav>

      {activeTab === 'history' ? (
        <section className="panel">
          <div className="panelHead">
            <div>
              <span>History</span>
              <h2>{activeChiller}</h2>
            </div>
            <div className="filterRow">
              <button type="button" className={historyMode === 'all' ? 'active' : ''} onClick={() => setHistoryMode('all')}>
                All history
              </button>
              <button type="button" className={historyMode === 'overdue' ? 'active danger' : ''} onClick={() => setHistoryMode('overdue')}>
                Overdue only
              </button>
            </div>
          </div>

          <div className="chillerTabs">
            {CHILLERS.map((chiller) => (
              <button
                key={chiller}
                type="button"
                className={activeChiller === chiller ? 'active' : ''}
                onClick={() => setActiveChiller(chiller)}
              >
                {chiller}
              </button>
            ))}
          </div>

          {selectedHistory.length === 0 ? (
            <div className="empty">No records found for this view.</div>
          ) : (
            <div className="historyList">
              {selectedHistory.map((item) => (
                <article key={`${item.week.start}-${item.chiller}`} className={`historyCard ${item.status}`}>
                  <div className="recordHead">
                    <div>
                      <strong>{formatDate(item.week.start)} - {formatDate(item.week.end)}</strong>
                      <span>{item.record?.staff_name || 'No submission yet'}</span>
                    </div>
                    <b>{statusLabel(item.status)}</b>
                  </div>
                  <div className="thumbGrid">
                    <PhotoTile
                      label="Before"
                      url={item.record?.before_url}
                      time={item.record?.before_submitted_at}
                      onOpen={(url) => setLightbox({ url, title: `${item.chiller} Before` })}
                    />
                    <PhotoTile
                      label="After"
                      url={item.record?.after_url}
                      time={item.record?.after_submitted_at}
                      onOpen={(url) => setLightbox({ url, title: `${item.chiller} After` })}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'settings' ? (
        <section className="panel">
          <div className="panelHead">
            <div>
              <span>Access Control</span>
              <h2>Separate Passcodes</h2>
            </div>
          </div>
          <form className="settingsGrid" onSubmit={savePasscodes}>
            <label>
              Staff page passcode
              <input
                type="password"
                value={staffPasscode}
                onChange={(event) => setStaffPasscode(event.target.value)}
                placeholder="New staff passcode"
              />
              <small>Used only for `/chiller-cleaning` photo submission.</small>
            </label>
            <label>
              Admin page passcode
              <input
                type="password"
                value={adminPasscode}
                onChange={(event) => setAdminPasscode(event.target.value)}
                placeholder="New admin passcode"
              />
              <small>Used only for this admin page.</small>
            </label>
            <button type="submit" className="primaryBtn" disabled={busy}>
              {busy ? 'Saving...' : 'Save Passcodes'}
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === 'reset' ? (
        <section className="panel dangerPanel">
          <div className="panelHead">
            <div>
              <span>Controlled Reset</span>
              <h2>Reset Options</h2>
            </div>
          </div>
          <div className="resetLayout">
            <div className="resetChooser">
              {CHILLERS.map((chiller) => (
                <button
                  key={chiller}
                  type="button"
                  className={resetChiller === chiller ? 'active' : ''}
                  onClick={() => setResetChiller(chiller)}
                >
                  {chiller}
                </button>
              ))}
            </div>
            <div className="resetCard">
              <span>Current week only</span>
              <h3>{resetChiller}</h3>
              <p>
                This clears the selected chiller&apos;s before/after photos and submitted staff name for{' '}
                {formatDate(currentWeek?.start)} - {formatDate(currentWeek?.end)}. Past weeks are untouched.
              </p>
              <div className="resetMeta">
                <b>Status: {statusLabel(statusFor(selectedCurrentRecord))}</b>
                <small>{selectedCurrentRecord?.staff_name || 'No staff submitted yet'}</small>
              </div>
              <button type="button" className="dangerBtn" onClick={() => setConfirmReset(true)}>
                Reset Selected Chiller
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {confirmReset ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="confirmModal">
            <span>Confirm Reset</span>
            <h2>Reset {resetChiller} for this week?</h2>
            <p>
              This action removes only the current-week uploads for {resetChiller}. It will not affect other chillers or past weeks.
            </p>
            <div className="modalActions">
              <button type="button" className="ghostBtn" onClick={() => setConfirmReset(false)} disabled={busy}>Cancel</button>
              <button type="button" className="dangerBtn" onClick={resetSelectedChiller} disabled={busy}>
                {busy ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <div className="lightbox" onClick={(event) => event.stopPropagation()}>
            <div>
              <strong>{lightbox.title}</strong>
              <button type="button" onClick={() => setLightbox(null)}>Close</button>
            </div>
            <img src={lightbox.url} alt={lightbox.title} />
          </div>
        </div>
      ) : null}

      <style jsx>{styles}</style>
    </main>
  );
}

function PhotoTile({
  label,
  url,
  time,
  onOpen,
}: {
  label: string;
  url?: string | null;
  time?: string | null;
  onOpen: (url: string) => void;
}) {
  return (
    <div className="photoTile">
      <div>
        <strong>{label}</strong>
        <span>{formatTime(time)}</span>
      </div>
      {url ? (
        <button type="button" onClick={() => onOpen(url)}>
          <img src={url} alt={`${label} submission`} />
        </button>
      ) : (
        <div className="missingPhoto">No photo</div>
      )}
    </div>
  );
}

const styles = `
  .adminPage {
    min-height: 100vh;
    box-sizing: border-box;
    padding: 28px;
    background:
      radial-gradient(circle at 10% 0%, rgba(37, 99, 235, 0.1), transparent 36%),
      linear-gradient(180deg, #eef5ff 0%, #f8fbff 46%, #ffffff 100%);
    color: #07152d;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .hero, .panel, .loginCard, .statusCard {
    border: 1px solid #cfe0f5;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 18px 46px rgba(15, 35, 75, 0.08);
  }
  .hero {
    max-width: 1180px;
    margin: 0 auto 16px;
    border-radius: 26px;
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
  }
  span {
    color: #2563eb;
    font-size: 12px;
    font-weight: 1000;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: clamp(32px, 5vw, 48px); line-height: 0.95; }
  h2 { font-size: 28px; }
  p { color: #526983; font-weight: 700; }
  .heroActions, .filterRow, .chillerTabs, .tabs, .modalActions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .statusGrid {
    max-width: 1180px;
    margin: 0 auto 16px;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
  }
  .statusCard {
    text-align: left;
    border-radius: 20px;
    padding: 16px;
    min-height: 118px;
    display: grid;
    gap: 8px;
  }
  .statusCard strong { font-size: 24px; }
  .statusCard small { color: #607997; font-weight: 800; }
  .statusCard.complete { border-color: #86efac; background: #f0fdf4; }
  .statusCard.partial { border-color: #fed7aa; background: #fff7ed; }
  .statusCard.missing { border-color: #fecaca; background: #fff1f2; }
  .tabs, .panel, .alert {
    max-width: 1180px;
    margin-left: auto;
    margin-right: auto;
  }
  .tabs { margin-bottom: 16px; }
  button {
    border: 0;
    border-radius: 14px;
    padding: 12px 16px;
    font: inherit;
    font-weight: 1000;
    cursor: pointer;
  }
  button:disabled { cursor: wait; opacity: 0.7; }
  .tabs button, .chillerTabs button, .filterRow button, .ghostBtn, .softBtn {
    border: 1px solid #c9d8eb;
    background: #fff;
    color: #07152d;
  }
  .tabs .active, .chillerTabs .active, .filterRow .active, .primaryBtn {
    background: #0f172a;
    color: #fff;
    border-color: #0f172a;
  }
  .primaryBtn {
    box-shadow: 0 16px 34px rgba(37, 99, 235, 0.18);
  }
  .dangerBtn {
    background: #be123c;
    color: #fff;
    box-shadow: 0 16px 34px rgba(190, 18, 60, 0.16);
  }
  .filterRow .danger {
    background: #be123c;
    border-color: #be123c;
    color: #fff;
  }
  .panel {
    border-radius: 24px;
    padding: 22px;
    margin-bottom: 22px;
  }
  .panelHead, .recordHead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }
  .chillerTabs { margin-bottom: 16px; }
  .historyList {
    display: grid;
    gap: 14px;
  }
  .historyCard {
    border: 1px solid #d7e3f4;
    border-radius: 20px;
    padding: 16px;
    background: #fff;
  }
  .historyCard.complete { border-color: #bbf7d0; }
  .historyCard.partial { border-color: #fed7aa; }
  .historyCard.missing { border-color: #fecaca; }
  .recordHead strong { display: block; font-size: 18px; }
  .recordHead span { letter-spacing: 0; text-transform: none; color: #607997; }
  .recordHead b {
    border-radius: 999px;
    padding: 8px 12px;
    background: #eef6ff;
    color: #1d4ed8;
    white-space: nowrap;
  }
  .thumbGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .photoTile {
    border: 1px solid #e1eaf6;
    border-radius: 16px;
    overflow: hidden;
    background: #f8fbff;
  }
  .photoTile > div:first-child {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
  }
  .photoTile span {
    letter-spacing: 0;
    text-transform: none;
    color: #607997;
  }
  .photoTile button, .missingPhoto {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eef6ff;
    color: #607997;
  }
  .photoTile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .empty {
    border: 1px dashed #b8cff0;
    border-radius: 18px;
    padding: 28px;
    text-align: center;
    color: #607997;
    font-weight: 900;
  }
  .settingsGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  label {
    display: grid;
    gap: 8px;
    color: #263b58;
    font-weight: 1000;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #c9d8eb;
    border-radius: 14px;
    padding: 14px 16px;
    font: inherit;
    font-weight: 800;
    background: #fff;
  }
  label small {
    color: #607997;
    font-weight: 700;
  }
  .settingsGrid .primaryBtn {
    grid-column: 1 / -1;
    justify-self: end;
  }
  .dangerPanel {
    border-color: #fecaca;
    background: linear-gradient(180deg, #fff 0%, #fff7f7 100%);
  }
  .resetLayout {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 16px;
  }
  .resetChooser {
    display: grid;
    gap: 10px;
  }
  .resetChooser button {
    border: 1px solid #fecaca;
    background: #fff;
    color: #991b1b;
    text-align: left;
  }
  .resetChooser .active {
    background: #991b1b;
    color: #fff;
  }
  .resetCard {
    border: 1px solid #fecaca;
    border-radius: 22px;
    padding: 20px;
    background: #fff;
  }
  .resetCard h3 { font-size: 30px; margin: 8px 0; }
  .resetMeta {
    display: grid;
    gap: 4px;
    margin: 16px 0;
    padding: 14px;
    border-radius: 16px;
    background: #fff1f2;
    color: #991b1b;
  }
  .alert {
    box-sizing: border-box;
    border-radius: 16px;
    padding: 14px 16px;
    margin-bottom: 14px;
    font-weight: 900;
  }
  .alert.error { border: 1px solid #fecaca; background: #fff1f2; color: #be123c; }
  .alert.success { border: 1px solid #bbf7d0; background: #ecfdf3; color: #047857; }
  .loginCard {
    width: min(620px, 100%);
    box-sizing: border-box;
    margin: 10vh auto;
    border-radius: 26px;
    padding: 28px;
    display: grid;
    gap: 14px;
  }
  .loginCard h1 { font-size: clamp(34px, 7vw, 56px); }
  .modalBackdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(15, 23, 42, 0.55);
  }
  .confirmModal, .lightbox {
    width: min(560px, 100%);
    box-sizing: border-box;
    border-radius: 24px;
    padding: 24px;
    background: #fff;
    box-shadow: 0 24px 70px rgba(0,0,0,0.22);
  }
  .confirmModal h2 { margin: 8px 0; }
  .modalActions { justify-content: flex-end; margin-top: 18px; }
  .lightbox {
    width: min(980px, 100%);
    max-height: calc(100vh - 36px);
    overflow: auto;
  }
  .lightbox > div:first-child {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .lightbox img {
    width: 100%;
    height: auto;
    border-radius: 16px;
  }
  @media (max-width: 900px) {
    .adminPage { padding: 14px; }
    .hero, .panelHead { flex-direction: column; align-items: stretch; }
    .heroActions, .filterRow { display: grid; grid-template-columns: 1fr; }
    .statusGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .settingsGrid, .resetLayout, .thumbGrid { grid-template-columns: 1fr; }
    .settingsGrid .primaryBtn { justify-self: stretch; }
  }
  @media (max-width: 460px) {
    .statusGrid { grid-template-columns: 1fr; }
    .tabs, .chillerTabs { display: grid; grid-template-columns: 1fr; }
    .modalActions { display: grid; grid-template-columns: 1fr; }
    .hero, .panel, .loginCard { border-radius: 20px; padding: 18px; }
  }
`;
