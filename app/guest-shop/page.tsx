'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';

type Category = string;
type LanguageCode = 'en' | 'ms' | 'zh';

type ShopItem = {
  id: string;
  name: string;
  nameMs?: string;
  nameZh?: string;
  category: string;
  submenu: string;
  submenuMs?: string;
  submenuZh?: string;
  description: string;
  descriptionMs?: string;
  descriptionZh?: string;
  price: number;
  stock: number;
  imageUrl: string;
  accent: string;
  label?: string;
  labelMs?: string;
  labelZh?: string;
  isFnb: boolean;
  optionGroups: OptionGroup[];
};

type OptionChoice = {
  id: string;
  name: string;
  nameMs?: string;
  nameZh?: string;
  priceDelta: number;
  isDefault: boolean;
};

type OptionGroup = {
  id: string;
  name: string;
  nameMs?: string;
  nameZh?: string;
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
  specialInstructions: string;
};

const INITIAL_CATEGORIES: Category[] = ['All'];

const DEFAULT_HERO = {
  hero_image_url: '',
  hero_kicker: 'Private in-room collection',
  hero_kicker_ms: '',
  hero_kicker_zh: '',
  hero_title: 'Quiet luxuries, ready on request.',
  hero_title_ms: '',
  hero_title_zh: '',
  hero_body:
    'Order selected comforts, guest essentials, and hotel services from your room. Prepared by the team after verified payment.',
  hero_body_ms: '',
  hero_body_zh: '',
  featured_item_id: null as string | null,
};

const OLD_DEFAULT_HERO_IMAGE = 'images.unsplash.com/photo-1551882547-ff40c63fe5fa';

function cachedHeroSettings() {
  if (typeof window === 'undefined') return DEFAULT_HERO;

  try {
    const cached = window.localStorage.getItem('guestShopHeroSettings');
    if (!cached) return DEFAULT_HERO;
    const parsed = JSON.parse(cached);
    const cachedImage = String(parsed?.hero_image_url || '');
    return {
      hero_image_url: cachedImage.includes(OLD_DEFAULT_HERO_IMAGE) ? '' : cachedImage,
      hero_kicker: String(parsed?.hero_kicker || DEFAULT_HERO.hero_kicker),
      hero_kicker_ms: String(parsed?.hero_kicker_ms || ''),
      hero_kicker_zh: String(parsed?.hero_kicker_zh || ''),
      hero_title: String(parsed?.hero_title || DEFAULT_HERO.hero_title),
      hero_title_ms: String(parsed?.hero_title_ms || ''),
      hero_title_zh: String(parsed?.hero_title_zh || ''),
      hero_body: String(parsed?.hero_body || DEFAULT_HERO.hero_body),
      hero_body_ms: String(parsed?.hero_body_ms || ''),
      hero_body_zh: String(parsed?.hero_body_zh || ''),
      featured_item_id: parsed?.featured_item_id ? String(parsed.featured_item_id) : null,
    };
  } catch {
    return DEFAULT_HERO;
  }
}

const LANGUAGE_OPTIONS: Array<{ code: LanguageCode; label: string; shortLabel: string }> = [
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'ms', label: 'Bahasa Melayu', shortLabel: 'BM' },
  { code: 'zh', label: '简体中文', shortLabel: '中文' },
];

