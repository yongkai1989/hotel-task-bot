'use client';

import { useEffect, useState } from 'react';

type LanguageCode = 'en' | 'ms' | 'zh';

type OrderStatus = {
  id: string;
  room_number: string;
  guest_name: string;
  status: string;
  payment_reference: string;
  total_myr: number;
  items_json: any[];
  paid_at: string | null;
};

type OrderedItem = {
  key: string;
  name: string;
  options: string;
  instructions: string;
  quantity: number;
  lineTotal: number;
};

const COPY: Record<LanguageCode, Record<string, string>> = {
  en: {
    hotel: 'Hallmark Crown Hotel',
    paymentVerified: 'Payment verified',
    paymentVerifiedBody: 'Your order has been received by Front Office.',
    paymentFailed: 'Payment not completed',
    paymentFailedBody: 'No confirmed order was released. Please try again or contact Front Office.',
    confirmingPayment: 'Confirming payment',
    confirmingPaymentBody: 'We are waiting for the payment confirmation from Billplz. This usually takes a moment.',
    checkingPayment: 'Checking payment',
    checkingPaymentBody: 'Please wait while we verify your order.',
    nextStep: 'Next step',
    nextStepBody: 'Press Send to Front Desk to send your order details to our team.',
    room: 'Room',
    guest: 'Guest',
    total: 'Total',
    paymentRef: 'Payment Ref',
    itemsOrdered: 'Items ordered',
    item: 'item',
    items: 'items',
    noItemDetails: 'No item details available',
    note: 'Note',
    sendDesk: 'Send to Front Desk',
    backShop: 'Back to shop',
    missingOrder: 'Missing order reference.',
    unableLoadOrder: 'Unable to load order status',
    unableLoadPayment: 'Unable to load payment status',
  },
  ms: {
    hotel: 'Hallmark Crown Hotel',
    paymentVerified: 'Bayaran disahkan',
    paymentVerifiedBody: 'Pesanan anda telah diterima oleh Front Office.',
    paymentFailed: 'Bayaran tidak lengkap',
    paymentFailedBody: 'Tiada pesanan yang disahkan. Sila cuba lagi atau hubungi Front Office.',
    confirmingPayment: 'Mengesahkan bayaran',
    confirmingPaymentBody: 'Kami sedang menunggu pengesahan bayaran daripada Billplz. Ini biasanya mengambil sedikit masa.',
    checkingPayment: 'Menyemak bayaran',
    checkingPaymentBody: 'Sila tunggu sementara kami mengesahkan pesanan anda.',
    nextStep: 'Langkah seterusnya',
    nextStepBody: 'Tekan Hantar ke Front Desk untuk menghantar butiran pesanan kepada pasukan kami.',
    room: 'Bilik',
    guest: 'Tetamu',
    total: 'Jumlah',
    paymentRef: 'Rujukan Bayaran',
    itemsOrdered: 'Item dipesan',
    item: 'item',
    items: 'item',
    noItemDetails: 'Butiran item tidak tersedia',
    note: 'Nota',
    sendDesk: 'Hantar ke Front Desk',
    backShop: 'Kembali ke kedai',
    missingOrder: 'Rujukan pesanan tiada.',
    unableLoadOrder: 'Tidak dapat memuat status pesanan',
    unableLoadPayment: 'Tidak dapat memuat status bayaran',
  },
  zh: {
    hotel: 'Hallmark Crown Hotel',
    paymentVerified: '付款已确认',
    paymentVerifiedBody: '您的订单已发送给前台。',
    paymentFailed: '付款未完成',
    paymentFailedBody: '订单尚未确认。请重试或联系前台。',
    confirmingPayment: '正在确认付款',
    confirmingPaymentBody: '我们正在等待 Billplz 的付款确认，通常只需片刻。',
    checkingPayment: '正在检查付款',
    checkingPaymentBody: '请稍候，我们正在确认您的订单。',
    nextStep: '下一步',
    nextStepBody: '请点击“发送至前台”，把订单资料发送给酒店团队。',
    room: '房号',
    guest: '住客',
    total: '总额',
    paymentRef: '付款编号',
    itemsOrdered: '已订商品',
    item: '件商品',
    items: '件商品',
    noItemDetails: '暂无商品详情',
    note: '备注',
    sendDesk: '发送至前台',
    backShop: '返回商店',
    missingOrder: '缺少订单编号。',
    unableLoadOrder: '无法读取订单状态',
    unableLoadPayment: '无法读取付款状态',
  },
};

