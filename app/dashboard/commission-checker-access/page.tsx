'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type AccessRow = {
  id: string;
  email: string;
  label: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return 'Never used';
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
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
      setError(err?.message || 'Unable to load approved emails');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addEmail(event: FormEvent) {
    event.preventDefault();
    try {
      setAdding(true);
      setError('');
      setMessage('');
      await request('/api/admin/commission-checker-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, label }),
      });
      setEmail('');
      setLabel('');
      setMessage('Approved email saved. It can now receive Commission Checker OTP codes.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to add approved email');
    } finally {
      setAdding(false);
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
      setMessage(row.is_active ? `${row.email} has been removed. Its session will be rejected on the next page load.` : `${row.email} has been restored.`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to update approved email');
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="admin-page">
      <div className="shell">
        <header className="hero">
          <div>
            <div className="eyebrow">Secure external access</div>
            <h1>Commission Checker Access</h1>
            <p>Approve branch email addresses for OTP login without granting dashboard access.</p>
          </div>
          <div className="hero-actions">
            <Link href="/commission-checker" target="_blank" className="button secondary">Open Public Checker</Link>
            <Link href="/dashboard/admin-settings" className="button secondary">Admin Settings</Link>
          </div>
        </header>

        {error ? <div className="alert error">{error}</div> : null}
        {message ? <div className="alert success">{message}</div> : null}

        <section className="panel add-panel">
          <div>
            <div className="section-kicker">Add approved login</div>
            <h2>Authorize a branch email</h2>
            <p>The address receives a six-digit OTP. No dashboard account or password is required.</p>
          </div>
          <form onSubmit={addEmail} className="add-form">
            <div className="field">
              <label htmlFor="branch-label">Branch / description</label>
              <input id="branch-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Regency branch" required />
            </div>
            <div className="field">
              <label htmlFor="branch-email">Email address</label>
              <input id="branch-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="branch@hotelhallmark.com" required />
            </div>
            <button type="submit" disabled={adding}>{adding ? 'Savingâ€¦' : 'Approve Email'}</button>
          </form>
        </section>

        <section className="panel list-panel">
          <div className="list-head">
            <div>
              <div className="section-kicker">Approved access</div>
              <h2>{rows.filter((row) => row.is_active).length} active email{rows.filter((row) => row.is_active).length === 1 ? '' : 's'}</h2>
            </div>
            <button type="button" className="refresh" onClick={() => void load()} disabled={loading}>Refresh</button>
          </div>

          {loading ? <div className="empty">Loading approved emailsâ€¦</div> : rows.length === 0 ? (
            <div className="empty">No email addresses have been approved yet.</div>
          ) : (
            <div className="access-list">
              {rows.map((row) => (
                <article key={row.id} className={`access-row ${row.is_active ? '' : 'inactive'}`}>
                  <div className={`status-dot ${row.is_active ? 'on' : ''}`} />
                  <div className="identity">
                    <strong>{row.label || 'Unnamed branch'}</strong>
                    <span>{row.email}</span>
                  </div>
                  <div className="last-used">
                    <small>Last signed in</small>
                    <span>{formatDate(row.last_login_at)}</span>
                  </div>
                  <span className={`status ${row.is_active ? 'active' : ''}`}>{row.is_active ? 'Active' : 'Removed'}</span>
                  <button
                    type="button"
                    className={row.is_active ? 'remove' : 'restore'}
                    onClick={() => void toggle(row)}
                    disabled={busyId === row.id}
                  >
                    {busyId === row.id ? 'Savingâ€¦' : row.is_active ? 'Remove Access' : 'Restore'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="security-note">
          Removing an address invalidates its seven-day session on the next page load or refresh. Uploaded CSV files remain in the userâ€™s browser and are not stored by this access page.
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
        .button.secondary, button.refresh { border: 1px solid #cbd5e1; background: #fff; color: #16366d; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .panel { border: 1px solid #dbe4f0; border-radius: 22px; background: #fff; box-shadow: 0 12px 34px rgba(15,23,42,.055); }
        .add-panel { display: grid; grid-template-columns: minmax(260px,.75fr) minmax(420px,1.25fr); gap: 28px; align-items: end; padding: 22px; margin-bottom: 16px; }
        .add-form { display: grid; grid-template-columns: .8fr 1.2fr auto; gap: 10px; align-items: end; }
        .field { display: grid; gap: 7px; min-width: 0; }
        label { color: #334155; font-size: 12px; font-weight: 850; }
        input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 13px; padding: 12px 13px; background: #fff; color: #0f172a; font-size: 14px; outline: none; }
        input:focus { border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37,99,235,.1); }
        .list-panel { padding: 20px; }
        .list-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
        .access-list { display: grid; gap: 9px; }
        .access-row { display: grid; grid-template-columns: 10px minmax(190px,1.25fr) minmax(170px,.8fr) auto auto; align-items: center; gap: 14px; border: 1px solid #dbe4f0; border-radius: 16px; padding: 13px 14px; background: #fbfdff; }
        .access-row.inactive { background: #f8fafc; color: #64748b; }
        .status-dot { width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; }
        .status-dot.on { background: #22c55e; box-shadow: 0 0 0 4px #dcfce7; }
        .identity, .last-used { display: grid; gap: 3px; min-width: 0; }
        .identity strong { font-size: 15px; }
        .identity span, .last-used span { overflow: hidden; color: #64748b; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .last-used small { color: #94a3b8; font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: .08em; }
        .status { border-radius: 999px; padding: 6px 9px; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 850; }
        .status.active { background: #dcfce7; color: #166534; }
        button.remove { border: 1px solid #fecaca; background: #fff; color: #dc2626; }
        button.restore { background: #16366d; }
        .empty { border: 1px dashed #cbd5e1; border-radius: 16px; padding: 28px; color: #64748b; text-align: center; font-weight: 750; }
        .alert { margin-bottom: 14px; border-radius: 14px; padding: 12px 14px; font-size: 13px; font-weight: 750; }
        .alert.error { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; }
        .alert.success { border: 1px solid #bbf7d0; background: #ecfdf5; color: #166534; }
        .security-note { margin-top: 14px; border: 1px solid #dbeafe; border-radius: 16px; padding: 13px 15px; background: #eff6ff; color: #1e3a8a; font-size: 12px; line-height: 1.55; font-weight: 750; }
        @media (max-width: 840px) { .hero, .add-panel { grid-template-columns: 1fr; display: grid; } .hero-actions { display: grid; grid-template-columns: 1fr 1fr; } .add-form { grid-template-columns: 1fr 1fr; } .add-form > button { grid-column: 1 / -1; } .access-row { grid-template-columns: 10px 1fr auto; } .last-used { grid-column: 2 / 3; } .status { grid-column: 3; grid-row: 1; } .access-row > button { grid-column: 2 / -1; width: 100%; } }
        @media (max-width: 560px) { .admin-page { padding: 12px 10px 32px; } .hero, .panel { border-radius: 18px; } .hero { padding: 18px; } .hero-actions, .add-form { grid-template-columns: 1fr; } .add-form > button { grid-column: auto; } .access-row { gap: 10px; padding: 12px; } }
      `}</style>
    </main>
  );
}

