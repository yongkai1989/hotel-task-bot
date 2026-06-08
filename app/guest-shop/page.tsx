'use client';

import { useMemo, useState } from 'react';

type Category = 'All' | 'Room Services' | 'Laundry' | 'Comfort' | 'Refreshments';

type ShopItem = {
  id: string;
  name: string;
  category: Exclude<Category, 'All'>;
  description: string;
  price: number;
  stock: number;
  badge?: string;
  imageUrl: string;
};

type CartItem = {
  item: ShopItem;
  quantity: number;
};

const categories: Category[] = ['All', 'Room Services', 'Laundry', 'Comfort', 'Refreshments'];

const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'late-checkout',
    name: 'Late Check-Out',
    category: 'Room Services',
    description: 'Extend your stay comfortably, subject to front office confirmation.',
    price: 60,
    stock: 8,
    badge: 'Guest Favorite',
    imageUrl:
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'express-laundry',
    name: 'Express Laundry',
    category: 'Laundry',
    description: 'Priority laundry handling for guests who need a faster return.',
    price: 40,
    stock: 12,
    imageUrl:
      'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'extra-pillow',
    name: 'Extra Pillow',
    category: 'Comfort',
    description: 'Fresh pillow delivered to your room for a better night of rest.',
    price: 15,
    stock: 18,
    imageUrl:
      'https://images.unsplash.com/photo-1585495336621-dcfb1aaf2a45?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'bottled-water',
    name: 'Mineral Water Set',
    category: 'Refreshments',
    description: 'A set of chilled bottled mineral water delivered to your room.',
    price: 12,
    stock: 30,
    imageUrl:
      'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'travel-adapter',
    name: 'Travel Adapter',
    category: 'Comfort',
    description: 'Universal adapter for guest convenience during the stay.',
    price: 25,
    stock: 6,
    imageUrl:
      'https://images.unsplash.com/photo-1625834311143-7b6f5c9fdb40?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'extra-bed',
    name: 'Extra Bed',
    category: 'Room Services',
    description: 'Additional bed setup for selected room types, subject to availability.',
    price: 60,
    stock: 4,
    badge: 'Limited',
    imageUrl:
      'https://images.unsplash.com/photo-1615874959474-d609969a20ed?auto=format&fit=crop&w=900&q=80',
  },
];

const formatCurrency = (amount: number) => `RM${amount.toFixed(2)}`;

