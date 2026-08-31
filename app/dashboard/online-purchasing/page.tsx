'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { formatDateTimeDDMMYYYY } from '../../../lib/dateDisplay';
import styles from './online-purchasing.module.css';

type Hotel = {
  code: string;
  name: string;
  legal_entity: string;
  opening_float: number;
  available_balance: number;
};

type DocumentRow = {
  id: string;
  document_type: 'E_INVOICE' | 'PHOTO' | 'REFUND_PHOTO';
  file_name: string;
  url: string | null;
};

type Order = {
  id: string;
  purchase_number: number;
  hotel_code: string;
  shopee_url: string;
  status: string;
  purchase_amount: number | null;
  purchase_date?: string | null;
  purchased_at: string | null;
  arrived_at: string | null;
  invoice_submitted_at: string | null;
  reimbursed_at: string | null;
  refund_issue_type: string | null;
  refund_remark: string | null;
  refund_requested_at: string | null;
  refund_completed_at: string | null;
  refund_amount: number | null;
  created_by: string;
  purchased_by: string | null;
  arrived_by: string | null;
  invoice_submitted_by: string | null;
  reimbursed_by: string | null;
  refund_requested_by: string | null;
  refund_completed_by: string | null;
  cancelled_by: string | null;
  created_at: string;
  online_purchase_documents: DocumentRow[];
};

type Access = { id: string; user_id: string; hotel_code: string; access_role: 'PURCHASER' | 'HOD' };
type Profile = { user_id: string; name: string; email: string; role: string };
type Payload = {
  user: { user_id: string; name: string; email: string; role: string };
  hotels: Hotel[];
  orders: Order[];
  access: Access[];
  profiles: Profile[];
};

const statusLabels: Record<string, string> = {
  AWAITING_PURCHASE: 'Awaiting Purchase',
  PURCHASED_IN_TRANSIT: 'Purchased – In Transit',
  ARRIVED_INVOICE_PENDING: 'Arrived – E-Invoice Pending',
  PENDING_REIMBURSEMENT: 'Pending Reimbursement',
  COMPLETE_CLAIMED: 'Complete & Claimed',
  REFUND_PENDING: 'Lost/Defective – Pending Refund',
  REFUND_COMPLETED: 'Refund Completed',
  CANCELLED: 'Cancelled',
};

const terminalStatuses = new Set(['COMPLETE_CLAIMED', 'REFUND_COMPLETED', 'CANCELLED']);

function money(value: number | null | undefined) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0));
}

function dateTime(value: string | null | undefined) {
  return formatDateTimeDDMMYYYY(value, '—');
}

