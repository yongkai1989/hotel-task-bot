'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type Category = string;

type ShopItem = {
  id: string;
  name: string;
  category: string;
  submenu: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  accent: string;
  label?: string;
  isFnb: boolean;
  optionGroups: OptionGroup[];
};

type OptionChoice = {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
};

type OptionGroup = {
  id: string;
  name: string;
  selectionType: 'single' | 'multiple';
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: OptionChoice[];
};

type SelectedOptionGroup = {
  groupId: string;
  optionIds: string[];
};

type CartItem = {
  cartKey: string;
  item: ShopItem;
  quantity: number;
  selectedOptions: SelectedOptionGroup[];
  unitPrice: number;
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
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
    submenu: '',
    isFnb: false,
    optionGroups: [],
    accent: '#3c704d',
    imageUrl:
      'https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&w=1100&q=82',
  },
];

function money(value: number) {
  return `RM${value.toFixed(2)}`;
}

function normalizeOptionGroups(value: any): OptionGroup[] {
  if (!Array.isArray(value)) return [];

  return value.map((group: any) => ({
    id: String(group?.id || ''),
    name: String(group?.name || ''),
    selectionType: String(group?.selection_type || 'single') === 'multiple' ? 'multiple' : 'single',
    isRequired: group?.is_required === true,
    minSelect: Math.max(0, Number(group?.min_select || 0)),
    maxSelect: Math.max(0, Number(group?.max_select || 0)),
    options: Array.isArray(group?.options)
      ? group.options.map((option: any) => ({
          id: String(option?.id || ''),
          name: String(option?.name || ''),
          priceDelta: Number(option?.price_delta_myr || 0),
          isDefault: option?.is_default === true,
        })).filter((option: OptionChoice) => option.id && option.name)
      : [],
  })).filter((group: OptionGroup) => group.id && group.name && group.options.length);
}

function defaultSelection(item: ShopItem): SelectedOptionGroup[] {
  return item.optionGroups.map((group) => {
    const defaults = group.options.filter((option) => option.isDefault).map((option) => option.id);
    return {
      groupId: group.id,
      optionIds: group.selectionType === 'single' ? defaults.slice(0, 1) : defaults,
    };
  });
}

