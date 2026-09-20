'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type NotificationUser = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  alerts_enabled: boolean;
  active_devices: number;
  devices: string[];
  departments: string[];
  last_updated_at: string | null;
};

type Payload = {
  captured_at: string;
  summary: { total: number; enabled: number; disabled: number };
  users: NotificationUser[];
};

type Filter = 'ALL' | 'ENABLED' | 'DISABLED';

function formatDate(value: string | null) {
  if (!value) return 'Never registered';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function NotificationStatusPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch('/api/admin/notification-status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || 'Unable to load notification status');
      }
      setPayload(json);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to load notification status');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (payload?.users || []).filter((user) => {
      if (filter === 'ENABLED' && !user.alerts_enabled) return false;
      if (filter === 'DISABLED' && user.alerts_enabled) return false;
      if (!query) return true;
      return [user.name, user.email, user.user_id, user.role]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [filter, payload, search]);

  return (
    <main className="notification-page">
      <header>
        <div>
          <small>MANAGEMENT</small>
          <h1>Notification Status</h1>
          <p>See which user accounts have registered browser alerts.</p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link href="/dashboard">Back</Link>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {payload ? (
        <>
          <section className="summary">
            <button type="button" className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>
              <span>All users</span><strong>{payload.summary.total}</strong>
            </button>
            <button type="button" className={`enabled ${filter === 'ENABLED' ? 'active' : ''}`} onClick={() => setFilter('ENABLED')}>
              <span>Alerts enabled</span><strong>{payload.summary.enabled}</strong>
            </button>
            <button type="button" className={`disabled ${filter === 'DISABLED' ? 'active' : ''}`} onClick={() => setFilter('DISABLED')}>
              <span>Not enabled</span><strong>{payload.summary.disabled}</strong>
            </button>
          </section>

          <section className="panel">
            <div className="toolbar">
              <div>
                <h2>User alert registration</h2>
                <p>{visibleUsers.length} account{visibleUsers.length === 1 ? '' : 's'} shown</p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, ID, email or role"
                aria-label="Search notification users"
              />
            </div>

            <div className="user-list">
              {visibleUsers.map((user) => (
                <article className="user-row" key={user.user_id}>
                  <div className="identity">
                    <div className="avatar">{user.name.trim().slice(0, 1).toUpperCase() || '?'}</div>
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.email || 'No email'} · {user.role}</span>
                      <code>{user.user_id}</code>
                    </div>
                  </div>
                  <div className="device">
                    <span>Registered device</span>
                    <strong>{user.devices.length ? user.devices.join(', ') : 'None'}</strong>
                    <small>{user.active_devices > 1 ? `${user.active_devices} active devices` : formatDate(user.last_updated_at)}</small>
                  </div>
                  <div className={`status ${user.alerts_enabled ? 'on' : 'off'}`}>
                    <i />
                    <div><strong>{user.alerts_enabled ? 'Alerts enabled' : 'Not enabled'}</strong><span>{user.alerts_enabled ? 'Push subscription active' : 'No active device registered'}</span></div>
                  </div>
                </article>
              ))}
              {!visibleUsers.length ? <div className="empty">No users match this filter.</div> : null}
            </div>
          </section>

          <p className="note">Status is based on active devices registered with the app. If a user changes browser or phone, they must enable alerts again on that device.</p>
        </>
      ) : loading ? <div className="loading">Checking notification registrations…</div> : null}

      <style jsx>{`
        .notification-page{min-height:100vh;padding:22px;background:#f3f7fd;color:#0f1d35}header,.panel,.summary button{border:1px solid #d7e1ef;background:#fff;border-radius:18px}header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:24px}header small{color:#225be8;font-weight:900;letter-spacing:.13em}h1{margin:3px 0 2px;font-size:34px}p{margin:0;color:#60728e}.header-actions{display:flex;gap:9px}.header-actions button,.header-actions a{border:1px solid #cbd8ea;border-radius:11px;padding:11px 14px;background:#fff;color:#12203a;font-weight:850;text-decoration:none}.header-actions button{background:#14213a;color:#fff;cursor:pointer}.header-actions button:disabled{opacity:.6}.error{margin-top:14px;padding:14px;border-radius:12px;background:#fee2e2;color:#991b1b;font-weight:800}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}.summary button{display:flex;align-items:center;justify-content:space-between;padding:18px;text-align:left;cursor:pointer;color:#52647f}.summary button strong{font-size:28px;color:#14213a}.summary button.active{outline:3px solid #bfdbfe;border-color:#2563eb}.summary button.enabled strong{color:#15803d}.summary button.disabled strong{color:#b91c1c}.panel{margin-top:14px;padding:20px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.toolbar h2{margin:0 0 4px;font-size:20px}.toolbar input{width:min(360px,100%);border:1px solid #cbd8ea;border-radius:12px;padding:12px 14px;font:inherit}.user-list{display:grid;gap:9px}.user-row{display:grid;grid-template-columns:minmax(300px,1.3fr) minmax(210px,.8fr) minmax(190px,.65fr);gap:16px;align-items:center;padding:14px;border:1px solid #e0e8f3;border-radius:14px;background:#fbfdff}.identity{display:flex;align-items:center;gap:12px;min-width:0}.avatar{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:#e5edff;color:#1849b8;font-weight:900;flex:0 0 auto}.identity>div:last-child{display:grid;gap:3px;min-width:0}.identity strong{font-size:15px}.identity span,.identity code,.device span,.device small,.status span{font-size:11px;color:#6b7a90}.identity code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.device{display:grid;gap:4px}.device>strong{font-size:13px}.status{display:flex;align-items:center;gap:10px;padding:11px;border-radius:12px}.status i{width:10px;height:10px;border-radius:999px;flex:0 0 auto}.status div{display:grid;gap:2px}.status strong{font-size:13px}.status.on{background:#ecfdf3;color:#166534}.status.on i{background:#22c55e}.status.off{background:#fff1f2;color:#991b1b}.status.off i{background:#ef4444}.empty,.loading{padding:36px;text-align:center;color:#64748b;font-weight:800}.note{padding:13px;text-align:center;font-size:12px}@media(max-width:820px){.notification-page{padding:10px}header,.toolbar{align-items:stretch;flex-direction:column}.header-actions>*{flex:1;text-align:center}.summary{grid-template-columns:1fr}.user-row{grid-template-columns:1fr}.toolbar input{width:auto}.device{padding-left:54px}.status{margin-left:54px}}
      `}</style>
    </main>
  );
}
