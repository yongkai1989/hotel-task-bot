import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canAccessKitchen(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return (
    role === 'SUPERUSER' ||
    role === 'FNB' ||
    user?.can_access_fnb_orders === true ||
    email === 'fenny@hotelhallmark.com' ||
    email === 'fnb@hotelhallmark.com'
  );
}

function canDeleteKitchenHistory(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com';
}

function orderSelect() {
  return `
    id,
    room_number,
    guest_name,
    guest_email,
    status,
    order_type,
    payment_reference,
    total_myr,
    items_json,
    paid_at,
    created_at,
    updated_at,
    kitchen_status,
    kitchen_requested_at,
    kitchen_accept_deadline_at,
    kitchen_accepted_at,
    kitchen_rejected_at,
    kitchen_delivered_at,
    kitchen_ready_minutes,
    kitchen_decision_by,
    kitchen_decision_note,
    refund_required,
    refund_reason,
    print_status,
    print_requested_at,
    printed_at,
    print_error
  `;
}

function normalizeOrder(row: any) {
  return {
    id: String(row?.id || ''),
    room_number: String(row?.room_number || ''),
    guest_name: String(row?.guest_name || ''),
    guest_email: String(row?.guest_email || ''),
    status: String(row?.status || 'PENDING_PAYMENT'),
    order_type: String(row?.order_type || 'GUEST_SHOP'),
    payment_reference: String(row?.payment_reference || ''),
    total_myr: Number(row?.total_myr || 0),
    items_json: Array.isArray(row?.items_json) ? row.items_json : [],
    paid_at: row?.paid_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    kitchen_status: String(row?.kitchen_status || 'NOT_REQUIRED'),
    kitchen_requested_at: row?.kitchen_requested_at || null,
    kitchen_accept_deadline_at: row?.kitchen_accept_deadline_at || null,
    kitchen_accepted_at: row?.kitchen_accepted_at || null,
    kitchen_rejected_at: row?.kitchen_rejected_at || null,
    kitchen_delivered_at: row?.kitchen_delivered_at || null,
    kitchen_ready_minutes: row?.kitchen_ready_minutes === null ? null : Number(row?.kitchen_ready_minutes || 0),
    kitchen_decision_by: String(row?.kitchen_decision_by || ''),
    kitchen_decision_note: String(row?.kitchen_decision_note || ''),
    refund_required: row?.refund_required === true,
    refund_reason: String(row?.refund_reason || ''),
    print_status: String(row?.print_status || 'NOT_QUEUED'),
    print_requested_at: row?.print_requested_at || null,
    printed_at: row?.printed_at || null,
    print_error: String(row?.print_error || ''),
  };
}

async function expireOldPendingOrders() {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from('guest_shop_orders')
    .update({
      kitchen_status: 'AUTO_REJECTED',
      kitchen_rejected_at: nowIso,
      kitchen_decision_by: 'Kitchen timeout',
      kitchen_decision_note: 'F&B order was not accepted within 10 minutes.',
      refund_required: true,
      refund_reason: 'Kitchen did not accept this paid F&B order within 10 minutes.',
    })
    .eq('order_type', 'FNB')
    .eq('status', 'PAID')
    .eq('kitchen_status', 'PENDING_ACCEPTANCE')
    .lt('kitchen_accept_deadline_at', nowIso);
}

export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canAccessKitchen(user)) return jsonNoCache({ ok: false, error: 'F&B Kitchen access denied' }, 403);

    await expireOldPendingOrders();

    const status = String(req.nextUrl.searchParams.get('status') || 'ACTIVE').trim().toUpperCase();

    let query = supabaseAdmin
      .from('guest_shop_orders')
      .select(orderSelect())
      .eq('order_type', 'FNB')
      .in('status', ['PAID', 'FULFILLED'])
      .order('created_at', { ascending: false });

    if (status === 'PENDING') query = query.eq('kitchen_status', 'PENDING_ACCEPTANCE');
    else if (status === 'HISTORY') query = query.in('kitchen_status', ['DELIVERED', 'REJECTED', 'AUTO_REJECTED']);
    else query = query.in('kitchen_status', ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS']);

    const { data, error } = await query.limit(100);
    if (error) throw error;

    return jsonNoCache({ ok: true, orders: (data || []).map(normalizeOrder) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load F&B kitchen orders', orders: [] }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canAccessKitchen(user)) return jsonNoCache({ ok: false, error: 'F&B Kitchen access denied' }, 403);

    await expireOldPendingOrders();

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const action = String(body?.action || '').trim().toUpperCase();
    const readyMinutes = Number(body?.ready_minutes || 0);
    const note = String(body?.note || '').trim().slice(0, 240);

    if (!id) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const actor = String(user?.name || user?.email || 'F&B').trim();
    const nowIso = new Date().toISOString();
    let update: Record<string, any> = {};

    if (action === 'ACCEPT') {
      if (![15, 30, 45].includes(readyMinutes)) {
        return jsonNoCache({ ok: false, error: 'Choose estimated ready time: 15, 30, or 45 minutes' }, 400);
      }
      update = {
        kitchen_status: 'IN_PROGRESS',
        kitchen_accepted_at: nowIso,
        kitchen_ready_minutes: readyMinutes,
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
        refund_required: false,
        refund_reason: null,
      };
    } else if (action === 'REJECT') {
      update = {
        kitchen_status: 'REJECTED',
        kitchen_rejected_at: nowIso,
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
        refund_required: true,
        refund_reason: note || 'Kitchen rejected this paid F&B order.',
      };
    } else if (action === 'IN_PROGRESS') {
      update = {
        kitchen_status: 'IN_PROGRESS',
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
      };
    } else if (action === 'DELIVERED') {
      update = {
        kitchen_status: 'DELIVERED',
        kitchen_delivered_at: nowIso,
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
        status: 'FULFILLED',
      };
    } else if (action === 'REPRINT') {
      update = {
        print_status: 'QUEUED',
        print_requested_at: nowIso,
        print_error: null,
      };
    } else {
      return jsonNoCache({ ok: false, error: 'Invalid kitchen action' }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .update(update)
      .eq('id', id)
      .eq('order_type', 'FNB')
      .select(orderSelect())
      .single();

    if (error) throw error;
    return jsonNoCache({ ok: true, order: normalizeOrder(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update F&B order' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canDeleteKitchenHistory(user)) return jsonNoCache({ ok: false, error: 'Only Superuser or Fenny can delete F&B order history' }, 403);

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const { error } = await supabaseAdmin
      .from('guest_shop_orders')
      .delete()
      .eq('id', id)
      .eq('order_type', 'FNB')
      .in('kitchen_status', ['DELIVERED', 'REJECTED', 'AUTO_REJECTED']);

    if (error) throw error;
    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to delete F&B order history' }, 500);
  }
}
