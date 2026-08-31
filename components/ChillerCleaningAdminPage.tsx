'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from '../lib/dateDisplay';

type ChillerRecord = {
  id: string;
  week_start: string;
  week_end: string;
  chiller_name: string;
  staff_name: string | null;
  before_available?: boolean;
  before_url?: string | null;
  before_submitted_at?: string | null;
  after_available?: boolean;
  after_url?: string | null;
  after_submitted_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Week = { start: string; end: string };
type Tab = 'history' | 'settings' | 'reset';
type HistoryMode = 'all' | 'overdue';
type BranchId = 'regency' | 'grand';

const ADMIN_TOKEN_KEY = 'chiller_cleaning_admin_token_v3';
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
const BRANCHES: Array<{ id: BranchId; name: string; description: string; url: string }> = [
  {
    id: 'regency',
    name: 'Regency',
    description: 'Regency F&B Routine Duties',
    url: '/regency-fnb-routine-duties',
  },
  {
    id: 'grand',
    name: 'Grand',
    description: 'Grand F&B Routine Duties',
    url: '/grand-fnb-routine-duties',
  },
];
const TRACKING_START = '2026-07-20';

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value?: string) {
  return formatDateDDMMYYYY(value);
}

function formatTime(value?: string | null) {
  return formatDateTimeDDMMYYYY(value, 'Not submitted');
}

