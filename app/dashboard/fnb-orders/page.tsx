'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type KitchenOrder = {
  id: string;
  room_number: string;
  guest_name: string;
  status: string;
  payment_reference: string;
  total_myr: number;
  items_json: any[];
  paid_at: string | null;
  created_at: string | null;
  kitchen_status: string;
  kitchen_requested_at: string | null;
  kitchen_accept_deadline_at: string | null;
  kitchen_ready_minutes: number | null;
  kitchen_decision_by: string;
  kitchen_decision_note: string;
  refund_required: boolean;
  refund_reason: string;
};

type Profile = {
  email: string;
  name: string;
  role: string;
};

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canAccessKitchen(profile: Profile | null) {
  if (!profile) return false;
  const role = String(profile.role || '').trim().toUpperCase();
  const email = normalizeEmail(profile.email);
  return role === 'SUPERUSER' || role === 'FNB' || email === 'fnb@hotelhallmark.com' || email === 'fenny@hotelhallmark.com';
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

function statusLabel(value: string) {
  return String(value || '').replace(/_/g, ' ');
}

function itemSummary(items: any[]) {
  if (!Array.isArray(items) || !items.length) return 'No items';
  return items.map((item) => {
    const qty = Number(item?.quantity || 1);
    const name = String(item?.name || 'Item');
    const options = Array.isArray(item?.selected_options)
      ? item.selected_options
          .flatMap((group: any) => Array.isArray(group?.options) ? group.options.map((option: any) => String(option?.name || '').trim()).filter(Boolean) : [])
          .join(', ')
      : '';
    const note = String(item?.special_instructions || '').trim();
    return `${qty}x ${name}${options ? ` (${options})` : ''}${note ? ` - ${note}` : ''}`;
  }).join(' | ');
}

function secondsLeft(deadline?: string | null) {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
}

export default function FnbOrdersPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const alarmRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PENDING' | 'HISTORY'>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [tick, setTick] = useState(0);

  const pendingCount = orders.filter((order) => order.kitchen_status === 'PENDING_ACCEPTANCE').length;
  const access = canAccessKitchen(profile);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        const token = await getToken();
        if (!token) throw new Error('Please log in again');

        const res = await fetch('/api/session-profile', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load profile');

        if (!alive) return;
        setProfile({
          email: normalizeEmail(json.user?.email),
          name: String(json.user?.name || json.user?.email || 'User'),
          role: String(json.user?.role || '').toUpperCase(),
        });
      } catch (err: any) {
        if (alive) setError(err?.message || 'Failed to load F&B kitchen page');
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
    if (!access) return;
    loadOrders();
    const interval = setInterval(loadOrders, 15000);
    return () => clearInterval(interval);
  }, [access, activeTab]);

  useEffect(() => {
    const interval = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!alarmEnabled || pendingCount <= 0) {
      if (alarmRef.current) clearInterval(alarmRef.current);
      alarmRef.current = null;
      return;
    }

    if (alarmRef.current) return;
    alarmRef.current = setInterval(() => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.08;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          context.close();
        }, 220);
      } catch {
        // Browser audio can be blocked without user interaction.
      }
    }, 2500);

    return () => {
      if (alarmRef.current) clearInterval(alarmRef.current);
      alarmRef.current = null;
    };
  }, [alarmEnabled, pendingCount]);

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  async function loadOrders() {
    try {
      setError('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch(`/api/guest-shop/kitchen-orders?status=${encodeURIComponent(activeTab)}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders');
      setOrders(Array.isArray(json.orders) ? json.orders : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load F&B orders');
    }
  }

  async function updateOrder(order: KitchenOrder, action: string, readyMinutes?: number) {
    try {
      setBusyId(`${order.id}:${action}:${readyMinutes || ''}`);
      setError('');
      setMessage('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch('/api/guest-shop/kitchen-orders', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: order.id,
          action,
          ready_minutes: readyMinutes || 0,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to update order');
      setMessage(action === 'REJECT' ? 'Order rejected. Marked for refund follow-up.' : 'Order updated.');
      await loadOrders();
    } catch (err: any) {
      setError(err?.message || 'Failed to update order');
    } finally {
      setBusyId('');
    }
  }

  if (loading) {
    return <main style={styles.page}><div style={styles.centerCard}>Loading F&B Orders...</div></main>;
  }

  if (!access) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <h1>Access denied</h1>
          <p>F&B Orders is available to F&B, Superuser, and Fenny.</p>
          <Link href="/dashboard" style={styles.darkButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Kitchen Workspace</div>
          <h1 style={styles.title}>F&B Orders</h1>
          <p style={styles.subtitle}>Paid F&B orders requiring kitchen acceptance and delivery updates.</p>
        </div>
        <div style={styles.heroActions}>
          <button type="button" onClick={() => setAlarmEnabled((value) => !value)} style={alarmEnabled ? styles.alarmOnButton : styles.lightButton}>
            {alarmEnabled ? 'Alarm On' : 'Enable Alarm'}
          </button>
          <button type="button" onClick={loadOrders} style={styles.lightButton}>Refresh</button>
          <Link href="/dashboard" style={styles.lightButton}>Back</Link>
        </div>
      </section>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {message ? <div style={styles.successBox}>{message}</div> : null}

      <section style={styles.statsGrid}>
        <div style={styles.statCard}><span>Pending acceptance</span><strong>{pendingCount}</strong></div>
        <div style={styles.statCard}><span>Active kitchen orders</span><strong>{orders.filter((order) => ['ACCEPTED', 'IN_PROGRESS'].includes(order.kitchen_status)).length}</strong></div>
        <div style={styles.statCard}><span>Refund follow-up</span><strong>{orders.filter((order) => order.refund_required).length}</strong></div>
      </section>

      <nav style={styles.tabs}>
        {(['ACTIVE', 'PENDING', 'HISTORY'] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} style={activeTab === tab ? styles.activeTab : styles.tabButton}>
            {tab === 'ACTIVE' ? 'Active' : tab === 'PENDING' ? 'Pending' : 'History'}
          </button>
        ))}
      </nav>

      <section style={styles.orderList}>
        {orders.length ? orders.map((order) => {
          const remaining = secondsLeft(order.kitchen_accept_deadline_at);
          return (
            <article key={order.id} style={styles.orderCard}>
              <div style={styles.cardHead}>
                <div>
                  <div style={styles.eyebrow}>Room {order.room_number || '-'}</div>
                  <h2 style={styles.cardTitle}>{order.guest_name || 'Guest'}</h2>
                </div>
                <span style={styles.statusBadge}>{statusLabel(order.kitchen_status)}</span>
              </div>

              <div style={styles.detailGrid}>
                <div><span>Total</span><strong>{money(order.total_myr)}</strong></div>
                <div><span>Paid</span><strong>{formatTime(order.paid_at)}</strong></div>
                <div><span>Payment Ref</span><strong>{order.payment_reference || '-'}</strong></div>
                <div><span>Deadline</span><strong>{order.kitchen_status === 'PENDING_ACCEPTANCE' ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` : '-'}</strong></div>
              </div>

              <p style={styles.itemsText}>{itemSummary(order.items_json)}</p>

              {order.refund_required ? (
                <div style={styles.refundBox}>
                  Refund follow-up required: {order.refund_reason || 'Kitchen rejected or timed out after payment.'}
                </div>
              ) : null}

              <div style={styles.actions}>
                {order.kitchen_status === 'PENDING_ACCEPTANCE' ? (
                  <>
                    {[15, 30, 45].map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        disabled={!!busyId}
                        onClick={() => updateOrder(order, 'ACCEPT', minutes)}
                        style={styles.primaryButton}
                      >
                        Accept {minutes}m
                      </button>
                    ))}
                    <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'REJECT')} style={styles.dangerButton}>
                      Reject
                    </button>
                  </>
                ) : null}

                {['ACCEPTED', 'IN_PROGRESS'].includes(order.kitchen_status) ? (
                  <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'DELIVERED')} style={styles.primaryButton}>
                    Delivered
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div style={styles.emptyState}>No F&B orders in this view.</div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: '100vh',
    padding: 'clamp(16px, 3vw, 34px)',
    background: 'linear-gradient(180deg, #f4f8ff 0%, #edf4fb 100%)',
    color: '#0f172a',
  },
  centerCard: {
    maxWidth: 560,
    margin: '80px auto',
    padding: 28,
    borderRadius: 24,
    background: '#fff',
    border: '1px solid #d6e2f1',
    boxShadow: '0 24px 70px rgba(15,23,42,0.10)',
    textAlign: 'center',
    fontWeight: 900,
  },
  hero: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: 22,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #ffffff, #eef6ff)',
    border: '1px solid #d6e2f1',
    boxShadow: '0 24px 70px rgba(15,23,42,0.08)',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  eyebrow: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  title: { margin: '4px 0', fontSize: 'clamp(34px, 5vw, 54px)', letterSpacing: 0 },
  subtitle: { margin: 0, color: '#526173', fontWeight: 700 },
  heroActions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  lightButton: {
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 14,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  alarmOnButton: {
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 14,
    border: '1px solid #bbf7d0',
    background: '#dcfce7',
    color: '#047857',
    fontWeight: 900,
    cursor: 'pointer',
  },
  darkButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 14,
    background: '#0f172a',
    color: '#fff',
    fontWeight: 900,
    textDecoration: 'none',
  },
  errorBox: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#be123c',
    fontWeight: 900,
  },
  successBox: {
    marginBottom: 12,
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
    marginBottom: 14,
  },
  statCard: {
    padding: 16,
    borderRadius: 18,
    background: '#fff',
    border: '1px solid #d6e2f1',
    boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
  },
  tabs: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 14,
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
    boxShadow: '0 12px 26px rgba(37,99,235,0.22)',
  },
  orderList: { display: 'grid', gap: 12 },
  orderCard: {
    padding: 18,
    borderRadius: 22,
    background: '#fff',
    border: '1px solid #d6e2f1',
    boxShadow: '0 22px 58px rgba(15,23,42,0.07)',
  },
  cardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  cardTitle: { margin: '4px 0', fontSize: 26 },
  statusBadge: {
    padding: '8px 12px',
    borderRadius: 999,
    background: '#eef6ff',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 900,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  itemsText: {
    margin: '12px 0',
    padding: 12,
    borderRadius: 16,
    background: '#f8fbff',
    border: '1px solid #e2eaf4',
    color: '#334155',
    fontWeight: 800,
    lineHeight: 1.5,
  },
  refundBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#9a3412',
    fontWeight: 900,
  },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  primaryButton: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 13,
    border: 0,
    background: '#2563eb',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  dangerButton: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 13,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontWeight: 900,
    cursor: 'pointer',
  },
  emptyState: {
    padding: 28,
    borderRadius: 22,
    background: '#fff',
    border: '1px dashed #bfd1e5',
    color: '#64748b',
    textAlign: 'center',
    fontWeight: 900,
  },
};
