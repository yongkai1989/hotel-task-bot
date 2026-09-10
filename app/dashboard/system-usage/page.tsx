'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Bucket = { bucket_id: string; object_count: number; total_bytes: number };
type TableUsage = { schemaname: string; table_name: string; estimated_rows: number; total_bytes: number };
type Snapshot = {
  captured_at: string;
  database_bytes: number;
  storage_bytes: number;
  storage_objects: number;
  storage_buckets: Bucket[];
  largest_tables: TableUsage[];
  cleanup_eligible: { room_checks: number; media_items: number; pending_media_protected: number };
};
type Payload = {
  usage: Snapshot;
  limits: { database_bytes: number; storage_bytes: number; warning_percent: number; critical_percent: number };
  links: { supabase_database: string; supabase_usage: string; vercel_usage: string };
  note: string;
  cached: boolean;
};

function bytes(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function percent(used: number, limit: number) {
  return limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
}

function tone(value: number, limits: Payload['limits']) {
  if (value >= limits.critical_percent) return 'critical';
  if (value >= limits.warning_percent) return 'warning';
  return 'good';
}

export default function SystemUsagePage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(force = false) {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again.');
      const response = await fetch(`/api/admin/system-usage${force ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error || 'Unable to load usage');
      setPayload(json);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to load usage');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, []);

  const databasePercent = payload ? percent(payload.usage.database_bytes, payload.limits.database_bytes) : 0;
  const storagePercent = payload ? percent(payload.usage.storage_bytes, payload.limits.storage_bytes) : 0;

  return (
    <main className="usage-page">
      <header>
        <div><small>SUPERUSER</small><h1>System Usage</h1><p>Free-tier capacity, file pressure and safe cleanup eligibility.</p></div>
        <div className="actions"><button onClick={() => void load(true)} disabled={loading}>{loading ? 'Checking…' : 'Refresh now'}</button><Link href="/dashboard">Back</Link></div>
      </header>
      {error ? <div className="error">{error}</div> : null}
      {payload ? <>
        <section className="meter-grid">
          {[
            { label: 'Database', used: payload.usage.database_bytes, limit: payload.limits.database_bytes, value: databasePercent },
            { label: 'File storage', used: payload.usage.storage_bytes, limit: payload.limits.storage_bytes, value: storagePercent },
          ].map((item) => <article className={`meter ${tone(item.value, payload.limits)}`} key={item.label}>
            <div><span>{item.label}</span><strong>{item.value.toFixed(1)}%</strong></div>
            <div className="track"><i style={{ width: `${item.value}%` }} /></div>
            <p>{bytes(item.used)} used of {bytes(item.limit)}</p>
          </article>)}
        </section>
        <section className="summary-grid">
          <article><span>Stored files</span><strong>{payload.usage.storage_objects.toLocaleString()}</strong></article>
          <article><span>Cleanup eligible</span><strong>{payload.usage.cleanup_eligible.media_items.toLocaleString()}</strong><small>Media from completed room checks older than 15 days</small></article>
          <article><span>Protected pending media</span><strong>{payload.usage.cleanup_eligible.pending_media_protected.toLocaleString()}</strong><small>Never eligible while the room check is unfinished</small></article>
        </section>
        <section className="panel"><h2>Storage by area</h2><div className="rows">{payload.usage.storage_buckets.map((bucket) => <div className="row" key={bucket.bucket_id}><b>{bucket.bucket_id}</b><span>{bucket.object_count.toLocaleString()} files</span><strong>{bytes(bucket.total_bytes)}</strong></div>)}</div></section>
        <section className="panel"><h2>Largest database tables</h2><div className="rows">{payload.usage.largest_tables.map((table) => <div className="row" key={`${table.schemaname}.${table.table_name}`}><b>{table.table_name}</b><span>about {Number(table.estimated_rows || 0).toLocaleString()} rows</span><strong>{bytes(table.total_bytes)}</strong></div>)}</div></section>
        <section className="provider"><div><h2>Bandwidth and server use</h2><p>{payload.note}</p></div><a href={payload.links.supabase_usage} target="_blank" rel="noreferrer">Supabase usage</a><a href={payload.links.vercel_usage} target="_blank" rel="noreferrer">Vercel usage</a></section>
        <p className="captured">Measured {new Date(payload.usage.captured_at).toLocaleString('en-GB')} {payload.cached ? '· cached for speed' : ''}</p>
      </> : loading ? <div className="loading">Checking system usage…</div> : null}
      <style jsx>{`
        .usage-page{min-height:100vh;padding:22px;background:#f3f7fd;color:#0f1d35}header,.panel,.provider,.meter,.summary-grid article{border:1px solid #d7e1ef;background:#fff;border-radius:18px}header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:24px}header small{color:#225be8;font-weight:900;letter-spacing:.13em}h1{margin:3px 0 2px;font-size:34px}p{margin:0;color:#60728e}.actions{display:flex;gap:9px}.actions button,.actions a,.provider a{border:1px solid #cbd8ea;border-radius:11px;padding:11px 14px;background:#fff;color:#12203a;font-weight:850;text-decoration:none}.actions button{background:#14213a;color:#fff;cursor:pointer}.actions button:disabled{opacity:.6}.error{margin-top:14px;padding:14px;border-radius:12px;background:#fee2e2;color:#991b1b;font-weight:800}.meter-grid,.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.meter{padding:18px}.meter>div:first-child{display:flex;justify-content:space-between;align-items:center}.meter span,.summary-grid span{font-weight:800;color:#52647f}.meter strong{font-size:27px}.track{height:12px;margin:14px 0 9px;border-radius:999px;background:#e6edf7;overflow:hidden}.track i{display:block;height:100%;background:#1e67df}.meter.warning .track i{background:#d97706}.meter.critical .track i{background:#dc2626}.summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.summary-grid article{display:grid;gap:5px;padding:18px}.summary-grid strong{font-size:28px}.summary-grid small{color:#6b7a90;line-height:1.35}.panel{margin-top:14px;padding:20px}.panel h2,.provider h2{margin:0 0 13px;font-size:19px}.rows{display:grid;gap:7px}.row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(120px,.5fr) 100px;gap:12px;padding:11px;border-radius:10px;background:#f5f8fc}.row span{color:#65758c}.row strong{text-align:right}.provider{display:flex;gap:12px;align-items:center;margin-top:14px;padding:20px}.provider div{margin-right:auto}.provider p{max-width:760px;line-height:1.5}.provider a{white-space:nowrap}.captured{padding:12px;text-align:center;font-size:12px}.loading{margin-top:14px;padding:35px;text-align:center;font-weight:800}@media(max-width:720px){.usage-page{padding:10px}header,.provider{align-items:stretch;flex-direction:column}.meter-grid,.summary-grid{grid-template-columns:1fr}.row{grid-template-columns:1fr auto}.row span{grid-column:1/-1}.provider div{margin:0}.provider a{text-align:center}}
      `}</style>
    </main>
  );
}
