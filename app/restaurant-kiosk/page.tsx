'use client';

import { useEffect, useMemo, useState } from 'react';

type VoucherType = {
  id: string;
  name: string;
  description: string;
  price_myr: number;
  is_active: boolean;
};

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function RestaurantKioskPage() {
  const [voucherTypes, setVoucherTypes] = useState<VoucherType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [guestName, setGuestName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAssist, setShowAssist] = useState(false);

  const selectedType = useMemo(
    () => voucherTypes.find((type) => type.id === selectedTypeId) || voucherTypes[0] || null,
    [voucherTypes, selectedTypeId]
  );
  const total = useMemo(() => quantity * Number(selectedType?.price_myr || 0), [quantity, selectedType]);

  useEffect(() => {
    let alive = true;
    async function loadTypes() {
      try {
        const res = await fetch('/api/restaurant-kiosk/voucher-types', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        const types = Array.isArray(json?.types) ? json.types : [];
        setVoucherTypes(types);
        setSelectedTypeId(String(types[0]?.id || ''));
      } catch {
        const fallback = [{
          id: 'default-breakfast',
          name: 'Breakfast Voucher',
          description: 'Breakfast pass redeemable at the restaurant counter.',
          price_myr: 20,
          is_active: true,
        }];
        setVoucherTypes(fallback);
        setSelectedTypeId(fallback[0].id);
      }
    }
    loadTypes();
    return () => {
      alive = false;
    };
  }, []);

  async function pay() {
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/api/restaurant-kiosk/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity,
          voucherTypeId: selectedType?.id || '',
          guestName: guestName.trim() || 'Restaurant Guest',
          roomNumber: roomNumber.trim() || 'Kiosk',
          email: email.trim(),
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
          <h1>Breakfast Voucher</h1>
          <p className="subcopy">
            Choose your breakfast voucher. A QR ticket will be shown after payment is verified.
          </p>
        </div>
        <div className="priceCard">
          <span>{selectedType?.name || 'Per voucher'}</span>
          <strong>{money(selectedType?.price_myr || 0)}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="panel product">
          <div className="voucherArt">
            <span>Breakfast</span>
            <strong>{selectedType?.name || 'Hallmark Morning Pass'}</strong>
            <small>{selectedType?.description || 'Redeem once at the restaurant counter'}</small>
          </div>
          <div className="typeGrid">
            {voucherTypes.map((type) => (
              <button
                className={type.id === selectedType?.id ? 'typeCard active' : 'typeCard'}
                key={type.id}
                type="button"
                onClick={() => setSelectedTypeId(type.id)}
              >
                <span>{type.name}</span>
                <strong>{money(type.price_myr)}</strong>
                {type.description ? <small>{type.description}</small> : null}
              </button>
            ))}
          </div>
          <div className="qtyRow">
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>-</button>
            <strong>{quantity}</strong>
            <button type="button" onClick={() => setQuantity((value) => Math.min(20, value + 1))}>+</button>
          </div>
        </div>

        <div className="panel checkout">
          <p className="eyebrow">Your cart</p>
          <h2>{quantity}x {selectedType?.name || 'Breakfast Voucher'}</h2>

          <label>
            Guest name
            <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Room number
            <input value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} placeholder="Optional for walk-in guest" />
          </label>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" type="email" />
          </label>

          <div className="totalLine">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>

          <button className="payBtn" type="button" onClick={pay} disabled={loading}>
            {loading ? 'Opening payment...' : 'Pay with TNG / Alipay / Card'}
          </button>
          <button className="assistBtn" type="button" onClick={() => setShowAssist((value) => !value)}>
            I need staff assistance
          </button>

          {showAssist ? (
            <div className="assistBox">
              <strong>Please call Front Office staff.</strong>
              <span>For foreign guests without TNG or Alipay, staff may assist with manual payment at the counter.</span>
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
            radial-gradient(circle at 20% 10%, rgba(218, 178, 93, 0.2), transparent 30%),
            linear-gradient(135deg, #fffaf0 0%, #f6efe5 42%, #eef4f2 100%);
        }
        .hero {
          min-height: 42vh;
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
          max-width: 720px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(54px, 9vw, 116px);
          line-height: 0.88;
          letter-spacing: 0;
        }
        .subcopy {
          max-width: 560px;
          margin: 22px 0 0;
          font-size: clamp(17px, 2vw, 24px);
          line-height: 1.45;
          color: rgba(255, 248, 234, 0.84);
        }
        .priceCard {
          min-width: 220px;
          padding: 22px;
          border-radius: 22px;
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
          font-size: 44px;
          line-height: 1;
        }
        .workspace {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 420px;
          gap: 22px;
          margin-top: 22px;
        }
        .panel {
          border: 1px solid rgba(142, 104, 50, 0.2);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 20px 55px rgba(48, 40, 27, 0.11);
        }
        .product {
          padding: 20px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(220px, 320px) auto;
          align-items: center;
          gap: 18px;
        }
        .voucherArt {
          min-height: 230px;
          border-radius: 22px;
          padding: 28px;
          background:
            linear-gradient(135deg, rgba(11, 19, 42, 0.95), rgba(39, 46, 79, 0.84)),
            radial-gradient(circle at 72% 20%, rgba(234, 195, 108, 0.32), transparent 30%);
          color: #fff8ea;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .voucherArt span {
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #edc669;
        }
        .voucherArt strong {
          margin-top: 12px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(36px, 5vw, 70px);
          line-height: 0.95;
        }
        .voucherArt small {
          margin-top: 18px;
          color: rgba(255, 248, 234, 0.72);
          font-size: 16px;
          font-weight: 700;
        }
        .typeGrid {
          display: grid;
          gap: 10px;
          align-self: stretch;
          align-content: center;
        }
        .typeCard {
          width: 100%;
          min-height: 86px;
          border-radius: 18px;
          border: 1px solid #e6d4b8;
          background: #fffaf1;
          padding: 14px;
          text-align: left;
          color: #15120e;
          font: inherit;
          cursor: pointer;
        }
        .typeCard.active {
          border-color: #c9972b;
          box-shadow: 0 12px 28px rgba(181, 132, 37, 0.18);
        }
        .typeCard span,
        .typeCard strong,
        .typeCard small {
          display: block;
        }
        .typeCard span {
          font-weight: 950;
        }
        .typeCard strong {
          margin-top: 5px;
          font-size: 24px;
        }
        .typeCard small {
          margin-top: 4px;
          color: #6a5b48;
          font-weight: 750;
          line-height: 1.35;
        }
        .qtyRow {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px;
          border-radius: 999px;
          background: #fffaf1;
          border: 1px solid #e6d4b8;
        }
        .qtyRow button {
          width: 52px;
          height: 52px;
          border: 0;
          border-radius: 999px;
          background: #15120e;
          color: #fff;
          font-size: 24px;
          font-weight: 900;
        }
        .qtyRow strong {
          min-width: 44px;
          text-align: center;
          font-size: 28px;
        }
        .checkout {
          padding: 24px;
        }
        h2 {
          margin: 0 0 20px;
          font-size: 30px;
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
          opacity: 0.65;
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
        @media (max-width: 860px) {
          .kiosk {
            padding: 14px;
          }
          .hero {
            min-height: 58vh;
            border-radius: 22px;
            align-items: flex-end;
            flex-direction: column;
            justify-content: flex-end;
          }
          .priceCard {
            width: 100%;
            box-sizing: border-box;
          }
          .workspace,
          .product {
            grid-template-columns: 1fr;
          }
          .typeGrid {
            grid-template-columns: 1fr;
          }
          .qtyRow {
            justify-content: center;
          }
          .totalLine strong {
            font-size: 34px;
          }
        }
      `}</style>
    </main>
  );
}