function cartKeyFor(item: ShopItem, selectedOptions: SelectedOptionGroup[]) {
  const clean = selectedOptions
    .map((group) => ({
      groupId: group.groupId,
      optionIds: [...group.optionIds].sort(),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  return `${item.id}:${JSON.stringify(clean)}`;
}

function unitPriceFor(item: ShopItem, selectedOptions: SelectedOptionGroup[]) {
  const optionIds = new Set(selectedOptions.flatMap((group) => group.optionIds));
  const addOns = item.optionGroups.flatMap((group) => group.options)
    .filter((option) => optionIds.has(option.id))
    .reduce((total, option) => total + option.priceDelta, 0);

  return Number((item.price + addOns).toFixed(2));
}

function selectedOptionLabels(item: ShopItem, selectedOptions: SelectedOptionGroup[]) {
  const optionIds = new Set(selectedOptions.flatMap((group) => group.optionIds));
  return item.optionGroups.flatMap((group) =>
    group.options
      .filter((option) => optionIds.has(option.id))
      .map((option) => `${group.name}: ${option.name}${option.priceDelta ? ` +${money(option.priceDelta)}` : ''}`)
  );
}

export default function GuestShopPage() {
  const [items, setItems] = useState<ShopItem[]>(DEFAULT_SHOP_ITEMS);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [hero, setHero] = useState(DEFAULT_HERO);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [activeSubmenu, setActiveSubmenu] = useState('All');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [selectedOptionsByItem, setSelectedOptionsByItem] = useState<Record<string, SelectedOptionGroup[]>>({});

  const visibleItems = useMemo(() => {
    const categoryItems = activeCategory === 'All'
      ? items
      : items.filter((item) => item.category === activeCategory);

    if (activeSubmenu === 'All') return categoryItems;
    return categoryItems.filter((item) => item.submenu === activeSubmenu);
  }, [activeCategory, activeSubmenu, items]);

  const submenuChoices = useMemo(() => {
    if (activeCategory === 'All') return [];
    const choices = items
      .filter((item) => item.category === activeCategory)
      .map((item) => item.submenu)
      .filter(Boolean);
    return ['All', ...Array.from(new Set(choices))];
  }, [activeCategory, items]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartItems.reduce((total, row) => total + row.quantity, 0);
  const cartTotal = cartItems.reduce((total, row) => total + row.unitPrice * row.quantity, 0);
  const heroStyle = {
    '--hero-image': heroLoaded ? `url("${hero.hero_image_url}")` : 'none',
  } as CSSProperties;

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
        setHeroLoaded(true);

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
            submenu: String(item.submenu || ''),
            isFnb: item.is_fnb === true,
            optionGroups: normalizeOptionGroups(item.option_groups),
          }))
          .filter((item: ShopItem) => item.name);

        if (nextItems.length) {
          setItems(nextItems);
          setSelectedOptionsByItem((current) => {
            const next = { ...current };
            for (const item of nextItems) {
              if (!next[item.id]) next[item.id] = defaultSelection(item);
            }
            return next;
          });
          setCategories((current) => {
            const itemCategories = nextItems.map((item) => item.category).filter(Boolean);
            return ['All', ...Array.from(new Set([...current.filter((item) => item !== 'All'), ...itemCategories]))];
          });
        }
      } catch {
        if (alive) setHeroLoaded(true);
        // Keep the curated fallback so the guest shop stays usable if the catalog table is not ready.
      }
    }

    loadShop();

    return () => {
      alive = false;
    };
  }, []);

  function getSelection(item: ShopItem) {
    return selectedOptionsByItem[item.id] || defaultSelection(item);
  }

  function setGroupSelection(item: ShopItem, group: OptionGroup, optionId: string, checked: boolean) {
    setSelectedOptionsByItem((current) => {
      const existing = current[item.id] || defaultSelection(item);
      const next = existing.map((row) => ({ ...row, optionIds: [...row.optionIds] }));
      let target = next.find((row) => row.groupId === group.id);

      if (!target) {
        target = { groupId: group.id, optionIds: [] };
        next.push(target);
      }

      if (group.selectionType === 'single') {
        target.optionIds = checked ? [optionId] : [];
      } else {
        const set = new Set(target.optionIds);
        if (checked) set.add(optionId);
        else set.delete(optionId);
        target.optionIds = Array.from(set);
      }

      return { ...current, [item.id]: next };
    });
  }

  function addItem(item: ShopItem) {
    if (item.stock <= 0) return;

    const selectedOptions = getSelection(item);
    const missing = item.optionGroups.find((group) => {
      const selected = selectedOptions.find((row) => row.groupId === group.id)?.optionIds || [];
      return group.isRequired && selected.length < Math.max(1, group.minSelect);
    });

    if (missing) {
      setNotice(`Please choose ${missing.name} before adding ${item.name}.`);
      return;
    }

    const cartKey = cartKeyFor(item, selectedOptions);
    const unitPrice = unitPriceFor(item, selectedOptions);

    setCart((current) => {
      const existing = current[cartKey];
      const quantity = Math.min((existing?.quantity ?? 0) + 1, item.stock);

      return {
        ...current,
        [cartKey]: { cartKey, item, quantity, selectedOptions, unitPrice },
      };
    });
    setNotice('');
  }

  function setQuantity(cartKey: string, quantity: number) {
    setCart((current) => {
      const existing = current[cartKey];
      if (!existing) return current;

      if (quantity <= 0) {
        const next = { ...current };
        delete next[cartKey];
        return next;
      }

      return {
        ...current,
        [cartKey]: {
          ...existing,
          quantity: Math.min(quantity, existing.item.stock),
        },
      };
    });
  }

  async function proceedToPayment() {
    if (!cartItems.length) {
      setNotice('Please select at least one item before payment.');
      return;
    }

    if (!roomNumber.trim() || !guestName.trim()) {
      setNotice('Please enter room number and guest name before payment.');
      return;
    }

    try {
      setPaymentBusy(true);
      setNotice('Preparing secure payment...');

      const res = await fetch('/api/guest-shop/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNumber,
          guestName,
          email,
          items: cartItems.map(({ item, quantity, selectedOptions }) => ({
            id: item.id,
            quantity,
            selected_options: item.optionGroups.length
              ? selectedOptions.map((group) => ({
                  group_id: group.groupId,
                  option_ids: group.optionIds,
                }))
              : [],
          })),
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.payment_url) {
        throw new Error(json?.error || 'Unable to start payment');
      }

      window.location.href = String(json.payment_url);
    } catch (error: any) {
      setNotice(error?.message || 'Unable to start payment. Please contact Front Office.');
      setPaymentBusy(false);
    }
  }

  return (
    <main className="guest-shop">
      <section
        className={heroLoaded ? 'hero hero-ready' : 'hero'}
        style={heroStyle}
      >
        {heroLoaded ? (
          <img
            className="hero-image"
            src={hero.hero_image_url}
            alt="Luxury hotel suite"
          />
        ) : null}
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

          <a className="cart-button" href="#order" aria-label={`Cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
            <svg className="cart-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.2 7.8h13.1l-1.4 7.1a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.9H3.4" />
              <path d="M9.4 20.1h.1M17 20.1h.1" />
            </svg>
            <span>Cart</span>
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

      </section>

      <section id="shop" className="collection">
        <div className="categories" role="tablist" aria-label="Product categories">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={activeCategory === category ? 'active' : ''}
              onClick={() => {
                setActiveCategory(category);
                setActiveSubmenu('All');
              }}
            >
              {category}
            </button>
          ))}
        </div>

        {submenuChoices.length > 1 ? (
          <div className="submenus" role="tablist" aria-label={`${activeCategory} submenus`}>
            {submenuChoices.map((submenu) => (
              <button
                key={submenu}
                type="button"
                className={activeSubmenu === submenu ? 'active' : ''}
                onClick={() => setActiveSubmenu(submenu)}
              >
                {submenu}
              </button>
            ))}
          </div>
        ) : null}

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
              const selectedOptions = getSelection(item);
              const selectedCartKey = cartKeyFor(item, selectedOptions);
              const isAdded = Boolean(cart[selectedCartKey]);
              const displayPrice = unitPriceFor(item, selectedOptions);

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
                    {item.submenu ? <span className="submenu-chip">{item.submenu}</span> : null}
                    {item.label ? <span className="item-label">{item.label}</span> : null}
                  </div>

                  <div className="product-info">
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                    </div>

                    {item.optionGroups.length ? (
                      <div className="option-panel">
                        {item.optionGroups.map((group) => {
                          const selected = new Set(
                            selectedOptions.find((row) => row.groupId === group.id)?.optionIds || []
                          );

                          return (
                            <div className="option-group" key={group.id}>
                              <div className="option-title">
                                <span>{group.name}</span>
                                {group.isRequired ? <b>Required</b> : <b>Optional</b>}
                              </div>
                              <div className="option-list">
                                {group.options.map((option) => (
                                  <label className="option-pill" key={option.id}>
                                    <input
                                      type={group.selectionType === 'single' ? 'radio' : 'checkbox'}
                                      name={`${item.id}-${group.id}`}
                                      checked={selected.has(option.id)}
                                      onChange={(event) => setGroupSelection(item, group, option.id, event.target.checked)}
                                    />
                                    <span>{option.name}</span>
                                    {option.priceDelta ? <em>+{money(option.priceDelta)}</em> : null}
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="product-footer">
                      <div>
                        <strong>{money(displayPrice)}</strong>
                        <span>{isUnavailable ? 'Out of stock' : `${item.stock} available`}</span>
                      </div>
                      <button
                        type="button"
                        className={isAdded ? 'added' : ''}
                        disabled={isUnavailable}
                        onClick={() => addItem(item)}
                      >
                        {isUnavailable ? 'Unavailable' : isAdded ? 'Added' : 'Add'}
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
                cartItems.map(({ cartKey, item, quantity, selectedOptions, unitPrice }) => (
                  <div className="order-line" key={cartKey}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{money(unitPrice)} each</span>
                      {selectedOptionLabels(item, selectedOptions).length ? (
                        <small>{selectedOptionLabels(item, selectedOptions).join(', ')}</small>
                      ) : null}
                    </div>
                    <div className="stepper">
                      <button type="button" onClick={() => setQuantity(cartKey, quantity - 1)}>
                        -
                      </button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => setQuantity(cartKey, quantity + 1)}>
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
                Email (optional)
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="For receipt, optional"
                />
              </label>
            </div>

            <div className="total-row">
              <span>Total</span>
              <strong>{money(cartTotal)}</strong>
            </div>

            <button
              type="button"
              className="payment-button"
              onClick={proceedToPayment}
              disabled={paymentBusy}
            >
              {paymentBusy ? 'Opening secure payment...' : 'Proceed to payment'}
            </button>

            {notice ? <p className="notice">{notice}</p> : null}

            <p className="payment-note">
              Staff receives the order only after payment is verified by the payment provider.
            </p>
          </aside>
        </div>
      </section>

      <section className="front-office-contact" aria-label="Contact Front Office">
        <div>
          <p className="eyebrow">Need assistance?</p>
          <h2>Speak with Front Office</h2>
          <p>Questions about your order or a special request can be sent directly to our team.</p>
        </div>
        <a
          className="whatsapp-button"
          href="https://wa.me/60126308316"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contact Front Office on WhatsApp"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.5 21l4.7-1.2A8.8 8.8 0 1 0 12 3.2Z" />
            <path d="M8.8 8.5c.2-.5.4-.6.7-.6h.5c.2 0 .4.1.5.4l.8 1.8c.1.3 0 .5-.2.7l-.5.6c.8 1.4 1.8 2.3 3.2 3.1l.7-.7c.2-.2.4-.2.7-.1l1.7.8c.3.1.4.3.4.6v.5c0 .3-.1.6-.6.8-.5.2-1.2.4-2 .2-2.5-.5-5.5-3.1-6.5-5.5-.3-.8-.2-1.6 0-2.1Z" />
          </svg>
          <span>WhatsApp Front Office</span>
        </a>
      </section>

      <a
        className={cartCount > 0 ? 'floating-cart has-items' : 'floating-cart'}
        href="#order"
        aria-label={`Jump to cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}
      >
        <svg className="cart-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.2 7.8h13.1l-1.4 7.1a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.9H3.4" />
          <path d="M9.4 20.1h.1M17 20.1h.1" />
        </svg>
        <span>Cart</span>
        <b>{cartCount}</b>
      </a>

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
          background:
            radial-gradient(circle at 70% 28%, rgba(223, 191, 119, 0.12), transparent 32%),
            linear-gradient(135deg, #080808, #15110d);
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

        .cart-icon {
          width: 20px;
          height: 20px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
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

        .floating-cart {
          position: fixed;
          right: max(16px, env(safe-area-inset-right));
          bottom: max(16px, env(safe-area-inset-bottom));
          z-index: 60;
          display: inline-flex;
          min-height: 56px;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 0 16px;
          border: 1px solid rgba(255, 248, 235, 0.42);
          border-radius: 999px;
          color: #17110c;
          background: linear-gradient(135deg, #fff8ed, #f1d48b);
          box-shadow: 0 20px 48px rgba(43, 30, 14, 0.24);
          font-weight: 900;
          text-decoration: none;
          backdrop-filter: blur(18px);
        }

        .floating-cart.has-items {
          background: linear-gradient(135deg, #f2d68c, #c8933d);
        }

        .floating-cart b {
          display: grid;
          min-width: 28px;
          height: 28px;
          place-items: center;
          color: #fff8ed;
          border-radius: 50%;
          background: #1b1713;
          font-size: 13px;
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

        .payment-button:disabled {
          cursor: wait;
          opacity: 0.72;
          box-shadow: none;
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

        .submenus {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: -18px 0 24px;
        }

        .submenus button {
          min-height: 38px;
          padding: 0 15px;
          border: 1px solid rgba(104, 82, 53, 0.16);
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.72);
          color: #493728;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
        }

        .submenus button.active {
          color: #1f160c;
          background: linear-gradient(135deg, #f2d68c, #d7a24a);
          box-shadow: 0 16px 32px rgba(177, 119, 36, 0.14);
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
        .submenu-chip,
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

        .submenu-chip {
          right: 14px;
          bottom: 14px;
          padding: 8px 11px;
          color: #2e1f0e;
          background: rgba(255, 248, 233, 0.9);
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

        .option-panel {
          display: grid;
          gap: 12px;
          padding: 12px;
          border: 1px solid rgba(91, 74, 50, 0.1);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.58);
        }

        .option-group {
          display: grid;
          gap: 8px;
        }

        .option-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: #3e3329;
          font-size: 12px;
          font-weight: 900;
        }

        .option-title b {
          color: #a56a1d;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .option-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .option-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 34px;
          padding: 0 10px;
          border: 1px solid rgba(91, 74, 50, 0.13);
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.94);
          color: #2d241b;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .option-pill input {
          accent-color: #1b1713;
        }

        .option-pill em {
          color: #a56a1d;
          font-style: normal;
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

        .product-footer button.added {
          color: #1f160c;
          background: linear-gradient(135deg, #f2d68c, #c8933d);
          box-shadow: 0 14px 30px rgba(186, 132, 48, 0.18);
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
        .order-line small,
        .empty-order span {
          display: block;
          margin-top: 4px;
          color: #766b5f;
          font-size: 13px;
          font-weight: 800;
        }

        .order-line small {
          max-width: 230px;
          color: #a56a1d;
          font-size: 11px;
          line-height: 1.35;
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

        .front-office-contact {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin: 0 clamp(18px, 4vw, 64px) clamp(34px, 5vw, 70px);
          padding: clamp(22px, 4vw, 34px);
          border: 1px solid rgba(91, 74, 50, 0.14);
          border-radius: 30px;
          background:
            radial-gradient(circle at 10% 0%, rgba(223, 191, 119, 0.22), transparent 34%),
            rgba(255, 252, 246, 0.92);
          box-shadow: 0 24px 70px rgba(44, 34, 23, 0.09);
        }

        .front-office-contact h2 {
          margin: 6px 0 8px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 4vw, 48px);
          font-weight: 500;
          letter-spacing: 0;
        }

        .front-office-contact p:last-child {
          max-width: 560px;
          margin: 0;
          color: #655b51;
          line-height: 1.6;
        }

        .whatsapp-button {
          display: inline-flex;
          min-height: 54px;
          align-items: center;
          justify-content: center;
          gap: 11px;
          padding: 0 22px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #1fbf62, #128c47);
          box-shadow: 0 18px 42px rgba(18, 140, 71, 0.22);
          font-weight: 900;
          text-decoration: none;
          white-space: nowrap;
        }

        .whatsapp-button svg {
          width: 23px;
          height: 23px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.9;
          stroke-linecap: round;
          stroke-linejoin: round;
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

          .cart-icon {
            width: 18px;
            height: 18px;
          }

          .hero-content {
            width: auto;
            margin-top: auto;
            padding: 18px 16px 34px;
          }

          .hero-content h1 {
            font-size: 52px;
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
          .guest-shop {
            padding-bottom: 76px;
          }

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

          .front-office-contact {
            align-items: stretch;
            flex-direction: column;
            margin-right: 16px;
            margin-left: 16px;
          }

          .whatsapp-button {
            width: 100%;
            box-sizing: border-box;
          }

          .floating-cart {
            right: 14px;
            bottom: 14px;
            min-height: 52px;
            padding: 0 14px;
            font-size: 14px;
          }
        }
      `}</style>
    </main>
  );
}