function itemWord(language: LanguageCode, count: number) {
  if (language === 'zh') return COPY.zh.items;
  return count === 1 ? COPY[language].item : COPY[language].items;
}

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusCopy(status: string, language: LanguageCode) {
  const t = COPY[language];
  if (status === 'PAID' || status === 'FULFILLED') {
    return {
      title: t.paymentVerified,
      body: t.paymentVerifiedBody,
      tone: 'success',
    };
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    return {
      title: t.paymentFailed,
      body: t.paymentFailedBody,
      tone: 'danger',
    };
  }

  return {
    title: t.confirmingPayment,
    body: t.confirmingPaymentBody,
    tone: 'pending',
  };
}

function orderItemSummary(items: any[]) {
  if (!Array.isArray(items) || !items.length) return 'No item details';

  return items
    .map((item) => {
      const quantity = Number(item?.quantity || item?.qty || 1);
      const name = String(item?.name || item?.item_name || 'Item');
      const options = optionSummary(item);
      const instructions = String(item?.special_instructions || '').trim();
      return `${quantity}x ${name}${options ? ` (${options})` : ''}${instructions ? ` - Note: ${instructions}` : ''}`;
    })
    .join(', ');
}

function optionSummary(item: any) {
  if (!Array.isArray(item?.selected_options)) return '';
  return item.selected_options
    .flatMap((group: any) =>
      Array.isArray(group?.options)
        ? group.options.map((option: any) => String(option?.name || '').trim()).filter(Boolean)
        : []
    )
    .join(', ');
}

function orderItems(items: any[]): OrderedItem[] {
  if (!Array.isArray(items)) return [];

  return items.map((item, index): OrderedItem => {
    const key = `${String(item?.id || item?.name || 'item')}-${index}`;
    const name = String(item?.name || item?.item_name || 'Item');
    const options = optionSummary(item);
    const instructions = String(item?.special_instructions || '').trim();
    const quantity = Number(item?.quantity || item?.qty || 1);
    const lineTotal = Number(item?.line_total_myr || 0);

    return { key, name, options, instructions, quantity, lineTotal };
  });
}

function whatsappMessage(order: OrderStatus | null) {
  if (!order) {
    return 'Hello Front Office, I need assistance with my Guest Shop order.';
  }

  const status = String(order.status || 'PENDING_PAYMENT');
  const items = orderItemSummary(order.items_json);

  if (status === 'PAID' || status === 'FULFILLED') {
    return [
      'Hello Front Office, my Guest Shop payment is successful.',
      `Room: ${order.room_number || '-'}`,
      `Guest: ${order.guest_name || '-'}`,
      `Items: ${items}`,
      `Total: ${money(order.total_myr)}`,
      `Payment Ref: ${order.payment_reference || '-'}`,
      'Kindly assist to prepare my order. Thank you.',
    ].join('\n');
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    return [
      'Hello Front Office, I would like to order from the Guest Shop but my payment has failed.',
      `Room: ${order.room_number || '-'}`,
      `Guest: ${order.guest_name || '-'}`,
      `Items: ${items}`,
      `Total: ${money(order.total_myr)}`,
      `Payment Ref: ${order.payment_reference || '-'}`,
      'Kindly assist me. Thank you.',
    ].join('\n');
  }

  return [
    'Hello Front Office, I need help checking my Guest Shop payment status.',
    `Room: ${order.room_number || '-'}`,
    `Guest: ${order.guest_name || '-'}`,
    `Items: ${items}`,
    `Total: ${money(order.total_myr)}`,
    `Payment Ref: ${order.payment_reference || '-'}`,
    'The page is still showing payment confirmation pending.',
  ].join('\n');
}