const COPY: Record<LanguageCode, Record<string, string>> = {
  en: {
    guestShop: 'Guest Shop',
    cart: 'Cart',
    exploreCollection: 'Explore collection',
    viewOrder: 'View order',
    all: 'All',
    guestShopFilter: 'Guest Shop',
    fnbFilter: 'Food & Beverage',
    shopEssentials: 'Shop your stay',
    shopEssentialsBody: 'Room comforts, essentials and hotel services',
    orderFood: 'Order food & drinks',
    orderFoodBody: 'Fresh favourites delivered to your room',
    selectedStore: 'Selected',
    openNow: 'Open now',
    browseBy: 'Browse by category',
    shopHeading: 'Everything you need for a better stay',
    foodHeading: 'Good food, just a few taps away',
    productsAvailable: 'choices available',
    fnbClosed: 'F&B is currently closed.',
    guestMenu: 'Guest menu',
    curated: 'Curated for your stay',
    customize: 'Customize',
    customizeHint: 'Choose any add-ons or preparation options',
    required: 'Required',
    optional: 'Optional',
    remove: 'Remove',
    currentlyClosed: 'Currently closed',
    outOfStock: 'Out of stock',
    available: 'Available',
    closed: 'Closed',
    unavailable: 'Unavailable',
    added: 'Added',
    add: 'Add',
    yourOrder: 'Your order',
    item: 'item',
    items: 'items',
    each: 'each',
    specialInstructions: 'Special instructions',
    specialInstructionsPlaceholder: 'Example: less spicy, no onion, extra chilli',
    noItemsSelected: 'No items selected',
    addItemToBegin: 'Add an item to begin your order.',
    roomNumber: 'Room number',
    roomPlaceholder: 'Example: 1205',
    guestName: 'Guest name',
    guestNamePlaceholder: 'Name on room',
    emailOptional: 'Email (optional)',
    emailPlaceholder: 'For receipt, optional',
    total: 'Total',
    openingPayment: 'Opening secure payment...',
    proceedPayment: 'Proceed to payment',
    paymentNote: 'Staff receives the order only after payment is verified by the payment provider.',
    fnbPaymentNote: ' F&B orders are then accepted by the kitchen.',
    needAssistance: 'Need assistance?',
    speakFrontOffice: 'Speak with Front Office',
    assistanceBody: 'Questions about your order or a special request can be sent directly to our team.',
    whatsappFrontOffice: 'WhatsApp Front Office',
    selectItemNotice: 'Please select at least one item before payment.',
    enterDetailsNotice: 'Please enter room number and guest name before payment.',
    preparingPaymentNotice: 'Preparing secure payment...',
    unableStartPayment: 'Unable to start payment',
    unableStartPaymentFrontOffice: 'Unable to start payment. Please contact Front Office.',
    chooseBeforeAdding: 'Please choose {option} before adding {item}.',
    loadingMenu: 'Loading your menu…',
    preparingMenu: 'Preparing the latest images and prices.',
    menuTemporarilyUnavailable: 'The menu is temporarily unavailable.',
    refreshOrContact: 'Please refresh the page or contact Front Office.',
    noItemsAvailable: 'No items are currently available.',
    hotelSuiteAlt: 'Luxury hotel suite',
    brandAria: 'Hallmark Crown Hotel guest shop',
    languageAria: 'Language selection',
    storefrontAria: 'Choose what to shop',
    fnbCategoriesAria: 'Food and beverage categories',
    guestCategoriesAria: 'Guest shop categories',
    contactAria: 'Contact Front Office',
    whatsappAria: 'Contact Front Office on WhatsApp',
    shopNavigationAria: 'Shop navigation',
    cartAria: 'Cart with',
    jumpCartAria: 'Jump to cart with',
  },
  ms: {
    guestShop: 'Kedai Tetamu',
    cart: 'Troli',
    exploreCollection: 'Lihat pilihan',
    viewOrder: 'Lihat pesanan',
    all: 'Semua',
    guestShopFilter: 'Kedai Tetamu',
    fnbFilter: 'Makanan & Minuman',
    shopEssentials: 'Keperluan penginapan',
    shopEssentialsBody: 'Keselesaan bilik, keperluan dan servis hotel',
    orderFood: 'Pesan makanan & minuman',
    orderFoodBody: 'Hidangan segar dihantar ke bilik anda',
    selectedStore: 'Dipilih',
    openNow: 'Dibuka sekarang',
    browseBy: 'Pilih mengikut kategori',
    shopHeading: 'Semua yang anda perlukan untuk penginapan lebih selesa',
    foodHeading: 'Hidangan sedap hanya dengan beberapa sentuhan',
    productsAvailable: 'pilihan tersedia',
    fnbClosed: 'Makanan & Minuman sedang ditutup.',
    guestMenu: 'Menu tetamu',
    curated: 'Pilihan untuk penginapan anda',
    customize: 'Pilihan tambahan',
    customizeHint: 'Pilih tambahan atau cara penyediaan',
    required: 'Wajib',
    optional: 'Pilihan',
    remove: 'Buang',
    currentlyClosed: 'Sedang tutup',
    outOfStock: 'Stok habis',
    available: 'Tersedia',
    closed: 'Tutup',
    unavailable: 'Tiada',
    added: 'Ditambah',
    add: 'Tambah',
    yourOrder: 'Pesanan anda',
    item: 'item',
    items: 'item',
    each: 'setiap satu',
    specialInstructions: 'Arahan khas',
    specialInstructionsPlaceholder: 'Contoh: kurang pedas, tanpa bawang, cili lebih',
    noItemsSelected: 'Tiada item dipilih',
    addItemToBegin: 'Tambah item untuk mula membuat pesanan.',
    roomNumber: 'Nombor bilik',
    roomPlaceholder: 'Contoh: 1205',
    guestName: 'Nama tetamu',
    guestNamePlaceholder: 'Nama bilik',
    emailOptional: 'Emel (pilihan)',
    emailPlaceholder: 'Untuk resit, pilihan',
    total: 'Jumlah',
    openingPayment: 'Membuka bayaran selamat...',
    proceedPayment: 'Teruskan ke bayaran',
    paymentNote: 'Staf hanya menerima pesanan selepas bayaran disahkan oleh penyedia bayaran.',
    fnbPaymentNote: ' Pesanan makanan & minuman akan diterima oleh dapur selepas itu.',
    needAssistance: 'Perlu bantuan?',
    speakFrontOffice: 'Hubungi Front Office',
    assistanceBody: 'Soalan tentang pesanan atau permintaan khas boleh dihantar terus kepada pasukan kami.',
    whatsappFrontOffice: 'WhatsApp Front Office',
    selectItemNotice: 'Sila pilih sekurang-kurangnya satu item sebelum bayaran.',
    enterDetailsNotice: 'Sila masukkan nombor bilik dan nama tetamu sebelum bayaran.',
    preparingPaymentNotice: 'Menyediakan bayaran selamat...',
    unableStartPayment: 'Tidak dapat memulakan bayaran',
    unableStartPaymentFrontOffice: 'Tidak dapat memulakan bayaran. Sila hubungi Front Office.',
    chooseBeforeAdding: 'Sila pilih {option} sebelum menambah {item}.',
    loadingMenu: 'Memuatkan menu anda…',
    preparingMenu: 'Gambar dan harga terkini sedang disediakan.',
    menuTemporarilyUnavailable: 'Menu tidak dapat dimuatkan buat masa ini.',
    refreshOrContact: 'Sila muat semula halaman atau hubungi Front Office.',
    noItemsAvailable: 'Tiada item tersedia buat masa ini.',
    hotelSuiteAlt: 'Suite hotel mewah',
    brandAria: 'Kedai Tetamu Hallmark Crown Hotel',
    languageAria: 'Pilihan bahasa',
    storefrontAria: 'Pilih bahagian untuk membeli-belah',
    fnbCategoriesAria: 'Kategori makanan dan minuman',
    guestCategoriesAria: 'Kategori Kedai Tetamu',
    contactAria: 'Hubungi Front Office',
    whatsappAria: 'Hubungi Front Office melalui WhatsApp',
    shopNavigationAria: 'Navigasi kedai',
    cartAria: 'Troli dengan',
    jumpCartAria: 'Pergi ke troli dengan',
  },
  zh: {
    guestShop: '住客商店',
    cart: '购物车',
    exploreCollection: '浏览商品',
    viewOrder: '查看订单',
    guestShopFilter: '住客商店',
    fnbFilter: '餐饮',
    shopEssentials: '住宿用品',
    shopEssentialsBody: '客房用品、日常必需品与酒店服务',
    orderFood: '订购餐饮',
    orderFoodBody: '新鲜美食送到您的房间',
    selectedStore: '已选择',
    openNow: '营业中',
    browseBy: '按类别浏览',
    shopHeading: '让您的住宿更加舒适便利',
    foodHeading: '轻点几下，美食送到房间',
    productsAvailable: '项可选',
    fnbClosed: '餐饮目前暂停服务。',
    guestMenu: '住客菜单',
    curated: '为您的住宿精选',
    customize: '自选项目',
    customizeHint: '选择加购或制作选项',
    required: '必选',
    optional: '可选',
    remove: '移除',
    currentlyClosed: '暂停服务',
    outOfStock: '缺货',
    available: '可订购',
    closed: '关闭',
    unavailable: '不可订购',
    added: '已加入',
    add: '加入',
    yourOrder: '您的订单',
    item: '件商品',
    items: '件商品',
    each: '每份',
    specialInstructions: '特别要求',
    specialInstructionsPlaceholder: '例如：少辣、不要洋葱、多辣椒',
    noItemsSelected: '尚未选择商品',
    addItemToBegin: '请先加入商品开始下单。',
    roomNumber: '房号',
    roomPlaceholder: '例如：1205',
    guestName: '住客姓名',
    guestNamePlaceholder: '入住姓名',
    emailOptional: '电邮（可选）',
    emailPlaceholder: '用于收据，可选',
    total: '总额',
    openingPayment: '正在开启安全付款...',
    proceedPayment: '前往付款',
    paymentNote: '订单会在付款供应商确认后才发送给酒店团队。',
    fnbPaymentNote: ' 餐饮订单随后会由厨房接单。',
    needAssistance: '需要协助？',
    speakFrontOffice: '联系前台',
    assistanceBody: '如有订单问题或特别要求，可直接发送给我们的团队。',
    whatsappFrontOffice: 'WhatsApp 前台',
    selectItemNotice: '付款前请至少选择一件商品。',
    enterDetailsNotice: '付款前请输入房号和住客姓名。',
    preparingPaymentNotice: '正在准备安全付款...',
    unableStartPayment: '无法开始付款',
    unableStartPaymentFrontOffice: '无法开始付款。请联系前台。',
    chooseBeforeAdding: '加入{item}前，请先选择{option}。',
    loadingMenu: '正在加载您的菜单…',
    preparingMenu: '正在准备最新图片和价格。',
    menuTemporarilyUnavailable: '菜单暂时无法加载。',
    refreshOrContact: '请刷新页面或联系前台。',
    noItemsAvailable: '目前没有可订购商品。',
    hotelSuiteAlt: '豪华酒店套房',
    brandAria: 'Hallmark Crown Hotel 住客商店',
    languageAria: '语言选择',
    storefrontAria: '选择购物类别',
    fnbCategoriesAria: '餐饮类别',
    guestCategoriesAria: '住客商店类别',
    contactAria: '联系前台',
    whatsappAria: '通过 WhatsApp 联系前台',
    shopNavigationAria: '商店导航',
    cartAria: '购物车内有',
    jumpCartAria: '跳到购物车，内有',
  },
};

function itemWord(language: LanguageCode, count: number) {
  if (language === 'zh') return COPY.zh.items;
  return count === 1 ? COPY[language].item : COPY[language].items;
}

