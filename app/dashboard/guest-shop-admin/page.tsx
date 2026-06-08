'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Category = 'Comfort' | 'Laundry' | 'Room Service' | 'Essentials';
type Role = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';

type Profile = {
  email: string;
  name: string;
  role: Role;
};

type ShopItem = {
  id: string;
  name: string;
  category: Category;
  description: string;
  price_myr: number;
  stock: number;
  image_url: string;
  label: string;
  accent: string;
  sort_order: number;
  is_active: boolean;
  out_of_stock: boolean;
};

type Draft = {
  id: string;
  name: string;
  category: Category;
  description: string;
  price_myr: string;
  stock: string;
  image_url: string;
  label: string;
  accent: string;
  sort_order: string;
  is_active: boolean;
  out_of_stock: boolean;
};

const CATEGORIES: Category[] = ['Comfort', 'Laundry', 'Room Service', 'Essentials'];

const EMPTY_DRAFT: Draft = {
  id: '',
  name: '',
  category: 'Comfort',
  description: '',
  price_myr: '',
  stock: '0',
  image_url: '',
  label: '',
  accent: '#b6813a',
  sort_order: '0',
  is_active: true,
  out_of_stock: false,
};

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function canManageGuestShop(profile: Profile | null) {
  if (!profile) return false;
  const email = normalizeEmail(profile.email);
  return (
    profile.role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com' ||
    email === 'walter@hotelhallmark.com'
  );
}