function whatsappUrl(order: OrderStatus | null) {
  return `https://wa.me/60126308316?text=${encodeURIComponent(whatsappMessage(order))}`;
}

export default function GuestShopPaymentStatusPage() {
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    setOrderId(new URLSearchParams(window.location.search).get('order_id') || '');
    const saved = window.localStorage.getItem('guestShopLanguage') as LanguageCode | null;
    if (saved === 'en' || saved === 'ms' || saved === 'zh') setLanguage(saved);
  }, []);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loadStatus() {
      if (orderId === null) return;

      if (!orderId) {
        setError(COPY[language].missingOrder);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/guest-shop/order-status?order_id=${encodeURIComponent(orderId)}`, {
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;

        if (!res.ok || !json?.ok) throw new Error(json?.error || COPY[language].unableLoadOrder);

        setOrder(json.order);
        setError('');
        setLoading(false);

        const status = String(json.order?.status || '');
        if (status === 'PENDING_PAYMENT' && attempts < 8) {
          attempts += 1;
          timer = setTimeout(loadStatus, 2500);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(err?.message || COPY[language].unableLoadPayment);
        setLoading(false);
      }
    }

    if (orderId !== null) loadStatus();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, language]);

  const t = COPY[language];
  const copy = statusCopy(order?.status || 'PENDING_PAYMENT', language);
  const orderedItems = orderItems(order?.items_json || []);
  const shouldSendToDesk =
    order?.status === 'PAID' || order?.status === 'FULFILLED' || order?.status === 'PENDING_PAYMENT';

  return (
    <main className="status-page">
      <section className="status-card">
        <div className={`status-orb ${copy.tone}`} aria-hidden="true">
          {copy.tone === 'success' ? 'OK' : copy.tone === 'danger' ? '!' : '...'}
        </div>

        <p className="eyebrow">{t.hotel}</p>
        <h1>{loading ? t.checkingPayment : copy.title}</h1>
        <p>{loading ? t.checkingPaymentBody : copy.body}</p>

        {!loading && shouldSendToDesk ? (
          <div className="next-step">
            <strong>{t.nextStep}</strong>
            <span>{t.nextStepBody}</span>
          </div>
        ) : null}

        {error ? <div className="message error">{error}</div> : null}

        {order ? (
          <>
            <div className="receipt">
              <div>
                <span>{t.room}</span>
                <strong>{order.room_number || '-'}</strong>
              </div>
              <div>
                <span>{t.guest}</span>
                <strong>{order.guest_name || '-'}</strong>
              </div>
              <div>
                <span>{t.total}</span>
                <strong>{money(order.total_myr)}</strong>
              </div>
              <div>
                <span>{t.paymentRef}</span>
                <strong>{order.payment_reference || '-'}</strong>
              </div>
            </div>

            <div className="ordered-items">
              <div className="ordered-items-head">
                <span>{t.itemsOrdered}</span>
                <strong>{orderedItems.length} {itemWord(language, orderedItems.length)}</strong>
              </div>
              {orderedItems.length ? (
                orderedItems.map((item) => (
                  <div className="ordered-item" key={item.key}>
                    <span>
                      {item.quantity}x {item.name}
                      {item.options ? <small>{item.options}</small> : null}
                      {item.instructions ? <small>{t.note}: {item.instructions}</small> : null}
                    </span>
                    <strong>{item.lineTotal > 0 ? money(item.lineTotal) : '-'}</strong>
                  </div>
                ))
              ) : (
                <div className="ordered-item">
                  <span>{t.noItemDetails}</span>
                  <strong>-</strong>
                </div>
              )}
            </div>
          </>
        ) : null}

        <div className="actions">
          <a href={whatsappUrl(order)} target="_blank" rel="noopener noreferrer">
            {t.sendDesk}
          </a>
          <a href="/guest-shop">{t.backShop}</a>
        </div>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f4efe7;
        }

        .status-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          color: #16110d;
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
          background:
            radial-gradient(circle at 18% 18%, rgba(216, 178, 97, 0.18), transparent 30%),
            linear-gradient(135deg, #fffaf1 0%, #eef4f3 100%);
        }

        .status-card {
          width: min(100%, 560px);
          padding: 34px;
          border: 1px solid rgba(176, 137, 72, 0.28);
          border-radius: 30px;
          background: rgba(255, 255, 255, 0.88);
          box-shadow: 0 26px 70px rgba(43, 55, 82, 0.14);
          text-align: center;
        }

        .status-orb {
          width: 70px;
          height: 70px;
          margin: 0 auto 18px;
          display: grid;
          place-items: center;
          border-radius: 24px;
          font-size: 34px;
          font-weight: 900;
        }

        .status-orb.success {
          color: #047857;
          background: #dcfce7;
        }

        .status-orb.danger {
          color: #b91c1c;
          background: #fee2e2;
        }

        .status-orb.pending {
          color: #92400e;
          background: #fef3c7;
        }

        .eyebrow {
          margin: 0 0 8px;
          color: #9a6a2f;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        h1 {
          margin: 0;
          font-size: clamp(32px, 7vw, 54px);
          line-height: 1;
          letter-spacing: 0;
        }

        p {
          margin: 14px auto 0;
          max-width: 430px;
          color: #536174;
          font-size: 16px;
          line-height: 1.6;
        }

        .message {
          margin-top: 20px;
          padding: 14px;
          border-radius: 16px;
          font-weight: 800;
        }

        .message.error {
          color: #b91c1c;
          background: #fee2e2;
        }

        .next-step {
          display: grid;
          gap: 6px;
          margin: 20px auto 0;
          padding: 14px 16px;
          max-width: 430px;
          border: 1px solid rgba(176, 137, 72, 0.26);
          border-radius: 18px;
          color: #4a3519;
          background: linear-gradient(135deg, #fff8e8, #fffdf8);
          text-align: left;
        }

        .next-step strong {
          color: #9a6a2f;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .next-step span {
          color: #2f3846;
          font-size: 15px;
          font-weight: 800;
          line-height: 1.45;
        }

        .receipt {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 24px;
          text-align: left;
        }

        .receipt div {
          padding: 16px;
          border: 1px solid #eadfce;
          border-radius: 18px;
          background: #fffaf2;
        }

        .receipt span {
          display: block;
          color: #7b8798;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .receipt strong {
          display: block;
          margin-top: 6px;
          overflow-wrap: anywhere;
          font-size: 16px;
        }

        .ordered-items {
          margin-top: 12px;
          padding: 14px 16px;
          border: 1px solid #eadfce;
          border-radius: 20px;
          background: rgba(255, 250, 242, 0.82);
          text-align: left;
        }

        .ordered-items-head,
        .ordered-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .ordered-items-head {
          padding-bottom: 10px;
          border-bottom: 1px solid #eadfce;
        }

        .ordered-items-head span {
          color: #9a6a2f;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .ordered-items-head strong,
        .ordered-item strong {
          white-space: nowrap;
        }

        .ordered-item {
          padding-top: 10px;
          color: #263244;
          font-weight: 800;
        }

        .ordered-item small {
          display: block;
          margin-top: 4px;
          color: #9a6a2f;
          font-size: 12px;
          line-height: 1.35;
          font-weight: 800;
        }

        .actions {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 26px;
        }

        .actions a {
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 18px;
          border: 1px solid #d9c7aa;
          border-radius: 999px;
          color: #16110d;
          background: #fff;
          text-decoration: none;
          font-weight: 900;
        }

        .actions a:first-child {
          color: #fff;
          border-color: #16110d;
          background: #16110d;
        }

        @media (max-width: 520px) {
          .status-page {
            padding: 16px;
          }

          .status-card {
            padding: 24px 18px;
            border-radius: 24px;
          }

          .receipt {
            grid-template-columns: 1fr;
          }

          .ordered-items-head,
          .ordered-item {
            align-items: flex-start;
          }

          .actions a {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