function money(value: number) {
  return `RM${value.toFixed(2)}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function localizedText(defaultText: string, bmText: string | undefined, zhText: string | undefined, language: LanguageCode) {
  if (language === 'ms') return bmText || defaultText;
  if (language === 'zh') return zhText || defaultText;
  return defaultText;
}

function normalizeOptionGroups(value: any): OptionGroup[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((group: any): OptionGroup => {
      const selectionType: OptionGroup['selectionType'] =
        String(group?.selection_type || 'single') === 'multiple' ? 'multiple' : 'single';

      return {
        id: String(group?.id || ''),
        name: String(group?.name || ''),
        nameMs: String(group?.name_ms || ''),
        nameZh: String(group?.name_zh || ''),
        selectionType,
        isRequired: group?.is_required === true,
        minSelect: Math.max(0, Number(group?.min_select || 0)),
        maxSelect: Math.max(0, Number(group?.max_select || 0)),
        options: Array.isArray(group?.options)
          ? group.options
              .map((option: any): OptionChoice => ({
                id: String(option?.id || ''),
                name: String(option?.name || ''),
                nameMs: String(option?.name_ms || ''),
                nameZh: String(option?.name_zh || ''),
                priceDelta: Number(option?.price_delta_myr || 0),
                isDefault: option?.is_default === true,
              }))
              .filter((option: OptionChoice) => option.id && option.name)
          : [],
      };
    })
    .filter((group: OptionGroup) => group.id && group.name && group.options.length);
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

function selectedOptionLabels(item: ShopItem, selectedOptions: SelectedOptionGroup[], language: LanguageCode) {
  const optionIds = new Set(selectedOptions.flatMap((group) => group.optionIds));
  return item.optionGroups.flatMap((group) =>
    group.options
      .filter((option) => optionIds.has(option.id))
      .map((option) => {
        const groupName = localizedText(group.name, group.nameMs, group.nameZh, language);
        const optionName = localizedText(option.name, option.nameMs, option.nameZh, language);
        return `${groupName}: ${optionName}${option.priceDelta ? ` +${money(option.priceDelta)}` : ''}`;
      })
  );
}

function isFnbItem(item: ShopItem) {
  const category = item.category.trim().toLowerCase();
  return item.isFnb || category === 'f&b' || category.includes('food & beverage');
}

function isFnbCategory(category: string) {
  const normalized = category.trim().toLowerCase();
  return normalized === 'f&b' || normalized.includes('food & beverage');
}

export default function GuestShopPage() {
  const [language, setLanguage] = useState<LanguageCode>('en');
  const [items, setItems] = useState<ShopItem[]>([]);
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  const [shopLoading, setShopLoading] = useState(true);
  const [shopLoadError, setShopLoadError] = useState('');
  const [categoryTranslations, setCategoryTranslations] = useState<Record<string, { ms: string; zh: string }>>({});
  const [hero, setHero] = useState(cachedHeroSettings);
  const [heroReady, setHeroReady] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category>('All');
  const [activeSubmenu, setActiveSubmenu] = useState('All');
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [fnbOpenNow, setFnbOpenNow] = useState(true);
  const [fnbClosedReason, setFnbClosedReason] = useState('');
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [selectedOptionsByItem, setSelectedOptionsByItem] = useState<Record<string, SelectedOptionGroup[]>>({});
  const t = COPY[language];

  useEffect(() => {
    const saved = window.localStorage.getItem('guestShopLanguage') as LanguageCode | null;
    if (saved === 'en' || saved === 'ms' || saved === 'zh') setLanguage(saved);
  }, []);

  function chooseLanguage(nextLanguage: LanguageCode) {
    setLanguage(nextLanguage);
    window.localStorage.setItem('guestShopLanguage', nextLanguage);
  }

  function displayCategory(category: string) {
    if (category === 'All') return t.all || 'All';
    if (category === 'FNB') return t.fnbFilter;
    const translated = categoryTranslations[category];
    return localizedText(category, translated?.ms, translated?.zh, language);
  }

  function displaySubmenu(itemOrSubmenu: ShopItem | string) {
    if (typeof itemOrSubmenu === 'string') return itemOrSubmenu === 'All' ? t.all || 'All' : itemOrSubmenu;
    return localizedText(itemOrSubmenu.submenu, itemOrSubmenu.submenuMs, itemOrSubmenu.submenuZh, language);
  }

  function displaySubmenuChoice(submenu: string) {
    if (submenu === 'All') return t.all || 'All';
    const matchingItem = items.find((item) => item.submenu === submenu);
    return matchingItem ? displaySubmenu(matchingItem) : submenu;
  }

  function displayItemName(item: ShopItem) {
    return localizedText(item.name, item.nameMs, item.nameZh, language);
  }

  function displayItemDescription(item: ShopItem) {
    return localizedText(item.description, item.descriptionMs, item.descriptionZh, language);
  }

  function displayItemLabel(item: ShopItem) {
    return localizedText(item.label || '', item.labelMs, item.labelZh, language);
  }

  const visibleItems = useMemo(() => {
    if (activeCategory === 'FNB') {
      const fnbItems = items.filter(isFnbItem);
      if (activeSubmenu === 'All') return fnbItems;
      return fnbItems.filter((item) => item.submenu === activeSubmenu);
    }

    const guestItems = items.filter((item) => !isFnbItem(item));
    if (activeCategory === 'All') return guestItems;
    return guestItems.filter((item) => item.category === activeCategory);
  }, [activeCategory, activeSubmenu, items]);

  const guestCategories = useMemo(() => {
    const choices = categories
      .filter((category) => category !== 'All')
      .filter((category) => !isFnbCategory(category));

    return ['All', ...Array.from(new Set(choices))];
  }, [categories]);

  const fnbSubmenuChoices = useMemo(() => {
    const fnbItems = items.filter(isFnbItem);
    if (!fnbItems.length) return [];

    const choices = items
      .filter(isFnbItem)
      .map((item) => item.submenu)
      .filter(Boolean);

    return ['All', ...Array.from(new Set(choices))];
  }, [items]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartItems.reduce((total, row) => total + row.quantity, 0);
  const cartTotal = cartItems.reduce((total, row) => total + row.unitPrice * row.quantity, 0);
  const cartHasFnb = cartItems.some((row) => isFnbItem(row.item));
  const heroStyle = {
    '--hero-image': hero.hero_image_url ? `url("${hero.hero_image_url}")` : 'none',
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

    async function loadHeroSettings() {
      try {
        const settingsRes = await fetch('/api/guest-shop/settings');
        const settingsJson = await settingsRes.json();
        if (!alive || !settingsJson?.ok || !settingsJson.settings) return;

        const nextHero = {
          hero_image_url: String(settingsJson.settings.hero_image_url || ''),
          hero_kicker: String(settingsJson.settings.hero_kicker || DEFAULT_HERO.hero_kicker),
          hero_kicker_ms: String(settingsJson.settings.hero_kicker_ms || ''),
          hero_kicker_zh: String(settingsJson.settings.hero_kicker_zh || ''),
          hero_title: String(settingsJson.settings.hero_title || DEFAULT_HERO.hero_title),
          hero_title_ms: String(settingsJson.settings.hero_title_ms || ''),
          hero_title_zh: String(settingsJson.settings.hero_title_zh || ''),
          hero_body: String(settingsJson.settings.hero_body || DEFAULT_HERO.hero_body),
          hero_body_ms: String(settingsJson.settings.hero_body_ms || ''),
          hero_body_zh: String(settingsJson.settings.hero_body_zh || ''),
          featured_item_id: settingsJson.settings.featured_item_id
            ? String(settingsJson.settings.featured_item_id)
            : null,
        };

        setHero((current) => {
          if (current.hero_image_url !== nextHero.hero_image_url) setHeroReady(false);
          return nextHero;
        });
        window.localStorage.setItem('guestShopHeroSettings', JSON.stringify(nextHero));
      } catch {
        // Keep text-only hero if settings are unavailable.
      }
    }

    async function loadCategories() {
      try {
        const categoriesRes = await fetchWithTimeout('/api/guest-shop/categories', 7000);
        const categoriesJson = await categoriesRes.json();
        if (!alive || !categoriesJson?.ok || !Array.isArray(categoriesJson.categories)) return;

        const nextCategories = categoriesJson.categories
          .filter((category: any) => category?.is_active !== false)
          .map((category: any) => String(category?.name || '').trim())
          .filter(Boolean);

        if (nextCategories.length) {
          setCategories((current) => [
            'All',
            ...Array.from(new Set([...nextCategories, ...current.filter((category) => category !== 'All')])),
          ]);
        }
        setCategoryTranslations(
          Object.fromEntries(
            categoriesJson.categories
              .map((category: any) => [
                String(category?.name || '').trim(),
                { ms: String(category?.name_ms || ''), zh: String(category?.name_zh || '') },
              ])
              .filter(([name]: [string, any]) => Boolean(name))
          )
        );
      } catch {
        // Item categories are used as a fallback when this optional request is unavailable.
      }
    }

    async function loadFnbHours() {
      try {
        const fnbHoursRes = await fetchWithTimeout('/api/guest-shop/fnb-hours', 7000);
        const fnbHoursJson = await fnbHoursRes.json();
        if (!alive || !fnbHoursJson?.ok || !fnbHoursJson.current) return;

        setFnbOpenNow(fnbHoursJson.current.open !== false);
        setFnbClosedReason(String(fnbHoursJson.current.reason || 'F&B is currently closed.'));
      } catch {
        // Keep F&B available when its optional operating-hours request is unavailable.
      }
    }

    async function loadItems() {
      try {
        setShopLoadError('');
        const itemsRes = await fetchWithTimeout('/api/guest-shop/items', 12000);
        const json = await itemsRes.json();
        if (!alive) return;

        if (!itemsRes.ok || !json?.ok || !Array.isArray(json.items)) {
          throw new Error(String(json?.error || 'Unable to load the guest menu.'));
        }

        const nextItems = json.items
          .filter((item: any) => item?.is_active !== false)
          .map((item: any): ShopItem => ({
            id: String(item.id),
            name: String(item.name || ''),
            nameMs: String(item.name_ms || ''),
            nameZh: String(item.name_zh || ''),
            category: String(item.category || 'Essentials'),
            description: String(item.description || ''),
            descriptionMs: String(item.description_ms || ''),
            descriptionZh: String(item.description_zh || ''),
            price: Number(item.price_myr || 0),
            stock: item.out_of_stock ? 0 : Math.max(0, Number(item.stock || 0)),
            imageUrl: String(item.image_url || ''),
            accent: String(item.accent || '#b6813a'),
            label: String(item.label || ''),
            labelMs: String(item.label_ms || ''),
            labelZh: String(item.label_zh || ''),
            submenu: String(item.submenu || ''),
            submenuMs: String(item.submenu_ms || ''),
            submenuZh: String(item.submenu_zh || ''),
            isFnb: item.is_fnb === true,
            optionGroups: normalizeOptionGroups(item.option_groups),
          }))
          .filter((item: ShopItem) => item.name);

        setItems(nextItems);
        if (nextItems.length) {
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
      } catch (error: any) {
        if (!alive) return;
        setItems([]);
        setShopLoadError(
          error?.name === 'AbortError'
            ? 'The menu is taking too long to respond. Please refresh and try again.'
            : error?.message || 'Unable to load the guest menu.'
        );
      } finally {
        if (alive) setShopLoading(false);
      }
    }

    loadHeroSettings();
    void loadCategories();
    void loadFnbHours();
    void loadItems();

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

  function clearGroupSelection(item: ShopItem, group: OptionGroup) {
    if (group.isRequired) return;

    setSelectedOptionsByItem((current) => {
      const existing = current[item.id] || defaultSelection(item);
      const next = existing.map((row) =>
        row.groupId === group.id ? { ...row, optionIds: [] } : { ...row, optionIds: [...row.optionIds] }
      );

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
      setNotice(
        t.chooseBeforeAdding
          .replace('{option}', localizedText(missing.name, missing.nameMs, missing.nameZh, language))
          .replace('{item}', displayItemName(item))
      );
      return;
    }

    const cartKey = cartKeyFor(item, selectedOptions);
    const unitPrice = unitPriceFor(item, selectedOptions);

    setCart((current) => {
      const existing = current[cartKey];
      const quantity = Math.min((existing?.quantity ?? 0) + 1, item.stock);

      return {
        ...current,
        [cartKey]: {
          cartKey,
          item,
          quantity,
          selectedOptions,
          unitPrice,
          specialInstructions: existing?.specialInstructions || '',
        },
      };
    });
    setNotice('');
  }

  function setCartInstruction(cartKey: string, value: string) {
    setCart((current) => {
      const existing = current[cartKey];
      if (!existing) return current;
      return {
        ...current,
        [cartKey]: {
          ...existing,
          specialInstructions: value.slice(0, 240),
        },
      };
    });
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
      setNotice(t.selectItemNotice);
      return;
    }

    if (!roomNumber.trim() || !guestName.trim()) {
      setNotice(t.enterDetailsNotice);
      return;
    }

    if (cartHasFnb && !fnbOpenNow) {
      setNotice(fnbClosedReason || t.fnbClosed);
      return;
    }

    try {
      setPaymentBusy(true);
      setNotice(t.preparingPaymentNotice);

      const res = await fetch('/api/guest-shop/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNumber,
          guestName,
          email,
          language,
          items: cartItems.map(({ item, quantity, selectedOptions, specialInstructions }) => ({
            id: item.id,
            quantity,
            special_instructions: specialInstructions,
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
        throw new Error(json?.error || t.unableStartPayment);
      }

      window.location.href = String(json.payment_url);
    } catch (error: any) {
      setNotice(error?.message || t.unableStartPaymentFrontOffice);
      setPaymentBusy(false);
    }
  }

  return (
    <main className="guest-shop">
      <section
        className={heroReady ? 'hero hero-ready' : 'hero'}
        style={heroStyle}
      >
        {hero.hero_image_url ? (
          <img
            className={heroReady ? 'hero-image hero-image-ready' : 'hero-image'}
            src={hero.hero_image_url}
            alt={t.hotelSuiteAlt}
            loading="eager"
            decoding="async"
            onLoad={() => setHeroReady(true)}
          />
        ) : null}
        <div className="hero-shade" />

        <header className="nav">
          <a className="brand" href="/guest-shop" aria-label={t.brandAria}>
            <span className="brand-mark">
              <img src="/logo.png" alt="" />
            </span>
            <span>
              <small>Hallmark Crown Hotel</small>
              <strong>{t.guestShop}</strong>
            </span>
          </a>

          <div className="nav-actions">
            <div className="language-switch" aria-label={t.languageAria}>
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  className={language === option.code ? 'active' : ''}
                  onClick={() => chooseLanguage(option.code)}
                  aria-label={option.label}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
            <a
              className="cart-button"
              href="#order"
              aria-label={`${t.cartAria} ${cartCount} ${itemWord(language, cartCount)}`}
            >
              <svg className="cart-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7.2 7.8h13.1l-1.4 7.1a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.9H3.4" />
                <path d="M9.4 20.1h.1M17 20.1h.1" />
              </svg>
              <span>{t.cart}</span>
              <b>{cartCount}</b>
            </a>
          </div>
        </header>

        <div className="hero-content">
          <p className="eyebrow">{localizedText(hero.hero_kicker, hero.hero_kicker_ms, hero.hero_kicker_zh, language)}</p>
          <h1>{localizedText(hero.hero_title, hero.hero_title_ms, hero.hero_title_zh, language)}</h1>
          <p className="hero-copy">{localizedText(hero.hero_body, hero.hero_body_ms, hero.hero_body_zh, language)}</p>

          <div className="hero-actions">
            <a href="#shop" className="primary-action">
              {t.exploreCollection}
            </a>
            <a href="#order" className="secondary-action">
              {t.viewOrder}
            </a>
          </div>
        </div>

      </section>

      <section id="shop" className="collection">
        <div className="storefront-switcher" role="tablist" aria-label={t.storefrontAria}>
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory !== 'FNB'}
            className={activeCategory !== 'FNB' ? 'storefront-card active' : 'storefront-card'}
            onClick={() => {
              setActiveCategory('All');
              setActiveSubmenu('All');
            }}
          >
            <span className="storefront-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 9.5 12 4l8 5.5V20H4Z" />
                <path d="M8 20v-6h8v6M8.5 10.5h7" />
              </svg>
            </span>
            <span className="storefront-copy">
              <small>{t.guestShopFilter}</small>
              <strong>{t.shopEssentials}</strong>
              <span>{t.shopEssentialsBody}</span>
            </span>
            <span className="storefront-status">{activeCategory !== 'FNB' ? t.selectedStore : '›'}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === 'FNB'}
            className={activeCategory === 'FNB' ? 'storefront-card active food' : 'storefront-card food'}
            onClick={() => {
              setActiveCategory('FNB');
              setActiveSubmenu('All');
            }}
          >
            <span className="storefront-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10v11M9.5 3v4.5A2.5 2.5 0 0 1 7 10M16 3v18M16 3c3 1.5 4 4 4 7h-4" />
              </svg>
            </span>
            <span className="storefront-copy">
              <small>{t.fnbFilter}</small>
              <strong>{t.orderFood}</strong>
              <span>{t.orderFoodBody}</span>
            </span>
            <span className={activeCategory === 'FNB' ? 'storefront-status' : fnbOpenNow ? 'storefront-status open' : 'storefront-status closed'}>
              {activeCategory === 'FNB' ? t.selectedStore : fnbOpenNow ? t.openNow : t.closed}
            </span>
          </button>
        </div>

        <div className="collection-head">
          <div>
            <p className="eyebrow">{activeCategory === 'FNB' ? t.fnbFilter : t.guestShopFilter}</p>
            <h2>{activeCategory === 'FNB' ? t.foodHeading : t.shopHeading}</h2>
          </div>
          <span className="catalog-count">{visibleItems.length} {t.productsAvailable}</span>
        </div>

        <div className="menu-toolbar">
          <div className="filter-block">
            <span>{t.browseBy}</span>
            {activeCategory === 'FNB' ? (
              <>
                {!fnbOpenNow ? <strong className="closed-note">{fnbClosedReason || t.fnbClosed}</strong> : null}
                <div className="categories" role="tablist" aria-label={t.fnbCategoriesAria}>
                  {fnbSubmenuChoices.map((submenu) => (
                    <button
                      key={submenu}
                      type="button"
                      className={activeSubmenu === submenu ? 'active' : ''}
                      onClick={() => setActiveSubmenu(submenu)}
                    >
                      {displaySubmenuChoice(submenu)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="categories" role="tablist" aria-label={t.guestCategoriesAria}>
                {guestCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={activeCategory === category ? 'active' : ''}
                    onClick={() => {
                      setActiveCategory(category);
                      setActiveSubmenu('All');
                    }}
                  >
                    {displayCategory(category)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shop-grid">
          <div className="products">
            {shopLoading ? (
              <div className="catalog-state" role="status" aria-live="polite">
                <strong>{t.loadingMenu}</strong>
                <span>{t.preparingMenu}</span>
              </div>
            ) : null}
            {!shopLoading && shopLoadError ? (
              <div className="catalog-state catalog-error" role="alert">
                <strong>{t.menuTemporarilyUnavailable}</strong>
                <span>{t.refreshOrContact}</span>
              </div>
            ) : null}
            {!shopLoading && !shopLoadError && !visibleItems.length ? (
              <div className="catalog-state">
                <strong>{t.noItemsAvailable}</strong>
              </div>
            ) : null}
            {!shopLoading && !shopLoadError ? visibleItems.map((item) => {
              const fnbClosed = isFnbItem(item) && !fnbOpenNow;
              const isUnavailable = item.stock <= 0 || fnbClosed;
              const selectedOptions = getSelection(item);
              const selectedCartKey = cartKeyFor(item, selectedOptions);
              const isAdded = Boolean(cart[selectedCartKey]);
              const displayPrice = unitPriceFor(item, selectedOptions);
              const displayName = displayItemName(item);
              const displayLabel = displayItemLabel(item);

              return (
                <article className="product-card" key={item.id}>
                  <div className="product-image" style={{ '--accent': item.accent } as CSSProperties}>
                    <span className="image-fallback">{displayName.slice(0, 2).toUpperCase()}</span>
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={displayName}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <span className="category-chip">{displayCategory(item.category)}</span>
                    {item.submenu ? <span className="submenu-chip">{displaySubmenu(item)}</span> : null}
                    {displayLabel ? <span className="item-label">{displayLabel}</span> : null}
                  </div>

                  <div className="product-info">
                    <div>
                      <h3>{displayName}</h3>
                      <p>{displayItemDescription(item)}</p>
                    </div>

                    {item.optionGroups.length ? (
                      <div className="option-panel">
                        <div className="customize-head">
                          <strong>{t.customize}</strong>
                          <span>{t.customizeHint}</span>
                        </div>
                        {item.optionGroups.map((group) => {
                          const selected = new Set(
                            selectedOptions.find((row) => row.groupId === group.id)?.optionIds || []
                          );

                          return (
                            <div className="option-group" key={group.id}>
                              <div className="option-title">
                                <span>{localizedText(group.name, group.nameMs, group.nameZh, language)}</span>
                                <div className="option-title-actions">
                                  {group.isRequired ? <b>{t.required}</b> : <b>{t.optional}</b>}
                                  {!group.isRequired && selected.size ? (
                                    <button
                                      type="button"
                                      className="clear-options"
                                      onClick={() => clearGroupSelection(item, group)}
                                    >
                                      {t.remove}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="option-list">
                                {group.options.map((option) => (
                                  <label className="option-pill" key={option.id}>
                                    <input
                                      type={group.selectionType === 'single' && group.isRequired ? 'radio' : 'checkbox'}
                                      name={`${item.id}-${group.id}`}
                                      checked={selected.has(option.id)}
                                      onChange={(event) => setGroupSelection(item, group, option.id, event.target.checked)}
                                    />
                                    <span>{localizedText(option.name, option.nameMs, option.nameZh, language)}</span>
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
                        <span>{fnbClosed ? t.currentlyClosed : isUnavailable ? t.outOfStock : t.available}</span>
                      </div>
                      <button
                        type="button"
                        className={isAdded ? 'added' : ''}
                        disabled={isUnavailable}
                        onClick={() => addItem(item)}
                      >
                        {fnbClosed ? t.closed : isUnavailable ? t.unavailable : isAdded ? t.added : t.add}
                      </button>
                    </div>
                  </div>
                </article>
              );
            }) : null}
          </div>

          <aside id="order" className="order-panel">
            <div className="order-header">
              <p className="eyebrow">{t.yourOrder}</p>
              <strong>{cartCount} {itemWord(language, cartCount)}</strong>
            </div>

            <div className="order-lines">
              {cartItems.length ? (
                cartItems.map(({ cartKey, item, quantity, selectedOptions, unitPrice, specialInstructions }) => (
                  <div className="order-line" key={cartKey}>
                    <div className="order-line-top">
                      <div>
                        <strong>{displayItemName(item)}</strong>
                        <span>{money(unitPrice)} {t.each}</span>
                        {selectedOptionLabels(item, selectedOptions, language).length ? (
                          <small>{selectedOptionLabels(item, selectedOptions, language).join(', ')}</small>
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
                    <label className="line-remark">
                      {t.specialInstructions}
                      <textarea
                        value={specialInstructions}
                        onChange={(event) => setCartInstruction(cartKey, event.target.value)}
                        placeholder={t.specialInstructionsPlaceholder}
                        rows={2}
                      />
                    </label>
                  </div>
                ))
              ) : (
                <div className="empty-order">
                  <strong>{t.noItemsSelected}</strong>
                  <span>{t.addItemToBegin}</span>
                </div>
              )}
            </div>

            <div className="guest-details">
              <label>
                {t.roomNumber}
                <input
                  value={roomNumber}
                  onChange={(event) => setRoomNumber(event.target.value)}
                  placeholder={t.roomPlaceholder}
                />
              </label>
              <label>
                {t.guestName}
                <input
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  placeholder={t.guestNamePlaceholder}
                />
              </label>
              <label>
                {t.emailOptional}
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t.emailPlaceholder}
                />
              </label>
            </div>

            <div className="total-row">
              <span>{t.total}</span>
              <strong>{money(cartTotal)}</strong>
            </div>

            <button
              type="button"
              className="payment-button"
              onClick={proceedToPayment}
              disabled={paymentBusy}
            >
              {paymentBusy ? t.openingPayment : t.proceedPayment}
            </button>

            {notice ? <p className="notice">{notice}</p> : null}

            <p className="payment-note">
              {t.paymentNote}
              {cartHasFnb ? t.fnbPaymentNote : ''}
            </p>
          </aside>
        </div>
      </section>

      <section className="front-office-contact" aria-label={t.contactAria}>
        <div>
          <p className="eyebrow">{t.needAssistance}</p>
          <h2>{t.speakFrontOffice}</h2>
          <p>{t.assistanceBody}</p>
        </div>
        <a
          className="whatsapp-button"
          href="https://wa.me/60126308316"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.whatsappAria}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.2a8.8 8.8 0 0 0-7.6 13.2L3.5 21l4.7-1.2A8.8 8.8 0 1 0 12 3.2Z" />
            <path d="M8.8 8.5c.2-.5.4-.6.7-.6h.5c.2 0 .4.1.5.4l.8 1.8c.1.3 0 .5-.2.7l-.5.6c.8 1.4 1.8 2.3 3.2 3.1l.7-.7c.2-.2.4-.2.7-.1l1.7.8c.3.1.4.3.4.6v.5c0 .3-.1.6-.6.8-.5.2-1.2.4-2 .2-2.5-.5-5.5-3.1-6.5-5.5-.3-.8-.2-1.6 0-2.1Z" />
          </svg>
          <span>{t.whatsappFrontOffice}</span>
        </a>
      </section>

      <a
        className={cartCount > 0 ? 'floating-cart has-items' : 'floating-cart'}
        href="#order"
        aria-label={`${t.jumpCartAria} ${cartCount} ${itemWord(language, cartCount)}`}
      >
        <svg className="cart-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7.2 7.8h13.1l-1.4 7.1a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.9H3.4" />
          <path d="M9.4 20.1h.1M17 20.1h.1" />
        </svg>
        <span>{t.cart}</span>
        <b>{cartCount}</b>
      </a>

      <nav className="mobile-commerce-nav" aria-label={t.shopNavigationAria}>
        <button
          type="button"
          className={activeCategory !== 'FNB' ? 'active' : ''}
          onClick={() => {
            setActiveCategory('All');
            setActiveSubmenu('All');
            document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10 12 4l8 6v10H4Z" />
            <path d="M9 20v-6h6v6" />
          </svg>
          {t.guestShopFilter}
        </button>
        <button
          type="button"
          className={activeCategory === 'FNB' ? 'active' : ''}
          onClick={() => {
            setActiveCategory('FNB');
            setActiveSubmenu('All');
            document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10v11M9.5 3v4.5A2.5 2.5 0 0 1 7 10M16 3v18M16 3c3 1.5 4 4 4 7h-4" />
          </svg>
          {t.fnbFilter}
        </button>
        <a href="#order" className={cartCount ? 'cart-active' : ''}>
          <span className="mobile-cart-count" aria-hidden="true">{cartCount}</span>
          {t.cart}
        </a>
      </nav>

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
          opacity: 0;
          transition: opacity 260ms ease;
        }

        .hero-image-ready {
          opacity: 1;
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

        .nav-actions {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }

        .language-switch {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px;
          border: 1px solid rgba(255, 248, 235, 0.24);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(18px);
        }

        .language-switch button {
          min-width: 42px;
          min-height: 34px;
          padding: 0 10px;
          border: 0;
          border-radius: 999px;
          color: rgba(255, 248, 237, 0.78);
          background: transparent;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .language-switch button.active {
          color: #17110c;
          background: #dfbf77;
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.16);
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

        .mobile-commerce-nav {
          display: none;
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
          padding: clamp(28px, 5vw, 66px) clamp(16px, 4vw, 54px) clamp(34px, 5vw, 76px);
        }

        .storefront-switcher {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 28px;
        }

        .storefront-card {
          position: relative;
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr) auto;
          min-height: 116px;
          align-items: center;
          gap: 15px;
          padding: 18px 20px;
          overflow: hidden;
          border: 1px solid rgba(91, 74, 50, 0.15);
          border-radius: 22px;
          color: #30271f;
          background: rgba(255, 252, 246, 0.88);
          box-shadow: 0 16px 40px rgba(44, 34, 23, 0.06);
          text-align: left;
          cursor: pointer;
          transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
        }

        .storefront-card::after {
          position: absolute;
          right: -44px;
          bottom: -64px;
          width: 180px;
          height: 180px;
          border-radius: 50%;
          background: rgba(213, 164, 83, 0.08);
          content: "";
          pointer-events: none;
        }

        .storefront-card:hover {
          border-color: rgba(154, 107, 49, 0.32);
          box-shadow: 0 20px 50px rgba(44, 34, 23, 0.1);
          transform: translateY(-2px);
        }

        .storefront-card.active {
          color: #fffaf0;
          border-color: #1b1713;
          background: linear-gradient(135deg, #17130f, #34261a);
          box-shadow: 0 22px 50px rgba(35, 24, 14, 0.2);
        }

        .storefront-card.food.active {
          border-color: #8b551f;
          background: linear-gradient(135deg, #6f3e18, #b5762f);
          box-shadow: 0 22px 50px rgba(126, 72, 25, 0.22);
        }

        .storefront-icon {
          display: grid;
          width: 52px;
          height: 52px;
          place-items: center;
          border-radius: 17px;
          color: #82531f;
          background: #f4e4bf;
        }

        .storefront-card.active .storefront-icon {
          color: #20160d;
          background: linear-gradient(135deg, #f6dfa5, #d7a24a);
        }

        .storefront-icon svg {
          width: 27px;
          height: 27px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .storefront-copy {
          position: relative;
          z-index: 1;
          display: grid;
          min-width: 0;
          gap: 3px;
        }

        .storefront-copy small {
          color: #9a6b31;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .storefront-card.active .storefront-copy small {
          color: #e8c978;
        }

        .storefront-copy strong {
          font-size: clamp(17px, 1.7vw, 22px);
          line-height: 1.15;
        }

        .storefront-copy > span {
          color: #74675b;
          font-size: 13px;
          line-height: 1.35;
        }

        .storefront-card.active .storefront-copy > span {
          color: rgba(255, 250, 240, 0.74);
        }

        .storefront-status {
          position: relative;
          z-index: 1;
          min-width: max-content;
          padding: 7px 10px;
          border: 1px solid rgba(111, 76, 32, 0.14);
          border-radius: 999px;
          color: #6d4b24;
          background: #fbf2df;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .storefront-card.active .storefront-status {
          color: #24170c;
          border-color: transparent;
          background: #edcb77;
        }

        .storefront-status.open {
          color: #17633b;
          background: #e4f7ea;
        }

        .storefront-status.closed {
          color: #9a2727;
          background: #fee8e8;
        }

        .collection-head {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 22px;
          margin-bottom: 16px;
        }

        .collection-head h2 {
          margin: 6px 0 0;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 4.2vw, 50px);
          font-weight: 500;
          letter-spacing: 0;
        }

        .collection .eyebrow {
          color: #9a6b31;
        }

        .catalog-count {
          flex: 0 0 auto;
          padding: 8px 12px;
          border: 1px solid rgba(91, 74, 50, 0.12);
          border-radius: 999px;
          color: #665647;
          background: rgba(255, 252, 246, 0.82);
          font-size: 12px;
          font-weight: 800;
        }

        .menu-toolbar {
          display: grid;
          gap: 10px;
          margin-bottom: 20px;
          padding: 12px 14px;
          border: 1px solid rgba(91, 74, 50, 0.11);
          border-radius: 22px;
          background: rgba(255, 252, 246, 0.78);
          box-shadow: 0 18px 46px rgba(44, 34, 23, 0.055);
        }

        .filter-block {
          display: grid;
          gap: 10px;
        }

        .filter-block > span {
          color: #9a6b31;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .closed-note {
          width: fit-content;
          max-width: 100%;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(185, 28, 28, 0.18);
          background: rgba(254, 226, 226, 0.75);
          color: #991b1b;
          font-size: 12px;
          font-weight: 900;
        }

        .categories {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 8px;
        }

        .categories button {
          min-height: 38px;
          padding: 0 15px;
          color: #403326;
          border-color: rgba(104, 82, 53, 0.16);
          background: rgba(255, 252, 246, 0.86);
          font-size: 13px;
        }

        .categories button.active {
          color: #fff7e8;
          background: #1b1713;
        }

        .submenus {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.64);
          border: 1px solid rgba(91, 74, 50, 0.1);
        }

        .fnb-submenus {
          background:
            linear-gradient(135deg, rgba(255, 248, 235, 0.88), rgba(255, 255, 255, 0.7));
        }

        .submenus button {
          min-height: 34px;
          padding: 0 13px;
          border: 1px solid rgba(104, 82, 53, 0.16);
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.72);
          color: #493728;
          font-size: 12px;
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
          grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
          gap: 22px;
          align-items: start;
        }

        .products {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .catalog-state {
          grid-column: 1 / -1;
          min-height: 220px;
          display: grid;
          place-content: center;
          gap: 8px;
          padding: 28px;
          border: 1px dashed rgba(145, 108, 53, 0.28);
          border-radius: 20px;
          color: #6f5a3f;
          background: rgba(255, 252, 246, 0.72);
          text-align: center;
        }

        .catalog-state strong {
          color: #342719;
          font-size: 18px;
        }

        .catalog-state span {
          font-size: 13px;
        }

        .catalog-state.catalog-error {
          border-color: rgba(180, 60, 45, 0.3);
          color: #8e4339;
          background: rgba(255, 247, 245, 0.85);
        }

        .product-card,
        .order-panel {
          overflow: hidden;
          border: 1px solid rgba(91, 74, 50, 0.14);
          border-radius: 20px;
          background: rgba(255, 252, 246, 0.92);
          box-shadow: 0 18px 46px rgba(44, 34, 23, 0.075);
        }

        .product-card {
          display: flex;
          min-height: 0;
          flex-direction: column;
          transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
        }

        .product-card:hover {
          border-color: rgba(166, 114, 43, 0.24);
          box-shadow: 0 22px 54px rgba(44, 34, 23, 0.11);
          transform: translateY(-2px);
        }

        .product-image {
          position: relative;
          height: 184px;
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
          font-size: 34px;
          font-weight: 900;
        }

        .category-chip,
        .submenu-chip,
        .item-label {
          position: absolute;
          z-index: 2;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .category-chip {
          left: 10px;
          bottom: 10px;
          max-width: calc(100% - 20px);
          padding: 6px 9px;
          color: #fff8ed;
          background: rgba(18, 15, 12, 0.62);
          backdrop-filter: blur(12px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .submenu-chip {
          right: 10px;
          bottom: 10px;
          max-width: calc(100% - 20px);
          padding: 6px 9px;
          color: #2e1f0e;
          background: rgba(255, 248, 233, 0.9);
          backdrop-filter: blur(12px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .item-label {
          top: 10px;
          left: 10px;
          padding: 6px 9px;
          color: #2e1f0e;
          background: rgba(246, 224, 170, 0.94);
        }

        .product-info {
          display: flex;
          flex: 1;
          flex-direction: column;
          justify-content: space-between;
          gap: 12px;
          padding: 14px;
        }

        .product-info h3 {
          display: -webkit-box;
          margin: 0 0 6px;
          overflow: hidden;
          font-size: 18px;
          letter-spacing: 0;
          line-height: 1.16;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .product-info p {
          display: -webkit-box;
          margin: 0;
          color: #655b51;
          overflow: hidden;
          font-size: 13px;
          line-height: 1.38;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }

        .option-panel {
          display: grid;
          gap: 9px;
          padding: 10px;
          border: 1px solid rgba(91, 74, 50, 0.1);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.58);
        }

        .customize-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(91, 74, 50, 0.1);
        }

        .customize-head strong {
          color: #1b1713;
          font-size: 12px;
        }

        .customize-head span {
          max-width: 150px;
          color: #6b6259;
          font-size: 10px;
          font-weight: 800;
          text-align: right;
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
          font-size: 11px;
          font-weight: 900;
        }

        .option-title b {
          color: #a56a1d;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .option-title-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .clear-options {
          min-height: 26px;
          padding: 0 10px;
          border: 1px solid rgba(178, 72, 54, 0.2);
          border-radius: 999px;
          background: rgba(255, 238, 234, 0.84);
          color: #9f2f22;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }

        .clear-options:hover {
          background: rgba(255, 225, 218, 0.95);
        }

        .option-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .option-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 30px;
          padding: 0 8px;
          border: 1px solid rgba(91, 74, 50, 0.13);
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.94);
          color: #2d241b;
          font-size: 11px;
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
          gap: 10px;
          padding-top: 12px;
          border-top: 1px solid rgba(91, 74, 50, 0.13);
        }

        .product-footer strong {
          display: block;
          font-size: 20px;
          letter-spacing: 0;
        }

        .product-footer span {
          display: block;
          margin-top: 2px;
          color: #766b5f;
          font-size: 11px;
          font-weight: 800;
        }

        .product-footer button {
          min-width: 72px;
          min-height: 38px;
          padding: 0 14px;
          color: #fff7e8;
          background: #1b1713;
          font-size: 13px;
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
          align-items: stretch;
          justify-content: space-between;
          gap: 12px;
          padding: 14px;
          border: 1px solid rgba(91, 74, 50, 0.12);
          border-radius: 18px;
          background: rgba(255, 250, 241, 0.88);
        }

        .order-line {
          flex-direction: column;
        }

        .order-line-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
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

        .line-remark {
          display: grid;
          gap: 7px;
          color: #5e5349;
          font-size: 12px;
          font-weight: 900;
        }

        .line-remark textarea {
          width: 100%;
          min-height: 62px;
          padding: 10px 12px;
          border: 1px solid rgba(91, 74, 50, 0.14);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.86);
          color: #1b1713;
          font: inherit;
          resize: vertical;
          box-sizing: border-box;
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
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .guest-shop {
            padding-bottom: calc(82px + env(safe-area-inset-bottom));
          }

          .floating-cart {
            display: none;
          }

          .mobile-commerce-nav {
            position: fixed;
            right: 10px;
            bottom: max(10px, env(safe-area-inset-bottom));
            left: 10px;
            z-index: 80;
            display: grid;
            grid-template-columns: 1fr 1fr minmax(82px, 0.8fr);
            gap: 5px;
            padding: 6px;
            border: 1px solid rgba(73, 55, 35, 0.16);
            border-radius: 19px;
            background: rgba(255, 252, 246, 0.95);
            box-shadow: 0 20px 55px rgba(35, 25, 14, 0.24);
            backdrop-filter: blur(18px);
          }

          .mobile-commerce-nav button,
          .mobile-commerce-nav a {
            position: relative;
            display: flex;
            min-width: 0;
            min-height: 50px;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 0 8px;
            border: 0;
            border-radius: 14px;
            color: #625547;
            background: transparent;
            font: inherit;
            font-size: 11px;
            font-weight: 900;
            text-align: center;
            text-decoration: none;
            cursor: pointer;
          }

          .mobile-commerce-nav svg {
            width: 17px;
            height: 17px;
            flex: 0 0 auto;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.9;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .mobile-commerce-nav button.active {
            color: #fff9ed;
            background: #1b1713;
            box-shadow: 0 10px 24px rgba(27, 23, 19, 0.2);
          }

          .mobile-commerce-nav a.cart-active {
            color: #20170d;
            background: linear-gradient(135deg, #f2d68c, #d8a34a);
          }

          .mobile-cart-count {
            display: grid;
            min-width: 24px;
            height: 24px;
            place-items: center;
            border-radius: 50%;
            color: #fff9ed;
            background: #1b1713;
            font-size: 11px;
          }

          .hero {
            min-height: min(520px, 76svh);
            display: flex;
            flex-direction: column;
          }

          .hero-image {
            inset: 0;
            height: 100%;
            min-height: 0;
            padding: 8px;
            object-position: center;
          }

          .nav {
            padding: 16px;
          }

          .nav-actions {
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
          }

          .language-switch button {
            min-width: 36px;
            min-height: 32px;
            padding: 0 8px;
            font-size: 11px;
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
            padding: 18px 16px 28px;
          }

          .hero-content h1 {
            margin: 10px 0 12px;
            font-size: clamp(40px, 11vw, 52px);
            line-height: 0.94;
          }

          .hero-copy {
            display: -webkit-box;
            overflow: hidden;
            font-size: 15px;
            line-height: 1.5;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
          }

          .hero-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 9px;
            margin-top: 18px;
          }

          .hero-actions a {
            min-height: 46px;
            padding: 0 12px;
          }

          .collection {
            padding-top: 20px;
            padding-right: 16px;
            padding-left: 16px;
          }

          .storefront-switcher {
            gap: 10px;
            margin-bottom: 20px;
          }

          .storefront-card {
            grid-template-columns: 44px minmax(0, 1fr);
            min-height: 104px;
            gap: 10px;
            padding: 14px;
            border-radius: 18px;
          }

          .storefront-icon {
            width: 44px;
            height: 44px;
            border-radius: 14px;
          }

          .storefront-copy strong {
            font-size: 17px;
          }

          .storefront-copy > span {
            display: none;
          }

          .storefront-status {
            grid-column: 1 / -1;
            width: fit-content;
            margin-top: -3px;
            padding: 5px 8px;
            font-size: 9px;
          }

          .menu-toolbar {
            gap: 10px;
            margin-bottom: 16px;
            padding: 10px 12px;
            border-radius: 18px;
          }

          .collection-head {
            align-items: flex-end;
            flex-direction: row;
            margin-bottom: 12px;
          }

          .collection-head h2 {
            font-size: clamp(27px, 8vw, 36px);
            line-height: 1.04;
          }

          .catalog-count {
            padding: 6px 9px;
            font-size: 10px;
            white-space: nowrap;
          }

          .categories {
            justify-content: flex-start;
          }

          .products {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .product-card {
            min-height: 0;
          }

          .product-image {
            height: 150px;
          }

          .product-info {
            gap: 10px;
            padding: 12px;
          }

          .product-info h3 {
            font-size: 16px;
          }

          .product-info p {
            font-size: 12px;
            -webkit-line-clamp: 2;
          }

          .product-footer {
            align-items: center;
            flex-direction: row;
          }

          .product-footer strong {
            font-size: 18px;
          }

          .product-footer button {
            min-width: 64px;
            min-height: 36px;
            padding: 0 11px;
            font-size: 12px;
          }
        }

        @media (max-width: 520px) {
          .guest-shop {
            padding-bottom: calc(82px + env(safe-area-inset-bottom));
          }

          .nav {
            align-items: flex-start;
          }

          .cart-button span {
            display: none;
          }

          .hero-actions a {
            width: auto;
            font-size: 12px;
          }

          .storefront-card {
            min-height: 98px;
            padding: 12px 10px;
          }

          .storefront-copy small {
            font-size: 8px;
            letter-spacing: 0.08em;
          }

          .storefront-copy strong {
            font-size: 14px;
            line-height: 1.16;
          }

          .storefront-status {
            padding: 4px 7px;
            font-size: 8px;
          }

          .collection-head {
            align-items: flex-start;
            flex-direction: column;
            gap: 8px;
          }

          .categories {
            display: flex;
            flex-wrap: nowrap;
            gap: 8px;
            margin-right: -12px;
            margin-left: -2px;
            padding: 2px 12px 4px 2px;
            overflow-x: auto;
            scroll-snap-type: x proximity;
            -webkit-overflow-scrolling: touch;
          }

          .categories button {
            flex: 0 0 auto;
            min-height: 36px;
            padding: 0 12px;
            scroll-snap-align: start;
          }

          .submenus {
            flex-wrap: nowrap;
            margin-right: -12px;
            padding: 8px 12px 8px 8px;
            overflow-x: auto;
            scroll-snap-type: x proximity;
            -webkit-overflow-scrolling: touch;
          }

          .submenus button {
            flex: 0 0 auto;
            scroll-snap-align: start;
          }

          .products {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .product-card {
            border-radius: 16px;
            box-shadow: 0 12px 30px rgba(44, 34, 23, 0.07);
          }

          .product-image {
            height: 122px;
          }

          .category-chip,
          .submenu-chip {
            bottom: 8px;
            padding: 5px 7px;
            font-size: 8px;
          }

          .category-chip {
            left: 8px;
          }

          .submenu-chip {
            right: 8px;
          }

          .item-label {
            top: 8px;
            left: 8px;
            padding: 5px 7px;
            font-size: 8px;
          }

          .product-info {
            padding: 10px;
          }

          .product-info h3 {
            margin-bottom: 4px;
            font-size: 15px;
            line-height: 1.15;
          }

          .product-info p {
            font-size: 11px;
            line-height: 1.32;
          }

          .option-panel {
            gap: 7px;
            padding: 8px;
            border-radius: 12px;
          }

          .customize-head {
            display: block;
          }

          .customize-head span {
            display: none;
          }

          .option-title {
            align-items: flex-start;
            flex-direction: column;
            gap: 4px;
          }

          .option-title-actions {
            gap: 6px;
          }

          .option-pill {
            min-height: 28px;
            padding: 0 7px;
            font-size: 10px;
          }

          .option-pill em {
            font-size: 10px;
          }

          .product-footer,
          .order-line {
            align-items: center;
            flex-direction: row;
          }

          .product-footer button {
            width: auto;
            min-width: 62px;
            min-height: 34px;
            border-radius: 999px;
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

          .mobile-commerce-nav button,
          .mobile-commerce-nav a {
            padding: 0 5px;
            font-size: 10px;
          }
        }
      `}</style>
    </main>
  );
}
