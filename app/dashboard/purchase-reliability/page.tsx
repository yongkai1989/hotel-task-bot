'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Printer = { role: string; online: boolean; last_seen_at: string | null; device_name: string; bridge_version: string; queued: number; stalled: number; failed: number; latest_error: string };
type Snapshot = {
  printers: Printer[];
  summary: { orders_30_days: number; paid_30_days: number; revenue_30_days: number; stale_pending: number; unacknowledged: number; refunds_outstanding: number; outbox_pending: number };
  exceptions: any[];
  outbox: any[];
  checked_at: string;
};

function when(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-MY');
}

export default function PurchaseReliabilityPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (recover = false) => {
    setBusy(true);
    try {
      const response = await fetch('/api/guest-shop/reliability', recover ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'RUN_RECOVERY' }),
      } : { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to load purchase health');
      setData(result);
      setError('');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to load purchase health');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <main className="reliability-page">
      <header>
        <div><span>MANAGEMENT</span><h1>Purchase Reliability</h1><p>Payment, printer, notification and refund health in one place.</p></div>
        <div className="actions"><button disabled={busy} onClick={() => load(true)}>{busy ? 'Checking…' : 'Run recovery check'}</button><Link href="/dashboard">Dashboard</Link></div>
      </header>
      {error ? <div className="error">{error}</div> : null}
      {!data ? <section className="panel">Loading purchase health…</section> : <>
        <section className="summary">
          <article><small>Paid · 30 days</small><strong>{data.summary.paid_30_days}</strong><span>RM{data.summary.revenue_30_days.toFixed(2)}</span></article>
          <article><small>Awaiting staff</small><strong>{data.summary.unacknowledged}</strong><span>Needs acknowledgement</span></article>
          <article className={data.summary.refunds_outstanding ? 'warn' : ''}><small>Refunds outstanding</small><strong>{data.summary.refunds_outstanding}</strong><span>Required or in progress</span></article>
          <article className={data.summary.outbox_pending ? 'warn' : ''}><small>Notification recovery</small><strong>{data.summary.outbox_pending}</strong><span>Waiting to retry</span></article>
        </section>

        <section className="panel">
          <div className="panel-head"><div><span>PRINTER BRIDGE</span><h2>Live printer status</h2></div><small>Online means seen within 2 minutes</small></div>
          <div className="printers">{data.printers.map((printer) => <article key={printer.role}>
            <div className="printer-title"><h3>{printer.role}</h3><b className={printer.online ? 'online' : 'offline'}>{printer.online ? 'ONLINE' : 'OFFLINE'}</b></div>
            <dl><div><dt>Last contact</dt><dd>{when(printer.last_seen_at)}</dd></div><div><dt>Queued</dt><dd>{printer.queued}</dd></div><div><dt>Stalled</dt><dd>{printer.stalled}</dd></div><div><dt>Failed</dt><dd>{printer.failed}</dd></div></dl>
            <p>{printer.device_name || 'No bridge device has checked in.'}</p>{printer.latest_error ? <em>{printer.latest_error}</em> : null}
          </article>)}</div>
        </section>

        <section className="panel">
          <div className="panel-head"><div><span>ACTION REQUIRED</span><h2>Purchase exceptions</h2></div><small>Checked {when(data.checked_at)}</small></div>
          {!data.exceptions.length ? <div className="clear">No print failures or outstanding refunds.</div> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Type</th><th>Payment</th><th>Refund</th><th>Print status</th></tr></thead><tbody>{data.exceptions.map((row) => <tr key={row.id}><td>{String(row.id).slice(0, 8)}<small>{when(row.created_at)}</small></td><td>{row.order_type}</td><td>{row.status}<small>{row.payment_reference || '-'}</small></td><td>{row.refund_status || (row.refund_required ? 'REQUIRED' : 'NOT REQUIRED')}<small>{row.refund_reason || ''}</small></td><td>Breakfast: {row.breakfast_print_status}<br/>F&amp;B: {row.fnb_print_status}<br/>FO: {row.fo_print_status}</td></tr>)}</tbody></table></div>}
        </section>
      </>}
      <style jsx>{`
        .reliability-page{min-height:100vh;padding:28px;background:#f4f7fb;color:#10213e;font-family:Inter,system-ui,sans-serif}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;max-width:1200px;margin:0 auto 20px}header span,.panel-head span{font-size:11px;font-weight:900;letter-spacing:.14em;color:#2563eb}h1{margin:5px 0;font-size:34px}h2{margin:4px 0;font-size:22px}p{margin:0;color:#60708a}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button,.actions a{border:0;border-radius:12px;padding:12px 15px;background:#10213e;color:#fff;font-weight:850;text-decoration:none}.actions a{background:#fff;color:#10213e;border:1px solid #cbd7e8}.summary,.panel{max-width:1200px;margin:0 auto 18px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.summary article,.panel{border:1px solid #d8e2ef;border-radius:18px;background:#fff;box-shadow:0 10px 28px rgba(31,55,91,.06)}.summary article{padding:18px}.summary small{display:block;color:#60708a;font-weight:800}.summary strong{display:block;font-size:30px;margin:6px 0}.summary span{font-size:12px;color:#60708a}.summary .warn{border-color:#fdba74;background:#fffaf2}.panel{padding:20px}.panel-head{display:flex;justify-content:space-between;gap:15px;align-items:flex-start;margin-bottom:14px}.panel-head small{color:#708099}.printers{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.printers article{border:1px solid #dbe5f2;border-radius:16px;padding:16px}.printer-title{display:flex;justify-content:space-between;align-items:center}.printer-title h3{margin:0}.printer-title b{font-size:10px;padding:6px 8px;border-radius:999px}.online{color:#047857;background:#d1fae5}.offline{color:#b91c1c;background:#fee2e2}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0}dl div{background:#f6f8fc;padding:9px;border-radius:10px}dt{font-size:10px;color:#708099;font-weight:800}dd{margin:3px 0 0;font-weight:900}.printers em{display:block;margin-top:10px;color:#b91c1c;font-size:12px}.clear{padding:24px;border-radius:14px;background:#ecfdf5;color:#047857;font-weight:850}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e3e9f2;font-size:13px;vertical-align:top}th{color:#60708a;font-size:11px;text-transform:uppercase}td small{display:block;color:#718096;margin-top:4px}.error{max-width:1200px;margin:0 auto 18px;padding:14px;border-radius:12px;background:#fee2e2;color:#b91c1c;font-weight:800}@media(max-width:800px){.reliability-page{padding:16px}header{display:block}header .actions{margin-top:15px}.summary{grid-template-columns:1fr 1fr}.printers{grid-template-columns:1fr}}@media(max-width:480px){.summary{grid-template-columns:1fr}h1{font-size:28px}.panel{padding:15px}}
      `}</style>
    </main>
  );
}