export default function OnlinePurchasingPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'ACTIVE' | 'HISTORY' | 'TEAM'>('ACTIVE');
  const [hotelFilter, setHotelFilter] = useState('ALL');
  const [newHotel, setNewHotel] = useState('');
  const [newLink, setNewLink] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refundOrder, setRefundOrder] = useState<string | null>(null);
  const [refundType, setRefundType] = useState('LOST');
  const [refundRemark, setRefundRemark] = useState('');
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});

  const accessToken = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || '';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/online-purchasing', {
        cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to load Online Purchasing');
      setData(json);
      if (!newHotel && json.hotels?.[0]?.code) setNewHotel(json.hotels[0].code);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Online Purchasing');
    } finally {
      setLoading(false);
    }
  }, [accessToken, newHotel]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (action: string, orderId?: string, payload: Record<string, unknown> = {}) => {
    setBusy(`${action}:${orderId || 'new'}`);
    setError('');
    setNotice('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/online-purchasing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, order_id: orderId, payload }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to save');
      setNotice(action === 'DELETE_ORDER'
        ? (json.storage_cleanup_pending ? 'History deleted. One or more uploaded files require storage cleanup.' : 'History deleted successfully.')
        : 'Saved successfully.');
      await load();
      return true;
    } catch (err: any) {
      setError(err?.message || 'Unable to save');
      return false;
    } finally {
      setBusy('');
    }
  };

  const uploadFiles = async (orderId: string, documentType: string, files: FileList | null) => {
    if (!files?.length) return;
    setBusy(`UPLOAD:${orderId}`);
    setError('');
    try {
      const token = await accessToken();
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('order_id', orderId);
        form.set('document_type', documentType);
        form.set('file', file);
        const response = await fetch('/api/online-purchasing/upload', {
          method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `Unable to upload ${file.name}`);
      }
      setNotice('File uploaded successfully.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Unable to upload file');
    } finally {
      setBusy('');
    }
  };

  const isSuperuser = data?.user.role === 'SUPERUSER';
  const assigned = (hotelCode: string, role: 'PURCHASER' | 'HOD') =>
    !!data?.access.some((row) => row.user_id === data.user.user_id && row.hotel_code === hotelCode && row.access_role === role);

  const visibleOrders = useMemo(() => {
    const orders = data?.orders || [];
    return orders.filter((order) => {
      if (hotelFilter !== 'ALL' && order.hotel_code !== hotelFilter) return false;
      return tab === 'HISTORY' ? terminalStatuses.has(order.status) : !terminalStatuses.has(order.status);
    });
  }, [data, hotelFilter, tab]);

  const profileById = useMemo(() => new Map((data?.profiles || []).map((p) => [p.user_id, p])), [data]);
  const actorName = (userId: string | null | undefined) => userId ? (profileById.get(userId)?.name || profileById.get(userId)?.email || 'User') : '—';

  if (loading && !data) return <main className={styles.page}><div className={styles.loading}>Loading Online Purchasing…</div></main>;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>MANAGEMENT WORKSPACE</div>
          <h1>Online Purchasing</h1>
          <p>Authorised orders, documents, reimbursements, and refunds in one accountable branch ledger.</p>
        </div>
        <button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Refresh</button>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={styles.balanceGrid} aria-label="Branch purchasing balances">
        {(data?.hotels || []).map((hotel) => {
          const used = Number(hotel.opening_float) - Number(hotel.available_balance);
          const percent = Math.min(100, Math.max(0, (used / Number(hotel.opening_float || 1)) * 100));
          return (
            <button key={hotel.code} className={`${styles.balanceCard} ${hotelFilter === hotel.code ? styles.selectedCard : ''}`} onClick={() => setHotelFilter(hotelFilter === hotel.code ? 'ALL' : hotel.code)}>
              <span>{hotel.name}</span>
              <strong>{money(hotel.available_balance)}</strong>
              <small>Available from {money(hotel.opening_float)}</small>
              <i><b style={{ width: `${percent}%` }} /></i>
            </button>
          );
        })}
      </section>

      <nav className={styles.tabs} aria-label="Online Purchasing sections">
        <button className={tab === 'ACTIVE' ? styles.activeTab : ''} onClick={() => setTab('ACTIVE')}>Active orders</button>
        <button className={tab === 'HISTORY' ? styles.activeTab : ''} onClick={() => setTab('HISTORY')}>History</button>
        {isSuperuser ? <button className={tab === 'TEAM' ? styles.activeTab : ''} onClick={() => setTab('TEAM')}>Team access</button> : null}
        <select value={hotelFilter} onChange={(event) => setHotelFilter(event.target.value)} aria-label="Filter by hotel">
          <option value="ALL">All hotels</option>
          {(data?.hotels || []).map((hotel) => <option key={hotel.code} value={hotel.code}>{hotel.name}</option>)}
        </select>
      </nav>

      {tab === 'TEAM' && isSuperuser ? (
        <TeamAccess data={data!} busy={busy} profileById={profileById} onChange={async (userId, hotelCode, accessRole, enabled) => {
          setBusy(`ACCESS:${userId}:${hotelCode}:${accessRole}`);
          setError('');
          try {
            const token = await accessToken();
            const response = await fetch('/api/online-purchasing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ action: 'SET_ACCESS', user_id: userId, hotel_code: hotelCode, access_role: accessRole, enabled }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json.error || 'Unable to update access');
            await load();
          } catch (err: any) { setError(err?.message || 'Unable to update access'); }
          finally { setBusy(''); }
        }} />
      ) : (
        <>
          {isSuperuser && tab === 'ACTIVE' ? (
            <section className={styles.createPanel}>
              <div><div className={styles.eyebrow}>SUPERUSER AUTHORISATION</div><h2>Create purchase order</h2><p>The Shopee link and selected hotel are the approved instruction to purchase.</p></div>
              <div className={styles.createFields}>
                <label>Hotel<select value={newHotel} onChange={(e) => setNewHotel(e.target.value)}>{data?.hotels.map((h) => <option key={h.code} value={h.code}>{h.name}</option>)}</select></label>
                <label>Shopee link<input type="url" value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://shopee.com.my/…" /></label>
                <button className={styles.primaryButton} disabled={!newHotel || !newLink.trim() || !!busy} onClick={async () => {
                  if (await runAction('CREATE_ORDER', undefined, { hotel_code: newHotel, shopee_url: newLink.trim() })) setNewLink('');
                }}>Create order</button>
              </div>
            </section>
          ) : null}

          <section className={styles.orderSection}>
            <div className={styles.sectionHeading}><div><h2>{tab === 'HISTORY' ? 'Completed history' : 'Orders requiring action'}</h2><p>{visibleOrders.length} order{visibleOrders.length === 1 ? '' : 's'}</p></div></div>
            {visibleOrders.length === 0 ? <div className={styles.empty}>No orders in this view.</div> : (
              <div className={styles.orders}>
                {visibleOrders.map((order) => {
                  const hotel = data?.hotels.find((item) => item.code === order.hotel_code);
                  const purchaser = assigned(order.hotel_code, 'PURCHASER');
                  const hod = assigned(order.hotel_code, 'HOD');
                  const invoices = order.online_purchase_documents.filter((d) => d.document_type === 'E_INVOICE');
                  const photos = order.online_purchase_documents.filter((d) => d.document_type !== 'E_INVOICE');
                  return (
                    <article key={order.id} className={`${styles.orderCard} ${styles[`status_${order.status}`] || ''}`}>
                      <div className={styles.orderTop}>
                        <div><span className={styles.orderNumber}>OP-{String(order.purchase_number).padStart(6, '0')}</span><h3>{hotel?.name || order.hotel_code}</h3><small>{hotel?.legal_entity}</small></div>
                        <span className={styles.status}>{statusLabels[order.status] || order.status}</span>
                      </div>
                      <div className={styles.orderFacts}>
                        <div><span>Created</span><strong>{dateTime(order.created_at)}</strong></div>
                        <div><span>Purchased amount</span><strong>{order.purchase_amount ? money(order.purchase_amount) : 'Not entered'}</strong></div>
                        {order.refund_amount ? <div><span>Refunded</span><strong>{money(order.refund_amount)}</strong></div> : null}
                      </div>
                      <a className={styles.shopeeLink} href={order.shopee_url} target="_blank" rel="noreferrer">Open approved Shopee item ↗</a>

                      {order.online_purchase_documents.length ? <div className={styles.documents}>{order.online_purchase_documents.map((doc) => doc.url ? <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer">{doc.document_type === 'E_INVOICE' ? 'PDF' : 'Photo'} · {doc.file_name}</a> : null)}</div> : null}

                      <div className={styles.actions}>
                        {order.status === 'AWAITING_PURCHASE' && purchaser ? <div className={styles.inlineAction}><label>Total purchased amount (RM)<input inputMode="decimal" value={amounts[order.id] || ''} onChange={(e) => setAmounts((current) => ({ ...current, [order.id]: e.target.value }))} placeholder="0.00" /></label><button className={styles.primaryButton} disabled={!!busy} onClick={() => void runAction('SAVE_PURCHASE', order.id, { amount: amounts[order.id] })}>Save purchase</button></div> : null}
                        {order.status === 'AWAITING_PURCHASE' && isSuperuser ? <button className={styles.dangerButton} disabled={!!busy} onClick={() => window.confirm('Cancel this unpurchased order?') && void runAction('CANCEL_ORDER', order.id)}>Cancel order</button> : null}
                        {order.status === 'PURCHASED_IN_TRANSIT' && purchaser ? <button className={styles.primaryButton} disabled={!!busy} onClick={() => void runAction('MARK_ARRIVED', order.id)}>Mark arrived</button> : null}
                        {order.status === 'ARRIVED_INVOICE_PENDING' && purchaser ? <>
                          <label className={styles.uploadButton}>Upload e-Invoice PDF<input type="file" accept="application/pdf" onChange={(e) => void uploadFiles(order.id, 'E_INVOICE', e.target.files)} /></label>
                          <label className={styles.uploadButton}>Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void uploadFiles(order.id, 'PHOTO', e.target.files)} /></label>
                          <button className={styles.primaryButton} disabled={!invoices.length || !!busy} onClick={() => void runAction('SUBMIT_DOCUMENTS', order.id)}>Submit for reimbursement</button>
                        </> : null}
                        {order.status === 'PENDING_REIMBURSEMENT' && hod ? <button className={styles.successButton} disabled={!!busy} onClick={() => window.confirm(`Confirm ${money(order.purchase_amount)} has been reimbursed?`) && void runAction('COMPLETE_CLAIM', order.id)}>Complete &amp; Claimed</button> : null}
                        {['PURCHASED_IN_TRANSIT','ARRIVED_INVOICE_PENDING','PENDING_REIMBURSEMENT'].includes(order.status) && purchaser ? <button className={styles.warningButton} onClick={() => { setRefundOrder(refundOrder === order.id ? null : order.id); setRefundAmount(order); }}>Lost / defective</button> : null}
                        {tab === 'HISTORY' && isSuperuser ? <button className={styles.dangerButton} disabled={!!busy} onClick={() => {
                          const orderNumber = `OP-${String(order.purchase_number).padStart(6, '0')}`;
                          if (window.confirm(`Permanently delete ${orderNumber} and its uploaded documents, ledger entries, and history? This cannot be undone.`)) {
                            void runAction('DELETE_ORDER', order.id);
                          }
                        }}>Delete history</button> : null}
                      </div>

                      {refundOrder === order.id ? <div className={styles.refundPanel}>
                        <h4>Refund follow-up</h4>
                        <div className={styles.refundFields}><label>Issue<select value={refundType} onChange={(e) => setRefundType(e.target.value)}><option value="LOST">Lost</option><option value="DEFECTIVE">Defective</option><option value="OTHER">Other</option></select></label><label>Remark (optional)<input value={refundRemark} onChange={(e) => setRefundRemark(e.target.value)} /></label><button className={styles.warningButton} onClick={async () => { if (await runAction('START_REFUND', order.id, { issue_type: refundType, remark: refundRemark })) { setRefundOrder(null); setRefundRemark(''); } }}>Mark pending refund</button></div>
                      </div> : null}

                      {order.status === 'REFUND_PENDING' && purchaser ? <div className={styles.refundPanel}>
                        <p><strong>{order.refund_issue_type}</strong>{order.refund_remark ? ` · ${order.refund_remark}` : ''}</p>
                        <div className={styles.actions}><label className={styles.uploadButton}>Add refund photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void uploadFiles(order.id, 'REFUND_PHOTO', e.target.files)} /></label><label>Refund received (RM)<input inputMode="decimal" value={refundAmounts[order.id] ?? String(order.purchase_amount || '')} onChange={(e) => setRefundAmounts((current) => ({ ...current, [order.id]: e.target.value }))} /></label><button className={styles.successButton} onClick={() => window.confirm('Confirm the refund has been received?') && void runAction('COMPLETE_REFUND', order.id, { amount: refundAmounts[order.id] || order.purchase_amount })}>Refund completed</button></div>
                      </div> : null}

                      <div className={styles.timeline}>
                        Created by {actorName(order.created_by)} · {dateTime(order.created_at)}
                        {order.purchased_at ? ` · Purchased by ${actorName(order.purchased_by)} at ${dateTime(order.purchased_at)}` : ''}
                        {order.invoice_submitted_at ? ` · Submitted by ${actorName(order.invoice_submitted_by)} at ${dateTime(order.invoice_submitted_at)}` : ''}
                        {order.reimbursed_at ? ` · Claimed by ${actorName(order.reimbursed_by)} at ${dateTime(order.reimbursed_at)}` : ''}
                        {order.refund_completed_at ? ` · Refund recorded by ${actorName(order.refund_completed_by)} at ${dateTime(order.refund_completed_at)}` : ''}
                      </div>
                      {!purchaser && !hod && !isSuperuser ? <div className={styles.readOnly}>View only for this hotel.</div> : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );

  function setRefundAmount(order: Order) {
    setRefundAmounts((current) => current[order.id] ? current : ({ ...current, [order.id]: String(order.purchase_amount || '') }));
  }
}

function TeamAccess({ data, busy, profileById, onChange }: { data: Payload; busy: string; profileById: Map<string, Profile>; onChange: (userId: string, hotelCode: string, role: 'PURCHASER' | 'HOD', enabled: boolean) => Promise<void> }) {
  const accessSet = new Set(data.access.map((row) => `${row.user_id}:${row.hotel_code}:${row.access_role}`));
  return <section className={styles.teamPanel}>
    <div className={styles.sectionHeading}><div><div className={styles.eyebrow}>SUPERUSER ONLY</div><h2>Purchaser and HOD access</h2><p>Page access is granted in Admin Settings. Assign the hotel actions each authorised user may perform here.</p></div></div>
    <div className={styles.teamList}>{data.profiles.map((profile) => <article key={profile.user_id} className={styles.teamCard}>
      <div className={styles.person}><strong>{profile.name || profile.email}</strong><span>{profile.email}</span></div>
      <div className={styles.hotelRoles}>{data.hotels.map((hotel) => <div key={hotel.code} className={styles.hotelRoleRow}><span>{hotel.name}</span>{(['PURCHASER','HOD'] as const).map((role) => {
        const key = `${profile.user_id}:${hotel.code}:${role}`;
        const enabled = accessSet.has(key);
        return <button key={role} className={enabled ? styles.roleEnabled : styles.roleButton} disabled={busy === `ACCESS:${key}`} onClick={() => void onChange(profile.user_id, hotel.code, role, !enabled)}>{role === 'PURCHASER' ? 'Purchaser' : 'HOD'} {enabled ? '✓' : '+'}</button>;
      })}</div>)}</div>
    </article>)}</div>
  </section>;
}
