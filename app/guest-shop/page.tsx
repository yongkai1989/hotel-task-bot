'use client';

import { useMemo, useState } from 'react';

type ShopCategory = 'Essentials' | 'Laundry' | 'Comfort' | 'Food & Drink';

type ShopItem = {
  id: string;
  name: string;
  category: ShopCategory;
  description: string;
  price: number;
  stock: number;
  outOfStock?: boolean;
  accent: 'blue' | 'gold' | 'green' | 'rose';
  initials: string;
};

type CartLine = {
  itemId: string;
  quantity: number;
};

type CheckoutStatus = 'SHOPPING' | 'CHECKOUT' | 'PAID';

const CURRENCY = 'RM';

const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'late-checkout',
    name: 'Late Check-Out',
    category: 'Essentials',
    description: 'Extend your stay subject to front office confirmation.',
    price: 50,
    stock: 6,
    accent: 'blue',
    initials: 'LC',
  },
  {
    id: 'extra-bed',
    name: 'Extra Bed',
    category: 'Comfort',
    description: 'Additional bed setup for your room.',
    price: 60,
    stock: 4,
    accent: 'gold',
    initials: 'EB',
  },
  {
    id: 'guest-laundry',
    name: 'Guest Laundry',
    category: 'Laundry',
    description: 'Laundry collection request with front office follow-up.',
    price: 30,
    stock: 20,
    accent: 'green',
    initials: 'GL',
  },
  {
    id: 'towel-set',
    name: 'Fresh Towel Set',
    category: 'Comfort',
    description: 'Extra bath towel and hand towel set.',
    price: 12,
    stock: 18,
    accent: 'blue',
    initials: 'TS',
  },
  {
    id: 'bottled-water',
    name: 'Mineral Water Pack',
    category: 'Food & Drink',
    description: 'Six bottles delivered to your room.',
    price: 10,
    stock: 30,
    accent: 'green',
    initials: 'MW',
  },
  {
    id: 'umbrella',
    name: 'Hotel Umbrella',
    category: 'Essentials',
    description: 'Compact umbrella for city walks and rainy days.',
    price: 25,
    stock: 0,
    outOfStock: true,
    accent: 'rose',
    initials: 'HU',
  },
];

const CATEGORIES: Array<'All' | ShopCategory> = ['All', 'Essentials', 'Laundry', 'Comfort', 'Food & Drink'];

