import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { broadcastFnbOrderChange } from '../../../../lib/fnbOrderBroadcastServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canAccessGuestShopOrders(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return (
    role === 'SUPERUSER' ||
    user?.can_access_guest_shop_orders === true ||
    email === 'fenny@hotelhallmark.com'
  );
}

function orderSelect() {
  return `
    id, room_number, guest_name, guest_email, status, order_type,
    payment_reference, total_myr, items_json, paid_at, fulfilled_at,
    created_at, updated_at, kitchen_status, kitchen_requested_at,
    kitchen_accepted_at, kitchen_delivered_at, kitchen_decision_by,
    kitchen_decision_note, fo_print_status, fo_print_requested_at,
    fo_printed_at, fo_print_error
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
    fulfilled_at: row?.fulfilled_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
    kitchen_status: String(row?.kitchen_status || 'NOT_REQUIRED'),
    kitchen_requested_at: row?.kitchen_requested_at || null,
    kitchen_accepted_at: row?.kitchen_accepted_at || null,
    kitchen_delivered_at: row?.kitchen_delivered_at || null,
    kitchen_decision_by: String(row?.kitchen_decision_by || ''),
    kitchen_decision_note: String(row?.kitchen_decision_note || ''),
    print_status: String(row?.fo_print_status || 'NOT_QUEUED'),
    print_requested_at: row?.fo_print_requested_at || null,
    printed_at: row?.fo_printed_at || null,
    print_error: String(row?.fo_print_error || ''),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canAccessGuestShopOrders(user)) return jsonNoCache({ ok: false, error: 'Guest Shop Orders access denied' }, 403);

    const view = String(req.nextUrl.searchParams.get('status') || 'ACTIVE').trim().toUpperCase();
    let query = supabaseAdmin
      .from('guest_shop_orders')
      .select(orderSelect())
      .eq('order_type', 'GUEST_SHOP')
      .in('status', ['PAID', 'FULFILLED'])
      .order('paid_at', { ascending: false, nullsFirst: false });

    if (view === 'PENDING') query = query.eq('kitchen_status', 'PENDING_ACCEPTANCE');
    else if (view === 'HISTORY') query = query.eq('kitchen_status', 'DELIVERED');
    else query = query.in('kitchen_status', ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS']);

    const { data, error } = await query.limit(view === 'HISTORY' ? 150 : 100);
    if (error) throw error;
    return jsonNoCache({ ok: true, orders: (data || []).map(normalizeOrder) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load Guest Shop orders', orders: [] }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canAccessGuestShopOrders(user)) return jsonNoCache({ ok: false, error: 'Guest Shop Orders access denied' }, 403);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const action = String(body?.action || '').trim().toUpperCase();
    const note = String(body?.note || '').trim().slice(0, 240);
    if (!id) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const actor = String(user?.name || user?.email || 'Guest Shop').trim();
    const nowIso = new Date().toISOString();
    let update: Record<string, any>;
    let allowedCurrentStatuses: string[];

    if (action === 'ACCEPT' || action === 'IN_PROGRESS') {
      update = {
        kitchen_status: 'IN_PROGRESS',
        kitchen_accepted_at: nowIso,
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
      };
      allowedCurrentStatuses = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS'];
    } else if (action === 'DELIVERED') {
      update = {
        kitchen_status: 'DELIVERED',
        kitchen_delivered_at: nowIso,
        kitchen_decision_by: actor,
        kitchen_decision_note: note,
        status: 'FULFILLED',
        fulfilled_at: nowIso,
      };
      allowedCurrentStatuses = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'IN_PROGRESS'];
    } else if (action === 'REOPEN') {
      if (String(user?.role || '').trim().toUpperCase() !== 'SUPERUSER') {
        return jsonNoCache({ ok: false, error: 'Only Superuser can reopen a delivered order' }, 403);
      }
      update = {
        kitchen_status: 'IN_PROGRESS',
        kitchen_delivered_at: null,
        kitchen_decision_by: actor,
        kitchen_decision_note: note || 'Reopened by Superuser',
        status: 'PAID',
        fulfilled_at: null,
      };
      allowedCurrentStatuses = ['DELIVERED'];
    } else {
      return jsonNoCache({ ok: false, error: 'Invalid Guest Shop action' }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .update(update)
      .eq('id', id)
      .eq('order_type', 'GUEST_SHOP')
      .in('kitchen_status', allowedCurrentStatuses)
      .select(orderSelect())
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonNoCache({ ok: false, error: 'Order was already updated. Refreshing the list.' }, 409);
    await broadcastFnbOrderChange('UPDATE');
    return jsonNoCache({ ok: true, order: normalizeOrder(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update Guest Shop order' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (String(user.role || '').trim().toUpperCase() !== 'SUPERUSER') {
      return jsonNoCache({ ok: false, error: 'Only Superuser can delete Guest Shop order history' }, 403);
    }
    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .delete()
      .eq('id', id)
      .eq('order_type', 'GUEST_SHOP')
      .eq('kitchen_status', 'DELIVERED')
      .select('id');
    if (error) throw error;
    if (data?.length) await broadcastFnbOrderChange('DELETE');
    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to delete Guest Shop order history' }, 500);
  }
}
