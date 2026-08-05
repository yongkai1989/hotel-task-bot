'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';
import {
  FNB_ORDER_BROADCAST_CHANNEL,
  FNB_ORDER_BROADCAST_EVENT,
} from '../lib/fnbOrderRealtime';

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
  kitchen_accepted_at: string | null;
  kitchen_ready_minutes: number | null;
  kitchen_decision_by: string;
  kitchen_decision_note: string;
  refund_required: boolean;
  refund_reason: string;
  print_status?: string;
  print_requested_at?: string | null;
  printed_at?: string | null;
  print_error?: string;
};

type Profile = {
  email: string;
  name: string;
  role: string;
  can_access_fnb_orders?: boolean;
  can_access_guest_shop_orders?: boolean;
};

type OrderMode = 'FNB' | 'GUEST_SHOP';

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canAccessOrders(profile: Profile | null, mode: OrderMode) {
  if (!profile) return false;
  const role = String(profile.role || '').trim().toUpperCase();
  const email = normalizeEmail(profile.email);
  if (mode === 'GUEST_SHOP') {
    return role === 'SUPERUSER' || profile.can_access_guest_shop_orders === true || email === 'fenny@hotelhallmark.com';
  }
  return (
    role === 'SUPERUSER' ||
    role === 'FNB' ||
    profile.can_access_fnb_orders === true ||
    email === 'fnb@hotelhallmark.com' ||
    email === 'fenny@hotelhallmark.com'
  );
}