function formatMoney(value: number) {
  return `${CURRENCY}${value.toLocaleString('en-MY', {
    minimumFractionDigits: value % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function lineTotal(item: ShopItem, quantity: number) {
  return item.price * quantity;
}

export default function GuestShopPage() {
  const [selectedCategory, setSelectedCategory] = useState<'All' | ShopCategory>('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<CheckoutStatus>('SHOPPING');

  const visibleItems = useMemo(
    () => SHOP_ITEMS.filter((item) => selectedCategory === 'All' || item.category === selectedCategory),
    [selectedCategory]
  );

  const cartItems = useMemo(
    () => cart
      .map((line) => {
        const item = SHOP_ITEMS.find((candidate) => candidate.id === line.itemId);
        return item ? { item, quantity: line.quantity } : null;
      })
      .filter(Boolean) as Array<{ item: ShopItem; quantity: number }>,
    [cart]
  );

  const total = useMemo(
    () => cartItems.reduce((sum, line) => sum + lineTotal(line.item, line.quantity), 0),
    [cartItems]
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart]
  );

  const canCheckout = cartItems.length > 0 && roomNumber.trim().length >= 3 && guestName.trim().length >= 2;

  function addItem(item: ShopItem) {
    if (item.outOfStock || item.stock <= 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.itemId === item.id);
      if (!existing) return [...current, { itemId: item.id, quantity: 1 }];
      if (existing.quantity >= item.stock) return current;
      return current.map((line) =>
        line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line
      );
    });
  }

  function changeQuantity(itemId: string, delta: number) {
    setCart((current) => current
      .map((line) => {
        if (line.itemId !== itemId) return line;
        const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
        const max = item?.stock || 0;
        return { ...line, quantity: Math.max(0, Math.min(max, line.quantity + delta)) };
      })
      .filter((line) => line.quantity > 0));
  }

  function startNewOrder() {
    setCart([]);
    setRoomNumber('');
    setGuestName('');
    setEmail('');
    setStatus('SHOPPING');
  }

  return (
    <main className="gs-shell">
      <section className="gs-hero">
        <div className="gs-brand-row">
          <div className="gs-logo-wrap">
            <img src="/logo.png" alt="Hallmark Crown Hotel" />
          </div>
          <div>
            <div className="gs-eyebrow">Hallmark Crown Hotel</div>
            <h1>Guest Shop</h1>
          </div>
        </div>
        <div className="gs-hero-copy">
          <p>Order hotel services and guest essentials from your phone. Your ticket appears only after secure payment confirmation.</p>
        </div>
        <button
          type="button"
          className="gs-cart-pill"
          onClick={() => setStatus('CHECKOUT')}
          disabled={!cartItems.length}
        >
          <span>Cart</span>
          <strong>{cartCount}</strong>
        </button>
      </section>

      <section className="gs-content">
        <section className="gs-shop-panel">
          <div className="gs-section-head">
            <div>
              <div className="gs-eyebrow">Browse</div>
              <h2>Available Items</h2>
            </div>
            <span className="gs-soft-pill">{visibleItems.length} items</span>
          </div>

          <div className="gs-tabs" aria-label="Shop categories">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={selectedCategory === category ? 'active' : ''}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <div className="gs-product-grid">
            {visibleItems.map((item) => {
              const disabled = item.outOfStock || item.stock <= 0;
              const inCart = cart.find((line) => line.itemId === item.id)?.quantity || 0;
              return (
                <article key={item.id} className={`gs-product gs-product-${item.accent}`}>
                  <div className="gs-product-media">
                    <span>{item.initials}</span>
                  </div>
                  <div className="gs-product-body">
                    <div className="gs-product-meta">
                      <span>{item.category}</span>
                      <strong>{formatMoney(item.price)}</strong>
                    </div>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                    <div className="gs-product-footer">
                      <span className={disabled ? 'gs-stock out' : 'gs-stock'}>
                        {disabled ? 'Out of stock' : `${item.stock} available`}
                      </span>
                      <button type="button" onClick={() => addItem(item)} disabled={disabled}>
                        {inCart ? `Added ${inCart}` : 'Add'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="gs-order-panel">
          {status === 'PAID' ? (
            <section className="gs-ticket">
              <div className="gs-success-icon">OK</div>
              <div className="gs-eyebrow">Payment Confirmed</div>
              <h2>Ticket Ready</h2>
              <p>Show this ticket to front office. Your order has been sent to the team.</p>
              <div className="gs-ticket-box">
                <span>Ticket No.</span>
                <strong>HC-{Math.max(1000, cartCount * 137 + 924)}</strong>
              </div>
              <div className="gs-ticket-summary">
                <div><span>Room</span><strong>{roomNumber || '-'}</strong></div>
                <div><span>Total</span><strong>{formatMoney(total)}</strong></div>
              </div>
              <button type="button" className="gs-primary" onClick={startNewOrder}>Start New Order</button>
            </section>
          ) : (
            <>
              <div className="gs-section-head">
                <div>
                  <div className="gs-eyebrow">Order</div>
                  <h2>Your Cart</h2>
                </div>
                <span className="gs-soft-pill">{cartCount} selected</span>
              </div>

              {cartItems.length ? (
                <div className="gs-cart-lines">
                  {cartItems.map(({ item, quantity }) => (
                    <div className="gs-cart-line" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{formatMoney(item.price)} each</span>
                      </div>
                      <div className="gs-stepper">
                        <button type="button" onClick={() => changeQuantity(item.id, -1)}>-</button>
                        <span>{quantity}</span>
                        <button type="button" onClick={() => changeQuantity(item.id, 1)}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="gs-empty-cart">
                  <strong>Your cart is empty</strong>
                  <span>Select an item to begin.</span>
                </div>
              )}

              <div className="gs-form">
                <label>
                  Room Number
                  <input value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} placeholder="Example: 1205" />
                </label>
                <label>
                  Guest Name
                  <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Name on order" />
                </label>
                <label>
                  Email Receipt <span>optional</span>
                  <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="guest@email.com" inputMode="email" />
                </label>
              </div>

              <div className="gs-total-box">
                <span>Total Amount</span>
                <strong>{formatMoney(total)}</strong>
              </div>

              {status === 'CHECKOUT' ? (
                <div className="gs-payment-note">
                  <strong>Billplz payment step</strong>
                  <span>In production, this button will create a Billplz bill and only show the ticket after verified successful payment.</span>
                </div>
              ) : null}

              <button
                type="button"
                className="gs-primary"
                disabled={!canCheckout || status === 'CHECKOUT'}
                onClick={() => setStatus('CHECKOUT')}
              >
                {status === 'CHECKOUT' ? 'Billplz Integration Pending' : 'Continue to Payment'}
              </button>
            </>
          )}
        </aside>
      </section>

      <style jsx global>{`
        .gs-shell {
          min-height: 100vh;
          padding: clamp(14px, 3vw, 34px);
          background:
            radial-gradient(circle at 8% 0%, rgba(37,99,235,.13), transparent 30%),
            radial-gradient(circle at 100% 6%, rgba(197,151,77,.18), transparent 26%),
            linear-gradient(180deg, #f7faff 0%, #eef4fb 100%);
          color: #0f172a;
          box-sizing: border-box;
        }
        .gs-hero,
        .gs-shop-panel,
        .gs-order-panel {
          border: 1px solid rgba(193, 211, 235, .9);
          background: rgba(255,255,255,.94);
          box-shadow: 0 24px 70px rgba(15,23,42,.09), inset 0 1px 0 rgba(255,255,255,.95);
          border-radius: 26px;
        }
        .gs-hero {
          max-width: 1220px;
          margin: 0 auto 16px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(260px, 440px) auto;
          gap: 18px;
          align-items: center;
          padding: clamp(16px, 2.2vw, 24px);
          background:
            linear-gradient(135deg, rgba(255,255,255,.98), rgba(242,247,255,.95)),
            radial-gradient(circle at 92% 8%, rgba(37,99,235,.13), transparent 34%);
        }
        .gs-brand-row {
          display: grid;
          grid-template-columns: 58px minmax(0, 1fr);
          gap: 14px;
          align-items: center;
        }
        .gs-logo-wrap {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          border: 1px solid #decba6;
          background: linear-gradient(135deg, #fff, #fbf7ef);
          display: grid;
          place-items: center;
          overflow: hidden;
        }
        .gs-logo-wrap img {
          width: 84%;
          height: 84%;
          object-fit: contain;
        }
        .gs-eyebrow {
          color: #2563eb;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .9px;
          font-weight: 950;
          margin-bottom: 6px;
        }
        .gs-hero h1,
        .gs-shop-panel h2,
        .gs-order-panel h2,
        .gs-ticket h2 {
          margin: 0;
          color: #071225;
          letter-spacing: 0;
          line-height: 1.05;
        }
        .gs-hero h1 {
          font-size: clamp(32px, 5vw, 52px);
        }
        .gs-hero-copy p {
          margin: 0;
          color: #516783;
          font-weight: 750;
          line-height: 1.5;
        }
        .gs-cart-pill {
          border: 0;
          min-height: 48px;
          border-radius: 16px;
          padding: 0 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: #fff;
          background: linear-gradient(135deg, #1d4ed8, #2563eb 55%, #3b82f6);
          box-shadow: 0 18px 34px rgba(37,99,235,.22);
          font-weight: 950;
          cursor: pointer;
        }
        .gs-cart-pill:disabled,
        .gs-primary:disabled,
        .gs-product-footer button:disabled {
          opacity: .45;
          cursor: not-allowed;
          box-shadow: none;
        }
        .gs-cart-pill strong {
          min-width: 26px;
          min-height: 26px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: rgba(255,255,255,.18);
        }
        .gs-content {
          max-width: 1220px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(330px, 390px);
          gap: 16px;
          align-items: start;
        }
        .gs-shop-panel,
        .gs-order-panel {
          padding: clamp(16px, 2.2vw, 24px);
        }
        .gs-order-panel {
          position: sticky;
          top: 14px;
        }
        .gs-section-head {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 12px;
          margin-bottom: 14px;
        }
        .gs-section-head h2 {
          font-size: clamp(24px, 3vw, 30px);
        }
        .gs-soft-pill {
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 8px 11px;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }
        .gs-tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 4px;
          margin-bottom: 16px;
          border-radius: 18px;
          border: 1px solid #dde8f6;
          background: #f7fbff;
        }
        .gs-tabs button {
          border: 0;
          border-radius: 14px;
          min-height: 42px;
          padding: 0 14px;
          background: transparent;
          color: #334155;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }
        .gs-tabs button.active {
          color: #fff;
          background: #0f172a;
          box-shadow: 0 12px 26px rgba(15,23,42,.18);
        }
        .gs-product-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .gs-product {
          border: 1px solid #dbe7f6;
          border-radius: 22px;
          background: #fff;
          overflow: hidden;
          display: grid;
          box-shadow: 0 18px 42px rgba(15,23,42,.055);
        }
        .gs-product-media {
          min-height: 110px;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 20% 20%, rgba(255,255,255,.65), transparent 36%),
            linear-gradient(135deg, #eaf2ff, #dbeafe);
        }
        .gs-product-media span {
          width: 64px;
          height: 64px;
          border-radius: 22px;
          display: grid;
          place-items: center;
          background: rgba(255,255,255,.78);
          color: #1d4ed8;
          font-size: 22px;
          font-weight: 950;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 18px 38px rgba(30,64,175,.14);
        }
        .gs-product-gold .gs-product-media { background: linear-gradient(135deg, #fff7ed, #fef3c7); }
        .gs-product-gold .gs-product-media span { color: #92400e; }
        .gs-product-green .gs-product-media { background: linear-gradient(135deg, #ecfdf5, #dcfce7); }
        .gs-product-green .gs-product-media span { color: #047857; }
        .gs-product-rose .gs-product-media { background: linear-gradient(135deg, #fff1f2, #ffe4e6); }
        .gs-product-rose .gs-product-media span { color: #be123c; }
        .gs-product-body {
          padding: 14px;
          display: grid;
          gap: 9px;
        }
        .gs-product-meta,
        .gs-product-footer {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }
        .gs-product-meta span,
        .gs-stock,
        .gs-cart-line span,
        .gs-ticket-summary span {
          color: #64748b;
          font-size: 12px;
          font-weight: 850;
        }
        .gs-product-meta strong {
          color: #0f172a;
          font-size: 18px;
        }
        .gs-product h3 {
          margin: 0;
          font-size: 19px;
          line-height: 1.15;
          color: #071225;
        }
        .gs-product p {
          margin: 0;
          color: #526783;
          font-size: 13px;
          line-height: 1.42;
          min-height: 38px;
        }
        .gs-stock.out {
          color: #be123c;
        }
        .gs-product-footer button {
          border: 0;
          border-radius: 14px;
          min-height: 38px;
          min-width: 76px;
          padding: 0 13px;
          background: #2563eb;
          color: #fff;
          font-weight: 950;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(37,99,235,.18);
        }
        .gs-cart-lines {
          display: grid;
          gap: 10px;
          margin-bottom: 14px;
        }
        .gs-cart-line {
          border: 1px solid #dde8f6;
          background: #fff;
          border-radius: 18px;
          padding: 12px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }
        .gs-cart-line strong {
          display: block;
          margin-bottom: 3px;
        }
        .gs-stepper {
          display: grid;
          grid-template-columns: 34px 34px 34px;
          align-items: center;
          border: 1px solid #dbe7f6;
          border-radius: 14px;
          overflow: hidden;
          background: #f8fbff;
        }
        .gs-stepper button {
          border: 0;
          height: 34px;
          background: transparent;
          color: #1d4ed8;
          font-weight: 950;
          cursor: pointer;
        }
        .gs-stepper span {
          text-align: center;
          font-weight: 950;
        }
        .gs-empty-cart {
          border: 1px dashed #cbd9eb;
          border-radius: 18px;
          padding: 24px;
          text-align: center;
          display: grid;
          gap: 5px;
          color: #64748b;
          margin-bottom: 14px;
        }
        .gs-empty-cart strong {
          color: #0f172a;
        }
        .gs-form {
          display: grid;
          gap: 10px;
          margin-bottom: 14px;
        }
        .gs-form label {
          display: grid;
          gap: 7px;
          color: #334155;
          font-size: 12px;
          font-weight: 950;
        }
        .gs-form label span {
          color: #94a3b8;
          font-weight: 850;
        }
        .gs-form input {
          width: 100%;
          height: 48px;
          border-radius: 15px;
          border: 1px solid #cbd9eb;
          padding: 0 13px;
          box-sizing: border-box;
          font: inherit;
          font-weight: 800;
          outline: none;
          background: #fff;
        }
        .gs-form input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 4px rgba(37,99,235,.1);
        }
        .gs-total-box {
          border: 1px solid #c7d2fe;
          border-radius: 20px;
          padding: 16px;
          background: linear-gradient(135deg, #172554, #1d4ed8 72%, #2563eb);
          color: #fff;
          display: grid;
          gap: 4px;
          margin-bottom: 12px;
        }
        .gs-total-box span {
          opacity: .78;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: .7px;
          font-weight: 950;
        }
        .gs-total-box strong {
          font-size: 34px;
          line-height: 1;
        }
        .gs-payment-note {
          border: 1px solid #bfdbfe;
          border-radius: 16px;
          padding: 12px;
          background: #eff6ff;
          color: #1e3a8a;
          display: grid;
          gap: 5px;
          margin-bottom: 12px;
          font-size: 13px;
          line-height: 1.38;
        }
        .gs-primary {
          width: 100%;
          min-height: 52px;
          border: 0;
          border-radius: 17px;
          color: #fff;
          background: linear-gradient(135deg, #1d4ed8, #2563eb 60%, #3b82f6);
          box-shadow: 0 18px 36px rgba(37,99,235,.22);
          font-weight: 950;
          cursor: pointer;
        }
        .gs-ticket {
          text-align: center;
          display: grid;
          gap: 14px;
        }
        .gs-success-icon {
          width: 62px;
          height: 62px;
          margin: 0 auto;
          border-radius: 22px;
          display: grid;
          place-items: center;
          background: #dcfce7;
          color: #047857;
          font-size: 30px;
          font-weight: 950;
        }
        .gs-ticket p {
          color: #526783;
          margin: 0;
          line-height: 1.45;
          font-weight: 750;
        }
        .gs-ticket-box {
          border: 1px dashed #93c5fd;
          border-radius: 20px;
          padding: 16px;
          display: grid;
          gap: 5px;
          background: #eff6ff;
        }
        .gs-ticket-box span {
          color: #1d4ed8;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .8px;
          font-weight: 950;
        }
        .gs-ticket-box strong {
          font-size: 30px;
          color: #071225;
        }
        .gs-ticket-summary {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .gs-ticket-summary div {
          border: 1px solid #dbe7f6;
          border-radius: 16px;
          padding: 12px;
          display: grid;
          gap: 5px;
          text-align: left;
        }
        .gs-ticket-summary strong {
          font-size: 20px;
        }
        @media (max-width: 920px) {
          .gs-hero {
            grid-template-columns: 1fr;
          }
          .gs-cart-pill {
            width: 100%;
          }
          .gs-content {
            grid-template-columns: 1fr;
          }
          .gs-order-panel {
            position: static;
          }
        }
        @media (max-width: 640px) {
          .gs-shell {
            padding: 10px;
          }
          .gs-hero,
          .gs-shop-panel,
          .gs-order-panel {
            border-radius: 20px;
          }
          .gs-brand-row {
            grid-template-columns: 48px minmax(0, 1fr);
          }
          .gs-logo-wrap {
            width: 48px;
            height: 48px;
            border-radius: 15px;
          }
          .gs-product-grid {
            grid-template-columns: 1fr;
          }
          .gs-product {
            grid-template-columns: 94px minmax(0, 1fr);
          }
          .gs-product-media {
            min-height: auto;
          }
          .gs-product-media span {
            width: 52px;
            height: 52px;
            border-radius: 18px;
            font-size: 18px;
          }
          .gs-product h3 {
            font-size: 17px;
          }
          .gs-product p {
            min-height: 0;
          }
          .gs-product-footer {
            align-items: stretch;
          }
          .gs-product-footer button {
            min-width: 70px;
          }
          .gs-ticket-summary {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}
