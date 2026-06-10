'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Role = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT' | 'FNB';

type Profile = {
  email: string;
  name: string;
  role: Role;
};

type ShopItem = {
  id: string;
  name: string;
  category: string;
  submenu: string;
  description: string;
  price_myr: number;
  stock: number;
  image_url: string;
  label: string;
  accent: string;
  sort_order: number;
  is_active: boolean;
  out_of_stock: boolean;
  is_fnb: boolean;
  option_groups: any[];
};

type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

type ShopSettings = {
  hero_image_url: string;
  hero_kicker: string;
  hero_title: string;
  hero_body: string;
  featured_item_id: string | null;
};

type ShopOrder = {
  id: string;
  room_number: string;
  guest_name: string;
  guest_email: string;
  status: string;
  payment_provider: string;
  payment_reference: string;
  total_myr: number;
  items_json: any[];
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string | null;
};

type Draft = {
  id: string;
  name: string;
  category: string;
  submenu: string;
  description: string;
  price_myr: string;
  stock: string;
  image_url: string;
  label: string;
  accent: string;
  sort_order: string;
  is_active: boolean;
  out_of_stock: boolean;
  is_fnb: boolean;
  option_groups_json: string;
};

type CategoryDraft = {
  id: string;
  name: string;
  sort_order: string;
  is_active: boolean;
};

const DEFAULT_CATEGORIES = ['Comfort', 'Laundry', 'Room Service', 'Essentials'];

const EMPTY_DRAFT: Draft = {
  id: '',
  name: '',
  category: 'Comfort',
  submenu: '',
  description: '',
  price_myr: '',
  stock: '0',
  image_url: '',
  label: '',
  accent: '#b6813a',
  sort_order: '0',
  is_active: true,
  out_of_stock: false,
  is_fnb: false,
  option_groups_json: '[]',
};

const EMPTY_CATEGORY_DRAFT: CategoryDraft = {
  id: '',
  name: '',
  sort_order: '0',
  is_active: true,
};

const DEFAULT_SETTINGS: ShopSettings = {
  hero_image_url:
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1800&q=84',
  hero_kicker: 'Private in-room collection',
  hero_title: 'Quiet luxuries, ready on request.',
  hero_body:
    'Order selected comforts, guest essentials, and hotel services from your room. Prepared by the team after verified payment.',
  featured_item_id: null,
};

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function canFullManageGuestShop(profile: Profile | null) {
  if (!profile) return false;
  const email = normalizeEmail(profile.email);
  const role = String(profile.role || '').trim().toUpperCase();
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com';
}

function canManageFnbStock(profile: Profile | null) {
  if (!profile) return false;
  const email = normalizeEmail(profile.email);
  const role = String(profile.role || '').trim().toUpperCase();
  return role === 'FNB' || email === 'fnb@hotelhallmark.com';
}

function canViewGuestShopAdmin(profile: Profile | null) {
  if (!profile) return false;
  const email = normalizeEmail(profile.email);
  const role = String(profile.role || '').trim().toUpperCase();
  return (
    canFullManageGuestShop(profile) ||
    canManageFnbStock(profile) ||
    role === 'FO' ||
    role === 'MANAGER' ||
    email === 'walter@hotelhallmark.com'
  );
}

function itemIsFnb(item: ShopItem | null) {
  return item?.is_fnb === true || String(item?.category || '').trim().toLowerCase() === 'f&b';
}

function todayInputValue() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: string) {
  return String(status || '').replace(/_/g, ' ');
}

function orderItemSummary(items: any[]) {
  if (!Array.isArray(items) || !items.length) return 'No item details';
  return items
    .map((item) => {
      const name = String(item?.name || item?.item_name || 'Item');
      const quantity = Number(item?.quantity || item?.qty || 1);
      const options = Array.isArray(item?.selected_options)
        ? item.selected_options
            .flatMap((group: any) =>
              Array.isArray(group?.options)
                ? group.options.map((option: any) => String(option?.name || '').trim()).filter(Boolean)
                : []
            )
            .join(', ')
        : '';
      const instructions = String(item?.special_instructions || '').trim();
      return `${quantity}x ${name}${options ? ` (${options})` : ''}${instructions ? ` - Note: ${instructions}` : ''}`;
    })
    .join(', ');
}

function draftFromItem(item: ShopItem): Draft {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    submenu: item.submenu || '',
    description: item.description,
    price_myr: String(item.price_myr ?? ''),
    stock: String(item.stock ?? '0'),
    image_url: item.image_url || '',
    label: item.label || '',
    accent: item.accent || '#b6813a',
    sort_order: String(item.sort_order ?? '0'),
    is_active: item.is_active !== false,
    out_of_stock: item.out_of_stock === true,
    is_fnb: item.is_fnb === true,
    option_groups_json: JSON.stringify(item.option_groups || [], null, 2),
  };
}

function normalizeItem(row: any): ShopItem {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    category: String(row?.category || 'Essentials'),
    submenu: String(row?.submenu || ''),
    description: String(row?.description || ''),
    price_myr: Number(row?.price_myr || 0),
    stock: Number(row?.stock || 0),
    image_url: String(row?.image_url || ''),
    label: String(row?.label || ''),
    accent: String(row?.accent || '#b6813a'),
    sort_order: Number(row?.sort_order || 0),
    is_active: row?.is_active !== false,
    out_of_stock: row?.out_of_stock === true,
    is_fnb: row?.is_fnb === true,
    option_groups: Array.isArray(row?.option_groups) ? row.option_groups : [],
  };
}

function normalizeCategory(row: any): CategoryRow {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    sort_order: Number(row?.sort_order || 0),
    is_active: row?.is_active !== false,
  };
}

function normalizeOrder(row: any): ShopOrder {
  return {
    id: String(row?.id || ''),
    room_number: String(row?.room_number || ''),
    guest_name: String(row?.guest_name || ''),
    guest_email: String(row?.guest_email || ''),
    status: String(row?.status || 'PENDING_PAYMENT'),
    payment_provider: String(row?.payment_provider || ''),
    payment_reference: String(row?.payment_reference || ''),
    total_myr: Number(row?.total_myr || 0),
    items_json: Array.isArray(row?.items_json) ? row.items_json : [],
    paid_at: row?.paid_at || null,
    fulfilled_at: row?.fulfilled_at || null,
    created_at: row?.created_at || null,
  };
}

function uniqueOptionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function GuestShopAdminPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SETTINGS);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(EMPTY_CATEGORY_DRAFT);
  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState<'items' | 'hero' | 'categories' | 'orders'>('items');
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('All');
  const [orderDate, setOrderDate] = useState(todayInputValue());
  const [orderStatus, setOrderStatus] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const canAccessAdmin = canViewGuestShopAdmin(profile);
  const canFullManage = canFullManageGuestShop(profile);
  const canFnbStockManage = canManageFnbStock(profile);
  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const canEditSelectedItem = canFullManage || (canFnbStockManage && itemIsFnb(selectedItem));
  const canEditSelectedFully = canFullManage;
  const liveItems = items.filter((item) => item.is_active && !item.out_of_stock).length;
  const visibleCategories = categories.filter((category) => category.is_active);
  const categoryNames = visibleCategories.length ? visibleCategories.map((category) => category.name) : DEFAULT_CATEGORIES;
  const itemFilterCategories = ['All', ...Array.from(new Set(items.map((item) => item.category).filter(Boolean)))];
  const filteredItems = items.filter((item) => {
    const matchesCategory = itemCategoryFilter === 'All' || item.category === itemCategoryFilter;
    const search = itemSearch.trim().toLowerCase();
    const haystack = [
      item.name,
      item.category,
      item.submenu,
      item.description,
      item.label,
    ].join(' ').toLowerCase();
    return matchesCategory && (!search || haystack.includes(search));
  });
  const paidOrders = orders.filter((order) => order.status === 'PAID' || order.status === 'FULFILLED').length;
  const failedOrders = orders.filter((order) => order.status === 'FAILED' || order.status === 'CANCELLED').length;

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        setLoading(true);
        setError('');

        const token = await getToken();
        if (!token) throw new Error('Please log in again');

        const profileRes = await fetch('/api/session-profile', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const profileJson = await profileRes.json();
        if (!profileRes.ok || !profileJson?.ok) {
          throw new Error(profileJson?.error || 'Failed to read session profile');
        }
        const user = profileJson?.user;

        if (alive && user) {
          setProfile({
            email: normalizeEmail(user.email),
            name: String(user.name || user.email || 'User'),
            role: String(user.role || 'FO').toUpperCase() as Role,
          });
        }

        const [itemsJson, categoriesJson, settingsJson] = await Promise.all([
          fetchJson('/api/guest-shop/items?include_inactive=1', token),
          fetchJson('/api/guest-shop/categories?include_inactive=1', token),
          fetchJson('/api/guest-shop/settings', token),
        ]);

        if (!alive) return;

        setItems(Array.isArray(itemsJson.items) ? itemsJson.items.map(normalizeItem) : []);
        const nextCategories = Array.isArray(categoriesJson.categories)
          ? categoriesJson.categories.map(normalizeCategory)
          : [];
        setCategories(nextCategories);

        if (settingsJson?.settings) {
          setSettings({
            hero_image_url: String(settingsJson.settings.hero_image_url || DEFAULT_SETTINGS.hero_image_url),
            hero_kicker: String(settingsJson.settings.hero_kicker || DEFAULT_SETTINGS.hero_kicker),
            hero_title: String(settingsJson.settings.hero_title || DEFAULT_SETTINGS.hero_title),
            hero_body: String(settingsJson.settings.hero_body || DEFAULT_SETTINGS.hero_body),
            featured_item_id: settingsJson.settings.featured_item_id
              ? String(settingsJson.settings.featured_item_id)
              : null,
          });
        }
      } catch (err: any) {
        if (alive) setError(err?.message || 'Failed to load Guest Shop Admin');
      } finally {
        if (alive) setLoading(false);
      }
    }

    init();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'orders' || !canAccessAdmin) return;
    loadOrders();
  }, [activeTab, orderDate, orderStatus, canAccessAdmin]);

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  async function fetchJson(url: string, token: string) {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Request failed');
    return json;
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetDraft() {
    setSelectedId('');
    setDraft({ ...EMPTY_DRAFT, category: categoryNames[0] || 'Comfort' });
    setMessage('');
    setError('');
  }

  function resetCategoryDraft() {
    setCategoryDraft(EMPTY_CATEGORY_DRAFT);
    setMessage('');
    setError('');
  }

  function draftOptionGroups() {
    try {
      const parsed = draft.option_groups_json.trim() ? JSON.parse(draft.option_groups_json) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function setDraftOptionGroups(groups: any[]) {
    updateDraft('option_groups_json', JSON.stringify(groups, null, 2));
  }

  function addOptionGroup() {
    const groups = draftOptionGroups();
    setDraftOptionGroups([
      ...groups,
      {
        id: uniqueOptionId('group'),
        name: 'New option group',
        selection_type: 'single',
        is_required: false,
        min_select: 0,
        max_select: 1,
        options: [
          {
            id: uniqueOptionId('option'),
            name: 'Regular',
            price_delta_myr: 0,
            is_default: true,
          },
        ],
      },
    ]);
  }

  function updateOptionGroup(index: number, patch: Record<string, any>) {
    const groups = draftOptionGroups();
    groups[index] = { ...groups[index], ...patch };
    if (patch.selection_type === 'single') {
      groups[index].max_select = 1;
    }
    setDraftOptionGroups(groups);
  }

  function removeOptionGroup(index: number) {
    setDraftOptionGroups(draftOptionGroups().filter((_group: any, rowIndex: number) => rowIndex !== index));
  }

  function addOptionChoice(groupIndex: number) {
    const groups = draftOptionGroups();
    const group = groups[groupIndex];
    if (!group) return;
    const options = Array.isArray(group.options) ? group.options : [];
    groups[groupIndex] = {
      ...group,
      options: [
        ...options,
        {
          id: uniqueOptionId('option'),
          name: 'New choice',
          price_delta_myr: 0,
          is_default: false,
        },
      ],
    };
    setDraftOptionGroups(groups);
  }

  function updateOptionChoice(groupIndex: number, optionIndex: number, patch: Record<string, any>) {
    const groups = draftOptionGroups();
    const group = groups[groupIndex];
    if (!group) return;
    const options = Array.isArray(group.options) ? [...group.options] : [];
    options[optionIndex] = { ...options[optionIndex], ...patch };
    groups[groupIndex] = { ...group, options };
    setDraftOptionGroups(groups);
  }

  function removeOptionChoice(groupIndex: number, optionIndex: number) {
    const groups = draftOptionGroups();
    const group = groups[groupIndex];
    if (!group) return;
    const options = Array.isArray(group.options) ? group.options : [];
    groups[groupIndex] = {
      ...group,
      options: options.filter((_: any, rowIndex: number) => rowIndex !== optionIndex),
    };
    setDraftOptionGroups(groups);
  }

  async function uploadImage(file: File, target: 'item' | 'hero') {
    try {
      if (!canFullManage) throw new Error('Only Superuser and Fenny can upload Guest Shop images.');
      setUploading(true);
      setError('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/guest-shop/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: dataUrl }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to upload image');

      if (target === 'hero') {
        setSettings((current) => ({ ...current, hero_image_url: String(json.url || '') }));
        setMessage('Hero image uploaded. Save Hero to publish it.');
      } else {
        updateDraft('image_url', String(json.url || ''));
        setMessage('Image uploaded. Save the SKU to publish it.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  async function saveItem() {
    try {
      if (!canFullManage && !(canFnbStockManage && itemIsFnb(selectedItem))) {
        throw new Error('You can only view this item.');
      }
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      let optionGroups: any[] = [];
      try {
        optionGroups = draft.option_groups_json.trim()
          ? JSON.parse(draft.option_groups_json)
          : [];
      } catch {
        throw new Error('Option groups must be valid JSON');
      }

      const payload = {
        id: draft.id,
        name: draft.name,
        category: draft.category || categoryNames[0] || 'Comfort',
        submenu: draft.submenu,
        description: draft.description,
        price_myr: Number(draft.price_myr || 0),
        stock: Number(draft.stock || 0),
        image_url: draft.image_url,
        label: draft.label,
        accent: draft.accent,
        sort_order: Number(draft.sort_order || 0),
        is_active: draft.is_active,
        out_of_stock: draft.out_of_stock,
        is_fnb: draft.is_fnb,
        option_groups: Array.isArray(optionGroups) ? optionGroups : [],
      };

      const res = await fetch('/api/guest-shop/items', {
        method: draft.id ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save SKU');

      const saved = normalizeItem(json.item);
      setItems((current) => {
        const exists = current.some((item) => item.id === saved.id);
        const next = exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
        return next.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      });

      setSelectedId(saved.id);
      setDraft(draftFromItem(saved));
      setMessage('SKU saved. Guest Shop will use the updated item.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save SKU');
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(item: ShopItem) {
    if (!canFullManage) {
      setError('Only Superuser and Fenny can delete SKUs.');
      return;
    }
    const confirmed = window.confirm(`Delete "${item.name}" from Guest Shop?`);
    if (!confirmed) return;

    try {
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch(`/api/guest-shop/items?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to delete SKU');

      setItems((current) => current.filter((row) => row.id !== item.id));
      if (selectedId === item.id) resetDraft();
      setMessage('SKU deleted.');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete SKU');
    } finally {
      setBusy(false);
    }
  }

  async function saveHero() {
    try {
      if (!canFullManage) throw new Error('Only Superuser and Fenny can update the hero display.');
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch('/api/guest-shop/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save hero');

      setSettings({
        hero_image_url: String(json.settings.hero_image_url || DEFAULT_SETTINGS.hero_image_url),
        hero_kicker: String(json.settings.hero_kicker || DEFAULT_SETTINGS.hero_kicker),
        hero_title: String(json.settings.hero_title || DEFAULT_SETTINGS.hero_title),
        hero_body: String(json.settings.hero_body || DEFAULT_SETTINGS.hero_body),
        featured_item_id: json.settings.featured_item_id ? String(json.settings.featured_item_id) : null,
      });
      setMessage('Hero saved. The guest shop display will refresh with this image/text.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save hero');
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory() {
    try {
      if (!canFullManage) throw new Error('Only Superuser and Fenny can update categories.');
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch('/api/guest-shop/categories', {
        method: categoryDraft.id ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: categoryDraft.id,
          name: categoryDraft.name,
          sort_order: Number(categoryDraft.sort_order || 0),
          is_active: categoryDraft.is_active,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save category');

      const saved = normalizeCategory(json.category);
      setCategories((current) => {
        const exists = current.some((category) => category.id === saved.id);
        const next = exists
          ? current.map((category) => (category.id === saved.id ? saved : category))
          : [...current, saved];
        return next.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      });
      setCategoryDraft({ id: saved.id, name: saved.name, sort_order: String(saved.sort_order), is_active: saved.is_active });
      setMessage('Category saved.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save category');
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(category: CategoryRow) {
    if (!canFullManage) {
      setError('Only Superuser and Fenny can remove categories.');
      return;
    }
    const confirmed = window.confirm(`Remove "${category.name}" from the guest shop filter? Existing SKUs will not be deleted.`);
    if (!confirmed) return;

    try {
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch(`/api/guest-shop/categories?id=${encodeURIComponent(category.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to remove category');

      const saved = normalizeCategory(json.category);
      setCategories((current) => current.map((row) => (row.id === saved.id ? saved : row)));
      setMessage('Category hidden from the guest shop.');
    } catch (err: any) {
      setError(err?.message || 'Failed to remove category');
    } finally {
      setBusy(false);
    }
  }

  async function loadOrders() {
    try {
      setError('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');
      const json = await fetchJson(
        `/api/guest-shop/orders?date=${encodeURIComponent(orderDate)}&status=${encodeURIComponent(orderStatus)}`,
        token
      );
      setOrders(Array.isArray(json.orders) ? json.orders.map(normalizeOrder) : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load orders');
      setOrders([]);
    }
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading Guest Shop Admin...</div>
      </main>
    );
  }

  if (!canAccessAdmin) {
    return (
      <main style={styles.page}>
        <div style={styles.deniedCard}>
          <h1>Access denied</h1>
          <p>Guest Shop Admin is available to Superuser, Fenny, Walter, Manager, Front Office, and F&B.</p>
          <Link href="/dashboard" style={styles.darkButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.kicker}>Front Office Commerce</div>
          <h1 style={styles.title}>Guest Shop Admin</h1>
          <p style={styles.subtitle}>
            Manage guest-facing products, hero display, categories, and purchase history.
          </p>
        </div>
        <div style={styles.heroActions}>
          <Link href="/guest-shop" target="_blank" style={styles.lightButton}>Preview Shop</Link>
          <Link href="/dashboard" style={styles.lightButton}>Back</Link>
        </div>
      </section>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {message ? <div style={styles.successBox}>{message}</div> : null}

      <section style={styles.statsGrid}>
        <div style={styles.statCard}><span>SKUs</span><strong>{items.length}</strong></div>
        <div style={styles.statCard}><span>Live Items</span><strong>{liveItems}</strong></div>
        <div style={styles.statCard}><span>Categories</span><strong>{visibleCategories.length}</strong></div>
        <div style={styles.statCard}><span>Orders Today</span><strong>{orders.length}</strong></div>
      </section>

      <nav style={styles.tabs}>
        {([
          ['items', 'SKUs'],
          ['hero', 'Hero Image'],
          ['categories', 'Categories'],
          ['orders', 'Orders'],
        ] as Array<[typeof activeTab, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            style={activeTab === id ? styles.activeTab : styles.tabButton}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'items' ? (
        <section style={styles.layout}>
          <div style={styles.formCard}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.kicker}>SKU Editor</div>
                <h2 style={styles.cardTitle}>{draft.id ? 'Edit Item' : 'New Item'}</h2>
              </div>
              {canFullManage ? <button type="button" onClick={resetDraft} style={styles.ghostButton}>New SKU</button> : null}
            </div>

            <div style={styles.formGrid}>
              <label style={styles.label}>
                Item Name
                <input disabled={!canFullManage} value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Example: Late Check-Out" style={styles.input} />
              </label>

              <label style={styles.label}>
                Category
                <select disabled={!canFullManage} value={draft.category} onChange={(event) => updateDraft('category', event.target.value)} style={styles.input}>
                  {categoryNames.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>

              <label style={styles.label}>
                Submenu
                <input disabled={!canFullManage} value={draft.submenu} onChange={(event) => updateDraft('submenu', event.target.value)} placeholder="Example: Asian Cuisine" style={styles.input} />
              </label>

              <label style={styles.label}>
                Price (RM)
                <input disabled={!canFullManage} value={draft.price_myr} onChange={(event) => updateDraft('price_myr', event.target.value)} inputMode="decimal" placeholder="0.00" style={styles.input} />
              </label>

              <label style={styles.label}>
                Stock
                <input disabled={!canFullManage && !(canFnbStockManage && (draft.is_fnb || draft.category.toLowerCase() === 'f&b'))} value={draft.stock} onChange={(event) => updateDraft('stock', event.target.value)} inputMode="numeric" placeholder="0" style={styles.input} />
              </label>

              <label style={styles.label}>
                Sort Order
                <input disabled={!canFullManage} value={draft.sort_order} onChange={(event) => updateDraft('sort_order', event.target.value)} inputMode="numeric" placeholder="0" style={styles.input} />
              </label>

              <label style={styles.label}>
                Label
                <input disabled={!canFullManage} value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} placeholder="Example: Limited daily" style={styles.input} />
              </label>
            </div>

            <label style={styles.label}>
              Description
              <textarea disabled={!canFullManage} value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} placeholder="Short guest-facing description" style={styles.textarea} />
            </label>

            <div style={styles.optionBuilder}>
              <div style={styles.optionBuilderHead}>
                <div>
                  <div style={styles.kicker}>Guest Choices</div>
                  <h3 style={styles.optionBuilderTitle}>Add-ons and options</h3>
                  <p style={styles.optionBuilderHelp}>
                    Use this for upsize, spicy level, add egg, no ice, or any paid/optional choice guests can select.
                  </p>
                </div>
                <button type="button" disabled={!canFullManage} onClick={addOptionGroup} style={styles.ghostButton}>Add Option Group</button>
              </div>

              {draftOptionGroups().length ? (
                <div style={styles.optionGroups}>
                  {draftOptionGroups().map((group: any, groupIndex: number) => {
                    const options = Array.isArray(group.options) ? group.options : [];
                    const isMultiple = String(group.selection_type || 'single') === 'multiple';

                    return (
                      <div style={styles.optionGroupCard} key={group.id || groupIndex}>
                        <div style={styles.optionGroupTop}>
                          <label style={styles.label}>
                            Group Name
                            <input
                              disabled={!canFullManage}
                              value={String(group.name || '')}
                              onChange={(event) => updateOptionGroup(groupIndex, { name: event.target.value })}
                              placeholder="Example: Size"
                              style={styles.input}
                            />
                          </label>

                          <label style={styles.label}>
                            Selection
                            <select
                              disabled={!canFullManage}
                              value={isMultiple ? 'multiple' : 'single'}
                              onChange={(event) => updateOptionGroup(groupIndex, {
                                selection_type: event.target.value,
                                max_select: event.target.value === 'single' ? 1 : Math.max(1, Number(group.max_select || 3)),
                              })}
                              style={styles.input}
                            >
                              <option value="single">Choose one</option>
                              <option value="multiple">Can choose many</option>
                            </select>
                          </label>

                          <label style={styles.label}>
                            Max Choice
                            <input
                              value={String(group.max_select ?? (isMultiple ? 3 : 1))}
                              disabled={!canFullManage || !isMultiple}
                              onChange={(event) => updateOptionGroup(groupIndex, { max_select: Number(event.target.value || 0) })}
                              inputMode="numeric"
                              style={styles.input}
                            />
                          </label>
                        </div>

                        <div style={styles.optionGroupActions}>
                          <label style={styles.checkLabel}>
                            <input
                              type="checkbox"
                              disabled={!canFullManage}
                              checked={group.is_required === true}
                              onChange={(event) => updateOptionGroup(groupIndex, {
                                is_required: event.target.checked,
                                min_select: event.target.checked ? 1 : 0,
                              })}
                            />
                            Required for guest
                          </label>
                          <button type="button" disabled={!canFullManage} onClick={() => addOptionChoice(groupIndex)} style={styles.ghostButton}>Add Choice</button>
                          <button type="button" disabled={!canFullManage} onClick={() => removeOptionGroup(groupIndex)} style={styles.dangerButton}>Remove Group</button>
                        </div>

                        <div style={styles.optionChoices}>
                          {options.map((option: any, optionIndex: number) => (
                            <div style={styles.optionChoiceRow} key={option.id || optionIndex}>
                              <input
                                disabled={!canFullManage}
                                value={String(option.name || '')}
                                onChange={(event) => updateOptionChoice(groupIndex, optionIndex, { name: event.target.value })}
                                placeholder="Example: Add egg"
                                style={styles.input}
                              />
                              <input
                                disabled={!canFullManage}
                                value={String(option.price_delta_myr ?? 0)}
                                onChange={(event) => updateOptionChoice(groupIndex, optionIndex, { price_delta_myr: event.target.value })}
                                inputMode="decimal"
                                placeholder="Add RM"
                                style={styles.input}
                              />
                              <label style={styles.compactCheck}>
                                <input
                                  type="checkbox"
                                  disabled={!canFullManage}
                                  checked={option.is_default === true}
                                  onChange={(event) => updateOptionChoice(groupIndex, optionIndex, { is_default: event.target.checked })}
                                />
                                Default
                              </label>
                              <button type="button" disabled={!canFullManage} onClick={() => removeOptionChoice(groupIndex, optionIndex)} style={styles.smallDangerButton}>
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={styles.emptyOptionBox}>
                  No add-ons yet. Add an option group for Size, Spicy Level, Extra Egg, or other guest choices.
                </div>
              )}
            </div>

            <div style={styles.imageEditor}>
              <div style={styles.previewBox}>
                {draft.image_url ? <img src={draft.image_url} alt="SKU preview" style={styles.previewImage} /> : <span style={styles.previewFallback}>Image</span>}
              </div>

              <div style={styles.imageControls}>
                <label style={styles.label}>
                  Product Image URL
                  <input disabled={!canFullManage} value={draft.image_url} onChange={(event) => updateDraft('image_url', event.target.value)} placeholder="Paste image URL or upload below" style={styles.input} />
                </label>

                <label style={styles.uploadButton}>
                  {uploading ? 'Uploading...' : 'Upload New Image'}
                  <input type="file" accept="image/*" disabled={uploading || !canFullManage} onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) uploadImage(file, 'item');
                  }} style={styles.hiddenInput} />
                </label>
              </div>
            </div>

            <div style={styles.switchRow}>
              <label style={styles.checkLabel}>
                <input type="checkbox" disabled={!canFullManage} checked={draft.is_fnb} onChange={(event) => updateDraft('is_fnb', event.target.checked)} />
                F&B menu item
              </label>
              <label style={styles.checkLabel}>
                <input type="checkbox" disabled={!canFullManage} checked={draft.is_active} onChange={(event) => updateDraft('is_active', event.target.checked)} />
                Show on Guest Shop
              </label>
              <label style={styles.checkLabel}>
                <input type="checkbox" disabled={!canFullManage && !(canFnbStockManage && (draft.is_fnb || draft.category.toLowerCase() === 'f&b'))} checked={draft.out_of_stock} onChange={(event) => updateDraft('out_of_stock', event.target.checked)} />
                Mark Out of Stock
              </label>
            </div>

            {canEditSelectedItem || (canFullManage && !draft.id) ? (
              <button type="button" disabled={busy || uploading} onClick={saveItem} style={styles.saveButton}>
                {busy ? 'Saving...' : canFullManage ? 'Save SKU' : 'Save Stock Status'}
              </button>
            ) : (
              <div style={styles.readOnlyBox}>View only. You do not have permission to edit this SKU.</div>
            )}
          </div>

          <div style={styles.listCard}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.kicker}>Catalog</div>
                <h2 style={styles.cardTitle}>Current SKUs</h2>
              </div>
            </div>

            <div style={styles.catalogFilters}>
              <label style={styles.label}>
                Category
                <select value={itemCategoryFilter} onChange={(event) => setItemCategoryFilter(event.target.value)} style={styles.input}>
                  {itemFilterCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label style={styles.label}>
                Search Product
                <input
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  placeholder="Search item name, submenu, label..."
                  style={styles.input}
                />
              </label>
            </div>

            <div style={styles.itemList}>
              {filteredItems.length ? filteredItems.map((item) => (
                <article key={item.id} style={{ ...styles.itemRow, borderColor: selectedId === item.id ? '#1d4ed8' : '#d7e0eb' }}>
                  <div style={styles.itemThumb}>{item.image_url ? <img src={item.image_url} alt="" style={styles.itemThumbImage} /> : null}</div>
                  <div style={styles.itemMain}>
                    <div style={styles.itemTop}>
                      <strong>{item.name}</strong>
                      <span style={item.out_of_stock || !item.is_active ? styles.inactiveBadge : styles.activeBadge}>
                        {item.out_of_stock ? 'Out of Stock' : item.is_active ? 'Live' : 'Hidden'}
                      </span>
                    </div>
                    <div style={styles.itemMeta}>
                      {item.category}{item.submenu ? ` / ${item.submenu}` : ''} | {money(item.price_myr)} | Stock {item.stock}
                      {item.option_groups?.length ? ` | ${item.option_groups.length} option group${item.option_groups.length === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                  <div style={styles.rowActions}>
                    <button type="button" onClick={() => {
                      setSelectedId(item.id);
                      setDraft(draftFromItem(item));
                      setMessage('');
                      setError('');
                    }} style={styles.smallButton}>Edit</button>
                    {canFullManage ? <button type="button" onClick={() => deleteItem(item)} style={styles.deleteButton}>Delete</button> : null}
                  </div>
                </article>
              )) : <div style={styles.emptyState}>No SKUs found for this search or category.</div>}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'hero' ? (
        <section style={styles.layout}>
          <div style={styles.formCard}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.kicker}>Hero Display</div>
                <h2 style={styles.cardTitle}>Guest Landing Image</h2>
              </div>
            </div>

            <div style={styles.heroPreview}>
              <img src={settings.hero_image_url} alt="Guest shop hero preview" style={styles.heroPreviewImage} />
            </div>

            <label style={styles.label}>
              Hero Image URL
              <input disabled={!canFullManage} value={settings.hero_image_url} onChange={(event) => setSettings((current) => ({ ...current, hero_image_url: event.target.value }))} style={styles.input} />
            </label>

            <label style={styles.uploadButton}>
              {uploading ? 'Uploading...' : 'Upload Hero Image'}
              <input type="file" accept="image/*" disabled={uploading || !canFullManage} onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) uploadImage(file, 'hero');
              }} style={styles.hiddenInput} />
            </label>

            <div style={styles.formGrid}>
              <label style={styles.label}>
                Small Text
                <input disabled={!canFullManage} value={settings.hero_kicker} onChange={(event) => setSettings((current) => ({ ...current, hero_kicker: event.target.value }))} style={styles.input} />
              </label>
              <label style={styles.label}>
                Featured Item
                <select disabled={!canFullManage} value={settings.featured_item_id || ''} onChange={(event) => setSettings((current) => ({ ...current, featured_item_id: event.target.value || null }))} style={styles.input}>
                  <option value="">Use first live item</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </div>

            <label style={styles.label}>
              Big Headline
              <input disabled={!canFullManage} value={settings.hero_title} onChange={(event) => setSettings((current) => ({ ...current, hero_title: event.target.value }))} style={styles.input} />
            </label>
            <label style={styles.label}>
              Supporting Text
              <textarea disabled={!canFullManage} value={settings.hero_body} onChange={(event) => setSettings((current) => ({ ...current, hero_body: event.target.value }))} style={styles.textarea} />
            </label>

            {canFullManage ? (
              <button type="button" disabled={busy || uploading} onClick={saveHero} style={styles.saveButton}>
                {busy ? 'Saving...' : 'Save Hero'}
              </button>
            ) : <div style={styles.readOnlyBox}>View only. Only Superuser and Fenny can update the hero display.</div>}
          </div>

          <div style={styles.displayCard}>
            <div style={styles.kicker}>Live Copy Preview</div>
            <h2 style={styles.previewTitle}>{settings.hero_title}</h2>
            <p style={styles.previewText}>{settings.hero_body}</p>
            <p style={styles.helperText}>The public guest page reads this on load. Tablet displays will show the updated hero after refresh or revisit.</p>
          </div>
        </section>
      ) : null}

      {activeTab === 'categories' ? (
        <section style={styles.layout}>
          <div style={styles.formCard}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.kicker}>Category Editor</div>
                <h2 style={styles.cardTitle}>{categoryDraft.id ? 'Edit Category' : 'New Category'}</h2>
              </div>
              {canFullManage ? <button type="button" onClick={resetCategoryDraft} style={styles.ghostButton}>New Category</button> : null}
            </div>

            <div style={styles.formGrid}>
              <label style={styles.label}>
                Category Name
                <input disabled={!canFullManage} value={categoryDraft.name} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Snacks" style={styles.input} />
              </label>
              <label style={styles.label}>
                Sort Order
                <input disabled={!canFullManage} value={categoryDraft.sort_order} onChange={(event) => setCategoryDraft((current) => ({ ...current, sort_order: event.target.value }))} inputMode="numeric" style={styles.input} />
              </label>
            </div>
            <label style={styles.checkLabel}>
              <input type="checkbox" disabled={!canFullManage} checked={categoryDraft.is_active} onChange={(event) => setCategoryDraft((current) => ({ ...current, is_active: event.target.checked }))} />
              Show category on Guest Shop
            </label>
            {canFullManage ? (
              <button type="button" disabled={busy} onClick={saveCategory} style={styles.saveButton}>{busy ? 'Saving...' : 'Save Category'}</button>
            ) : <div style={styles.readOnlyBox}>View only. Only Superuser and Fenny can update categories.</div>}
          </div>

          <div style={styles.listCard}>
            <div style={styles.cardHead}>
              <div>
                <div style={styles.kicker}>Filters</div>
                <h2 style={styles.cardTitle}>Current Categories</h2>
              </div>
            </div>
            <div style={styles.itemList}>
              {categories.map((category) => (
                <article key={category.id} style={styles.itemRow}>
                  <div style={styles.itemMain}>
                    <div style={styles.itemTop}>
                      <strong>{category.name}</strong>
                      <span style={category.is_active ? styles.activeBadge : styles.inactiveBadge}>{category.is_active ? 'Shown' : 'Hidden'}</span>
                    </div>
                    <div style={styles.itemMeta}>Sort {category.sort_order}</div>
                  </div>
                  <div style={styles.rowActions}>
                    <button type="button" onClick={() => setCategoryDraft({ id: category.id, name: category.name, sort_order: String(category.sort_order), is_active: category.is_active })} style={styles.smallButton}>Edit</button>
                    {canFullManage ? <button type="button" onClick={() => removeCategory(category)} style={styles.deleteButton}>Remove</button> : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'orders' ? (
        <section style={styles.fullCard}>
          <div style={styles.cardHead}>
            <div>
              <div style={styles.kicker}>Purchase Listing</div>
              <h2 style={styles.cardTitle}>Orders by Date</h2>
            </div>
            <button type="button" onClick={loadOrders} style={styles.ghostButton}>Refresh</button>
          </div>

          <div style={styles.orderToolbar}>
            <label style={styles.label}>
              Purchase Date
              <input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Payment Status
              <select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} style={styles.input}>
                <option value="ALL">All statuses</option>
                <option value="PENDING_PAYMENT">Pending Payment</option>
                <option value="PAID">Paid</option>
                <option value="FAILED">Failed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="FULFILLED">Fulfilled</option>
              </select>
            </label>
          </div>

          <div style={styles.orderSummary}>
            <span>{orders.length} orders on {orderDate}</span>
            <span>{paidOrders} confirmed paid</span>
            <span>{failedOrders} failed / cancelled</span>
          </div>

          <div style={styles.orderList}>
            {orders.length ? orders.map((order) => (
              <article key={order.id} style={styles.orderCard}>
                <div style={styles.orderCardHead}>
                  <div>
                    <strong>Room {order.room_number || '-'}</strong>
                    <span>{order.guest_name || 'Guest'} {order.guest_email ? `| ${order.guest_email}` : ''}</span>
                  </div>
                  <span style={styles[`status_${order.status}`] || styles.statusBadge}>{statusLabel(order.status)}</span>
                </div>
                <div style={styles.orderDetails}>
                  <div><span>Total</span><strong>{money(order.total_myr)}</strong></div>
                  <div><span>Created</span><strong>{formatTime(order.created_at)}</strong></div>
                  <div>
                    <span>{order.status === 'PAID' || order.status === 'FULFILLED' ? 'Paid At' : 'Payment Status'}</span>
                    <strong>
                      {order.status === 'PAID' || order.status === 'FULFILLED'
                        ? formatTime(order.paid_at)
                        : statusLabel(order.status)}
                    </strong>
                  </div>
                  <div><span>Payment Ref</span><strong>{order.payment_reference || '-'}</strong></div>
                </div>
                <p style={styles.orderItems}>{orderItemSummary(order.items_json)}</p>
              </article>
            )) : (
              <div style={styles.emptyState}>No guest shop orders found for this date and status.</div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: '100vh',
    padding: 'clamp(18px, 3vw, 34px)',
    background:
      'radial-gradient(circle at 8% 0%, rgba(37,99,235,0.08), transparent 32%), linear-gradient(180deg, #f4f7fb 0%, #eef4fb 100%)',
    color: '#0f172a',
  },
  centerCard: {
    maxWidth: 520,
    margin: '80px auto',
    padding: 28,
    borderRadius: 22,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.10)',
    fontWeight: 900,
    textAlign: 'center',
  },
  deniedCard: {
    maxWidth: 620,
    margin: '80px auto',
    padding: 32,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.10)',
    textAlign: 'center',
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 18,
    marginBottom: 18,
    padding: 24,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #ffffff, #eef5ff)',
    border: '1px solid #cfe0f4',
    boxShadow: '0 24px 70px rgba(15,23,42,0.08)',
    flexWrap: 'wrap',
  },
  kicker: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: {
    margin: '6px 0',
    fontSize: 'clamp(34px, 5vw, 56px)',
    letterSpacing: 0,
  },
  subtitle: { margin: 0, color: '#526173', fontSize: 16 },
  heroActions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  lightButton: {
    minHeight: 46,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 18px',
    borderRadius: 14,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    textDecoration: 'none',
    fontWeight: 900,
  },
  darkButton: {
    minHeight: 46,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 18px',
    borderRadius: 14,
    background: '#0f172a',
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 900,
  },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#be123c',
    fontWeight: 900,
  },
  successBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#047857',
    fontWeight: 900,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  statCard: {
    padding: 16,
    borderRadius: 18,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
  },
  tabs: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 18,
    padding: 6,
    borderRadius: 18,
    background: '#eaf3ff',
    width: 'fit-content',
    maxWidth: '100%',
  },
  tabButton: {
    minHeight: 42,
    padding: '0 16px',
    borderRadius: 13,
    border: 0,
    background: 'transparent',
    color: '#334155',
    fontWeight: 900,
    cursor: 'pointer',
  },
  activeTab: {
    minHeight: 42,
    padding: '0 16px',
    borderRadius: 13,
    border: 0,
    background: '#2563eb',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 12px 26px rgba(37,99,235,0.24)',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))',
    gap: 18,
    alignItems: 'start',
  },
  formCard: {
    padding: 22,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.08)',
  },
  listCard: {
    padding: 22,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.08)',
  },
  fullCard: {
    padding: 22,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.08)',
  },
  displayCard: {
    padding: 24,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #101827, #243b6b)',
    color: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 24px 70px rgba(15,23,42,0.12)',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
    flexWrap: 'wrap',
  },
  cardTitle: { margin: '4px 0 0', fontSize: 28, letterSpacing: 0 },
  previewTitle: { margin: '12px 0', fontSize: 'clamp(34px, 5vw, 58px)', lineHeight: 1, fontFamily: 'Georgia, serif' },
  previewText: { color: '#dbeafe', lineHeight: 1.7, fontSize: 16 },
  helperText: { color: '#bfdbfe', lineHeight: 1.6 },
  ghostButton: {
    minHeight: 42,
    padding: '0 15px',
    borderRadius: 12,
    border: '1px solid #c8d7e8',
    background: '#f8fbff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 12,
  },
  catalogFilters: {
    display: 'grid',
    gridTemplateColumns: 'minmax(min(100%, 180px), 0.45fr) minmax(min(100%, 240px), 1fr)',
    gap: 12,
    marginBottom: 14,
    padding: 12,
    borderRadius: 18,
    background: '#f8fbff',
    border: '1px solid #d7e0eb',
  },
  label: {
    display: 'grid',
    gap: 7,
    color: '#334155',
    fontSize: 13,
    fontWeight: 900,
    marginTop: 12,
  },
  input: {
    width: '100%',
    minHeight: 46,
    padding: '0 13px',
    borderRadius: 13,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    font: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    minHeight: 98,
    padding: 13,
    borderRadius: 13,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    font: 'inherit',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  optionBuilder: {
    display: 'grid',
    gap: 14,
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    background: 'linear-gradient(135deg, #f8fbff, #eef6ff)',
    border: '1px solid #d7e0eb',
  },
  optionBuilderHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
  },
  optionBuilderTitle: {
    margin: '4px 0',
    fontSize: 22,
    letterSpacing: 0,
  },
  optionBuilderHelp: {
    maxWidth: 560,
    margin: 0,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1.5,
  },
  optionGroups: {
    display: 'grid',
    gap: 14,
  },
  optionGroupCard: {
    display: 'grid',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 16px 40px rgba(15,23,42,0.05)',
  },
  optionGroupTop: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 10,
  },
  optionGroupActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  optionChoices: {
    display: 'grid',
    gap: 10,
  },
  optionChoiceRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))',
    gap: 10,
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    background: '#f8fbff',
    border: '1px solid #e2eaf4',
  },
  compactCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    minHeight: 42,
    padding: '0 10px',
    borderRadius: 12,
    background: '#fff',
    border: '1px solid #d7e0eb',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  dangerButton: {
    minHeight: 42,
    padding: '0 15px',
    borderRadius: 12,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#be123c',
    fontWeight: 900,
    cursor: 'pointer',
  },
  smallDangerButton: {
    minHeight: 42,
    padding: '0 12px',
    borderRadius: 12,
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#be123c',
    fontWeight: 900,
    cursor: 'pointer',
  },
  emptyOptionBox: {
    padding: 16,
    borderRadius: 16,
    border: '1px dashed #bdd2ea',
    background: '#fff',
    color: '#64748b',
    fontWeight: 900,
    lineHeight: 1.5,
  },
  imageEditor: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 14,
    marginTop: 14,
    padding: 14,
    borderRadius: 18,
    background: '#f8fbff',
    border: '1px solid #d7e0eb',
  },
  previewBox: {
    minHeight: 180,
    borderRadius: 16,
    overflow: 'hidden',
    background: '#eaf1fb',
    display: 'grid',
    placeItems: 'center',
  },
  previewImage: { width: '100%', height: '100%', objectFit: 'cover' },
  previewFallback: { color: '#64748b', fontWeight: 900 },
  imageControls: { display: 'grid', alignContent: 'center', gap: 12 },
  uploadButton: {
    minHeight: 46,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    marginTop: 12,
    borderRadius: 13,
    background: '#2563eb',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  hiddenInput: { display: 'none' },
  switchRow: { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 },
  checkLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    minHeight: 42,
    padding: '0 13px',
    marginTop: 12,
    borderRadius: 12,
    background: '#f8fbff',
    border: '1px solid #d7e0eb',
    fontWeight: 900,
  },
  saveButton: {
    width: '100%',
    minHeight: 50,
    marginTop: 16,
    border: 0,
    borderRadius: 14,
    background: '#0f172a',
    color: '#fff',
    fontWeight: 900,
    fontSize: 16,
    cursor: 'pointer',
  },
  readOnlyBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    background: '#f8fbff',
    border: '1px solid #d7e0eb',
    color: '#64748b',
    fontWeight: 900,
    lineHeight: 1.5,
  },
  heroPreview: {
    height: 300,
    overflow: 'hidden',
    borderRadius: 20,
    background: '#0f172a',
    border: '1px solid #d7e0eb',
  },
  heroPreviewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  itemList: { display: 'grid', gap: 12 },
  itemRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    border: '1px solid #d7e0eb',
    borderRadius: 18,
    background: '#f8fbff',
  },
  itemThumb: { width: 74, height: 74, overflow: 'hidden', borderRadius: 14, background: '#eaf1fb' },
  itemThumbImage: { width: '100%', height: '100%', objectFit: 'cover' },
  itemMain: { minWidth: 0, flex: '1 1 220px' },
  itemTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  itemMeta: { marginTop: 5, color: '#64748b', fontSize: 13, fontWeight: 800 },
  activeBadge: { padding: '6px 9px', borderRadius: 999, background: '#dcfce7', color: '#047857', fontSize: 12, fontWeight: 900 },
  inactiveBadge: { padding: '6px 9px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 900 },
  rowActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' },
  smallButton: {
    minHeight: 38,
    padding: '0 12px',
    borderRadius: 11,
    border: '1px solid #c8d7e8',
    background: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  deleteButton: {
    minHeight: 38,
    padding: '0 12px',
    borderRadius: 11,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#e11d48',
    fontWeight: 900,
    cursor: 'pointer',
  },
  emptyState: {
    padding: 24,
    borderRadius: 18,
    border: '1px dashed #c8d7e8',
    color: '#64748b',
    textAlign: 'center',
    fontWeight: 900,
  },
  orderToolbar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: 12,
    marginBottom: 12,
  },
  orderSummary: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  orderList: { display: 'grid', gap: 12 },
  orderCard: {
    padding: 16,
    borderRadius: 18,
    background: '#f8fbff',
    border: '1px solid #d7e0eb',
  },
  orderCardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  orderDetails: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 10,
    marginTop: 14,
  },
  orderItems: { margin: '14px 0 0', color: '#475569', fontWeight: 800 },
  statusBadge: { padding: '7px 10px', borderRadius: 999, background: '#e2e8f0', color: '#334155', fontSize: 12, fontWeight: 900 },
  status_PENDING_PAYMENT: { padding: '7px 10px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: 900 },
  status_PAID: { padding: '7px 10px', borderRadius: 999, background: '#dcfce7', color: '#047857', fontSize: 12, fontWeight: 900 },
  status_FULFILLED: { padding: '7px 10px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 12, fontWeight: 900 },
  status_FAILED: { padding: '7px 10px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 900 },
  status_CANCELLED: { padding: '7px 10px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', fontSize: 12, fontWeight: 900 },
};
