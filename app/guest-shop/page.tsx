'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type Category = string;

type ShopItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  accent: string;
  label?: string;
};

type CartItem = {
  item: ShopItem;
  quantity: number;
};

const DEFAULT_CATEGORIES: Category[] = ['All', 'Comfort', 'Laundry', 'Room Service', 'Essentials'];

const DEFAULT_HERO = {
  hero_image_url:
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1800&q=84',
  hero_kicker: 'Private in-room collection',
  hero_title: 'Quiet luxuries, ready on request.',
  hero_body:
    'Order selected comforts, guest essentials, and hotel services from your room. Prepared by the team after verified payment.',
  featured_item_id: null as string | null,
};

const DEFAULT_SHOP_ITEMS: ShopItem[] = [
  {
    id: 'late-checkout',
    name: 'Late Check-Out',
    category: 'Room Service',
    description: 'Extend your stay comfortably, subject to front office confirmation.',
    price: 60,
    stock: 8,
    accent: '#b6813a',
    label: 'Limited daily',
    imageUrl:
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1100&q=82',
  },
  {
    id: 'express-laundry',
    name: 'Express Laundry',
    category: 'Laundry',
    description: 'Priority laundry handling for garments that need a faster return.',
    price: 40,
    stock: 12,
    accent: '#28605f',
    imageUrl:
      'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&w=1100&q=82',
  },
  {
    id: 'extra-bed',
    name: 'Extra Bed',
    category: 'Comfort',
    description: 'Additional bed setup for selected room categories and family stays.',
    price: 60,
    stock: 4,
    accent: '#7c463a',
    label: 'Upon request',
    imageUrl:
      'https://images.unsplash.com/photo-1615874959474-d609969a20ed?auto=format&fit=crop&w=1100&q=82',
  },
  {
    id: 'extra-pillow',
    name: 'Extra Pillow',
    category: 'Comfort',
    description: 'Fresh pillow delivered to your room for a more restful night.',
    price: 15,
    stock: 18,
    accent: '#725a92',
    imageUrl:
      'https://images.unsplash.com/photo-1585495336621-dcfb1aaf2a45?auto=format&fit=crop&w=1100&q=82',
  },
  {
    id: 'travel-adapter',
    name: 'Travel Adapter',
    category: 'Essentials',
    description: 'Universal adapter prepared for guest convenience during your stay.',
    price: 25,
    stock: 6,
    accent: '#254f78',
    imageUrl:
      'https://images.unsplash.com/photo-1625834311143-7b6f5c9fdb40?auto=format&fit=crop&w=1100&q=82',
  },
  {
    id: 'mineral-water',
    name: 'Mineral Water Set',
    category: 'Essentials',
    description: 'Chilled bottled mineral water delivered directly to your room.',
    price: 12,
    stock: 30,
    accent: '#3c704d',
    imageUrl:
      'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=1100&q=82',
  },
];

function money(value: number) {
  return `RM${value.toFixed(2)}`;
}

