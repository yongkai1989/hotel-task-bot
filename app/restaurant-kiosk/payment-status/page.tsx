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
  print_status: string;
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
  const [ticketImageBusy, setTicketImageBusy] = useState(false);
  const [ticketImageMessage, setTicketImageMessage] = useState('');

  useEffect(() => {
    const nextOrderId = new URLSearchParams(window.location.search).get('order_id') || '';
    setOrderId(nextOrderId);

    if (!nextOrderId) {
      const timer = window.setTimeout(() => {
        window.location.href = '/restaurant-kiosk?mode=kiosk';
      }, 1200);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, []);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (orderId === null) return;
      if (!orderId) {
        setError('Missing order reference. Returning to kiosk menu...');
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
  const missingOrderReference = orderId === '';
  const printStatus = String(order?.print_status || 'NOT_QUEUED').toUpperCase();
  const isKioskPrintOrder = ['QUEUED', 'PRINTED', 'FAILED'].includes(printStatus);
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

  async function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to prepare QR image'));
      image.src = src;
    });
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines = 2
  ) {
    const words = text.split(/\s+/).filter(Boolean);
    let line = '';
    let lineCount = 0;
    for (let index = 0; index < words.length; index += 1) {
      const testLine = line ? `${line} ${words[index]}` : words[index];
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        lineCount += 1;
        line = words[index];
        if (lineCount >= maxLines - 1) break;
      } else {
        line = testLine;
      }
    }
    if (line && lineCount < maxLines) ctx.fillText(line, x, y);
    return y + lineHeight;
  }

  async function createTicketImageBlob() {
    if (!order || !qrUrl) throw new Error('Ticket is not ready yet.');

    const qrImage = await loadImage(qrUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to create ticket image.');

    const gradient = ctx.createLinearGradient(0, 0, 1080, 1500);
    gradient.addColorStop(0, '#fbf6eb');
    gradient.addColorStop(0.55, '#ffffff');
    gradient.addColorStop(1, '#eef4f8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1500);

    ctx.fillStyle = '#15120e';
    roundRect(ctx, 60, 60, 960, 1380, 54);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#dec79f';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#15120e';
    roundRect(ctx, 92, 92, 896, 270, 38);
    ctx.fillStyle = '#17130f';
    ctx.fill();

    ctx.fillStyle = '#d8ad58';
    ctx.font = '800 28px Arial';
    ctx.fillText('HALLMARK CROWN HOTEL', 132, 154);
    ctx.fillStyle = '#fff8ea';
    ctx.font = '700 68px Georgia';
    ctx.fillText('Buffet Breakfast Ticket', 132, 242);
    ctx.fillStyle = 'rgba(255, 248, 234, 0.76)';
    ctx.font = '600 28px Arial';
    ctx.fillText('Show this QR ticket at the restaurant counter.', 132, 304);

    roundRect(ctx, 330, 410, 420, 420, 38);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();
    ctx.strokeStyle = '#e0c99f';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.drawImage(qrImage, 372, 452, 336, 336);

    ctx.fillStyle = '#9b6428';
    ctx.font = '800 24px Arial';
    ctx.fillText('VOUCHER CODE', 385, 880);
    ctx.fillStyle = '#15120e';
    ctx.font = '800 40px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(order.voucher_code || '-', 540, 930);
    ctx.textAlign = 'left';

    const stats = [
      ['Room', order.room_number || '-'],
      ['Quantity', String(order.voucher_quantity || 1)],
      ['Total', money(order.total_myr)],
      ['Paid', formatDate(order.paid_at)],
    ];
    let statY = 990;
    stats.forEach((stat, index) => {
      const x = index % 2 === 0 ? 104 : 552;
      const y = statY + Math.floor(index / 2) * 122;
      roundRect(ctx, x, y, 424, 92, 24);
      ctx.fillStyle = '#fbf7ef';
      ctx.fill();
      ctx.strokeStyle = '#ead9bb';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '800 22px Arial';
      ctx.fillText(stat[0].toUpperCase(), x + 28, y + 34);
      ctx.fillStyle = '#15120e';
      ctx.font = '800 30px Arial';
      drawWrappedText(ctx, stat[1], x + 28, y + 68, 360, 32, 1);
    });

    ctx.fillStyle = '#15120e';
    ctx.font = '800 30px Arial';
    ctx.fillText('Order Details', 104, 1260);
    ctx.strokeStyle = '#ead9bb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(104, 1284);
    ctx.lineTo(976, 1284);
    ctx.stroke();

    let lineY = 1330;
    itemLines.slice(0, 5).forEach((item) => {
      ctx.fillStyle = '#15120e';
      ctx.font = '700 28px Arial';
      drawWrappedText(ctx, `${item.quantity}x ${item.name}`, 104, lineY, 640, 34, 1);
      ctx.textAlign = 'right';
      ctx.fillText(item.total ? money(item.total) : '-', 976, lineY);
      ctx.textAlign = 'left';
      lineY += 42;
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '600 22px Arial';
    ctx.fillText('Valid for one-time redemption after verified payment.', 104, 1410);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to export ticket image.'));
      }, 'image/png', 0.95);
    });
  }

  async function shareTicketImage() {
    if (!paid || !order) return;
    setTicketImageBusy(true);
    setTicketImageMessage('');
    try {
      const blob = await createTicketImageBlob();
      const fileName = `hallmark-breakfast-ticket-${order.room_number || 'guest'}-${order.voucher_code || 'qr'}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };

      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({
          files: [file],
          title: 'Hallmark Crown Hotel Breakfast Ticket',
          text: 'Please keep this breakfast ticket image for redemption.',
        });
        setTicketImageMessage('Ticket image is ready to send.');
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setTicketImageMessage('Ticket image downloaded. You may attach it to your email.');
      }
    } catch (err: any) {
      setTicketImageMessage(err?.message || 'Unable to prepare ticket image.');
    } finally {
      setTicketImageBusy(false);
    }
  }

  if (missingOrderReference) {
    return (
      <main className="statusPage">
        <section className="ticketCard pending">
          <div className="statusIcon">...</div>
          <p className="eyebrow">Hallmark Crown Hotel</p>
          <h1>Returning to kiosk</h1>
          <p className="lead">This payment page needs an order reference.</p>
          <div className="message">Missing order reference. Returning to kiosk menu...</div>
          <div className="actions">
            <a href="/restaurant-kiosk?mode=kiosk">Back to kiosk</a>
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
            background: linear-gradient(135deg, #fffaf1, #eef5f3);
          }
          .ticketCard {
            width: min(720px, 100%);
            border: 1px solid #e2ceb2;
            border-radius: 30px;
            padding: clamp(24px, 4vw, 44px);
            background: rgba(255, 255, 255, 0.92);
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
            background: #fff0bf;
            color: #9a5b12;
            font-weight: 900;
          }
          .eyebrow {
            margin: 0 0 10px;
            color: #9b6428;
            font-size: 12px;
            font-weight: 900;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }
          h1 {
            margin: 0;
            font-size: clamp(34px, 8vw, 60px);
            line-height: 0.95;
          }
          .lead {
            margin: 18px auto 0;
            max-width: 560px;
            color: #53627a;
            font-weight: 700;
            line-height: 1.5;
          }
          .message {
            margin-top: 24px;
            padding: 16px;
            border-radius: 16px;
            background: #fff7da;
            border: 1px solid #f3c86d;
            color: #9a5b12;
            font-weight: 900;
          }
          .actions {
            margin-top: 28px;
            display: flex;
            justify-content: center;
          }
          .actions a {
            display: inline-flex;
            justify-content: center;
            align-items: center;
            min-height: 52px;
            padding: 0 28px;
            border-radius: 999px;
            background: #15120e;
            color: #fffaf1;
            font-weight: 900;
            text-decoration: none;
          }
        `}</style>
      </main>
    );
  }

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
          {isKioskPrintOrder ? (
            <div className="printBox">
              <div>
                <small>Thermal Ticket</small>
                <p>
                  {printStatus === 'PRINTED'
                    ? 'Your QR ticket has been sent to the kiosk printer.'
                    : printStatus === 'FAILED'
                      ? 'The kiosk printer could not print this ticket. Please call staff for assistance.'
                      : 'Your QR ticket is being sent to the kiosk printer.'}
                </p>
              </div>
            </div>
          ) : (
          <div className="emailBox">
            <div>
              <small>Share Ticket</small>
              <p>Choose how you want to share the ticket.</p>
            </div>
            <button
              type="button"
              onClick={shareTicketImage}
              disabled={ticketImageBusy}
            >
              {ticketImageBusy ? 'Preparing image...' : 'Share Ticket Image'}
            </button>
            {ticketImageMessage ? <span className="imageMessage">{ticketImageMessage}</span> : null}
          </div>
          )}
          </>
        ) : null}

        {!paid && !failed ? (
          <div className="waitingBox">
            <strong>
              {missingOrderReference ? 'Returning to kiosk menu...' : loading ? 'Checking payment...' : 'Still pending'}
            </strong>
            <span>
              {missingOrderReference
                ? 'This page needs a payment reference.'
                : 'If this takes too long, please call Front Office staff for assistance.'}
            </span>
          </div>
        ) : null}

        <div className="actions">
          <a href={isKioskPrintOrder || missingOrderReference ? '/restaurant-kiosk?mode=kiosk' : '/restaurant-kiosk'}>
            {paid ? 'Buy another voucher' : 'Back to kiosk'}
          </a>
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
        .emailBox,
        .printBox {
          margin-top: 18px;
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
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
        .emailBox small,
        .printBox small {
          color: #9b6428;
        }
        .emailBox p,
        .printBox p {
          margin: 5px 0 0;
          color: #5f6678;
          font-weight: 750;
          line-height: 1.4;
        }
        .emailBox button {
          min-height: 52px;
          border-radius: 16px;
          padding: 0 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          background: #15120e;
          color: #fff8ea;
          font: inherit;
          font-weight: 950;
          white-space: nowrap;
        }
        .emailBox button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .imageMessage {
          grid-column: 1 / -1;
          color: #08733d;
          font-weight: 900;
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
          .emailBox,
          .printBox {
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
