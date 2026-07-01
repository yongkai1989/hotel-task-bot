'use client';

import { useEffect, useMemo, useState } from 'react';

type VoucherType = {
  id: string;
  name: string;
  description: string;
  price_myr: number;
  is_active: boolean;
};

type CartMap = Record<string, number>;

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'BV';
}

function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatEntryDate(value: string) {
  if (!value) return '-';
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function cartKey(entryDate: string, typeId: string) {
  return `${entryDate}__${typeId}`;
}

export default function RestaurantKioskPage() {
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
  const [cart, setCart] = useState<CartMap>({});
  const [entryDate, setEntryDate] = useState(todayIso());
  const [roomNumber, setRoomNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssist, setShowAssist] = useState(false);
  const [printMode, setPrintMode] = useState(false);

  const cartLines = useMemo(() => {
    const lines: Array<{ key: string; entryDate: string; type: VoucherType; quantity: number }> = [];

    Object.entries(cart).forEach(([key, quantity]) => {
      const [date, typeId] = key.split('__');
      const type = voucherTypes.find((row) => row.id === typeId);
      const cleanQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
      if (!type || !cleanQuantity) return;

      lines.push({
        key,
        entryDate: date,
        type,
        quantity: cleanQuantity,
      });
    });

    return lines;
  }, [cart, voucherTypes]);
  const totalQuantity = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = cartLines.reduce(
    (sum, line) => sum + line.quantity * Number(line.type.price_myr || 0),
    0
  );
  const lowestPrice = voucherTypes.reduce((lowest, type) => {
    const price = Number(type.price_myr || 0);
    if (!price) return lowest;
    return lowest === 0 ? price : Math.min(lowest, price);
  }, 0);

  useEffect(() => {
    setPrintMode(new URLSearchParams(window.location.search).get('mode') === 'kiosk');
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadTypes() {
      try {
        const res = await fetch('/api/restaurant-kiosk/voucher-types', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        const types = Array.isArray(json?.types) ? json.types : [];
        setVoucherTypes(types);
      } catch {
        if (!alive) return;
        setVoucherTypes([
          {
            id: 'default-breakfast',
            name: 'Breakfast Voucher',
            description: 'Breakfast pass redeemable at the restaurant counter.',
            price_myr: 20,
            is_active: true,
          },
        ]);
      }
    }
    loadTypes();
    return () => {
      alive = false;
    };
  }, []);

  function typeQuantity(typeId: string, date = entryDate) {
    return Math.max(0, Number(cart[cartKey(date, typeId)] || 0));
  }

  function setTypeQuantity(typeId: string, nextQuantity: number, date = entryDate) {
    setCart((current) => {
      const quantity = Math.max(0, Math.min(20, Math.floor(nextQuantity)));
      const key = cartKey(date, typeId);
      const next = { ...current };
      if (quantity <= 0) delete next[key];
      else next[key] = quantity;
      return next;
    });
  }

  async function pay() {
    setMessage('');

    if (!cartLines.length) {
      setMessage('Please add at least one breakfast voucher.');
      return;
    }

    if (!roomNumber.trim()) {
      setMessage('Please enter your room number before payment.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/restaurant-kiosk/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartLines.map((line) => ({
            voucherTypeId: line.type.id,
            entryDate: line.entryDate,
            quantity: line.quantity,
          })),
          roomNumber: roomNumber.trim(),
          printTicket: printMode,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.payment_url) {
        throw new Error(json?.error || 'Unable to start payment');
      }
      window.location.href = String(json.payment_url);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to start payment');
      setLoading(false);
    }
  }

  return (
    <main className="kiosk">
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Hallmark Crown Hotel</p>
          <h1>Buffet Breakfast Ticket</h1>
          <span>Purchase your breakfast ticket securely before entering the restaurant.</span>
        </div>
        <div className="priceCard">
          <span>From</span>
          <strong>{lowestPrice ? money(lowestPrice) : 'Select'}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="panel product">
          <div className="menuArea">
            <div className="sectionHead">
              <p className="eyebrow">Voucher Menu</p>
              <h2>Choose quantity</h2>
            </div>
            <label className="dateCard">
              Breakfast date
              <input
                type="date"
                min={todayIso()}
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value || todayIso())}
              />
              <span>Tickets are valid only on the selected date.</span>
            </label>

            <div className="typeGrid">
              {voucherTypes.map((type) => {
                const quantity = typeQuantity(type.id);
                return (
                  <article className={quantity > 0 ? 'typeCard active' : 'typeCard'} key={type.id}>
                    <div className="typeBadge">{initials(type.name)}</div>
                    <div className="typeInfo">
                      <h3>{type.name}</h3>
                      {type.description ? <p>{type.description}</p> : null}
                      <strong>{money(type.price_myr)}</strong>
                    </div>
                    <div className="qtyRow" aria-label={`${type.name} quantity`}>
                      <button type="button" onClick={() => setTypeQuantity(type.id, quantity - 1)} disabled={quantity <= 0}>
                        -
                      </button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => setTypeQuantity(type.id, quantity + 1)}>
                        +
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <div className="panel checkout">
          <p className="eyebrow">Your cart</p>
          <h2>{totalQuantity ? `${totalQuantity} voucher${totalQuantity === 1 ? '' : 's'}` : 'No voucher selected'}</h2>

          <div className="cartList">
            {cartLines.length ? (
              cartLines.map((line) => (
                <div className="cartLine" key={line.key}>
                  <div>
                    <strong>{line.quantity}x {line.type.name}</strong>
                    <em>{formatEntryDate(line.entryDate)}</em>
                    <span>{money(line.type.price_myr)} each</span>
                  </div>
                  <b>{money(line.quantity * Number(line.type.price_myr || 0))}</b>
                </div>
              ))
            ) : (
              <div className="emptyCart">Tap + beside a voucher type to add it here.</div>
            )}
          </div>

          <label>
            Room number
            <input value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} placeholder="Enter room number" />
          </label>

          <div className="totalLine">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>

          <button className="payBtn" type="button" onClick={pay} disabled={loading || !cartLines.length}>
            {loading ? 'Opening payment...' : 'Pay with TNG'}
          </button>
          {printMode ? (
            <div className="printNotice">
              <strong>Thermal ticket will print after successful payment.</strong>
              <span>The guest does not need to share or email the QR code from this kiosk.</span>
            </div>
          ) : null}
          <button className="assistBtn" type="button" onClick={() => setShowAssist((value) => !value)}>
            I need staff assistance
          </button>

          {showAssist ? (
            <div className="assistBox">
              <strong>Please approach our friendly F&amp;B staff.</strong>
              <span>For guests who would like to use a credit card, our staff can assist with manual payment. We do not accept cash payments.</span>
            </div>
          ) : null}
          {message ? <div className="errorBox">{message}</div> : null}
        </div>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f7f2ea;
          color: #15120e;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .kiosk {
          min-height: 100vh;
          padding: 28px;
          background:
            linear-gradient(135deg, rgba(20, 25, 38, 0.04), transparent 34%),
            linear-gradient(180deg, #f7f9fc 0%, #f1f5f9 52%, #f8fafc 100%);
        }
        .hero {
          position: relative;
          overflow: hidden;
          min-height: 220px;
          border: 1px solid #d8e2ef;
          border-radius: 24px;
          padding: clamp(28px, 4vw, 52px);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 251, 255, 0.94) 58%, rgba(241, 246, 252, 0.96) 100%);
          color: #0f172a;
          box-shadow: 0 22px 70px rgba(15, 23, 42, 0.1);
        }
        .hero::before {
          content: "";
          position: absolute;
          inset: 0 0 auto;
          height: 7px;
          background: linear-gradient(90deg, #0f172a 0%, #c99a3d 45%, #2563eb 100%);
          pointer-events: none;
        }
        .hero::after {
          content: "";
          position: absolute;
          inset: 7px 0 auto;
          height: 1px;
          background: rgba(201, 154, 61, 0.26);
          pointer-events: none;
        }
        .hero > * {
          position: relative;
          z-index: 1;
        }
        .heroCopy {
          max-width: 760px;
        }
        .heroCopy span {
          display: block;
          max-width: 560px;
          margin-top: 12px;
          color: #64748b;
          font-size: clamp(15px, 1.5vw, 18px);
          font-weight: 650;
          line-height: 1.45;
        }
        .eyebrow {
          margin: 0 0 10px;
          color: #9a6a22;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          max-width: 760px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(46px, 6vw, 82px);
          line-height: 0.96;
          letter-spacing: 0;
        }
        .subcopy {
          max-width: 640px;
          margin: 22px 0 0;
          font-size: clamp(17px, 2vw, 23px);
          line-height: 1.45;
          color: rgba(255, 248, 234, 0.84);
        }
        .priceCard {
          min-width: 156px;
          padding: 16px 18px;
          border-radius: 18px;
          background: #0f172a;
          border: 1px solid rgba(15, 23, 42, 0.08);
          color: #fff;
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18);
        }
        .priceCard span {
          display: block;
          color: #d9b56a;
          font-weight: 800;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 11px;
        }
        .priceCard strong {
          font-size: 32px;
          line-height: 1;
        }
        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 420px;
          gap: 22px;
          margin-top: 22px;
          align-items: start;
        }
        .panel {
          border: 1px solid rgba(142, 104, 50, 0.2);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 20px 55px rgba(48, 40, 27, 0.11);
        }
        .product {
          padding: 20px;
          display: block;
        }
        .menuArea {
          min-width: 0;
          display: grid;
          gap: 14px;
        }
        .sectionHead h2 {
          margin: 0;
          font-size: 30px;
        }
        .dateCard {
          margin-top: 0;
          padding: 14px;
          border: 1px solid #d8e2ef;
          border-radius: 18px;
          background: linear-gradient(135deg, #ffffff, #f8fbff);
          color: #0f172a;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }
        .dateCard span {
          color: #64748b;
          font-size: 13px;
          font-weight: 800;
        }
        .typeGrid {
          display: grid;
          gap: 12px;
        }
        .typeCard {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          border-radius: 20px;
          border: 1px solid #e6d4b8;
          background: #fffaf1;
          padding: 14px;
          color: #15120e;
        }
        .typeCard.active {
          border-color: #c9972b;
          box-shadow: 0 12px 28px rgba(181, 132, 37, 0.18);
        }
        .typeBadge {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #fff4d9, #ead0a0);
          color: #9c641b;
          font-weight: 950;
          letter-spacing: 0;
        }
        .typeInfo {
          min-width: 0;
        }
        .typeInfo h3 {
          margin: 0;
          font-size: 18px;
          line-height: 1.2;
        }
        .typeInfo p {
          margin: 4px 0 6px;
          color: #6a5b48;
          font-weight: 750;
          line-height: 1.35;
        }
        .typeInfo strong {
          display: block;
          font-size: 24px;
        }
        .qtyRow {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          border-radius: 999px;
          background: #fffdf8;
          border: 1px solid #e6d4b8;
        }
        .qtyRow button {
          width: 44px;
          height: 44px;
          border: 0;
          border-radius: 999px;
          background: #15120e;
          color: #fff;
          font-size: 22px;
          font-weight: 900;
        }
        .qtyRow button:disabled {
          opacity: 0.32;
        }
        .qtyRow span {
          min-width: 32px;
          text-align: center;
          font-size: 24px;
          font-weight: 950;
        }
        .checkout {
          padding: 24px;
          position: sticky;
          top: 18px;
        }
        h2 {
          margin: 0 0 18px;
          font-size: 30px;
          line-height: 1.15;
        }
        .cartList {
          display: grid;
          gap: 10px;
          margin-bottom: 18px;
        }
        .cartLine,
        .emptyCart {
          border: 1px solid #e6d4b8;
          border-radius: 16px;
          background: #fffdf8;
          padding: 13px;
        }
        .cartLine {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
        }
        .cartLine strong,
        .cartLine span,
        .cartLine em {
          display: block;
        }
        .cartLine em {
          margin: 3px 0;
          color: #9a6a22;
          font-style: normal;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .cartLine span,
        .emptyCart {
          color: #6a5b48;
          font-weight: 800;
        }
        .cartLine b {
          white-space: nowrap;
        }
        label {
          display: grid;
          gap: 8px;
          margin-top: 14px;
          color: #6a5b48;
          font-weight: 900;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          min-height: 54px;
          border-radius: 16px;
          border: 1px solid #dfceb4;
          background: #fffdf8;
          padding: 0 16px;
          color: #15120e;
          font: inherit;
          font-weight: 800;
        }
        .totalLine {
          margin-top: 22px;
          padding-top: 20px;
          border-top: 1px solid #e7d9c4;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .totalLine span {
          color: #6a5b48;
          font-weight: 900;
        }
        .totalLine strong {
          font-size: 42px;
        }
        .payBtn,
        .assistBtn {
          width: 100%;
          min-height: 58px;
          margin-top: 14px;
          border-radius: 18px;
          border: 0;
          font: inherit;
          font-weight: 950;
        }
        .payBtn {
          background: linear-gradient(135deg, #f2d17a, #c9972b);
          color: #17130c;
          box-shadow: 0 16px 32px rgba(181, 132, 37, 0.28);
        }
        .payBtn:disabled {
          opacity: 0.55;
          box-shadow: none;
        }
        .assistBtn {
          background: #fffaf1;
          border: 1px solid #dfceb4;
          color: #15120e;
        }
        .assistBox,
        .errorBox,
        .printNotice {
          margin-top: 14px;
          border-radius: 16px;
          padding: 14px;
          display: grid;
          gap: 4px;
          font-weight: 800;
        }
        .assistBox {
          background: #eef8ff;
          border: 1px solid #b8dbff;
          color: #173d66;
        }
        .printNotice {
          background: #f1f8ee;
          border: 1px solid #c8e7bc;
          color: #25631f;
        }
        .errorBox {
          background: #fff1f1;
          border: 1px solid #ffc5c5;
          color: #b20d17;
        }
        @media (max-width: 980px) {
          .workspace {
            grid-template-columns: 1fr;
          }
          .checkout {
            position: static;
          }
        }
        @media (max-width: 760px) {
          .kiosk {
            padding: 10px;
          }
          .hero {
            min-height: 178px;
            border-radius: 18px;
            padding: 22px 18px 18px;
            align-items: flex-start;
            flex-direction: column;
            justify-content: space-between;
            gap: 16px;
          }
          h1 {
            max-width: 330px;
            font-size: clamp(34px, 10.5vw, 46px);
            line-height: 0.98;
          }
          .heroCopy span {
            max-width: 300px;
            margin-top: 8px;
            font-size: 13px;
            line-height: 1.35;
          }
          .eyebrow {
            margin-bottom: 8px;
            font-size: 10px;
            letter-spacing: 0.13em;
          }
          .workspace {
            gap: 10px;
            margin-top: 10px;
          }
          .panel {
            border-radius: 18px;
          }
          .priceCard {
            width: 100%;
            min-width: 0;
            align-self: stretch;
            box-sizing: border-box;
            padding: 10px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-radius: 14px;
          }
          .priceCard strong {
            font-size: 24px;
          }
          .priceCard span {
            margin: 0;
            font-size: 10px;
          }
          .product {
            padding: 10px;
          }
          .sectionHead h2,
          h2 {
            font-size: 24px;
          }
          .checkout {
            padding: 16px;
          }
          .typeCard {
            grid-template-columns: 42px minmax(0, 1fr) auto;
            padding: 10px;
            gap: 10px;
            border-radius: 16px;
          }
          .typeBadge {
            width: 42px;
            height: 42px;
            border-radius: 14px;
            font-size: 13px;
          }
          .typeInfo h3 {
            font-size: 15px;
          }
          .typeInfo p {
            font-size: 12px;
          }
          .typeInfo strong {
            font-size: 19px;
          }
          .qtyRow {
            grid-column: auto;
            gap: 6px;
            padding: 5px;
          }
          .qtyRow button {
            width: 34px;
            height: 34px;
            font-size: 18px;
          }
          .qtyRow span {
            min-width: 22px;
            font-size: 18px;
          }
          .cartLine {
            align-items: flex-start;
          }
          .totalLine strong {
            font-size: 34px;
          }
        }
      `}</style>
    </main>
  );
}
