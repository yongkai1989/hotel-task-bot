'use client';

import { useMemo, useState } from 'react';

type Category = 'All' | 'Guest Comfort' | 'Laundry' | 'Room Service' | 'Essentials';

type ShopItem = {
  id: string;
  name: string;
  category: Exclude<Category, 'All'>;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  tag?: string;
};

type CartItem = {
  item: ShopItem;
  quantity: number;
};

const categories: Category[] = ['All', 'Guest Comfort', 'Laundry', 'Room Service', 'Essentials'];

const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'late-checkout',
    name: 'Late Check-Out',
    category: 'Room Service',
    description: 'Extend your stay comfortably, subject to availability.',
    price: 60,
    stock: 8,
    tag: 'Limited daily',
    imageUrl:
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'express-laundry',
    name: 'Express Laundry',
    category: 'Laundry',
    description: 'Priority handling for garments that need a faster return.',
    price: 40,
    stock: 12,
    imageUrl:
      'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'extra-bed',
    name: 'Extra Bed',
    category: 'Guest Comfort',
    description: 'Additional bed setup for selected room categories.',
    price: 60,
    stock: 4,
    tag: 'Upon request',
    imageUrl:
      'https://images.unsplash.com/photo-1615874959474-d609969a20ed?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'extra-pillow',
    name: 'Extra Pillow',
    category: 'Guest Comfort',
    description: 'Fresh pillow delivered to your room for a better rest.',
    price: 15,
    stock: 18,
    imageUrl:
      'https://images.unsplash.com/photo-1585495336621-dcfb1aaf2a45?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'travel-adapter',
    name: 'Travel Adapter',
    category: 'Essentials',
    description: 'Universal adapter prepared for guest convenience.',
    price: 25,
    stock: 6,
    imageUrl:
      'https://images.unsplash.com/photo-1625834311143-7b6f5c9fdb40?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'mineral-water',
    name: 'Mineral Water Set',
    category: 'Essentials',
    description: 'Chilled bottled mineral water delivered to your room.',
    price: 12,
    stock: 30,
    imageUrl:
      'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=900&q=80',
  },
];

function money(value: number) {
  return `RM${value.toFixed(2)}`;
}