export default function GuestShopPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [room, setRoom] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');

  const visibleItems = useMemo(() => {
    if (activeCategory === 'All') return SHOP_ITEMS;
    return SHOP_ITEMS.filter((item) => item.category === activeCategory);
  }, [activeCategory]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartItems.reduce((sum, row) => sum + row.quantity, 0);
  const total = cartItems.reduce((sum, row) => sum + row.item.price * row.quantity, 0);

  function addToCart(item: ShopItem) {
    if (item.stock <= 0) return;

    setCart((current) => {
      const existing = current[item.id];
      const nextQuantity = Math.min((existing?.quantity ?? 0) + 1, item.stock);

      return {
        ...current,
        [item.id]: {
          item,
          quantity: nextQuantity,
        },
      };
    });
    setCheckoutMessage('');
  }

  function updateQuantity(itemId: string, quantity: number) {
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

  function startCheckout() {
    if (!cartItems.length) {
      setCheckoutMessage('Please select at least one item before payment.');
      return;
    }

    if (!room.trim() || !guestName.trim() || !email.trim()) {
      setCheckoutMessage('Please enter room number, guest name, and email before payment.');
      return;
    }

    setCheckoutMessage(
      'Payment link setup is ready for Billplz integration. A ticket will only be released after verified successful payment.'
    );
  }

  return (
    <main className="shop-page">
      <header className="shop-nav">
        <a className="shop-brand" href="/guest-shop" aria-label="Hallmark Crown Hotel guest shop">
          <span className="shop-logo">
            <img src="/logo.png" alt="" />
          </span>
          <span>
            <span className="brand-overline">Hallmark Crown Hotel</span>
            <strong>Guest Shop</strong>
          </span>
        </a>

        <a className="shop-cart-link" href="#order">
          <span>Cart</span>
          <b>{cartCount}</b>
        </a>
      </header>

      <section className="shop-hero">
        <div className="hero-copy">
          <span className="hero-kicker">In-room convenience</span>
          <h1>Hotel essentials, delivered with a quieter kind of luxury.</h1>
          <p>
            Browse guest services and add-ons from your room. Select what you need, confirm your
            order, and our team will prepare it after payment is verified.
          </p>
          <div className="hero-actions">
            <a href="#shop" className="primary-link">
              Start shopping
            </a>
            <a href="#order" className="secondary-link">
              View order
            </a>
          </div>
          <div className="hero-notes" aria-label="Guest shop benefits">
            <span>Secure payment flow</span>
            <span>Front office notified</span>
            <span>Room delivery</span>
          </div>
        </div>

        <div className="hero-feature" aria-label="Featured guest service">
          <div className="feature-image">
            <img
              src="https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80"
              alt="Premium hotel room service setting"
            />
          </div>
          <div className="feature-card">
            <span>Featured</span>
            <strong>Comfort Upgrade</strong>
            <p>Extra bed, pillows, adapters, and guest essentials in one calm ordering flow.</p>
          </div>
        </div>
      </section>

      <section id="shop" className="shop-section">
        <div className="section-heading">
          <span>Guest menu</span>
          <h2>Choose your items</h2>
        </div>

        <div className="category-row" role="tablist" aria-label="Shop categories">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={category === activeCategory ? 'active' : ''}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="shop-layout">
          <div className="product-grid">
            {visibleItems.map((item) => {
              const isUnavailable = item.stock <= 0;

              return (
                <article key={item.id} className="product-card">
                  <div className="product-media">
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
                    {item.badge ? <span className="product-badge">{item.badge}</span> : null}
                  </div>

                  <div className="product-body">
                    <div>
                      <span className="product-category">{item.category}</span>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                    </div>

                    <div className="product-footer">
                      <div>
                        <strong>{formatCurrency(item.price)}</strong>
                        <span>{isUnavailable ? 'Out of stock' : `${item.stock} available`}</span>
                      </div>
                      <button type="button" disabled={isUnavailable} onClick={() => addToCart(item)}>
                        {isUnavailable ? 'Unavailable' : 'Add'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside id="order" className="order-panel" aria-label="Guest order summary">
            <div className="order-heading">
              <span>Your order</span>
              <strong>{cartCount} item{cartCount === 1 ? '' : 's'}</strong>
            </div>

            <div className="order-lines">
              {cartItems.length ? (
                cartItems.map(({ item, quantity }) => (
                  <div key={item.id} className="order-line">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{formatCurrency(item.price)} each</span>
                    </div>
                    <div className="quantity-control">
                      <button type="button" onClick={() => updateQuantity(item.id, quantity - 1)}>
                        -
                      </button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => updateQuantity(item.id, quantity + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-cart">
                  <strong>Your cart is empty</strong>
                  <span>Select an item to begin.</span>
                </div>
              )}
            </div>

            <div className="guest-form">
              <label>
                Room number
                <input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Example: 1205" />
              </label>
              <label>
                Guest name
                <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Name on room" />
              </label>
              <label>
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="For optional receipt" />
              </label>
            </div>

            <div className="order-total">
              <span>Total</span>
              <strong>{formatCurrency(total)}</strong>
            </div>

            <button type="button" className="checkout-button" onClick={startCheckout}>
              Proceed to Billplz
            </button>

            {checkoutMessage ? <p className="checkout-message">{checkoutMessage}</p> : null}

            <p className="payment-note">
              Tickets and staff notifications should be released only after Billplz confirms a
              successful payment.
            </p>
          </aside>
        </div>
      </section>

      <section className="image-admin-note" aria-label="SKU image setup">
        <div>
          <span>SKU image control</span>
          <h2>Every product already has its own image field.</h2>
        </div>
        <p>
          To change an item photo, replace that item&apos;s <code>imageUrl</code>. When the SKU admin
          page is connected later, this same field can be saved from an upload form.
        </p>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f7f3ec;
        }

        .shop-page {
          min-height: 100vh;
          color: #122033;
          background:
            radial-gradient(circle at 12% 10%, rgba(196, 154, 92, 0.2), transparent 30%),
            linear-gradient(180deg, #fffaf1 0%, #f5f7fb 42%, #eef4fb 100%);
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .shop-nav {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px clamp(18px, 4vw, 56px);
          border-bottom: 1px solid rgba(113, 89, 54, 0.14);
          background: rgba(255, 250, 242, 0.88);
          backdrop-filter: blur(18px);
        }

        .shop-brand {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: inherit;
          text-decoration: none;
        }

        .shop-logo {
          display: grid;
          width: 46px;
          height: 46px;
          place-items: center;
          overflow: hidden;
          border: 1px solid rgba(143, 103, 54, 0.28);
          border-radius: 50%;
          background: #fffdf8;
          box-shadow: 0 14px 34px rgba(77, 53, 24, 0.12);
        }

        .shop-logo img {
          width: 32px;
          height: 32px;
          object-fit: contain;
        }

        .brand-overline,
        .hero-kicker,
        .section-heading span,
        .product-category,
        .image-admin-note span {
          display: block;
          color: #8b663a;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .shop-brand strong {
          display: block;
          font-size: 20px;
          letter-spacing: 0;
        }

        .shop-cart-link {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 44px;
          padding: 0 16px;
          color: #fff;
          border-radius: 999px;
          background: #0f2747;
          text-decoration: none;
          box-shadow: 0 16px 38px rgba(15, 39, 71, 0.22);
        }

        .shop-cart-link b {
          display: grid;
          min-width: 26px;
          height: 26px;
          place-items: center;
          color: #0f2747;
          border-radius: 50%;
          background: #d8b56d;
        }

        .shop-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
          gap: clamp(24px, 4vw, 54px);
          align-items: center;
          padding: clamp(28px, 6vw, 86px) clamp(18px, 4vw, 56px) clamp(24px, 5vw, 58px);
        }

        .hero-copy h1 {
          max-width: 760px;
          margin: 12px 0 18px;
          font-family:
            Georgia,
            "Times New Roman",
            serif;
          font-size: clamp(42px, 6vw, 78px);
          line-height: 0.96;
          letter-spacing: 0;
        }

        .hero-copy p {
          max-width: 660px;
          margin: 0;
          color: #51647e;
          font-size: clamp(16px, 2vw, 20px);
          line-height: 1.7;
        }

        .hero-actions,
        .hero-notes,
        .category-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .hero-actions {
          margin-top: 28px;
        }

        .primary-link,
        .secondary-link,
        .category-row button,
        .product-footer button,
        .checkout-button {
          min-height: 46px;
          border-radius: 999px;
          border: 1px solid transparent;
          font-weight: 900;
          text-decoration: none;
          cursor: pointer;
        }

        .primary-link,
        .checkout-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 22px;
          color: #fff;
          background: #194cff;
          box-shadow: 0 18px 42px rgba(25, 76, 255, 0.25);
        }

        .secondary-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 22px;
          color: #0f2747;
          border-color: rgba(15, 39, 71, 0.18);
          background: rgba(255, 255, 255, 0.72);
        }

        .hero-notes {
          margin-top: 24px;
          color: #566981;
          font-size: 14px;
          font-weight: 800;
        }

        .hero-notes span {
          padding: 9px 12px;
          border: 1px solid rgba(143, 103, 54, 0.18);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.68);
        }

        .hero-feature {
          position: relative;
          min-height: 500px;
          overflow: hidden;
          border: 1px solid rgba(143, 103, 54, 0.18);
          border-radius: 34px;
          background: #1d2c42;
          box-shadow: 0 34px 90px rgba(25, 36, 52, 0.2);
        }

        .feature-image,
        .feature-image img {
          width: 100%;
          height: 100%;
        }

        .feature-image {
          position: absolute;
          inset: 0;
        }

        .feature-image img {
          object-fit: cover;
          opacity: 0.84;
        }

        .feature-card {
          position: absolute;
          right: 24px;
          bottom: 24px;
          left: 24px;
          padding: 22px;
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 24px;
          background: rgba(10, 22, 38, 0.72);
          backdrop-filter: blur(18px);
        }

        .feature-card span {
          color: #d8b56d;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .feature-card strong {
          display: block;
          margin-top: 8px;
          font-size: 28px;
        }

        .feature-card p {
          margin: 8px 0 0;
          color: rgba(255, 255, 255, 0.78);
          line-height: 1.5;
        }

        .shop-section,
        .image-admin-note {
          margin: 0 clamp(18px, 4vw, 56px) clamp(24px, 5vw, 58px);
        }

        .section-heading {
          margin-bottom: 18px;
        }

        .section-heading h2,
        .image-admin-note h2 {
          margin: 6px 0 0;
          font-size: clamp(28px, 4vw, 42px);
          letter-spacing: 0;
        }

        .category-row {
          margin-bottom: 22px;
        }

        .category-row button {
          padding: 0 18px;
          color: #33445b;
          border-color: rgba(16, 39, 71, 0.14);
          background: rgba(255, 255, 255, 0.72);
        }

        .category-row button.active {
          color: #fff;
          background: #0f2747;
        }

        .shop-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);
          gap: 24px;
          align-items: start;
        }

        .product-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }

        .product-card,
        .order-panel,
        .image-admin-note {
          border: 1px solid rgba(95, 124, 157, 0.18);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 24px 70px rgba(30, 52, 80, 0.1);
        }

        .product-card {
          display: flex;
          min-height: 450px;
          overflow: hidden;
          flex-direction: column;
        }

        .product-media {
          position: relative;
          height: 220px;
          overflow: hidden;
          background: linear-gradient(135deg, #f8efe0, #eaf2ff);
        }

        .product-media img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .image-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: rgba(15, 39, 71, 0.42);
          font-size: 44px;
          font-weight: 900;
        }

        .product-badge {
          position: absolute;
          top: 14px;
          left: 14px;
          padding: 8px 11px;
          color: #3d2811;
          border-radius: 999px;
          background: rgba(255, 244, 214, 0.92);
          font-size: 12px;
          font-weight: 900;
        }

        .product-body {
          display: flex;
          flex: 1;
          flex-direction: column;
          justify-content: space-between;
          gap: 22px;
          padding: 20px;
        }

        .product-body h3 {
          margin: 8px 0;
          font-size: 22px;
          letter-spacing: 0;
        }

        .product-body p {
          margin: 0;
          color: #60728b;
          line-height: 1.55;
        }

        .product-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-top: 16px;
          border-top: 1px solid rgba(95, 124, 157, 0.16);
        }

        .product-footer strong {
          display: block;
          font-size: 22px;
        }

        .product-footer span {
          display: block;
          color: #687b93;
          font-size: 13px;
          font-weight: 800;
        }

        .product-footer button {
          min-width: 82px;
          padding: 0 18px;
          color: #fff;
          background: #0f2747;
        }

        .product-footer button:disabled {
          cursor: not-allowed;
          color: #75869b;
          background: #e7edf4;
        }

        .order-panel {
          position: sticky;
          top: 92px;
          padding: 22px;
        }

        .order-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .order-heading span {
          color: #8b663a;
          font-weight: 900;
          text-transform: uppercase;
        }

        .order-heading strong {
          color: #0f2747;
        }

        .order-lines {
          display: grid;
          gap: 12px;
        }

        .order-line,
        .empty-cart {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px;
          border: 1px solid rgba(95, 124, 157, 0.16);
          border-radius: 18px;
          background: rgba(247, 250, 253, 0.86);
        }

        .order-line strong,
        .empty-cart strong {
          display: block;
        }

        .order-line span,
        .empty-cart span {
          display: block;
          margin-top: 4px;
          color: #687b93;
          font-size: 13px;
          font-weight: 800;
        }

        .quantity-control {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px;
          border-radius: 999px;
          background: #fff;
          box-shadow: inset 0 0 0 1px rgba(95, 124, 157, 0.16);
        }

        .quantity-control button {
          display: grid;
          width: 30px;
          height: 30px;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: #eef4fb;
          font-weight: 900;
        }

        .quantity-control span {
          min-width: 20px;
          margin: 0;
          color: #122033;
          text-align: center;
        }

        .guest-form {
          display: grid;
          gap: 12px;
          margin-top: 18px;
        }

        .guest-form label {
          color: #4d5f77;
          font-size: 13px;
          font-weight: 900;
        }

        .guest-form input {
          width: 100%;
          min-height: 46px;
          margin-top: 7px;
          padding: 0 14px;
          color: #122033;
          border: 1px solid rgba(95, 124, 157, 0.22);
          border-radius: 15px;
          background: #fff;
          font: inherit;
          box-sizing: border-box;
        }

        .order-total {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 20px 0 14px;
          padding-top: 18px;
          border-top: 1px solid rgba(95, 124, 157, 0.16);
        }

        .order-total span {
          color: #687b93;
          font-weight: 900;
        }

        .order-total strong {
          font-size: 34px;
          letter-spacing: 0;
        }

        .checkout-button {
          width: 100%;
          border: 0;
          font-size: 16px;
        }

        .checkout-message,
        .payment-note {
          margin: 14px 0 0;
          color: #52667f;
          line-height: 1.5;
        }

        .checkout-message {
          padding: 12px;
          border: 1px solid rgba(216, 181, 109, 0.46);
          border-radius: 16px;
          background: rgba(255, 247, 225, 0.82);
          font-weight: 800;
        }

        .payment-note {
          font-size: 13px;
        }

        .image-admin-note {
          display: grid;
          grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
          gap: 18px;
          align-items: center;
          padding: 24px;
        }

        .image-admin-note p {
          margin: 0;
          color: #5d7089;
          line-height: 1.65;
        }

        .image-admin-note code {
          padding: 2px 6px;
          border-radius: 8px;
          background: rgba(25, 76, 255, 0.1);
          color: #194cff;
          font-weight: 900;
        }

        @media (max-width: 1180px) {
          .shop-layout {
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
          .shop-nav {
            padding: 14px 16px;
          }

          .shop-brand strong {
            font-size: 16px;
          }

          .brand-overline {
            font-size: 9px;
          }

          .shop-cart-link {
            min-height: 40px;
            padding: 0 12px;
          }

          .shop-cart-link span {
            display: none;
          }

          .shop-hero {
            grid-template-columns: 1fr;
            padding: 28px 16px;
          }

          .hero-copy h1 {
            font-size: 40px;
          }

          .hero-feature {
            min-height: 360px;
            border-radius: 26px;
          }

          .shop-section,
          .image-admin-note {
            margin-right: 16px;
            margin-left: 16px;
          }

          .product-grid {
            grid-template-columns: 1fr;
          }

          .product-card {
            min-height: 0;
          }

          .product-media {
            height: 210px;
          }

          .image-admin-note {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 520px) {
          .hero-actions a,
          .category-row button {
            width: 100%;
          }

          .category-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .category-row button {
            padding: 0 10px;
          }

          .product-footer,
          .order-line {
            align-items: stretch;
            flex-direction: column;
          }

          .product-footer button {
            width: 100%;
          }

          .quantity-control {
            justify-content: space-between;
          }

          .order-total strong {
            font-size: 28px;
          }
        }
      `}</style>
    </main>
  );
}
