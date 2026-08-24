import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TERMINAL_STATUSES = ['COMPLETE_CLAIMED', 'REFUND_COMPLETED', 'CANCELLED'];

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function requireUser(req: NextRequest) {
  const result = await getDashboardUserFromRequest(req);
  if (!result.user) return { user: null, response: jsonError(result.error || 'Unauthorized', 401) };
  if (result.user.role !== 'SUPERUSER' && !result.user.can_access_online_purchasing) {
    return { user: null, response: jsonError('Online Purchasing access denied', 403) };
  }
  return { user: result.user, response: null };
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.response!;
  const user = auth.user;
  const isSuperuser = user.role === 'SUPERUSER';

  const [hotelsResult, accessResult, ordersResult, ledgerResult] = await Promise.all([
    supabaseAdmin.from('online_purchasing_hotels').select('*').eq('active', true).order('sort_order'),
    supabaseAdmin.from('online_purchasing_user_access').select('*').order('created_at'),
    supabaseAdmin
      .from('online_purchase_orders')
      .select('*, online_purchase_documents(*)')
      .order('created_at', { ascending: false })
      .limit(750),
    supabaseAdmin.from('online_purchase_ledger_entries').select('hotel_code, amount_delta'),
  ]);

  const firstError = hotelsResult.error || accessResult.error || ordersResult.error || ledgerResult.error;
  if (firstError) return jsonError(firstError.message, 500);

  const allAccess = accessResult.data || [];
  const ownAccess = allAccess.filter((row: any) => row.user_id === user.user_id);
  const visibleHotelCodes = new Set(
    isSuperuser ? (hotelsResult.data || []).map((hotel: any) => hotel.code) : ownAccess.map((row: any) => row.hotel_code)
  );

  const orders = (ordersResult.data || []).filter((order: any) => visibleHotelCodes.has(order.hotel_code));
  const profileIds = new Set<string>();
  for (const row of allAccess) profileIds.add(String(row.user_id));
  for (const order of orders as any[]) {
    ['created_by','purchased_by','arrived_by','invoice_submitted_by','reimbursed_by','refund_requested_by','refund_completed_by','cancelled_by']
      .forEach((key) => { if (order[key]) profileIds.add(String(order[key])); });
  }

  let profiles: any[] = [];
  if (profileIds.size > 0 || isSuperuser) {
    let profileQuery = supabaseAdmin.from('user_profiles').select('user_id,email,name,role').order('name');
    if (!isSuperuser) profileQuery = profileQuery.in('user_id', Array.from(profileIds));
    const profileResult = await profileQuery;
    if (profileResult.error) return jsonError(profileResult.error.message, 500);
    profiles = profileResult.data || [];
  }

  const ledgerTotals = new Map<string, number>();
  for (const entry of ledgerResult.data || []) {
    ledgerTotals.set(entry.hotel_code, (ledgerTotals.get(entry.hotel_code) || 0) + Number(entry.amount_delta || 0));
  }

  const hotels = (hotelsResult.data || [])
    .filter((hotel: any) => visibleHotelCodes.has(hotel.code))
    .map((hotel: any) => ({
      ...hotel,
      available_balance: Number(hotel.opening_float || 0) + (ledgerTotals.get(hotel.code) || 0),
    }));

  const signedOrders = await Promise.all(orders.map(async (order: any) => {
    const documents = await Promise.all((order.online_purchase_documents || []).map(async (document: any) => {
      const signed = await supabaseAdmin.storage
        .from('online-purchasing-documents')
        .createSignedUrl(document.storage_path, 60 * 15);
      return { ...document, url: signed.data?.signedUrl || null };
    }));
    return { ...order, online_purchase_documents: documents };
  }));

  return NextResponse.json({
    user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role },
    hotels,
    orders: signedOrders,
    access: isSuperuser ? allAccess : ownAccess,
    profiles,
    terminalStatuses: TERMINAL_STATUSES,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.user) return auth.response!;
  const user = auth.user;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid request');
  }

  const action = String(body?.action || '').trim().toUpperCase();
  if (action === 'SET_ACCESS') {
    if (user.role !== 'SUPERUSER') return jsonError('Only Superuser can manage team access', 403);
    const targetUserId = String(body.user_id || '').trim();
    const hotelCode = String(body.hotel_code || '').trim().toUpperCase();
    const accessRole = String(body.access_role || '').trim().toUpperCase();
    const enabled = body.enabled === true;
    if (!targetUserId || !hotelCode || !['PURCHASER', 'HOD'].includes(accessRole)) {
      return jsonError('Select a user, hotel, and access role');
    }

    if (enabled) {
      const { error } = await supabaseAdmin.from('online_purchasing_user_access').upsert({
        user_id: targetUserId,
        hotel_code: hotelCode,
        access_role: accessRole,
        created_by: user.user_id,
      }, { onConflict: 'user_id,hotel_code,access_role' });
      if (error) return jsonError(error.message, 500);
    } else {
      const { error } = await supabaseAdmin
        .from('online_purchasing_user_access')
        .delete()
        .eq('user_id', targetUserId)
        .eq('hotel_code', hotelCode)
        .eq('access_role', accessRole);
      if (error) return jsonError(error.message, 500);
    }
    return NextResponse.json({ ok: true });
  }

  const allowedActions = new Set([
    'CREATE_ORDER', 'SAVE_PURCHASE', 'MARK_ARRIVED', 'SUBMIT_DOCUMENTS',
    'COMPLETE_CLAIM', 'START_REFUND', 'COMPLETE_REFUND', 'CANCEL_ORDER',
  ]);
  if (!allowedActions.has(action)) return jsonError('Unsupported action');

  const orderId = body.order_id ? String(body.order_id) : null;
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const { data, error } = await supabaseAdmin.rpc('online_purchasing_apply_action', {
    p_actor_user_id: user.user_id,
    p_action: action,
    p_order_id: orderId,
    p_payload: payload,
  });
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ ok: true, result: data });
}
