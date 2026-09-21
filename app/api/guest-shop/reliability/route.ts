import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { expireUnacceptedFnbOrders, processGuestShopOutbox } from '../../../../lib/guestShopReliability';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function requireManagement(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { user: null, error: error || 'Unauthorized', status: 401 };
  const role = String(user.role || '').toUpperCase();
  if (!['SUPERUSER', 'MANAGER'].includes(role)) return { user: null, error: 'Management access required', status: 403 };
  return { user, error: '', status: 200 };
}

async function snapshot() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [heartbeatResult, orderResult, outboxResult] = await Promise.all([
    supabaseAdmin.from('guest_shop_printer_heartbeats').select('*').order('printer_role'),
    supabaseAdmin
      .from('guest_shop_orders')
      .select('id, order_type, status, payment_provider, payment_reference, total_myr, paid_at, created_at, kitchen_status, refund_required, refund_status, refund_reason, refund_reference, breakfast_print_status, breakfast_print_requested_at, breakfast_print_error, fnb_print_status, fnb_print_requested_at, fnb_print_error, fo_print_status, fo_print_requested_at, fo_print_error')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('guest_shop_order_outbox')
      .select('id, order_id, status, attempts, next_attempt_at, last_error, created_at')
      .neq('status', 'DONE')
      .order('created_at')
      .limit(100),
  ]);
  if (heartbeatResult.error) throw heartbeatResult.error;
  if (orderResult.error) throw orderResult.error;
  if (outboxResult.error) throw outboxResult.error;

  const orders = orderResult.data || [];
  const now = Date.now();
  const printers = ['BREAKFAST', 'FNB', 'FO'].map((role) => {
    const heartbeat = (heartbeatResult.data || []).find((row: any) => row.printer_role === role) || null;
    const statusKey = `${role.toLowerCase()}_print_status`;
    const requestedKey = `${role.toLowerCase()}_print_requested_at`;
    const errorKey = `${role.toLowerCase()}_print_error`;
    const queued = orders.filter((row: any) => row[statusKey] === 'QUEUED');
    const failed = orders.filter((row: any) => row[statusKey] === 'FAILED');
    const stalled = queued.filter((row: any) => {
      const requested = Date.parse(row[requestedKey] || '');
      return Number.isFinite(requested) && now - requested > 2 * 60 * 1000;
    });
    const lastSeen = Date.parse(heartbeat?.last_seen_at || '');
    return {
      role,
      online: Number.isFinite(lastSeen) && now - lastSeen < 2 * 60 * 1000,
      last_seen_at: heartbeat?.last_seen_at || null,
      device_name: heartbeat?.device_name || '',
      bridge_version: heartbeat?.bridge_version || '',
      queued: queued.length,
      stalled: stalled.length,
      failed: failed.length,
      latest_error: failed[0]?.[errorKey] || heartbeat?.last_error || '',
    };
  });

  const paidOrders = orders.filter((row: any) => ['PAID', 'FULFILLED'].includes(row.status));
  return {
    printers,
    summary: {
      orders_30_days: orders.length,
      paid_30_days: paidOrders.length,
      revenue_30_days: paidOrders.reduce((sum: number, row: any) => sum + Number(row.total_myr || 0), 0),
      stale_pending: orders.filter((row: any) => row.status === 'PENDING_PAYMENT' && now - Date.parse(row.created_at) > 30 * 60 * 1000).length,
      unacknowledged: paidOrders.filter((row: any) => row.kitchen_status === 'PENDING_ACCEPTANCE').length,
      refunds_outstanding: orders.filter((row: any) => row.refund_required || ['REQUIRED', 'IN_PROGRESS'].includes(row.refund_status)).length,
      outbox_pending: (outboxResult.data || []).length,
    },
    exceptions: orders.filter((row: any) =>
      row.refund_required ||
      ['REQUIRED', 'IN_PROGRESS'].includes(row.refund_status) ||
      ['FAILED'].includes(row.breakfast_print_status) ||
      ['FAILED'].includes(row.fnb_print_status) ||
      ['FAILED'].includes(row.fo_print_status)
    ).slice(0, 50),
    outbox: outboxResult.data || [],
    checked_at: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireManagement(req);
    if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
    await Promise.allSettled([expireUnacceptedFnbOrders(), processGuestShopOutbox({ limit: 5 })]);
    return json({ ok: true, ...(await snapshot()) });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'Failed to load purchase reliability' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireManagement(req);
    if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').toUpperCase();
    if (action === 'RUN_RECOVERY') {
      const [expired, outbox] = await Promise.all([expireUnacceptedFnbOrders(), processGuestShopOutbox({ limit: 20 })]);
      return json({ ok: true, expired, outbox, ...(await snapshot()) });
    }
    if (action === 'REQUEUE_PRINT') {
      const id = String(body.id || '');
      const role = String(body.role || '').toUpperCase();
      if (!id || !['BREAKFAST', 'FNB', 'FO'].includes(role)) return json({ ok: false, error: 'Invalid print job' }, 400);
      const prefix = role.toLowerCase();
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from('guest_shop_orders').update({
        [`${prefix}_print_status`]: 'QUEUED',
        [`${prefix}_print_requested_at`]: now,
        [`${prefix}_print_error`]: null,
        ...(role === 'BREAKFAST' || role === 'FNB' ? { print_status: 'QUEUED', print_requested_at: now, print_error: null } : {}),
      }).eq('id', id);
      if (error) throw error;
      return json({ ok: true, ...(await snapshot()) });
    }
    return json({ ok: false, error: 'Invalid action' }, 400);
  } catch (error: any) {
    return json({ ok: false, error: error?.message || 'Reliability action failed' }, 500);
  }
}
