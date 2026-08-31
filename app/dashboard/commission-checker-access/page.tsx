'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { formatDateTimeDDMMYYYY } from '../../../lib/dateDisplay';

type AccessRow = {
  id: string;
  email: string;
  label: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  passcode_generated_at: string | null;
  passcode_expires_at: string | null;
  passcode_never_expires: boolean;
  passcode: string | null;
  has_active_passcode: boolean;
  can_recover_passcode: boolean;
};

type IssuedPasscode = {
  email: string;
  label: string;
  passcode: string;
  expiresAt: string | null;
  neverExpires: boolean;
};

function formatDate(value: string | null) {
  return formatDateTimeDDMMYYYY(value, 'Never');
}

function passcodeState(row: AccessRow) {
  if (row.passcode_never_expires) return { label: 'Permanent code', tone: 'permanent' };
  if (!row.passcode_expires_at) return { label: 'Code required', tone: 'missing' };
  if (new Date(row.passcode_expires_at).getTime() <= Date.now()) return { label: 'Expired', tone: 'expired' };
  return { label: `Valid until ${formatDate(row.passcode_expires_at)}`, tone: 'valid' };
}

export default function CommissionCheckerAccessAdminPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [issued, setIssued] = useState<IssuedPasscode | null>(null);
  const [copied, setCopied] = useState(false);

  async function request(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
    });
    const json = await response.json();
    if (response.status === 403) {
      window.location.assign('/dashboard');
      throw new Error('Superuser access required');
    }
    if (!response.ok || !json?.ok) throw new Error(json?.error || 'Unable to complete request');
    return json;
  }

  async function load() {
    try {
      setLoading(true);
      setError('');
      const json = await request(`/api/admin/commission-checker-access?t=${Date.now()}`);
      setRows(json.access || []);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Commission Checker access');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function reveal(json: any, fallbackLabel: string, fallbackEmail: string) {
    setIssued({
      email: json.access?.email || fallbackEmail,
      label: json.access?.label || fallbackLabel,
      passcode: String(json.passcode || ''),
      expiresAt: json.passcode_expires_at ? String(json.passcode_expires_at) : null,
      neverExpires: json.passcode_never_expires === true || json.access?.passcode_never_expires === true,
    });
    setCopied(false);
  }

  async function addAccess(event: FormEvent) {
    event.preventDefault();
    try {
      setAdding(true);
      setError('');
      setMessage('');
      const json = await request('/api/admin/commission-checker-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, label }),
      });
      reveal(json, label, email);
      setEmail('');
      setLabel('');
      setMessage('Access created. The active code remains available on this page until it expires or is replaced.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to create access');
    } finally {
      setAdding(false);
    }
  }

  async function generate(row: AccessRow) {
    if (row.passcode_expires_at && !window.confirm(`Generate a new code for ${row.email}? Existing codes and signed-in devices will stop working.`)) return;
    try {
      setBusyId(row.id);
      setError('');
      setMessage('');
      const json = await request('/api/admin/commission-checker-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      reveal(json, row.label, row.email);
      setMessage('New passcode generated. The active code remains available on this page until it expires or is replaced.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to generate passcode');
    } finally {
      setBusyId('');
    }
  }

  async function toggle(row: AccessRow) {
    try {
      setBusyId(row.id);
      setError('');
      setMessage('');
      await request('/api/admin/commission-checker-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, label: row.label, is_active: !row.is_active }),
      });
      setMessage(row.is_active
        ? `${row.email} has been disabled. Its passcode and sessions are now invalid.`
        : `${row.email} has been restored. Generate a new passcode before use.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to update access');
    } finally {
      setBusyId('');
    }
  }

  async function copyPasscode() {
    if (!issued) return;
    await navigator.clipboard.writeText(`${issued.email}\nPasscode: ${issued.passcode}`);
    setCopied(true);
  }

  async function revealExisting(row: AccessRow) {
    try {
      setBusyId(row.id);
      setError('');
      setMessage('Recovering the existing code securely. This may take a few seconds...');
      const json = await request(
        `/api/admin/commission-checker-access?reveal=${encodeURIComponent(row.id)}&t=${Date.now()}`
      );
      const passcode = String(json.passcode || '');
      setRows((current) => current.map((item) => (
        item.id === row.id ? { ...item, ...json.access, passcode } : item
      )));
      setMessage(`Existing code recovered for ${row.email}.`);
    } catch (err: any) {
      setMessage('');
      setError(err?.message || 'Unable to reveal the existing code');
    } finally {
      setBusyId('');
    }
  }

  async function copyCurrentCode(row: AccessRow) {
    if (!row.passcode) return;
    await navigator.clipboard.writeText(`${row.email}\nPasscode: ${row.passcode}`);
    setMessage(`Login details copied for ${row.email}.`);
  }

  return (
    <main className="admin-page">
      <div className="shell">
        <header className="hero">
          <div>
            <div className="eyebrow">Superuser only</div>
            <h1>Commission Checker Access</h1>
            <p>Create usernames and issue secure six-digit passcodes valid for seven days.</p>
          </div>
          <div className="hero-actions">
            <Link href="/commission-checker" target="_blank" className="button secondary">Open Public Checker</Link>
            <Link href="/dashboard/admin-settings" className="button secondary">Admin Settings</Link>
          </div>
        </header>

        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        {issued ? (
          <section className="issued-card" aria-live="polite">
            <div>
              <div className="section-kicker">Passcode ready</div>
              <strong>{issued.label || issued.email}</strong>
              <span>{issued.email}</span>
            </div>
            <div className="code">{issued.passcode}</div>
            <div className="issued-meta">
              <span>{issued.neverExpires ? 'This code does not expire' : `Expires ${formatDate(issued.expiresAt)}`}</span>
              <small>This active code will remain available in the staff access list below.</small>
            </div>
            <button type="button" onClick={() => void copyPasscode()}>{copied ? 'Copied' : 'Copy login details'}</button>
            <button type="button" className="dismiss" onClick={() => setIssued(null)}>Done</button>
          </section>
        ) : null}

        <section className="panel add-panel">
          <div>
            <div className="section-kicker">Create staff login</div>
            <h2>Add username and generate code</h2>
            <p>The email is used only as a username. No OTP or email will be sent.</p>
            {email.trim().toLowerCase() === 'ryan.tan@hotelhallmark.com' ? (
              <div className="permanent-note">Ryan's generated code will remain valid until it is manually regenerated or disabled.</div>
            ) : null}
          </div>
          <form onSubmit={addAccess} className="add-form">
            <div className="field">
              <label htmlFor="branch-label">Branch / description</label>
              <input id="branch-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Regency branch" required />
            </div>
            <div className="field">
              <label htmlFor="branch-email">Username (email format)</label>
              <input id="branch-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="branch@hotelhallmark.com" required />
            </div>
            <button type="submit" disabled={adding}>{adding ? 'Generating...' : 'Create & Generate Code'}</button>
          </form>
        </section>

        <section className="panel list-panel">
          <div className="list-head">
            <div>
              <div className="section-kicker">Staff access</div>
              <h2>{rows.filter((row) => row.is_active).length} active username{rows.filter((row) => row.is_active).length === 1 ? '' : 's'}</h2>
            </div>
            <button type="button" className="refresh" onClick={() => void load()} disabled={loading}>Refresh</button>
          </div>

          {loading ? <div className="empty">Loading access records...</div> : rows.length === 0 ? (
            <div className="empty">No Commission Checker usernames have been created.</div>
          ) : (
            <div className="access-list">
              {rows.map((row) => {
                const codeState = passcodeState(row);
                return (
                  <article key={row.id} className={`access-row ${row.is_active ? '' : 'inactive'}`}>
                    <div className={`status-dot ${row.is_active ? 'on' : ''}`} />
                    <div className="identity">
                      <strong>{row.label || 'Unnamed branch'}</strong>
                      <span>{row.email}</span>
                    </div>
                    <div className="dates">
                      <small>Last signed in</small>
                      <span>{formatDate(row.last_login_at)}</span>
                    </div>
                    <span className={`code-status ${codeState.tone}`}>{row.is_active ? codeState.label : 'Disabled'}</span>
                    <div className="active-code">
                      <small>Current code</small>
                      {row.passcode ? (
                        <div className="code-line">
                          <strong>{row.passcode}</strong>
                          <button type="button" className="code-action" onClick={() => void copyCurrentCode(row)}>Copy</button>
                        </div>
                      ) : row.is_active && row.can_recover_passcode ? (
                        <button type="button" className="code-action recover" onClick={() => void revealExisting(row)} disabled={busyId === row.id}>
                          {busyId === row.id ? 'Recovering...' : 'Show existing code'}
                        </button>
                      ) : (
                        <span className="no-code">—</span>
                      )}
                    </div>
                    <div className="row-actions">
                      {row.is_active ? (
                        <button type="button" className="generate" onClick={() => void generate(row)} disabled={busyId === row.id}>
                          {busyId === row.id ? 'Working...' : row.passcode_expires_at ? 'New Code' : 'Generate Code'}
                        </button>
                      ) : null}
                      <button type="button" className={row.is_active ? 'remove' : 'restore'} onClick={() => void toggle(row)} disabled={busyId === row.id}>
                        {row.is_active ? 'Disable' : 'Restore'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="security-note">
          Generating a new code immediately invalidates the previous code and all existing Commission Checker sessions for that username. Active codes are encrypted at rest and are revealed only through this superuser-only page.
        </div>
      </div>

      <style jsx>{`
        .admin-page { min-height: 100vh; padding: 22px 16px 44px; background: #f4f7fb; color: #0f172a; }
        .shell { width: min(1180px, 100%); margin: 0 auto; }
        .hero { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; padding: 24px; border: 1px solid #dbe4f0; border-radius: 24px; background: linear-gradient(135deg, #fff 0%, #f7faff 100%); box-shadow: 0 16px 40px rgba(15,23,42,.06); }
        .eyebrow, .section-kicker { color: #2563eb; font-size: 11px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
        h1 { margin: 7px 0 6px; font-size: clamp(28px, 4vw, 38px); line-height: 1.05; letter-spacing: -.035em; }
        h2 { margin: 5px 0 6px; font-size: 21px; letter-spacing: -.02em; }
        p { margin: 0; color: #64748b; font-size: 14px; line-height: 1.55; }
        .hero-actions { display: flex; gap: 9px; flex-wrap: wrap; }
        .button, button { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; border: 0; border-radius: 13px; padding: 12px 15px; background: #16366d; color: #fff; font-size: 13px; font-weight: 850; text-decoration: none; cursor: pointer; }
        .button.secondary, button.refresh, button.dismiss { border: 1px solid #cbd5e1; background: #fff; color: #16366d; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .panel { border: 1px solid #dbe4f0; border-radius: 22px; background: #fff; box-shadow: 0 12px 34px rgba(15,23,42,.055); }
        .issued-card { display: grid; grid-template-columns: minmax(190px,1fr) auto minmax(170px,.7fr) auto auto; gap: 16px; align-items: center; margin-bottom: 16px; padding: 18px 20px; border: 2px solid #2563eb; border-radius: 20px; background: #eff6ff; box-shadow: 0 16px 34px rgba(37,99,235,.12); }
        .issued-card > div:first-child, .issued-meta { display: grid; gap: 3px; }
        .issued-card span, .issued-meta small { color: #64748b; font-size: 12px; }
        .code { color: #16366d; font-size: 32px; font-weight: 950; letter-spacing: .18em; }
        .add-panel { display: grid; grid-template-columns: minmax(260px,.75fr) minmax(420px,1.25fr); gap: 28px; align-items: end; padding: 22px; margin-bottom: 16px; }
        .add-form { display: grid; grid-template-columns: .8fr 1.2fr auto; gap: 10px; align-items: end; }
        .field { display: grid; gap: 7px; min-width: 0; }
        label { color: #334155; font-size: 12px; font-weight: 850; }
        input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 13px; padding: 12px 13px; background: #fff; color: #0f172a; font-size: 14px; outline: none; }
        input:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.1); }
        .list-panel { padding: 20px; }
        .list-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
        .access-list { display: grid; gap: 9px; }
        .access-row { display: grid; grid-template-columns: 10px minmax(180px,1.1fr) minmax(130px,.65fr) minmax(150px,.8fr) minmax(150px,.7fr) auto; align-items: center; gap: 14px; border: 1px solid #dbe4f0; border-radius: 16px; padding: 13px 14px; background: #fbfdff; }
        .access-row.inactive { background: #f8fafc; color: #64748b; }
        .status-dot { width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; }
        .status-dot.on { background: #22c55e; box-shadow: 0 0 0 4px #dcfce7; }
        .identity, .dates, .active-code { display: grid; gap: 3px; min-width: 0; }
        .identity strong { font-size: 15px; }
        .identity span, .dates span { overflow: hidden; color: #64748b; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .dates small, .active-code small { color: #94a3b8; font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
        .code-line { display: flex; align-items: center; gap: 7px; }
        .code-line strong { color: #16366d; font-size: 17px; letter-spacing: .12em; font-variant-numeric: tabular-nums; }
        button.code-action { min-height: 30px; border: 1px solid #bfdbfe; border-radius: 9px; padding: 6px 9px; background: #eff6ff; color: #1d4ed8; font-size: 11px; }
        button.code-action.recover { width: max-content; max-width: 100%; }
        .no-code { color: #94a3b8; font-weight: 800; }
        .code-status { border-radius: 999px; padding: 7px 10px; text-align: center; font-size: 11px; font-weight: 850; }
        .code-status.valid, .code-status.permanent { background: #dcfce7; color: #166534; }
        .code-status.expired { background: #fee2e2; color: #b91c1c; }
        .code-status.missing { background: #fef3c7; color: #92400e; }
        .row-actions { display: flex; gap: 7px; }
        button.generate { background: #2563eb; }
        button.remove { border: 1px solid #fecaca; background: #fff; color: #dc2626; }
        button.restore { background: #16366d; }
        .empty { border: 1px dashed #cbd5e1; border-radius: 16px; padding: 28px; color: #64748b; text-align: center; font-weight: 750; }
        .alert { margin-bottom: 14px; border-radius: 14px; padding: 12px 14px; font-size: 13px; font-weight: 750; }
        .alert.error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
        .alert.success { border: 1px solid #bbf7d0; background: #ecfdf5; color: #166534; }
        .permanent-note { margin-top: 12px; border-radius: 12px; padding: 10px 12px; background: #ecfdf5; color: #166534; font-size: 12px; font-weight: 800; line-height: 1.45; }
        .security-note { margin-top: 14px; border: 1px solid #dbeafe; border-radius: 16px; padding: 13px 15px; background: #eff6ff; color: #1e3a8a; font-size: 12px; line-height: 1.55; font-weight: 750; }
        @media (max-width: 900px) { .hero, .add-panel { grid-template-columns: 1fr; display: grid; } .add-form { grid-template-columns: 1fr 1fr; } .add-form > button { grid-column: 1 / -1; } .issued-card { grid-template-columns: 1fr auto; } .issued-meta { grid-column: 1 / -1; } .access-row { grid-template-columns: 10px 1fr auto; } .dates { grid-column: 2; } .code-status { grid-column: 3; grid-row: 1; } .active-code { grid-column: 2 / -1; } .row-actions { grid-column: 2 / -1; } }
        @media (max-width: 560px) { .admin-page { padding: 12px 10px 32px; } .hero, .panel { border-radius: 18px; } .hero { padding: 18px; } .hero-actions, .add-form { display: grid; grid-template-columns: 1fr; } .add-form > button { grid-column: auto; } .issued-card { grid-template-columns: 1fr; text-align: center; } .code { font-size: 36px; } .issued-card button { width: 100%; } .access-row { gap: 10px; padding: 12px; } .code-status { grid-column: 2 / -1; grid-row: auto; text-align: left; } .row-actions { display: grid; grid-template-columns: 1fr 1fr; } }
      `}</style>
    </main>
  );
}

