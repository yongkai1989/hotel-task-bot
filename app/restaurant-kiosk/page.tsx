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

export default function RestaurantKioskPage() {
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
  const [cart, setCart] = useState<CartMap>({});
  const [roomNumber, setRoomNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssist, setShowAssist] = useState(false);

  const cartLines = useMemo(
    () =>
      voucherTypes
        .map((type) => ({
          type,
          quantity: Math.max(0, Math.floor(Number(cart[type.id] || 0))),
        }))
        .filter((line) => line.quantity > 0),
    [cart, voucherTypes]
  );
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

  function setTypeQuantity(typeId: string, nextQuantity: number) {
    setCart((current) => {
      const quantity = Math.max(0, Math.min(20, Math.floor(nextQuantity)));
      const next = { ...current };
      if (quantity <= 0) delete next[typeId];
      else next[typeId] = quantity;
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
            quantity: line.quantity,
          })),
          roomNumber: roomNumber.trim(),
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
        <div>
          <p className="eyebrow">Hallmark Crown Hotel</p>
          <h1>Buffet Breakfast Ticket</h1>
        </div>
        <div className="breakfastVisual" aria-hidden="true">
          <svg viewBox="0 0 220 150" role="img">
            <path className="foodLine soft" d="M58 50c-15-16 8-25-2-42" />
            <path className="foodLine soft" d="M100 52c-16-18 12-27 0-46" />
            <path className="foodLine soft" d="M140 50c16-17-9-25 2-42" />
            <path className="foodLine gold" d="M43 88c19-23 43-33 72-31 27 2 49 16 64 38" />
            <path className="foodLine gold" d="M55 91c13 13 31 21 54 22 25 1 46-6 62-20" />
            <path className="foodLine thin" d="M37 111h146" />
            <path className="foodLine thin" d="M50 122c28 15 102 15 120 0" />
            <path className="foodLine soft" d="M24 57v72" />
            <path className="foodLine soft" d="M18 58h12M18 70h12M18 82h12" />
            <path className="foodLine soft" d="M194 57c10 18 7 37-4 56v16" />
          </svg>
        </div>
        <div className="priceCard">
          <span>Available from</span>
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

            <div className="typeGrid">
              {voucherTypes.map((type) => {
                const quantity = Math.max(0, Number(cart[type.id] || 0));
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
                <div className="cartLine" key={line.type.id}>
                  <div>
                    <strong>{line.quantity}x {line.type.name}</strong>
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
            radial-gradient(circle at 86% 16%, rgba(47, 88, 62, 0.08), transparent 18%),
            radial-gradient(circle at 11% 88%, rgba(170, 93, 34, 0.07), transparent 22%),
            radial-gradient(circle at 20% 10%, rgba(218, 178, 93, 0.2), transparent 30%),
            linear-gradient(135deg, #fffaf0 0%, #f6efe5 42%, #eef4f2 100%);
        }
        .hero {
          position: relative;
          overflow: hidden;
          min-height: 30vh;
          border: 1px solid rgba(142, 104, 50, 0.22);
          border-radius: 28px;
          padding: clamp(28px, 5vw, 64px);
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 28px;
          background:
            radial-gradient(circle at 78% 24%, rgba(238, 199, 106, 0.26), transparent 24%),
            radial-gradient(circle at 18% 82%, rgba(255, 255, 255, 0.12), transparent 22%),
            linear-gradient(90deg, rgba(20, 16, 12, 0.98), rgba(44, 35, 25, 0.9));
          color: #fff8ea;
          box-shadow: 0 28px 70px rgba(35, 28, 19, 0.18);
        }
        .hero::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(92deg, rgba(255, 248, 234, 0.055) 0 1px, transparent 1px 54px),
            linear-gradient(122deg, transparent 0 70%, rgba(234, 195, 108, 0.1) 70% 71%, transparent 71%);
          pointer-events: none;
        }
        .hero::after {
          content: "";
          position: absolute;
          right: clamp(36px, 12vw, 230px);
          bottom: clamp(26px, 6vw, 86px);
          width: clamp(150px, 18vw, 250px);
          height: clamp(150px, 18vw, 250px);
          border: 1px solid rgba(238, 199, 106, 0.13);
          border-radius: 999px;
          pointer-events: none;
        }
        .hero > * {
          position: relative;
          z-index: 1;
        }
        .breakfastVisual {
          position: absolute;
          right: clamp(230px, 24vw, 390px);
          bottom: clamp(26px, 4vw, 58px);
          width: clamp(170px, 20vw, 250px);
          height: clamp(116px, 14vw, 172px);
          opacity: 0.95;
          pointer-events: none;
          z-index: 1;
        }
        .breakfastVisual svg {
          width: 100%;
          height: 100%;
          overflow: visible;
          filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.18));
        }
        .foodLine {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-width: 6;
        }
        .foodLine.gold {
          stroke: rgba(238, 199, 106, 0.86);
        }
        .foodLine.soft {
          stroke: rgba(255, 248, 234, 0.5);
          stroke-width: 5;
        }
        .foodLine.thin {
          stroke: rgba(255, 248, 234, 0.34);
          stroke-width: 3;
        }
        .eyebrow {
          margin: 0 0 10px;
          color: #b78336;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          max-width: 760px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(50px, 8vw, 106px);
          line-height: 0.9;
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
          min-width: 170px;
          padding: 16px 18px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.22);
          backdrop-filter: blur(18px);
        }
        .priceCard span {
          display: block;
          color: rgba(255, 248, 234, 0.72);
          font-weight: 800;
          margin-bottom: 8px;
        }
        .priceCard strong {
          font-size: 34px;
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
        .cartLine span {
          display: block;
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
        .errorBox {
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
            min-height: 30vh;
            border-radius: 20px;
            padding: 24px;
            align-items: flex-start;
            flex-direction: column;
            justify-content: flex-end;
          }
          .breakfastVisual {
            right: 18px;
            top: 18px;
            bottom: auto;
            width: 118px;
            height: 84px;
            opacity: 0.72;
          }
          h1 {
            font-size: clamp(42px, 14vw, 64px);
          }
          .workspace {
            gap: 12px;
            margin-top: 12px;
          }
          .panel {
            border-radius: 20px;
          }
          .priceCard {
            width: auto;
            min-width: 138px;
            align-self: flex-start;
            box-sizing: border-box;
            padding: 12px 14px;
          }
          .priceCard strong {
            font-size: 28px;
          }
          .product {
            padding: 12px;
          }
          .checkout {
            padding: 18px;
          }
          .typeCard {
            grid-template-columns: 46px minmax(0, 1fr);
            padding: 12px;
            gap: 10px;
          }
          .typeBadge {
            width: 46px;
            height: 46px;
            border-radius: 15px;
          }
          .qtyRow {
            grid-column: 1 / -1;
            justify-content: space-between;
            padding: 6px;
          }
          .qtyRow button {
            width: 48px;
            height: 44px;
          }
          .qtyRow span {
            font-size: 24px;
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