function statusFor(record?: ChillerRecord) {
  const hasBefore = Boolean(record?.before_available || record?.before_url);
  const hasAfter = Boolean(record?.after_available || record?.after_url);
  if (hasBefore && hasAfter) return 'complete';
  if (hasBefore || hasAfter) return 'partial';
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
  const [activeBranch, setActiveBranch] = useState<BranchId>('regency');
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [activeChiller, setActiveChiller] = useState('Chiller 1');
  const [historyMode, setHistoryMode] = useState<HistoryMode>('all');
  const [staffPasscode, setStaffPasscode] = useState('');
  const [adminPasscode, setAdminPasscode] = useState('');
  const [resetChiller, setResetChiller] = useState('Chiller 1');
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mediaLoadingIds, setMediaLoadingIds] = useState<Set<string>>(() => new Set());
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const chillers = CHILLERS_BY_BRANCH[activeBranch];

  const recordMap = useMemo(() => {
    const map = new Map<string, ChillerRecord>();
    records.forEach((record) => map.set(`${record.week_start}|${record.chiller_name}`, record));
    return map;
  }, [records]);

  const currentRecords = useMemo(
    () => chillers.map((chiller) => recordMap.get(`${currentWeek?.start}|${chiller}`)),
    [chillers, currentWeek?.start, recordMap],
  );

  const pastWeeks = useMemo(() => buildPastWeeks(currentWeek?.start), [currentWeek?.start]);

  const overdueItems = useMemo(() => {
    return pastWeeks.flatMap((week) =>
      chillers.map((chiller) => {
        const record = recordMap.get(`${week.start}|${chiller}`);
        return { week, chiller, record, status: statusFor(record) };
      }).filter((item) => item.status !== 'complete'),
    );
  }, [chillers, pastWeeks, recordMap]);

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

  async function load(nextToken = token, branch: BranchId = activeBranch) {
    if (!nextToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/chiller-cleaning/admin?branch=${branch}`, {
        cache: 'no-store',
        headers: { 'x-chiller-token': nextToken },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load routine duty records');
      setRecords(Array.isArray(json.records) ? json.records : []);
      setCurrentWeek(json.week || json.current_week || null);
      setActiveBranch(branch);
      setToken(nextToken);
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, nextToken);
    } catch (err: any) {
      setToken('');
      window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      setError(err?.message || 'Unable to load routine duty records');
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
    if (busy) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/chiller-cleaning/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'admin', passcode }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Wrong admin passcode');
      setPasscode('');
      await load(json.token);
    } catch (err: any) {
      setError(err?.name === 'AbortError'
        ? 'The database is temporarily busy. Please wait a moment and try once.'
        : err?.message || 'Wrong admin passcode');
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function loadRecordMedia(recordId: string) {
    if (!recordId || mediaLoadingIds.has(recordId)) return;
    setMediaLoadingIds((current) => new Set(current).add(recordId));
    setError('');
    try {
      const res = await fetch(
        `/api/chiller-cleaning/admin?branch=${activeBranch}&record_id=${encodeURIComponent(recordId)}`,
        {
          cache: 'no-store',
          headers: { 'x-chiller-token': token },
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to load routine duty photos');
      const signedRecord = json.record || {};
      setRecords((current) => current.map((record) => (
        record.id === recordId
          ? {
            ...record,
            ...signedRecord,
            before_available: Boolean(signedRecord.before_path || signedRecord.before_url),
            after_available: Boolean(signedRecord.after_path || signedRecord.after_url),
          }
          : record
      )));
    } catch (err: any) {
      setError(err?.message || 'Unable to load routine duty photos');
    } finally {
      setMediaLoadingIds((current) => {
        const next = new Set(current);
        next.delete(recordId);
        return next;
      });
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
          branch: activeBranch,
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
      setNotice(`${BRANCHES.find((branch) => branch.id === activeBranch)?.name} passcode settings updated successfully.`);
      await load(json.token || token, activeBranch);
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
        body: JSON.stringify({ branch: activeBranch, chiller_name: resetChiller }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Unable to reset routine duty');
      setRecords(Array.isArray(json.records) ? json.records : []);
      setConfirmReset(false);
      setNotice(`${resetChiller} reset for the current week. ${json.removedFiles || 0} upload(s) removed.`);
    } catch (err: any) {
      setError(err?.message || 'Unable to reset routine duty');
    } finally {
      setBusy(false);
    }
  }

  async function changeBranch(branch: BranchId) {
    if (branch === activeBranch) return;
    setActiveChiller('Chiller 1');
    setResetChiller('Chiller 1');
    setHistoryMode('all');
    setStaffPasscode('');
    setNotice('');
    setError('');
    await load(token, branch);
  }

  if (loading) {
    return (
      <main className="adminPage">
        <div className="loginCard">Loading F&amp;B routine duties admin...</div>
        <style jsx>{styles}</style>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="adminPage">
        <form className="loginCard" onSubmit={login}>
          <span>Branch Admin</span>
          <h1>F&amp;B Routine Duties Admin</h1>
          <p>Enter the admin passcode to review records, reset selected duties, and manage passcodes.</p>
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
  const activeBranchDetails = BRANCHES.find((branch) => branch.id === activeBranch) || BRANCHES[0];
  const completedThisWeek = currentRecords.filter((record) => statusFor(record) === 'complete').length;

  return (
    <main className="adminPage">
      <section className="branchChooser" aria-label="Choose F&B branch">
        <div className="branchChooserHead">
          <div>
            <span>Branch workspace</span>
            <h2>Choose the location to review</h2>
            <p>Each location has separate staff access, submissions, history, and photo storage.</p>
          </div>
          <b>{activeBranchDetails.name} selected</b>
        </div>
        <div className="branchCards">
          {BRANCHES.map((branch) => (
            <button
              type="button"
              key={branch.id}
              className={`branchCard ${activeBranch === branch.id ? 'active' : ''}`}
              onClick={() => void changeBranch(branch.id)}
              disabled={loading}
            >
              <span>{branch.name}</span>
              <strong>{branch.description}</strong>
              <small>{activeBranch === branch.id ? 'Currently viewing' : 'Open branch records'}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="hero">
        <div className="heroIdentity">
          <span className="branchBadge">{activeBranchDetails.name} branch</span>
          <h1>{activeBranchDetails.description}</h1>
          <div className="weekSummary" aria-label="Current reporting week">
            <small>Current week</small>
            <strong>{formatDate(currentWeek?.start)} - {formatDate(currentWeek?.end)}</strong>
          </div>
        </div>
        <div className="heroActions">
          <a className="openBranchBtn" href={activeBranchDetails.url} target="_blank" rel="noreferrer">Open Staff Page</a>
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

      <section className="statusSection">
        <div className="statusSectionHead">
          <div>
            <span>Weekly overview</span>
            <h2>Routine duty status</h2>
          </div>
          <div className="completionSummary">
            <strong>{completedThisWeek}/{chillers.length}</strong>
            <small>completed</small>
          </div>
        </div>
        <div className="statusGrid">
          {chillers.map((chiller) => {
            const record = recordMap.get(`${currentWeek?.start}|${chiller}`);
            const status = statusFor(record);
            return (
              <button
                key={chiller}
                type="button"
                aria-pressed={activeTab === 'history' && activeChiller === chiller}
                className={`statusCard ${status} ${activeTab === 'history' && activeChiller === chiller ? 'selected' : ''}`}
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
        </div>
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
            {chillers.map((chiller) => (
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
                      available={item.record?.before_available}
                      url={item.record?.before_url}
                      time={item.record?.before_submitted_at}
                      loading={Boolean(item.record?.id && mediaLoadingIds.has(item.record.id))}
                      onLoad={() => item.record?.id && void loadRecordMedia(item.record.id)}
                      onOpen={(url) => setLightbox({ url, title: `${item.chiller} Before` })}
                    />
                    <PhotoTile
                      label="After"
                      available={item.record?.after_available}
                      url={item.record?.after_url}
                      time={item.record?.after_submitted_at}
                      loading={Boolean(item.record?.id && mediaLoadingIds.has(item.record.id))}
                      onLoad={() => item.record?.id && void loadRecordMedia(item.record.id)}
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
              <h2>{activeBranchDetails.name} Passcode</h2>
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
              <small>Used only for {activeBranchDetails.description}. The other branch is not changed.</small>
            </label>
            <label>
              Admin page passcode (all branches)
              <input
                type="password"
                value={adminPasscode}
                onChange={(event) => setAdminPasscode(event.target.value)}
                placeholder="New admin passcode"
              />
              <small>One admin passcode unlocks this page and both branch workspaces.</small>
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
              {chillers.map((chiller) => (
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
                This clears the selected duty&apos;s before/after photos and submitted staff name for{' '}
                {formatDate(currentWeek?.start)} - {formatDate(currentWeek?.end)}. Past weeks are untouched.
              </p>
              <div className="resetMeta">
                <b>Status: {statusLabel(statusFor(selectedCurrentRecord))}</b>
                <small>{selectedCurrentRecord?.staff_name || 'No staff submitted yet'}</small>
              </div>
              <button type="button" className="dangerBtn" onClick={() => setConfirmReset(true)}>
                Reset Selected Duty
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
              This action removes only the current-week uploads for {resetChiller}. It will not affect other duties or past weeks.
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
  available,
  url,
  time,
  loading,
  onLoad,
  onOpen,
}: {
  label: string;
  available?: boolean;
  url?: string | null;
  time?: string | null;
  loading: boolean;
  onLoad: () => void;
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
      ) : available ? (
        <button type="button" className="loadPhoto" onClick={onLoad} disabled={loading}>
          <strong>{loading ? 'Loading photo…' : 'View photo'}</strong>
          <span>{loading ? 'Creating a secure link' : 'Loaded only when requested'}</span>
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
  .hero, .panel, .loginCard, .statusCard, .branchChooser {
    border: 1px solid #cfe0f5;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 18px 46px rgba(15, 35, 75, 0.08);
  }
  .hero {
    max-width: 1180px;
    margin: 0 auto 16px;
    border-radius: 26px;
    padding: 28px 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
  }
  .heroIdentity {
    min-width: 0;
    display: grid;
    justify-items: start;
    gap: 10px;
  }
  .branchBadge {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    box-sizing: border-box;
    border: 1px solid #bfd5ff;
    border-radius: 999px;
    padding: 5px 10px;
    background: #eef5ff;
    color: #1d4ed8;
  }
  .weekSummary {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
    border: 1px solid #dbe7f6;
    border-radius: 12px;
    padding: 8px 11px;
    background: #f8fbff;
    color: #334c6c;
  }
  .weekSummary small {
    color: #71839c;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .weekSummary strong {
    font-size: 13px;
    white-space: nowrap;
  }
  .branchChooser {
    max-width: 1180px;
    box-sizing: border-box;
    margin: 0 auto 16px;
    border-radius: 26px;
    padding: 20px;
  }
  .branchChooserHead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 15px;
  }
  .branchChooserHead h2 { margin: 4px 0 5px; }
  .branchChooserHead b {
    flex: 0 0 auto;
    border-radius: 999px;
    padding: 8px 12px;
    color: #174ba5;
    background: #e9f2ff;
    font-size: 12px;
  }
  .branchCards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .branchCard {
    min-height: 112px;
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 5px;
    border: 1px solid #cbd9ec;
    border-radius: 18px;
    padding: 16px 18px;
    color: #14233b;
    background: #f8fbff;
    text-align: left;
  }
  .branchCard strong { font-size: 19px; }
  .branchCard small { color: #687b96; font-weight: 800; }
  .branchCard.active {
    border-color: #2563eb;
    color: #fff;
    background: linear-gradient(135deg, #123f9e, #2563eb);
    box-shadow: 0 14px 30px rgba(37, 99, 235, .2);
  }
  .branchCard.active span, .branchCard.active small { color: #dce9ff; }
  span {
    color: #2563eb;
    font-size: 12px;
    font-weight: 1000;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.08; letter-spacing: -0.035em; }
  h2 { font-size: 28px; }
  p { color: #526983; font-weight: 700; }
  .heroActions, .filterRow, .chillerTabs, .tabs, .modalActions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .heroActions {
    flex: 0 0 auto;
    justify-content: flex-end;
  }
  .openBranchBtn {
    box-sizing: border-box;
    border: 1px solid #2563eb;
    border-radius: 14px;
    padding: 12px 16px;
    color: #fff;
    background: #2563eb;
    font-weight: 1000;
    text-decoration: none;
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
  .photoTile button.loadPhoto {
    flex-direction: column;
    gap: 5px;
    padding: 16px;
    color: #174ea6;
  }
  .photoTile button.loadPhoto span {
    color: #607997;
    font-size: 11px;
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
    .hero, .panelHead, .branchChooserHead { flex-direction: column; align-items: stretch; }
    .branchChooserHead b { width: max-content; }
    .heroActions, .filterRow { display: grid; grid-template-columns: 1fr; }
    .openBranchBtn { text-align: center; }
    .statusGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .settingsGrid, .resetLayout, .thumbGrid { grid-template-columns: 1fr; }
    .settingsGrid .primaryBtn { justify-self: stretch; }
  }
  @media (max-width: 460px) {
    .branchCards { grid-template-columns: 1fr; }
    .statusGrid { grid-template-columns: 1fr; }
    .tabs, .chillerTabs { display: grid; grid-template-columns: 1fr; }
    .modalActions { display: grid; grid-template-columns: 1fr; }
    .hero, .panel, .loginCard, .branchChooser { border-radius: 20px; padding: 18px; }
    .hero { gap: 20px; }
    .heroIdentity { gap: 9px; }
    .hero h1 { font-size: clamp(29px, 9.5vw, 38px); line-height: 1.08; }
    .weekSummary {
      width: 100%;
      box-sizing: border-box;
      justify-content: space-between;
    }
    .weekSummary strong { white-space: normal; text-align: right; }
  }

  /* Unified admin workspace */
  .adminPage {
    --navy: #10264b;
    --blue: #2563eb;
    --blue-dark: #1d4ed8;
    --line: #d9e3f0;
    --surface: #ffffff;
    --surface-soft: #f5f8fc;
    --text-soft: #60728c;
    padding: 24px;
    background: #f3f6fb;
  }
  .adminPage, .adminPage * { box-sizing: border-box; }
  .branchChooser, .hero, .statusSection, .tabs, .panel, .alert {
    width: min(1180px, 100%);
    max-width: 1180px;
  }
  .branchChooser, .hero, .statusSection, .panel {
    border: 1px solid var(--line);
    background: var(--surface);
    box-shadow: 0 8px 28px rgba(26, 50, 86, .06);
  }
  .branchChooser {
    margin-bottom: 14px;
    padding: 20px;
    border-radius: 20px;
  }
  .branchChooserHead {
    align-items: center;
    margin-bottom: 14px;
  }
  .branchChooserHead h2 {
    margin: 3px 0 4px;
    color: var(--navy);
    font-size: 24px;
    line-height: 1.15;
    letter-spacing: -.025em;
  }
  .branchChooserHead p {
    color: var(--text-soft);
    font-size: 13px;
    line-height: 1.45;
  }
  .branchChooserHead b {
    border: 1px solid #cfe0ff;
    padding: 7px 11px;
    background: #eff5ff;
    color: #1d4ed8;
  }
  .branchCards { gap: 10px; }
  .branchCard {
    min-height: 88px;
    gap: 4px;
    border-color: var(--line);
    border-radius: 14px;
    padding: 14px 16px;
    background: var(--surface-soft);
    box-shadow: none;
    transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease;
  }
  .branchCard:hover:not(:disabled) {
    border-color: #9bbcf6;
    background: #f0f6ff;
    transform: translateY(-1px);
  }
  .branchCard strong {
    color: var(--navy);
    font-size: 16px;
    line-height: 1.25;
  }
  .branchCard small { font-size: 11px; }
  .branchCard.active {
    border-color: var(--blue);
    background: linear-gradient(135deg, #1e4fbd, #3269e8);
    box-shadow: 0 8px 20px rgba(37, 99, 235, .18);
    transform: none;
  }
  .branchCard.active strong { color: #fff; }

  .hero {
    margin-bottom: 14px;
    padding: 22px 24px;
    border-radius: 20px;
    gap: 24px;
  }
  .heroIdentity { gap: 8px; }
  .hero h1 {
    max-width: 680px;
    color: var(--navy);
    font-size: clamp(30px, 3.4vw, 42px);
    line-height: 1.08;
  }
  .branchBadge {
    min-height: 26px;
    border-color: #c7d9f8;
    padding: 4px 9px;
    background: #f3f7ff;
  }
  .weekSummary {
    min-height: 36px;
    margin-top: 1px;
    border-color: #e0e7f0;
    padding: 7px 10px;
    background: #f7f9fc;
  }
  .heroActions {
    display: grid;
    grid-template-columns: repeat(3, max-content);
    gap: 8px;
  }
  .heroActions > a, .heroActions > button {
    min-height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 11px;
    padding: 10px 14px;
    white-space: nowrap;
    box-shadow: none;
    font-size: 13px;
  }
  .openBranchBtn { background: var(--blue); }
  .dangerBtn { background: #c21646; box-shadow: none; }

  .statusSection {
    margin: 0 auto 14px;
    padding: 18px;
    border-radius: 20px;
  }
  .statusSectionHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }
  .statusSectionHead h2 {
    margin-top: 3px;
    color: var(--navy);
    font-size: 22px;
    letter-spacing: -.02em;
  }
  .completionSummary {
    min-width: 88px;
    display: grid;
    justify-items: end;
    gap: 1px;
    border-radius: 12px;
    padding: 8px 11px;
    background: #edf4ff;
  }
  .completionSummary strong { color: var(--blue-dark); font-size: 18px; }
  .completionSummary small { color: var(--text-soft); font-size: 10px; font-weight: 800; text-transform: uppercase; }
  .statusGrid {
    max-width: none;
    margin: 0;
    gap: 9px;
  }
  .statusCard {
    position: relative;
    min-height: 104px;
    align-content: start;
    gap: 6px;
    overflow: hidden;
    border-width: 1px;
    border-radius: 14px;
    padding: 14px;
    box-shadow: none;
    transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
  }
  .statusCard::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: #ef4444;
  }
  .statusCard.partial::before { background: #f59e0b; }
  .statusCard.complete::before { background: #16a34a; }
  .statusCard:hover { transform: translateY(-1px); }
  .statusCard.selected {
    border-color: var(--blue);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, .13);
  }
  .statusCard span { font-size: 10px; }
  .statusCard strong { color: var(--navy); font-size: 20px; line-height: 1.15; }
  .statusCard small { margin-top: auto; font-size: 11px; }
  .statusCard.missing { border-color: #f3c9cf; background: #fff8f8; }
  .statusCard.partial { border-color: #f5d9a7; background: #fffbf3; }
  .statusCard.complete { border-color: #b9e1c6; background: #f5fbf7; }

  .tabs {
    margin-top: 0;
    margin-bottom: 14px;
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 5px;
    background: var(--surface);
    box-shadow: 0 5px 18px rgba(26, 50, 86, .04);
  }
  .tabs button {
    min-height: 38px;
    border: 0;
    border-radius: 9px;
    padding: 8px 15px;
    color: #50627b;
    background: transparent;
    font-size: 13px;
  }
  .tabs .active {
    border-color: var(--blue);
    background: var(--blue);
    color: #fff;
  }
  .panel {
    margin-bottom: 24px;
    border-radius: 20px;
    padding: 20px;
  }
  .panelHead {
    align-items: center;
    margin-bottom: 14px;
  }
  .panelHead h2 {
    margin-top: 3px;
    color: var(--navy);
    font-size: 24px;
    letter-spacing: -.02em;
  }
  .filterRow {
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 4px;
    background: var(--surface-soft);
  }
  .filterRow button {
    min-height: 36px;
    border: 0;
    border-radius: 8px;
    padding: 7px 12px;
    background: transparent;
    font-size: 12px;
  }
  .filterRow .active { background: var(--navy); }
  .chillerTabs {
    gap: 6px;
    margin-bottom: 16px;
    border-radius: 14px;
    padding: 6px;
    background: var(--surface-soft);
  }
  .chillerTabs button {
    min-height: 36px;
    border-color: transparent;
    border-radius: 9px;
    padding: 7px 11px;
    background: transparent;
    color: #4b5e78;
    font-size: 12px;
  }
  .chillerTabs .active {
    border-color: #c9d9f0;
    background: #fff;
    color: var(--blue-dark);
    box-shadow: 0 2px 8px rgba(26, 50, 86, .08);
  }
  .historyList { gap: 10px; }
  .historyCard {
    border-color: var(--line);
    border-radius: 16px;
    padding: 14px;
    background: #fff;
  }
  .historyCard.complete { border-color: #b9e1c6; }
  .historyCard.partial { border-color: #f5d9a7; }
  .historyCard.missing { border-color: #f3c9cf; }
  .recordHead { align-items: center; margin-bottom: 12px; }
  .recordHead strong { color: var(--navy); font-size: 16px; }
  .recordHead span { display: block; margin-top: 3px; font-size: 11px; }
  .recordHead b { padding: 7px 10px; font-size: 11px; }
  .thumbGrid { gap: 10px; }
  .photoTile {
    border-color: var(--line);
    border-radius: 12px;
    background: var(--surface-soft);
  }
  .photoTile > div:first-child { align-items: center; padding: 10px 11px; }
  .photoTile > div:first-child strong { color: var(--navy); font-size: 13px; }
  .photoTile span { font-size: 10px; }
  .photoTile button, .missingPhoto { background: #edf2f8; }
  .empty { border-radius: 14px; background: #f8fafc; }

  .settingsGrid { gap: 12px; }
  .settingsGrid label {
    align-content: start;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    background: var(--surface-soft);
  }
  input { min-height: 46px; border-radius: 10px; padding: 11px 13px; }
  .settingsGrid .primaryBtn {
    min-height: 42px;
    border-radius: 10px;
    background: var(--blue);
  }
  .dangerPanel { border-color: #efc8cf; background: #fff; }
  .resetChooser { gap: 6px; }
  .resetChooser button { border-radius: 10px; }
  .resetCard { border-radius: 16px; }
  .alert { border-radius: 12px; }

  button, .openBranchBtn { transition: background .16s ease, border-color .16s ease, color .16s ease, transform .16s ease; }
  button:focus-visible, .openBranchBtn:focus-visible {
    outline: 3px solid rgba(37, 99, 235, .28);
    outline-offset: 2px;
  }

  @media (max-width: 900px) {
    .adminPage { padding: 14px; }
    .hero { align-items: stretch; }
    .heroActions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .heroActions > a, .heroActions > button { white-space: normal; text-align: center; }
    .statusGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panelHead { align-items: stretch; }
    .filterRow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 600px) {
    .adminPage { padding: 10px; }
    .branchChooser, .hero, .statusSection, .panel { border-radius: 16px; padding: 15px; }
    .branchChooserHead { align-items: flex-start; }
    .branchChooserHead b { width: auto; }
    .branchCards { grid-template-columns: 1fr; }
    .branchCard { min-height: 78px; }
    .hero h1 { font-size: clamp(28px, 9vw, 36px); }
    .heroActions { grid-template-columns: 1fr 1fr; }
    .heroActions .openBranchBtn { grid-column: 1 / -1; }
    .weekSummary { width: 100%; justify-content: space-between; }
    .weekSummary strong { white-space: normal; text-align: right; }
    .statusSectionHead { align-items: flex-end; }
    .statusSectionHead h2 { font-size: 20px; }
    .statusGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    .statusCard { min-height: 98px; padding: 12px; }
    .statusCard strong { font-size: 18px; }
    .tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .tabs button { padding: 8px 6px; }
    .panelHead { gap: 12px; }
    .chillerTabs {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
    }
    .chillerTabs button { flex: 0 0 auto; white-space: nowrap; }
    .thumbGrid { grid-template-columns: 1fr; }
    .recordHead { align-items: flex-start; }
    .settingsGrid, .resetLayout { grid-template-columns: 1fr; }
  }
`;