function money(value: number) {
  return `RM${Number(value || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function draftFromItem(item: ShopItem): Draft {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description,
    price_myr: String(item.price_myr ?? ''),
    stock: String(item.stock ?? '0'),
    image_url: item.image_url || '',
    label: item.label || '',
    accent: item.accent || '#b6813a',
    sort_order: String(item.sort_order ?? '0'),
    is_active: item.is_active !== false,
    out_of_stock: item.out_of_stock === true,
  };
}

function normalizeItem(row: any): ShopItem {
  const category = CATEGORIES.includes(row?.category) ? row.category : 'Essentials';
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    category,
    description: String(row?.description || ''),
    price_myr: Number(row?.price_myr || 0),
    stock: Number(row?.stock || 0),
    image_url: String(row?.image_url || ''),
    label: String(row?.label || ''),
    accent: String(row?.accent || '#b6813a'),
    sort_order: Number(row?.sort_order || 0),
    is_active: row?.is_active !== false,
    out_of_stock: row?.out_of_stock === true,
  };
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const canManage = canManageGuestShop(profile);
  const activeItems = items.filter((item) => item.is_active && !item.out_of_stock).length;
  const inactiveItems = items.length - activeItems;

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        setLoading(true);
        setError('');

        const profileRes = await fetch('/api/session-profile', { cache: 'no-store' });
        const profileJson = await profileRes.json();
        const user = profileJson?.user;

        if (alive && user) {
          setProfile({
            email: String(user.email || '').trim().toLowerCase(),
            name: String(user.name || user.email || 'User'),
            role: String(user.role || 'FO').toUpperCase() as Role,
          });
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const itemsRes = await fetch('/api/guest-shop/items?include_inactive=1', {
          cache: 'no-store',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const itemsJson = await itemsRes.json();

        if (!itemsJson?.ok) throw new Error(itemsJson?.error || 'Failed to load SKUs');

        const nextItems = Array.isArray(itemsJson.items)
          ? itemsJson.items.map(normalizeItem)
          : [];

        if (alive) setItems(nextItems);
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

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function resetDraft() {
    setSelectedId('');
    setDraft(EMPTY_DRAFT);
    setMessage('');
    setError('');
  }

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  async function uploadImage(file: File) {
    try {
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

      updateDraft('image_url', String(json.url || ''));
      setMessage('Image uploaded. Save the SKU to publish it.');
    } catch (err: any) {
      setError(err?.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  async function saveItem() {
    try {
      setBusy(true);
      setError('');
      setMessage('');

      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const payload = {
        id: draft.id,
        name: draft.name,
        category: draft.category,
        description: draft.description,
        price_myr: Number(draft.price_myr || 0),
        stock: Number(draft.stock || 0),
        image_url: draft.image_url,
        label: draft.label,
        accent: draft.accent,
        sort_order: Number(draft.sort_order || 0),
        is_active: draft.is_active,
        out_of_stock: draft.out_of_stock,
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
        if (exists) return current.map((item) => (item.id === saved.id ? saved : item));
        return [...current, saved].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
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

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading Guest Shop Admin...</div>
      </main>
    );
  }

  if (!canManage) {
    return (
      <main style={styles.page}>
        <div style={styles.deniedCard}>
          <h1>Access denied</h1>
          <p>Guest Shop Admin is available to Superuser, Walter, and Fenny only.</p>
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
            Manage guest-facing SKUs, pricing, stock status, and product images.
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
        <div style={styles.statCard}>
          <span>SKUs</span>
          <strong>{items.length}</strong>
        </div>
        <div style={styles.statCard}>
          <span>Active</span>
          <strong>{activeItems}</strong>
        </div>
        <div style={styles.statCard}>
          <span>Hidden / Out</span>
          <strong>{inactiveItems}</strong>
        </div>
      </section>

      <section style={styles.layout}>
        <div style={styles.formCard}>
          <div style={styles.cardHead}>
            <div>
              <div style={styles.kicker}>SKU Editor</div>
              <h2 style={styles.cardTitle}>{draft.id ? 'Edit Item' : 'New Item'}</h2>
            </div>
            <button type="button" onClick={resetDraft} style={styles.ghostButton}>New SKU</button>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              Item Name
              <input
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder="Example: Late Check-Out"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Category
              <select
                value={draft.category}
                onChange={(event) => updateDraft('category', event.target.value as Category)}
                style={styles.input}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>

            <label style={styles.label}>
              Price (RM)
              <input
                value={draft.price_myr}
                onChange={(event) => updateDraft('price_myr', event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Stock
              <input
                value={draft.stock}
                onChange={(event) => updateDraft('stock', event.target.value)}
                inputMode="numeric"
                placeholder="0"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Sort Order
              <input
                value={draft.sort_order}
                onChange={(event) => updateDraft('sort_order', event.target.value)}
                inputMode="numeric"
                placeholder="0"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Label
              <input
                value={draft.label}
                onChange={(event) => updateDraft('label', event.target.value)}
                placeholder="Example: Limited daily"
                style={styles.input}
              />
            </label>
          </div>

          <label style={styles.label}>
            Description
            <textarea
              value={draft.description}
              onChange={(event) => updateDraft('description', event.target.value)}
              placeholder="Short guest-facing description"
              style={styles.textarea}
            />
          </label>

          <div style={styles.imageEditor}>
            <div style={styles.previewBox}>
              {draft.image_url ? (
                <img src={draft.image_url} alt="SKU preview" style={styles.previewImage} />
              ) : (
                <span style={styles.previewFallback}>Image</span>
              )}
            </div>

            <div style={styles.imageControls}>
              <label style={styles.label}>
                Product Image URL
                <input
                  value={draft.image_url}
                  onChange={(event) => updateDraft('image_url', event.target.value)}
                  placeholder="Paste image URL or upload below"
                  style={styles.input}
                />
              </label>

              <label style={styles.uploadButton}>
                {uploading ? 'Uploading...' : 'Upload New Image'}
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) uploadImage(file);
                  }}
                  style={styles.hiddenInput}
                />
              </label>
            </div>
          </div>

          <div style={styles.switchRow}>
            <label style={styles.checkLabel}>
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => updateDraft('is_active', event.target.checked)}
              />
              Show on Guest Shop
            </label>
            <label style={styles.checkLabel}>
              <input
                type="checkbox"
                checked={draft.out_of_stock}
                onChange={(event) => updateDraft('out_of_stock', event.target.checked)}
              />
              Mark Out of Stock
            </label>
          </div>

          <button type="button" disabled={busy || uploading} onClick={saveItem} style={styles.saveButton}>
            {busy ? 'Saving...' : 'Save SKU'}
          </button>
        </div>

        <div style={styles.listCard}>
          <div style={styles.cardHead}>
            <div>
              <div style={styles.kicker}>Catalog</div>
              <h2 style={styles.cardTitle}>Current SKUs</h2>
            </div>
          </div>

          <div style={styles.itemList}>
            {items.length ? items.map((item) => (
              <article
                key={item.id}
                style={{
                  ...styles.itemRow,
                  borderColor: selectedId === item.id ? '#1d4ed8' : '#d7e0eb',
                }}
              >
                <div style={styles.itemThumb}>
                  {item.image_url ? <img src={item.image_url} alt="" style={styles.itemThumbImage} /> : null}
                </div>
                <div style={styles.itemMain}>
                  <div style={styles.itemTop}>
                    <strong>{item.name}</strong>
                    <span style={item.out_of_stock || !item.is_active ? styles.inactiveBadge : styles.activeBadge}>
                      {item.out_of_stock ? 'Out of Stock' : item.is_active ? 'Live' : 'Hidden'}
                    </span>
                  </div>
                  <div style={styles.itemMeta}>
                    {item.category} | {money(item.price_myr)} | Stock {item.stock}
                  </div>
                </div>
                <div style={styles.rowActions}>
                  <button type="button" onClick={() => {
                    setSelectedId(item.id);
                    setDraft(draftFromItem(item));
                    setMessage('');
                    setError('');
                  }} style={styles.smallButton}>Edit</button>
                  <button type="button" onClick={() => deleteItem(item)} style={styles.deleteButton}>Delete</button>
                </div>
              </article>
            )) : (
              <div style={styles.emptyState}>No SKUs yet. Add your first guest shop item.</div>
            )}
          </div>
        </div>
      </section>
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
  subtitle: {
    margin: 0,
    color: '#526173',
    fontSize: 16,
  },
  heroActions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  statCard: {
    padding: 18,
    borderRadius: 20,
    background: '#fff',
    border: '1px solid #d7e0eb',
    boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
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
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  cardTitle: {
    margin: '4px 0 0',
    fontSize: 28,
    letterSpacing: 0,
  },
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
  label: {
    display: 'grid',
    gap: 7,
    color: '#334155',
    fontSize: 13,
    fontWeight: 900,
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
    marginTop: 12,
    padding: 13,
    borderRadius: 13,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    font: 'inherit',
    boxSizing: 'border-box',
    resize: 'vertical',
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
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewFallback: {
    color: '#64748b',
    fontWeight: 900,
  },
  imageControls: {
    display: 'grid',
    alignContent: 'center',
    gap: 12,
  },
  uploadButton: {
    minHeight: 46,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    borderRadius: 13,
    background: '#2563eb',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  hiddenInput: {
    display: 'none',
  },
  switchRow: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    marginTop: 16,
  },
  checkLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
    minHeight: 42,
    padding: '0 13px',
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
  itemList: {
    display: 'grid',
    gap: 12,
  },
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
  itemThumb: {
    width: 74,
    height: 74,
    overflow: 'hidden',
    borderRadius: 14,
    background: '#eaf1fb',
  },
  itemThumbImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  itemMain: {
    minWidth: 0,
    flex: '1 1 220px',
  },
  itemTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemMeta: {
    marginTop: 5,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
  },
  activeBadge: {
    padding: '6px 9px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#047857',
    fontSize: 12,
    fontWeight: 900,
  },
  inactiveBadge: {
    padding: '6px 9px',
    borderRadius: 999,
    background: '#fee2e2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 900,
  },
  rowActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginLeft: 'auto',
  },
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
};