export default function GuestShopPage() {
  const [items, setItems] = useState<ShopItem[]>(DEFAULT_SHOP_ITEMS);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [hero, setHero] = useState(DEFAULT_HERO);
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  const visibleItems = useMemo(() => {
    if (activeCategory === 'All') return items;
    return items.filter((item) => item.category === activeCategory);
  }, [activeCategory, items]);

  const featuredItem =
    items.find((item) => item.id === hero.featured_item_id) || items[0] || DEFAULT_SHOP_ITEMS[0];
  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartItems.reduce((total, row) => total + row.quantity, 0);
  const cartTotal = cartItems.reduce((total, row) => total + row.item.price * row.quantity, 0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.history.scrollRestoration = 'manual';

    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadShop() {
      try {
        const [itemsRes, categoriesRes, settingsRes] = await Promise.all([
          fetch('/api/guest-shop/items', { cache: 'no-store' }),
          fetch('/api/guest-shop/categories', { cache: 'no-store' }),
          fetch('/api/guest-shop/settings', { cache: 'no-store' }),
        ]);

        const json = await itemsRes.json();
        const categoriesJson = await categoriesRes.json();
        const settingsJson = await settingsRes.json();
        if (!alive) return;

        if (categoriesJson?.ok && Array.isArray(categoriesJson.categories)) {
          const nextCategories = categoriesJson.categories
            .filter((category: any) => category?.is_active !== false)
            .map((category: any) => String(category?.name || '').trim())
            .filter(Boolean);

          if (nextCategories.length) setCategories(['All', ...nextCategories]);
        }

        if (settingsJson?.ok && settingsJson.settings) {
          setHero({
            hero_image_url: String(settingsJson.settings.hero_image_url || DEFAULT_HERO.hero_image_url),
            hero_kicker: String(settingsJson.settings.hero_kicker || DEFAULT_HERO.hero_kicker),
            hero_title: String(settingsJson.settings.hero_title || DEFAULT_HERO.hero_title),
            hero_body: String(settingsJson.settings.hero_body || DEFAULT_HERO.hero_body),
            featured_item_id: settingsJson.settings.featured_item_id
              ? String(settingsJson.settings.featured_item_id)
              : null,
          });
        }

        if (!json?.ok || !Array.isArray(json.items) || !json.items.length) return;

        const nextItems = json.items
          .filter((item: any) => item?.is_active !== false)
          .map((item: any): ShopItem => ({
            id: String(item.id),
            name: String(item.name || ''),
            category: String(item.category || 'Essentials'),
            description: String(item.description || ''),
            price: Number(item.price_myr || 0),
            stock: item.out_of_stock ? 0 : Math.max(0, Number(item.stock || 0)),
            imageUrl: String(item.image_url || ''),
            accent: String(item.accent || '#b6813a'),
            label: String(item.label || ''),
          }))
          .filter((item: ShopItem) => item.name);

        if (nextItems.length) {
          setItems(nextItems);
          setCategories((current) => {
            const itemCategories = nextItems.map((item) => item.category).filter(Boolean);
            return ['All', ...Array.from(new Set([...current.filter((item) => item !== 'All'), ...itemCategories]))];
          });
        }
      } catch {
        // Keep the curated fallback so the guest shop stays usable if the catalog table is not ready.
      }
    }

    loadShop();

    return () => {
      alive = false;
    };
  }, []);

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
      <section
        className="hero"
        style={{ '--hero-image': `url("${hero.hero_image_url}")` } as CSSProperties}
      >
        <img
          className="hero-image"
          src={hero.hero_image_url}
          alt="Luxury hotel suite"
        />
        <div className="hero-shade" />

        <header className="nav">
          <a className="brand" href="/guest-shop" aria-label="Hallmark Crown Hotel guest shop">
            <span className="brand-mark">
              <img src="/logo.png" alt="" />
            </span>
            <span>
              <small>Hallmark Crown Hotel</small>
              <strong>Guest Shop</strong>
            </span>
          </a>

          <a className="cart-button" href="#order">
            <span>Order</span>
            <b>{cartCount}</b>
          </a>
        </header>

        <div className="hero-content">
          <p className="eyebrow">{hero.hero_kicker}</p>
          <h1>{hero.hero_title}</h1>
          <p className="hero-copy">{hero.hero_body}</p>

          <div className="hero-actions">
            <a href="#shop" className="primary-action">
              Explore collection
            </a>
            <a href="#order" className="secondary-action">
              View order
            </a>
          </div>
        </div>

        <div className="hero-feature">
          <span>Tonight&apos;s selection</span>
          <strong>{featuredItem.name}</strong>
          <p>{featuredItem.description}</p>
          <button type="button" onClick={() => addItem(featuredItem)}>
            Add {money(featuredItem.price)}
          </button>
        </div>
      </section>

      <section id="shop" className="collection">
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

        <div className="collection-head">
          <div>
            <p className="eyebrow">Guest menu</p>
            <h2>Curated for your stay</h2>
          </div>
        </div>

        <div className="shop-grid">
          <div className="products">
            {visibleItems.map((item) => {
              const isUnavailable = item.stock <= 0;

              return (
                <article className="product-card" key={item.id}>
                  <div className="product-image" style={{ '--accent': item.accent } as CSSProperties}>
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
                    <span className="category-chip">{item.category}</span>
                    {item.label ? <span className="item-label">{item.label}</span> : null}
                  </div>

                  <div className="product-info">
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                    </div>

                    <div className="product-footer">
                      <div>
                        <strong>{money(item.price)}</strong>
                        <span>{isUnavailable ? 'Out of stock' : `${item.stock} available`}</span>
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
            <div className="order-header">
              <p className="eyebrow">Your order</p>
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
                <div className="empty-order">
                  <strong>No items selected</strong>
                  <span>Add an item to begin your order.</span>
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

            <button type="button" className="payment-button" onClick={proceedToPayment}>
              Proceed to payment
            </button>

            {notice ? <p className="notice">{notice}</p> : null}

            <p className="payment-note">
              Staff receives the order only after payment is verified by the payment provider.
            </p>
          </aside>
        </div>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f1eee8;
        }

        .guest-shop {
          min-height: 100vh;
          color: #16110d;
          background:
            linear-gradient(180deg, #f7f3ec 0%, #eef3f2 54%, #f4efe7 100%);
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .hero {
          position: relative;
          min-height: min(760px, 92vh);
          overflow: hidden;
          background: #080808;
          color: #fff8ed;
          isolation: isolate;
        }

        .hero::before {
          position: absolute;
          inset: -28px;
          z-index: -3;
          content: "";
          background-image: var(--hero-image);
          background-position: center;
          background-size: cover;
          filter: blur(20px) saturate(1.08);
          transform: scale(1.08);
          opacity: 0.8;
        }

        .hero-image,
        .hero-shade {
          position: absolute;
          inset: 0;
        }

        .hero-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          object-position: center center;
          padding: clamp(18px, 3vw, 42px);
          box-sizing: border-box;
          z-index: -2;
        }

        .hero-shade {
          z-index: -1;
          background:
            radial-gradient(circle at 70% 42%, rgba(255, 236, 189, 0.08), transparent 30%),
            linear-gradient(90deg, rgba(8, 8, 10, 0.88) 0%, rgba(8, 8, 10, 0.62) 42%, rgba(8, 8, 10, 0.34) 100%),
            linear-gradient(180deg, rgba(8, 8, 10, 0.2) 0%, rgba(8, 8, 10, 0.78) 100%);
        }

        .nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 22px clamp(18px, 4vw, 64px);
        }

        .brand,
        .cart-button,
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
          width: 52px;
          height: 52px;
          place-items: center;
          overflow: hidden;
          border: 1px solid rgba(230, 203, 160, 0.42);
          border-radius: 50%;
          background: rgba(255, 249, 238, 0.96);
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.18);
        }

        .brand-mark img {
          width: 34px;
          height: 34px;
          object-fit: contain;
        }

        .brand small,
        .eyebrow {
          display: block;
          color: #dfbf77;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .brand strong {
          display: block;
          margin-top: 2px;
          font-size: 21px;
          letter-spacing: 0;
        }

        .cart-button {
          display: inline-flex;
          min-height: 46px;
          align-items: center;
          gap: 10px;
          padding: 0 16px;
          border: 1px solid rgba(255, 248, 235, 0.24);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(18px);
          font-weight: 900;
        }

        .cart-button b {
          display: grid;
          min-width: 28px;
          height: 28px;
          place-items: center;
          color: #17110c;
          border-radius: 50%;
          background: #dfbf77;
        }

        .hero-content {
          width: min(760px, calc(100% - 36px));
          padding: clamp(48px, 9vw, 128px) clamp(18px, 4vw, 64px) 160px;
        }

        .hero-content h1 {
          margin: 14px 0 18px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(50px, 8vw, 112px);
          font-weight: 500;
          line-height: 0.9;
          letter-spacing: 0;
        }

        .hero-copy {
          max-width: 620px;
          margin: 0;
          color: rgba(255, 248, 237, 0.84);
          font-size: clamp(17px, 2vw, 22px);
          line-height: 1.7;
        }

        .hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 30px;
        }

        .hero-actions a,
        .hero-feature button,
        .categories button,
        .product-footer button,
        .payment-button {
          min-height: 48px;
          border: 1px solid transparent;
          border-radius: 999px;
          font-weight: 900;
          cursor: pointer;
        }

        .primary-action,
        .payment-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          color: #17110c;
          background: linear-gradient(135deg, #f2d68c, #c8933d);
          box-shadow: 0 22px 50px rgba(18, 12, 6, 0.24);
        }

        .secondary-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 24px;
          color: #fff7e8;
          border-color: rgba(255, 248, 235, 0.28);
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(18px);
        }

        .hero-feature {
          position: absolute;
          right: clamp(18px, 4vw, 64px);
          bottom: 34px;
          width: min(420px, calc(100% - 36px));
          padding: 22px;
          border: 1px solid rgba(255, 248, 235, 0.22);
          border-radius: 24px;
          background: rgba(15, 16, 18, 0.56);
          backdrop-filter: blur(20px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
        }

        .hero-feature span {
          color: #dfbf77;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .hero-feature strong {
          display: block;
          margin-top: 8px;
          font-size: 28px;
        }

        .hero-feature p {
          margin: 8px 0 16px;
          color: rgba(255, 248, 237, 0.78);
          line-height: 1.5;
        }

        .hero-feature button {
          width: 100%;
          color: #17110c;
          background: #fff8ed;
        }

        .collection {
          padding: clamp(34px, 6vw, 82px) clamp(18px, 4vw, 64px) clamp(38px, 6vw, 90px);
        }

        .collection-head {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 22px;
          margin-bottom: 22px;
        }

        .collection-head h2 {
          margin: 6px 0 0;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(34px, 5vw, 58px);
          font-weight: 500;
          letter-spacing: 0;
        }

        .collection .eyebrow {
          color: #9a6b31;
        }

        .categories {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 10px;
          margin-bottom: 18px;
        }

        .categories button {
          min-height: 44px;
          padding: 0 17px;
          color: #403326;
          border-color: rgba(104, 82, 53, 0.16);
          background: rgba(255, 252, 246, 0.86);
        }

        .categories button.active {
          color: #fff7e8;
          background: #1b1713;
        }

        .shop-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(330px, 420px);
          gap: 26px;
          align-items: start;
        }

        .products {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
        }

        .product-card,
        .order-panel {
          overflow: hidden;
          border: 1px solid rgba(91, 74, 50, 0.14);
          border-radius: 26px;
          background: rgba(255, 252, 246, 0.88);
          box-shadow: 0 24px 70px rgba(44, 34, 23, 0.09);
        }

        .product-card {
          display: flex;
          min-height: 478px;
          flex-direction: column;
        }

        .product-image {
          position: relative;
          height: 268px;
          overflow: hidden;
          background: color-mix(in srgb, var(--accent) 14%, #fbf5ea);
        }

        .product-image::after {
          position: absolute;
          inset: auto 0 0;
          height: 52%;
          content: "";
          background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.42));
          pointer-events: none;
        }

        .product-image img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 260ms ease;
        }

        .product-card:hover .product-image img {
          transform: scale(1.04);
        }

        .image-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: color-mix(in srgb, var(--accent) 62%, #fff);
          font-size: 44px;
          font-weight: 900;
        }

        .category-chip,
        .item-label {
          position: absolute;
          z-index: 2;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .category-chip {
          left: 14px;
          bottom: 14px;
          padding: 8px 11px;
          color: #fff8ed;
          background: rgba(18, 15, 12, 0.62);
          backdrop-filter: blur(12px);
        }

        .item-label {
          top: 14px;
          left: 14px;
          padding: 8px 11px;
          color: #2e1f0e;
          background: rgba(246, 224, 170, 0.94);
        }

        .product-info {
          display: flex;
          flex: 1;
          flex-direction: column;
          justify-content: space-between;
          gap: 18px;
          padding: 20px;
        }

        .product-info h3 {
          margin: 0 0 8px;
          font-size: 23px;
          letter-spacing: 0;
        }

        .product-info p {
          margin: 0;
          color: #655b51;
          line-height: 1.56;
        }

        .product-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-top: 16px;
          border-top: 1px solid rgba(91, 74, 50, 0.13);
        }

        .product-footer strong {
          display: block;
          font-size: 24px;
          letter-spacing: 0;
        }

        .product-footer span {
          display: block;
          margin-top: 4px;
          color: #766b5f;
          font-size: 13px;
          font-weight: 800;
        }

        .product-footer button {
          min-width: 84px;
          padding: 0 18px;
          color: #fff7e8;
          background: #1b1713;
        }

        .product-footer button:disabled {
          cursor: not-allowed;
          color: #887d72;
          background: #ece5dc;
        }

        .order-panel {
          position: sticky;
          top: 24px;
          padding: 22px;
        }

        .order-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .order-header strong {
          color: #1b1713;
        }

        .order-lines,
        .guest-details {
          display: grid;
          gap: 12px;
        }

        .order-line,
        .empty-order {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px;
          border: 1px solid rgba(91, 74, 50, 0.12);
          border-radius: 18px;
          background: rgba(255, 250, 241, 0.88);
        }

        .order-line strong,
        .empty-order strong {
          display: block;
        }

        .order-line span,
        .empty-order span {
          display: block;
          margin-top: 4px;
          color: #766b5f;
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
          box-shadow: inset 0 0 0 1px rgba(91, 74, 50, 0.12);
        }

        .stepper button {
          display: grid;
          width: 30px;
          height: 30px;
          place-items: center;
          border: 0;
          border-radius: 50%;
          background: #f1e7d8;
          font-weight: 900;
          cursor: pointer;
        }

        .stepper span {
          min-width: 20px;
          color: #17110c;
          text-align: center;
        }

        .guest-details {
          margin-top: 18px;
        }

        .guest-details label {
          color: #5e5349;
          font-size: 13px;
          font-weight: 900;
        }

        .guest-details input {
          width: 100%;
          min-height: 46px;
          margin-top: 7px;
          padding: 0 14px;
          border: 1px solid rgba(91, 74, 50, 0.16);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.92);
          color: #17110c;
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
          border-top: 1px solid rgba(91, 74, 50, 0.13);
        }

        .total-row span {
          color: #766b5f;
          font-weight: 900;
        }

        .total-row strong {
          font-size: 36px;
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
          border-radius: 16px;
          background: rgba(255, 246, 226, 0.82);
          font-weight: 800;
        }

        .payment-note {
          font-size: 13px;
        }

        @media (max-width: 1180px) {
          .shop-grid {
            grid-template-columns: 1fr;
          }

          .order-panel {
            position: static;
          }

          .products {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .hero {
            min-height: 100svh;
            display: flex;
            flex-direction: column;
          }

          .hero-image {
            inset: 0 0 auto;
            height: 58svh;
            min-height: 360px;
            padding: 8px;
            object-position: center top;
          }

          .nav {
            padding: 16px;
          }

          .brand strong {
            font-size: 16px;
          }

          .brand small {
            font-size: 9px;
          }

          .brand-mark {
            width: 46px;
            height: 46px;
          }

          .cart-button {
            min-height: 42px;
            padding: 0 12px;
          }

          .cart-button span {
            display: none;
          }

          .hero-content {
            width: auto;
            margin-top: auto;
            padding: 18px 16px 150px;
          }

          .hero-content h1 {
            font-size: 52px;
          }

          .hero-feature {
            right: 16px;
            bottom: 14px;
            left: 16px;
            width: auto;
            padding: 16px;
          }

          .collection {
            padding-right: 16px;
            padding-left: 16px;
          }

          .collection-head {
            align-items: stretch;
            flex-direction: column;
          }

          .categories {
            justify-content: flex-start;
          }

          .products {
            grid-template-columns: 1fr;
          }

          .product-card {
            min-height: 0;
          }
        }

        @media (max-width: 520px) {
          .hero-content h1 {
            font-size: 46px;
          }

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

          .product-image {
            height: 234px;
          }

          .product-footer,
          .order-line {
            align-items: stretch;
            flex-direction: column;
          }

          .product-footer button {
            width: 100%;
          }

          .stepper {
            justify-content: space-between;
          }

          .total-row strong {
            font-size: 30px;
          }
        }
      `}</style>
    </main>
  );
}
