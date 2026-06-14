'use client';

import { useEffect, useMemo, useState } from 'react';

type OrderStatus = {
  id: string;
  room_number: string;
  guest_name: string;
  status: string;
  payment_reference: string;
  total_myr: number;
  items_json: any[];
  paid_at: string | null;
  voucher_code: string;
  voucher_quantity: number;
  voucher_status: string;
};

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RestaurantKioskPaymentStatusPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [emailTo, setEmailTo] = useState('');

  useEffect(() => {
    setOrderId(new URLSearchParams(window.location.search).get('order_id') || '');
  }, []);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (orderId === null) return;
      if (!orderId) {
        setError('Missing order reference.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/guest-shop/order-status?order_id=${encodeURIComponent(orderId)}`, {
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Unable to load payment status');

        setOrder(json.order);
        setError('');
        setLoading(false);

        const status = String(json.order?.status || '');
        if (status === 'PENDING_PAYMENT' && attempts < 12) {
          attempts += 1;
          timer = setTimeout(load, 2500);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(err?.message || 'Unable to load payment status');
        setLoading(false);
      }
    }

    if (orderId !== null) load();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  const paid = order?.status === 'PAID' || order?.status === 'FULFILLED';
  const failed = order?.status === 'FAILED' || order?.status === 'CANCELLED';
  const qrPayload = order?.voucher_code || '';
  const itemLines = useMemo(() => {
    const rows = Array.isArray(order?.items_json) ? order?.items_json : [];
    if (rows.length) {
      return rows.map((item: any) => ({
        name: String(item?.name || 'Breakfast Voucher'),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        total: Number(item?.line_total_myr || 0),
      }));
    }
    if (!order) return [];
    return [{
      name: 'Breakfast Voucher',
      quantity: Math.max(1, Number(order.voucher_quantity || 1)),
      total: Number(order.total_myr || 0),
    }];
  }, [order]);
  const qrUrl = useMemo(
    () =>
      qrPayload
        ? `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=14&data=${encodeURIComponent(qrPayload)}`
        : '',
    [qrPayload]
  );
  const emailHref = useMemo(() => {
    if (!paid || !order) return '';
    const subject = `Hallmark Crown Hotel Breakfast Voucher - Room ${order.room_number || ''}`;
    const body = [
      'Hallmark Crown Hotel Breakfast Voucher',
      '',
      `Room: ${order.room_number || '-'}`,
      `Voucher Code: ${order.voucher_code || '-'}`,
      `Quantity: ${order.voucher_quantity || 1}`,
      `Total: ${money(order.total_myr)}`,
      `Payment Ref: ${order.payment_reference || '-'}`,
      '',
      'Order Details:',
      ...itemLines.map((item) => `- ${item.quantity}x ${item.name}${item.total ? ` (${money(item.total)})` : ''}`),
      '',
      'Please show the QR code or voucher code to our staff at the restaurant counter for redemption.',
      qrPayload ? `QR Code: ${qrUrl}` : '',
    ].filter(Boolean).join('\n');

    return `mailto:${encodeURIComponent(emailTo.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [emailTo, itemLines, order, paid, qrPayload, qrUrl]);

  return (
    <main className="statusPage">
      <section className={`ticketCard ${paid ? 'paid' : failed ? 'failed' : 'pending'}`}>
        <div className="statusIcon">{paid ? 'OK' : failed ? '!' : '...'}</div>
        <p className="eyebrow">Hallmark Crown Hotel</p>
        <h1>{paid ? 'Breakfast voucher ready' : failed ? 'Payment not completed' : 'Confirming payment'}</h1>
        <p className="lead">
          {paid
            ? 'Please keep this QR ticket. Show it to staff at the restaurant counter for redemption.'
            : failed
              ? 'No voucher was released. Please try again or call staff assistance.'
              : 'We are waiting for Billplz to confirm the payment.'}
        </p>

        {error ? <div className="message">{error}</div> : null}

        {paid && order ? (
          <>
          <div className="ticket">
            <div className="qrBox">
              {qrUrl ? <img src={qrUrl} alt="Breakfast voucher QR code" /> : <span>QR pending</span>}
            </div>
            <div className="ticketInfo">
              <span>Breakfast Voucher</span>
              <strong>{order.voucher_code || '-'}</strong>
              <div className="infoGrid">
                <div>
                  <small>Quantity</small>
                  <b>{order.voucher_quantity || 1}</b>
                </div>
                <div>
                  <small>Room</small>
                  <b>{order.room_number || '-'}</b>
                </div>
                <div>
                  <small>Paid</small>
                  <b>{formatDate(order.paid_at)}</b>
                </div>
                <div>
                  <small>Total</small>
                  <b>{money(order.total_myr)}</b>
                </div>
                <div>
                  <small>Payment Ref</small>
                  <b>{order.payment_reference || '-'}</b>
                </div>
              </div>
              <div className="breakdown">
                <small>Voucher Breakdown</small>
                {itemLines.map((item, index) => (
                  <div className="breakdownLine" key={`${item.name}-${index}`}>
                    <span>{item.quantity}x {item.name}</span>
                    <b>{item.total ? money(item.total) : '-'}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="emailBox">
            <div>
              <small>Optional email copy</small>
              <strong>Send ticket details to your email</strong>
            </div>
            <input
              type="email"
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
              placeholder="Enter email address"
            />
            <a
              className={!emailTo.trim() ? 'disabledLink' : ''}
              href={emailTo.trim() ? emailHref : undefined}
              onClick={(event) => {
                if (!emailTo.trim()) event.preventDefault();
              }}
            >
              Email me the ticket
            </a>
          </div>
          </>
        ) : null}

        {!paid && !failed ? (
          <div className="waitingBox">
            <strong>{loading ? 'Checking payment...' : 'Still pending'}</strong>
            <span>If this takes too long, please call Front Office staff for assistance.</span>
          </div>
        ) : null}

        <div className="actions">
          <a href="/restaurant-kiosk">{paid ? 'Buy another voucher' : 'Back to kiosk'}</a>
        </div>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f6efe6;
          color: #15120e;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .statusPage {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(circle at 13% 18%, rgba(48, 96, 62, 0.08), transparent 18%),
            radial-gradient(circle at 88% 84%, rgba(170, 93, 34, 0.07), transparent 20%),
            radial-gradient(circle at 80% 10%, rgba(230, 191, 104, 0.2), transparent 28%),
            linear-gradient(135deg, #fffaf1, #eef5f3);
        }
        .ticketCard {
          width: min(920px, 100%);
          border: 1px solid #e2ceb2;
          border-radius: 30px;
          padding: clamp(24px, 4vw, 44px);
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 28px 80px rgba(44, 34, 19, 0.15);
          text-align: center;
        }
        .statusIcon {
          width: 84px;
          height: 84px;
          margin: 0 auto 18px;
          display: grid;
          place-items: center;
          border-radius: 26px;
          font-weight: 950;
          background: #fff0bf;
          color: #9b5e11;
        }
        .paid .statusIcon {
          background: #d9fbe7;
          color: #08733d;
        }
        .failed .statusIcon {
          background: #ffe1e1;
          color: #b3121d;
        }
        .eyebrow {
          margin: 0 0 8px;
          color: #9b6428;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          font-size: clamp(38px, 6vw, 68px);
          line-height: 0.95;
          letter-spacing: 0;
        }
        .lead {
          max-width: 680px;
          margin: 18px auto 0;
          color: #5f6678;
          font-size: 18px;
          line-height: 1.5;
          font-weight: 700;
        }
        .message,
        .waitingBox {
          margin: 22px auto 0;
          max-width: 640px;
          border-radius: 18px;
          padding: 16px;
          background: #fff1f1;
          border: 1px solid #ffc7c7;
          color: #b3121d;
          font-weight: 900;
        }
        .waitingBox {
          display: grid;
          gap: 5px;
          color: #9b6428;
          background: #fff7df;
          border-color: #edd292;
        }
        .ticket {
          margin-top: 28px;
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 24px;
          text-align: left;
          align-items: stretch;
        }
        .qrBox {
          border-radius: 26px;
          border: 1px dashed #d9bd8c;
          background: #fffaf1;
          display: grid;
          place-items: center;
          padding: 20px;
        }
        .qrBox img {
          width: 100%;
          height: auto;
          border-radius: 18px;
        }
        .ticketInfo {
          border-radius: 26px;
          padding: 24px;
          background: linear-gradient(135deg, #15120e, #2d261f);
          color: #fff8ea;
        }
        .ticketInfo > span {
          color: #d9b35c;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .ticketInfo > strong {
          display: block;
          margin-top: 12px;
          font-size: 30px;
          overflow-wrap: anywhere;
        }
        .infoGrid {
          margin-top: 22px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .infoGrid div {
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 12px;
        }
        small {
          display: block;
          color: rgba(255, 248, 234, 0.62);
          font-weight: 900;
          margin-bottom: 5px;
        }
        b {
          overflow-wrap: anywhere;
        }
        .breakdown {
          margin-top: 18px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.08);
          padding: 14px;
        }
        .breakdownLine {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          color: #fff8ea;
          font-weight: 850;
        }
        .breakdownLine + .breakdownLine {
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }
        .emailBox {
          margin-top: 18px;
          display: grid;
          grid-template-columns: minmax(180px, 1fr) minmax(220px, 1fr) auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #e2ceb2;
          border-radius: 22px;
          background: #fffaf1;
          padding: 14px;
          text-align: left;
        }
        .emailBox strong {
          display: block;
          color: #15120e;
          font-size: 16px;
        }
        .emailBox small {
          color: #9b6428;
        }
        .emailBox input {
          min-height: 52px;
          border-radius: 16px;
          border: 1px solid #d7bf98;
          background: #fffdf8;
          padding: 0 14px;
          color: #15120e;
          font: inherit;
          font-weight: 800;
        }
        .emailBox a {
          min-height: 52px;
          border-radius: 16px;
          padding: 0 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #15120e;
          color: #fff8ea;
          text-decoration: none;
          font-weight: 950;
          white-space: nowrap;
        }
        .emailBox a.disabledLink {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .actions {
          margin-top: 28px;
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .actions button,
        .actions a {
          min-height: 54px;
          border-radius: 999px;
          padding: 0 26px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #d7bf98;
          background: #15120e;
          color: #fff;
          text-decoration: none;
          font: inherit;
          font-weight: 950;
        }
        .actions a {
          background: #fffaf1;
          color: #15120e;
        }
        @media (max-width: 760px) {
          .statusPage {
            padding: 10px;
            place-items: start center;
          }
          .ticketCard {
            border-radius: 22px;
            padding: 18px;
          }
          .statusIcon {
            width: 58px;
            height: 58px;
            border-radius: 18px;
            margin-bottom: 12px;
          }
          h1 {
            font-size: clamp(34px, 10vw, 48px);
          }
          .lead {
            margin-top: 12px;
            font-size: 15px;
          }
          .ticket {
            grid-template-columns: 1fr;
            margin-top: 18px;
            gap: 14px;
          }
          .qrBox {
            max-width: 230px;
            margin: 0 auto;
            border-radius: 20px;
            padding: 14px;
          }
          .ticketInfo {
            border-radius: 20px;
            padding: 18px;
          }
          .ticketInfo > strong {
            font-size: 22px;
          }
          .infoGrid {
            grid-template-columns: 1fr;
            gap: 8px;
            margin-top: 14px;
          }
          .infoGrid div,
          .breakdown {
            border-radius: 14px;
            padding: 10px;
          }
          .emailBox {
            grid-template-columns: 1fr;
            border-radius: 18px;
            padding: 12px;
          }
          .actions {
            margin-top: 18px;
          }
          .actions a {
            width: 100%;
          }
        }
        @media print {
          :global(body) {
            background: #fff;
          }
          .statusPage {
            min-height: auto;
            padding: 0;
            background: #fff;
          }
          .ticketCard {
            box-shadow: none;
            border: 0;
            padding: 12mm;
          }
          .actions,
          .lead {
            display: none;
          }
          .ticket {
            grid-template-columns: 280px 1fr;
          }
        }
      `}</style>
    </main>
  );
}