export default function GuestShopPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  const visibleItems = useMemo(() => {
    if (activeCategory === 'All') return SHOP_ITEMS;
    return SHOP_ITEMS.filter((item) => item.category === activeCategory);
  }, [activeCategory]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartItems.reduce((total, row) => total + row.quantity, 0);
  const cartTotal = cartItems.reduce((total, row) => total + row.item.price * row.quantity, 0);

  function addItem(item: ShopItem) {
    if (item.stock <= 0) return;

    setCart((current) => {
      const existing = current[item.id];
      const quantity = Math.min((existing?.quantity ?? 0) + 1, item.stock);

      return {
        ...current,
        [item.id]: { item, quantity },
      };
    });
    setNotice('');
  }

  function setQuantity(itemId: string, quantity: number) {
    setCart((current) => {
      const existing = current[itemId];
      if (!existing) return current;

      if (quantity <= 0) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }

      return {
        ...current,
        [itemId]: {
          ...existing,
          quantity: Math.min(quantity, existing.item.stock),
        },
      };
    });
  }

  function proceedToPayment() {
    if (!cartItems.length) {
      setNotice('Please select at least one item before payment.');
      return;
    }

    if (!roomNumber.trim() || !guestName.trim() || !email.trim()) {
      setNotice('Please enter room number, guest name, and email before payment.');
      return;
    }

    setNotice(
      'Billplz payment integration is pending. A ticket should only be shown after verified successful payment.'
    );
  }

  return (
    <main className="guest-shop">
      <header className="nav">
        <a className="brand" href="/guest-shop" aria-label="Hallmark Crown Hotel guest shop">
          <span className="brand-mark">
            <img src="/logo.png" alt="" />
          </span>
          <span>
            <small>Hallmark Crown Hotel</small>
            <strong>Guest Collection</strong>
          </span>
        </a>

        <a className="cart-pill" href="#order">
          <span>Order</span>
          <b>{cartCount}</b>
        </a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Private guest service</span>
          <h1>Selected comforts for a more refined stay.</h1>
          <p>
            A quiet collection of room essentials, comfort upgrades, and hotel services prepared
            for Hallmark Crown Hotel guests.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#shop">
              View collection
            </a>
            <a className="secondary-action" href="#order">
              Review order
            </a>
          </div>
        </div>

        <div className="hero-visual">
          <img
            src="https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1300&q=80"
            alt="Luxury hotel guest room"
          />
          <div className="hero-card">
            <span>Prepared by Front Office</span>
            <strong>Room delivery after verified payment</strong>
          </div>
        </div>
      </section>

      <section id="shop" className="collection">
        <div className="section-title">
          <span className="eyebrow">Guest menu</span>
          <h2>Choose from the collection</h2>
        </div>

        <div className="categories" role="tablist" aria-label="Product categories">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={activeCategory === category ? 'active' : ''}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="content-grid">
          <div className="product-grid">
            {visibleItems.map((item) => {
              const isUnavailable = item.stock <= 0;

              return (
                <article className="product-card" key={item.id}>
                  <div className="product-image">
                    <span className="image-fallback">{item.name.slice(0, 2).toUpperCase()}</span>
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    {item.tag ? <span className="product-tag">{item.tag}</span> : null}
                  </div>

                  <div className="product-info">
                    <span>{item.category}</span>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                    <div className="product-bottom">
                      <div>
                        <strong>{money(item.price)}</strong>
                        <small>{isUnavailable ? 'Out of stock' : `${item.stock} available`}</small>
                      </div>
                      <button type="button" disabled={isUnavailable} onClick={() => addItem(item)}>
                        {isUnavailable ? 'Unavailable' : 'Add'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside id="order" className="order-panel">
            <div className="order-top">
              <span className="eyebrow">Your selection</span>
              <strong>{cartCount} item{cartCount === 1 ? '' : 's'}</strong>
            </div>

            <div className="order-lines">
              {cartItems.length ? (
                cartItems.map(({ item, quantity }) => (
                  <div className="order-line" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{money(item.price)} each</span>
                    </div>
                    <div className="stepper">
                      <button type="button" onClick={() => setQuantity(item.id, quantity - 1)}>
                        -
                      </button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => setQuantity(item.id, quantity + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <strong>Your order is empty.</strong>
                  <span>Select any item to begin.</span>
                </div>
              )}
            </div>

            <div className="guest-details">
              <label>
                Room number
                <input
                  value={roomNumber}
                  onChange={(event) => setRoomNumber(event.target.value)}
                  placeholder="Example: 1205"
                />
              </label>
              <label>
                Guest name
                <input
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  placeholder="Name on room"
                />
              </label>
              <label>
                Email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="For receipt"
                />
              </label>
            </div>

            <div className="total-row">
              <span>Total</span>
              <strong>{money(cartTotal)}</strong>
            </div>

            <button className="payment-button" type="button" onClick={proceedToPayment}>
              Proceed to payment
            </button>

            {notice ? <p className="notice">{notice}</p> : null}
            <p className="payment-note">
              Orders are released to staff only after the payment provider confirms success.
            </p>
          </aside>
        </div>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f5efe6;
        }

        .guest-shop {
          min-height: 100vh;
          color: #17120d;
          background:
            radial-gradient(circle at 8% 0%, rgba(184, 132, 63, 0.2), transparent 32%),
            radial-gradient(circle at 92% 12%, rgba(30, 22, 15, 0.12), transparent 34%),
            linear-gradient(180deg, #fffaf2 0%, #f6efe4 54%, #efe4d5 100%);
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .nav {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px clamp(18px, 4vw, 58px);
          border-bottom: 1px solid rgba(92, 62, 31, 0.12);
          background: rgba(255, 250, 241, 0.9);
          backdrop-filter: blur(20px);
        }

        .brand,
        .cart-pill,
        .hero-actions a {
          color: inherit;
          text-decoration: none;
        }

        .brand {
          display: inline-flex;
          align-items: center;
          gap: 13px;
        }

        .brand-mark {
          display: grid;
          width: 48px;
          height: 48px;
          place-items: center;
          overflow: hidden;
          border: 1px solid rgba(121, 83, 42, 0.22);
          border-radius: 50%;
          background: linear-gradient(145deg, #fffaf2, #ead9bf);
          box-shadow: 0 18px 42px rgba(71, 48, 25, 0.12);
        }

        .brand-mark img {
          width: 32px;
          height: 32px;
          object-fit: contain;
        }

        .brand small,
        .eyebrow,
        .product-info > span {
          display: block;
          color: #9a6b31;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .brand strong {
          display: block;
          margin-top: 2px;
          font-size: 20px;
          letter-spacing: 0;
        }

        .cart-pill {
          display: inline-flex;
          min-height: 44px;
          align-items: center;
          gap: 10px;
          padding: 0 16px;
          color: #fff4df;
          border-radius: 999px;
          background: #1b1713;
          box-shadow: 0 18px 42px rgba(29, 20, 13, 0.18);
        }

        .cart-pill b {
          display: grid;
          min-width: 26px;
          height: 26px;
          place-items: center;
          color: #1b1713;
          border-radius: 50%;
          background: #d8b56d;
        }

        .hero {
          display: grid;
          grid-template-columns: minmax(0, 1.02fr) minmax(340px, 0.98fr);
          gap: clamp(26px, 4.4vw, 64px);
          align-items: center;
          padding: clamp(32px, 6vw, 92px) clamp(18px, 4vw, 58px) clamp(28px, 5vw, 70px);
        }

        .hero-copy h1 {
          max-width: 780px;
          margin: 14px 0 18px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(44px, 6.5vw, 88px);
          font-weight: 500;
          line-height: 0.94;
          letter-spacing: 0;
        }

        .hero-copy p {
          max-width: 640px;
          margin: 0;
          color: #5c5147;
          font-size: clamp(16px, 1.8vw, 20px);
          line-height: 1.75;
        }

        .hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 30px;
        }

        .hero-actions a,
        .categories button,
        .product-bottom button,
        .payment-button {
          min-height: 46px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-weight: 900;
          cursor: pointer;
        }

        .primary-action,
        .payment-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          color: #21170d;
          background: linear-gradient(135deg, #f0d38f, #c8963e);
          box-shadow: 0 20px 48px rgba(150, 104, 41, 0.26);
        }

        .secondary-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          color: #1b1713;
          border-color: rgba(94, 67, 38, 0.2);
          background: rgba(255, 252, 246, 0.78);
        }

        .hero-visual {
          position: relative;
          min-height: 520px;
          overflow: hidden;
          border: 1px solid rgba(121, 83, 42, 0.2);
          border-radius: 18px;
          background: #1b1713;
          box-shadow: 0 36px 95px rgba(45, 31, 18, 0.22);
        }

        .hero-visual img {
          width: 100%;
          height: 100%;
          min-height: 520px;
          object-fit: cover;
          opacity: 0.9;
        }

        .hero-card {
          position: absolute;
          right: 22px;
          bottom: 22px;
          left: 22px;
          padding: 20px;
          color: #fff8ec;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 16px;
          background: rgba(23, 18, 13, 0.76);
          backdrop-filter: blur(18px);
        }

        .hero-card span {
          display: block;
          color: #e2c17a;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .hero-card strong {
          display: block;
          margin-top: 8px;
          font-size: 24px;
          line-height: 1.22;
        }

        .collection {
          margin: 0 clamp(18px, 4vw, 58px) clamp(30px, 5vw, 70px);
        }

        .section-title {
          margin-bottom: 18px;
        }

        .section-title h2 {
          margin: 6px 0 0;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 4vw, 48px);
          font-weight: 500;
          letter-spacing: 0;
        }

        .categories {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 22px;
        }

        .categories button {
          padding: 0 18px;
          color: #4a3d30;
          border-color: rgba(94, 67, 38, 0.18);
          background: rgba(255, 252, 246, 0.78);
        }

        .categories button.active {
          color: #fff4df;
          background: #1b1713;
        }

        .content-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(330px, 410px);
          gap: 24px;
          align-items: start;
        }

        .product-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .product-card,
        .order-panel {
          overflow: hidden;
          border: 1px solid rgba(118, 89, 55, 0.16);
          border-radius: 18px;
          background: rgba(255, 252, 246, 0.86);
          box-shadow: 0 24px 70px rgba(54, 38, 22, 0.09);
        }

        .product-card {
          display: flex;
          min-height: 420px;
          flex-direction: column;
        }

        .product-image {
          position: relative;
          height: 218px;
          overflow: hidden;
          background: linear-gradient(135deg, #f2e2c9, #fbf7ec);
        }

        .product-image img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 240ms ease;
        }

        .product-card:hover .product-image img {
          transform: scale(1.035);
        }

        .image-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: rgba(42, 31, 20, 0.34);
          font-size: 42px;
          font-weight: 900;
        }

        .product-tag {
          position: absolute;
          top: 14px;
          left: 14px;
          padding: 8px 11px;
          color: #3e2a13;
          border-radius: 999px;
          background: rgba(247, 224, 169, 0.94);
          font-size: 12px;
          font-weight: 900;
        }

        .product-info {
          display: flex;
          flex: 1;
          flex-direction: column;
          justify-content: space-between;
          gap: 22px;
          padding: 20px;
        }

        .product-info h3 {
          margin: 8px 0;
          font-size: 22px;
          letter-spacing: 0;
        }

        .product-info p {
          margin: 0;
          color: #655b51;
          line-height: 1.55;
        }

        .product-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-top: 16px;
          border-top: 1px solid rgba(118, 89, 55, 0.14);
        }

        .product-bottom strong {
          display: block;
          font-size: 22px;
        }

        .product-bottom small {
          display: block;
          margin-top: 4px;
          color: #75695d;
          font-weight: 800;
        }

        .product-bottom button {
          min-width: 82px;
          padding: 0 18px;
          color: #fff4df;
          background: #1b1713;
        }

        .product-bottom button:disabled {
          cursor: not-allowed;
          color: #8d8174;
          background: #eee6dc;
        }

        .order-panel {
          position: sticky;
          top: 92px;
          padding: 22px;
        }

        .order-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .order-lines,
        .guest-details {
          display: grid;
          gap: 12px;
        }

        .order-line,
        .empty {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px;
          border: 1px solid rgba(118, 89, 55, 0.14);
          border-radius: 14px;
          background: rgba(255, 250, 241, 0.84);
        }

        .order-line strong,
        .empty strong {
          display: block;
        }

        .order-line span,
        .empty span {
          display: block;
          margin-top: 4px;
          color: #75695d;
          font-size: 13px;
          font-weight: 800;
        }

        .stepper {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px;
          border-radius: 999px;
          background: #fff;
          box-shadow: inset 0 0 0 1px rgba(118, 89, 55, 0.14);
        }

        .stepper button {
          display: grid;
          width: 30px;
          height: 30px;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: #f3eadb;
          font-weight: 900;
          cursor: pointer;
        }

        .stepper span {
          min-width: 20px;
          margin: 0;
          color: #17120d;
          text-align: center;
        }

        .guest-details {
          margin-top: 18px;
        }

        .guest-details label {
          color: #5d5148;
          font-size: 13px;
          font-weight: 900;
        }

        .guest-details input {
          width: 100%;
          min-height: 46px;
          margin-top: 7px;
          padding: 0 14px;
          border: 1px solid rgba(118, 89, 55, 0.18);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.92);
          color: #17120d;
          font: inherit;
          box-sizing: border-box;
        }

        .total-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 20px 0 14px;
          padding-top: 18px;
          border-top: 1px solid rgba(118, 89, 55, 0.14);
        }

        .total-row span {
          color: #75695d;
          font-weight: 900;
        }

        .total-row strong {
          font-size: 34px;
          letter-spacing: 0;
        }

        .payment-button {
          width: 100%;
          border: 0;
          font-size: 16px;
        }

        .notice,
        .payment-note {
          margin: 14px 0 0;
          color: #63594f;
          line-height: 1.5;
        }

        .notice {
          padding: 12px;
          border: 1px solid rgba(194, 150, 69, 0.42);
          border-radius: 14px;
          background: rgba(255, 246, 226, 0.82);
          font-weight: 800;
        }

        .payment-note {
          font-size: 13px;
        }

        @media (max-width: 1180px) {
          .content-grid {
            grid-template-columns: 1fr;
          }

          .order-panel {
            position: static;
          }

          .product-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .nav {
            padding: 14px 16px;
          }

          .brand strong {
            font-size: 16px;
          }

          .brand small {
            font-size: 9px;
          }

          .cart-pill {
            min-height: 40px;
            padding: 0 12px;
          }

          .cart-pill span {
            display: none;
          }

          .hero {
            grid-template-columns: 1fr;
            padding: 30px 16px;
          }

          .hero-copy h1 {
            font-size: 42px;
          }

          .hero-visual,
          .hero-visual img {
            min-height: 360px;
          }

          .collection {
            margin-right: 16px;
            margin-left: 16px;
          }

          .product-grid {
            grid-template-columns: 1fr;
          }

          .product-card {
            min-height: 0;
          }
        }

        @media (max-width: 520px) {
          .hero-actions a {
            width: 100%;
          }

          .categories {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .categories button {
            padding: 0 10px;
          }

          .product-bottom,
          .order-line {
            align-items: stretch;
            flex-direction: column;
          }

          .product-bottom button {
            width: 100%;
          }

          .stepper {
            justify-content: space-between;
          }

          .total-row strong {
            font-size: 28px;
          }
        }
      `}</style>
    </main>
  );
}