function canDeleteKitchenHistory(profile: Profile | null) {
  if (!profile) return false;
  const role = String(profile.role || '').trim().toUpperCase();
  const email = normalizeEmail(profile.email);
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com';
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

function itemLines(items: any[]) {
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((item, index) => {
    const qty = Number(item?.quantity || 1);
    const name = String(item?.name || 'Item');
    const options = Array.isArray(item?.selected_options)
      ? item.selected_options
          .flatMap((group: any) => Array.isArray(group?.options) ? group.options.map((option: any) => String(option?.name || '').trim()).filter(Boolean) : [])
          .join(', ')
      : '';
    const note = String(item?.special_instructions || '').trim();
    return {
      id: `${name}-${index}`,
      qty,
      name,
      options,
      note,
    };
  });
}

function secondsLeft(deadline?: string | null) {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
}

function readyDeadline(order: KitchenOrder) {
  if (!order.kitchen_accepted_at || !order.kitchen_ready_minutes) return null;
  return new Date(
    new Date(order.kitchen_accepted_at).getTime() + Number(order.kitchen_ready_minutes || 0) * 60 * 1000
  ).toISOString();
}

function countdownText(seconds: number) {
  if (seconds <= 0) return 'Ready now';
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const CUSTOM_ALARM_SRC = '/sounds/fnb-order-alert.mp3';

export default function OrderOperationsPage({ mode = 'FNB' }: { mode?: OrderMode }) {
  const isGuestShop = mode === 'GUEST_SHOP';
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const alarmRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PENDING' | 'HISTORY'>('PENDING');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const pendingOrders = orders.filter((order) => order.kitchen_status === 'PENDING_ACCEPTANCE');
  const pendingCount = pendingOrders.length;
  const promptOrder = pendingOrders[0] || null;
  const nextAcceptanceDeadline = pendingOrders.reduce<string | null>((earliest, order) => {
    const deadline = order.kitchen_accept_deadline_at;
    if (!deadline) return earliest;
    if (!earliest || Date.parse(deadline) < Date.parse(earliest)) return deadline;
    return earliest;
  }, null);
  const access = canAccessOrders(profile, mode);
  const canDeleteHistory = isGuestShop
    ? String(profile?.role || '').toUpperCase() === 'SUPERUSER'
    : canDeleteKitchenHistory(profile);
  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.room_number, order.guest_name, order.payment_reference, itemSummary(order.items_json)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [orders, search]);

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
          can_access_fnb_orders: json.user?.can_access_fnb_orders === true,
          can_access_guest_shop_orders: json.user?.can_access_guest_shop_orders === true,
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
  }, [mode]);

  useEffect(() => {
    if (!access) return;
    let channel: any = null;
    let refreshTimer: number | null = null;

    const refreshOrders = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadOrders(activeTab);
      }, 200);
    };

    const startChannel = async () => {
      if (channel || document.visibilityState !== 'visible') return;
      await supabase.realtime.setAuth();
      channel = supabase
        .channel(FNB_ORDER_BROADCAST_CHANNEL, { config: { private: true } })
        .on('broadcast', { event: FNB_ORDER_BROADCAST_EVENT }, refreshOrders)
        .subscribe();
    };

    const stopChannel = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      if (!channel) return;
      const activeChannel = channel;
      channel = null;
      void supabase.removeChannel(activeChannel);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void startChannel();
        void loadOrders(activeTab);
      } else {
        stopChannel();
      }
    };

    void loadOrders(activeTab);
    void startChannel();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopChannel();
    };
  }, [access, activeTab, supabase]);

  useEffect(() => {
    const interval = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!access || !nextAcceptanceDeadline) return;
    const deadlineMs = Date.parse(nextAcceptanceDeadline);
    if (!Number.isFinite(deadlineMs)) return;
    const timeout = window.setTimeout(
      () => void loadOrders(activeTab),
      Math.max(250, deadlineMs - Date.now() + 250)
    );
    return () => window.clearTimeout(timeout);
  }, [access, activeTab, nextAcceptanceDeadline]);

  useEffect(() => {
    if (!alarmEnabled || pendingCount <= 0) {
      if (alarmRef.current) clearInterval(alarmRef.current);
      alarmRef.current = null;
      return;
    }

    if (alarmRef.current) return;

    async function playAlarmOnce() {
      try {
        const audio = new Audio(CUSTOM_ALARM_SRC);
        audio.volume = 0.85;
        await audio.play();
        return;
      } catch {
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
      }
    }

    playAlarmOnce();
    alarmRef.current = setInterval(playAlarmOnce, 4500);

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

  async function loadOrders(view: 'ACTIVE' | 'PENDING' | 'HISTORY' = activeTab, forceSet = true): Promise<KitchenOrder[]> {
    try {
      setError('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const endpoint = isGuestShop ? '/api/guest-shop/fulfillment-orders' : '/api/guest-shop/kitchen-orders';
      const res = await fetch(`${endpoint}?status=${encodeURIComponent(view)}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to load orders');
      const nextOrders = Array.isArray(json.orders) ? json.orders : [];
      if (forceSet) {
        setOrders(nextOrders);
        setLastUpdatedAt(new Date());
      }
      return nextOrders;
    } catch (err: any) {
      setError(err?.message || `Failed to load ${isGuestShop ? 'Guest Shop' : 'F&B'} orders`);
      return [];
    }
  }

  async function updateOrder(order: KitchenOrder, action: string, readyMinutes?: number) {
    try {
      setBusyId(`${order.id}:${action}:${readyMinutes || ''}`);
      setError('');
      setMessage('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const res = await fetch(isGuestShop ? '/api/guest-shop/fulfillment-orders' : '/api/guest-shop/kitchen-orders', {
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
      setMessage(
        action === 'REJECT'
          ? 'Order rejected. Marked for refund follow-up.'
          : action === 'REPRINT'
            ? 'Order queued for reprint.'
            : action === 'DELIVERED'
              ? 'Order marked as delivered.'
              : action === 'REOPEN'
                ? 'Order reopened.'
                : 'Order updated.'
      );

      if (activeTab === 'PENDING' && ['ACCEPT', 'REJECT', 'DELIVERED'].includes(action)) {
        const pendingAfterAction = await loadOrders('PENDING', true);
        if (!pendingAfterAction.length) {
          setActiveTab('ACTIVE');
          await loadOrders('ACTIVE', true);
        }
      } else {
        await loadOrders(activeTab, true);
      }
    } catch (err: any) {
      if (String(err?.message || '').includes('already updated')) await loadOrders(activeTab, true);
      setError(err?.message || 'Failed to update order');
    } finally {
      setBusyId('');
    }
  }

  async function deleteHistoryOrder(order: KitchenOrder) {
    const confirmed = window.confirm(`Delete ${isGuestShop ? 'Guest Shop' : 'F&B'} history order for Room ${order.room_number || '-'}?`);
    if (!confirmed) return;

    try {
      setBusyId(`${order.id}:DELETE`);
      setError('');
      setMessage('');
      const token = await getToken();
      if (!token) throw new Error('Please log in again');

      const endpoint = isGuestShop ? '/api/guest-shop/fulfillment-orders' : '/api/guest-shop/kitchen-orders';
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(order.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to delete order');
      setMessage('History order deleted.');
      await loadOrders(activeTab, true);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete order');
    } finally {
      setBusyId('');
    }
  }

  if (loading) {
    return <main style={styles.page}><div style={styles.centerCard}>Loading {isGuestShop ? 'Guest Shop' : 'F&B'} Orders...</div></main>;
  }

  if (!access) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <h1>Access denied</h1>
          <p>You do not have access to {isGuestShop ? 'Guest Shop' : 'F&B'} Orders.</p>
          <Link href="/dashboard" style={styles.darkButton}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>{isGuestShop ? 'Guest Services Workspace' : 'Kitchen Workspace'}</div>
          <h1 style={styles.title}>{isGuestShop ? 'Guest Shop Orders' : 'F&B Orders'}</h1>
          <p style={styles.subtitle}>{isGuestShop ? 'Live paid orders from acknowledgment through room delivery.' : 'Paid F&B orders requiring kitchen acceptance and delivery updates.'}</p>
        </div>
        <div style={styles.heroActions}>
          <button type="button" onClick={() => setAlarmEnabled((value) => !value)} style={alarmEnabled ? styles.alarmOnButton : styles.lightButton}>
            {alarmEnabled ? 'Alarm On' : 'Alarm Off'}
          </button>
          <button type="button" onClick={() => loadOrders()} style={styles.lightButton}>Refresh</button>
          <Link href="/dashboard" style={styles.lightButton}>Dashboard</Link>
        </div>
      </section>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {message ? <div style={styles.successBox}>{message}</div> : null}

      {promptOrder ? (
        <section style={styles.acceptancePrompt}>
          <div style={styles.promptPulse}>New</div>
          <div style={styles.promptMain}>
            <div style={styles.eyebrow}>{isGuestShop ? 'New Paid Guest Shop Order' : 'Pending Kitchen Acceptance'}</div>
            <h2 style={styles.promptTitle}>Room {promptOrder.room_number || '-'} - {promptOrder.guest_name || 'Guest'}</h2>
            <p style={styles.promptItems}>{itemSummary(promptOrder.items_json)}</p>
            <div style={styles.promptMeta}>
              <span>{money(promptOrder.total_myr)}</span>
              <span>{formatTime(promptOrder.paid_at)}</span>
              <span>{promptOrder.payment_reference || '-'}</span>
            </div>
          </div>
          <div style={styles.promptActions}>
            {isGuestShop ? (
              <>
                <button type="button" disabled={!!busyId} onClick={() => updateOrder(promptOrder, 'ACCEPT')} style={styles.primaryButton}>Acknowledge &amp; Prepare</button>
                <button type="button" disabled={!!busyId} onClick={() => updateOrder(promptOrder, 'DELIVERED')} style={styles.deliveredButton}>Mark Delivered</button>
              </>
            ) : [15, 30, 45].map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={!!busyId}
                onClick={() => updateOrder(promptOrder, 'ACCEPT', minutes)}
                style={styles.primaryButton}
              >
                Accept {minutes}m
              </button>
            ))}
            {!isGuestShop ? <button type="button" disabled={!!busyId} onClick={() => updateOrder(promptOrder, 'REJECT')} style={styles.dangerButton}>Reject</button> : null}
          </div>
        </section>
      ) : null}

      <section style={styles.statsGrid}>
        <div style={styles.statCard}><span>{isGuestShop ? 'New Orders' : 'Pending Acceptance'}</span><strong>{pendingCount}</strong><small style={styles.statSubtext}>{isGuestShop ? 'Needs acknowledgment' : 'Needs kitchen decision'}</small></div>
        <div style={styles.statCard}><span>In Progress</span><strong>{orders.filter((order) => ['ACCEPTED', 'IN_PROGRESS'].includes(order.kitchen_status)).length}</strong><small style={styles.statSubtext}>Preparing now</small></div>
        <div style={styles.statCard}><span>{isGuestShop ? 'Visible Orders' : 'Refund Follow-up'}</span><strong>{isGuestShop ? orders.length : orders.filter((order) => order.refund_required).length}</strong><small style={styles.statSubtext}>{isGuestShop ? 'In selected view' : 'Rejected or timed out'}</small></div>
      </section>

      <section style={styles.toolRow}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search room, guest, item or payment reference"
          aria-label="Search orders"
          style={styles.searchInput}
        />
        <span style={styles.updatedText}>{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}` : 'Connecting...'}</span>
      </section>

      <nav style={styles.tabs}>
        {(['ACTIVE', 'PENDING', 'HISTORY'] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} style={activeTab === tab ? styles.activeTab : styles.tabButton}>
            {tab === 'ACTIVE' ? 'Active' : tab === 'PENDING' ? 'Pending' : 'History'}
          </button>
        ))}
      </nav>

      <section style={styles.orderList}>
        {filteredOrders.length ? filteredOrders.map((order) => {
          const acceptRemaining = secondsLeft(order.kitchen_accept_deadline_at);
          const readyRemaining = secondsLeft(readyDeadline(order));
          const deadlineLabel = isGuestShop ? 'Order Received' : order.kitchen_status === 'PENDING_ACCEPTANCE' ? 'Accept By' : 'Ready In';
          const deadlineValue =
            isGuestShop
              ? formatTime(order.paid_at)
              : order.kitchen_status === 'PENDING_ACCEPTANCE'
              ? countdownText(acceptRemaining)
              : ['ACCEPTED', 'IN_PROGRESS'].includes(order.kitchen_status)
                ? readyDeadline(order)
                  ? countdownText(readyRemaining)
                  : `${order.kitchen_ready_minutes || '-'}m`
                : '-';
          const lines = itemLines(order.items_json);
          const isHistory = ['DELIVERED', 'REJECTED', 'AUTO_REJECTED'].includes(order.kitchen_status);
          return (
            <article key={order.id} style={styles.orderCard}>
              <div style={styles.cardHead}>
                <div style={styles.orderIdentity}>
                  <div style={styles.eyebrow}>Room {order.room_number || '-'}</div>
                  <h2 style={styles.cardTitle}>{order.guest_name || 'Guest'}</h2>
                  <span style={styles.orderRef}>Payment {order.payment_reference || '-'}</span>
                </div>
                <span style={styles.statusBadge}>{statusLabel(order.kitchen_status)}</span>
              </div>

              <div style={styles.detailGrid}>
                <div style={styles.detailTile}><span>Total</span><strong>{money(order.total_myr)}</strong></div>
                <div style={styles.detailTile}><span>Paid</span><strong>{formatTime(order.paid_at)}</strong></div>
                <div style={styles.detailTile}><span>{deadlineLabel}</span><strong>{deadlineValue}</strong></div>
                <div style={styles.detailTile}><span>Print</span><strong>{statusLabel(order.print_status || 'NOT_QUEUED')}</strong></div>
              </div>

              <div style={styles.itemsPanel}>
                {lines.length ? lines.map((line) => (
                  <div key={line.id} style={styles.itemLine}>
                    <strong>{line.qty}x {line.name}</strong>
                    {line.options ? <span style={styles.itemOptions}>{line.options}</span> : null}
                    {line.note ? <em style={styles.itemNote}>{line.note}</em> : null}
                  </div>
                )) : <div style={styles.itemLine}><strong>No items</strong></div>}
              </div>

              {order.refund_required ? (
                <div style={styles.refundBox}>
                  Refund follow-up required: {order.refund_reason || 'Kitchen rejected or timed out after payment.'}
                </div>
              ) : null}

              <div style={styles.actions}>
                {order.kitchen_status === 'PENDING_ACCEPTANCE' ? (
                  <>
                    {isGuestShop ? (
                      <>
                        <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'ACCEPT')} style={styles.primaryButton}>Acknowledge &amp; Prepare</button>
                        <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'DELIVERED')} style={styles.deliveredButton}>Mark Delivered</button>
                      </>
                    ) : [15, 30, 45].map((minutes) => (
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
                    {!isGuestShop ? <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'REJECT')} style={styles.dangerButton}>Reject</button> : null}
                  </>
                ) : null}

                {['ACCEPTED', 'IN_PROGRESS'].includes(order.kitchen_status) ? (
                  <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'DELIVERED')} style={styles.deliveredButton}>
                    Delivered
                  </button>
                ) : null}
                {!isGuestShop ? <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'REPRINT')} style={styles.secondaryButton}>
                  Reprint Order
                </button> : null}
                {isGuestShop && isHistory && canDeleteHistory ? <button type="button" disabled={!!busyId} onClick={() => updateOrder(order, 'REOPEN')} style={styles.secondaryButton}>Reopen</button> : null}
                {isHistory && canDeleteHistory ? (
                  <button type="button" disabled={!!busyId} onClick={() => deleteHistoryOrder(order)} style={styles.deleteButton}>
                    Delete History
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div style={styles.emptyState}>{search ? 'No orders match your search.' : `No ${isGuestShop ? 'Guest Shop' : 'F&B'} orders in this view.`}</div>
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
    gap: 14,
    padding: 'clamp(16px, 2.5vw, 22px)',
    borderRadius: 24,
    background: 'linear-gradient(135deg, #ffffff 0%, #f7fbff 54%, #edf6ff 100%)',
    border: '1px solid #d6e2f1',
    boxShadow: '0 22px 60px rgba(15,23,42,0.08)',
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
  heroActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: 6,
    borderRadius: 18,
    background: '#eef6ff',
    border: '1px solid #d8e7f7',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
  },
  lightButton: {
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
    fontWeight: 900,
    textDecoration: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 22px rgba(15,23,42,0.05)',
  },
  alarmOnButton: {
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid #bbf7d0',
    background: 'linear-gradient(135deg, #dcfce7, #f0fdf4)',
    color: '#047857',
    fontWeight: 900,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 22px rgba(4,120,87,0.08)',
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
  toolRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: 10,
    borderRadius: 16,
    background: '#fff',
    border: '1px solid #d6e2f1',
    flexWrap: 'wrap',
  },
  searchInput: {
    flex: '1 1 280px',
    minWidth: 0,
    minHeight: 44,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid #c8d7e8',
    fontSize: 16,
    fontWeight: 700,
    background: '#f8fbff',
  },
  updatedText: { color: '#64748b', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' },
  acceptancePrompt: {
    position: 'sticky',
    top: 12,
    zIndex: 20,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    padding: 18,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #fff7ed 0%, #ffffff 56%, #eff6ff 100%)',
    border: '1px solid #fdba74',
    boxShadow: '0 24px 70px rgba(234,88,12,0.16)',
  },
  promptPulse: {
    width: 54,
    height: 54,
    borderRadius: 18,
    display: 'grid',
    placeItems: 'center',
    background: '#fed7aa',
    color: '#9a3412',
    fontSize: 12,
    fontWeight: 1000,
    textTransform: 'uppercase',
  },
  promptMain: { minWidth: 240, flex: '1 1 340px' },
  promptTitle: {
    margin: '4px 0',
    fontSize: 'clamp(22px, 3vw, 34px)',
    letterSpacing: 0,
  },
  promptItems: {
    margin: '8px 0',
    color: '#334155',
    fontWeight: 900,
    lineHeight: 1.45,
  },
  promptMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 900,
  },
  promptActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flex: '1 1 320px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  statCard: {
    padding: 18,
    borderRadius: 18,
    background: 'linear-gradient(135deg, #ffffff, #f8fbff)',
    border: '1px solid #d6e2f1',
    boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
  },
  statSubtext: {
    display: 'block',
    marginTop: 6,
    color: '#64748b',
    fontSize: 12,
    fontWeight: 900,
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
    padding: 'clamp(14px, 2.2vw, 18px)',
    borderRadius: 22,
    background: 'linear-gradient(135deg, #ffffff, #fbfdff)',
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
  orderIdentity: {
    display: 'grid',
    gap: 3,
  },
  cardTitle: { margin: '4px 0', fontSize: 26 },
  orderRef: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 900,
    wordBreak: 'break-word',
  },
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
  detailTile: {
    display: 'grid',
    gap: 5,
    padding: 12,
    borderRadius: 16,
    background: '#f8fbff',
    border: '1px solid #e2eaf4',
  },
  itemsPanel: {
    display: 'grid',
    gap: 8,
    margin: '12px 0',
    padding: 12,
    borderRadius: 18,
    background: '#f8fbff',
    border: '1px solid #e2eaf4',
  },
  itemLine: {
    display: 'grid',
    gap: 3,
    padding: '10px 12px',
    borderRadius: 14,
    background: '#fff',
    border: '1px solid #edf2f7',
    color: '#0f172a',
    lineHeight: 1.35,
  },
  itemOptions: {
    color: '#475569',
    fontSize: 13,
    fontWeight: 800,
  },
  itemNote: {
    color: '#b45309',
    fontSize: 13,
    fontStyle: 'normal',
    fontWeight: 900,
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
  deliveredButton: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 13,
    border: 0,
    background: '#15803d',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
  },
  secondaryButton: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 13,
    border: '1px solid #c8d7e8',
    background: '#fff',
    color: '#0f172a',
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
  deleteButton: {
    minHeight: 42,
    padding: '0 14px',
    borderRadius: 13,
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#dc2626',
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
