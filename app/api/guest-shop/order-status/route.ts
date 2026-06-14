import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { createFoTaskForPaidGuestShopOrder } from '../../../../lib/guestShopTask';

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

function billplzBaseUrl() {
  return String(process.env.BILLPLZ_MODE || '').trim().toLowerCase() === 'production'
    ? 'https://www.billplz.com/api/v3'
    : 'https://www.billplz-sandbox.com/api/v3';
}

function basicAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function billPaid(value: any) {
  const state = String(value?.state || '').trim().toLowerCase();
  return value?.paid === true || state === 'paid';
}

function billFailed(value: any) {
  const state = String(value?.state || '').trim().toLowerCase();
  return (
    value?.paid === false &&
    ['due', 'failed', 'cancelled', 'canceled', 'expired'].includes(state)
  );
}

async function decrementPaidStock(items: any[]) {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    const id = String(item?.id || '');
    const quantity = Math.max(0, Math.floor(Number(item?.quantity || 0)));
    if (!id || quantity <= 0) continue;

    const { data } = await supabaseAdmin
      .from('guest_shop_items')
      .select('stock')
      .eq('id', id)
      .maybeSingle();

    if (!data) continue;

    await supabaseAdmin
      .from('guest_shop_items')
      .update({ stock: Math.max(0, Number(data.stock || 0) - quantity) })
      .eq('id', id);
  }
}

function paidOrderUpdatePayload(order: any, paidAt: string) {
  const isFnb = String(order?.order_type || '').trim().toUpperCase() === 'FNB';
  return {
    status: 'PAID',
    paid_at: paidAt,
    ...(isFnb
      ? {
          print_status: 'QUEUED',
          print_requested_at: new Date().toISOString(),
          print_error: null,
        }
      : {}),
  };
}

function isBreakfastOrder(order: any) {
  return String(order?.order_type || '').trim().toUpperCase() === 'BREAKFAST';
}

function breakfastVoucherQuantity(order: any) {
  const items = Array.isArray(order?.items_json) ? order.items_json : [];
  const count = items.reduce((total, item) => total + Math.max(0, Math.floor(Number(item?.quantity || 0))), 0);
  return Math.max(1, count || Math.max(1, Math.floor(Number(order?.voucher_quantity || 1))));
}

function breakfastVoucherCode() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `BF-${day}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function ensureBreakfastVoucher(order: any) {
  if (!isBreakfastOrder(order) || !order?.id || order?.voucher_code) return order;

  const quantity = breakfastVoucherQuantity(order);
  const { data } = await supabaseAdmin
    .from('guest_shop_orders')
    .update({
      voucher_code: breakfastVoucherCode(),
      voucher_quantity: quantity,
      voucher_redeemed_quantity: 0,
      voucher_status: 'ACTIVE',
    })
    .eq('id', order.id)
    .is('voucher_code', null)
    .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, paid_at, created_at, order_type, print_status, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status, voucher_redeemed_at, voucher_redeemed_by')
    .maybeSingle();

  return data || order;
}

async function markKitchenPendingIfNeeded(order: any) {
  const isFnb = String(order?.order_type || '').trim().toUpperCase() === 'FNB';
  if (!isFnb || !order?.id) return;

  const requestedAt = new Date();
  const deadlineAt = new Date(requestedAt.getTime() + 10 * 60 * 1000);

  const { error } = await supabaseAdmin
    .from('guest_shop_orders')
    .update({
      kitchen_status: 'PENDING_ACCEPTANCE',
      kitchen_requested_at: requestedAt.toISOString(),
      kitchen_accept_deadline_at: deadlineAt.toISOString(),
      kitchen_accepted_at: null,
      kitchen_rejected_at: null,
      kitchen_delivered_at: null,
      kitchen_ready_minutes: null,
      kitchen_decision_by: null,
      kitchen_decision_note: null,
      refund_required: false,
      refund_reason: null,
    })
    .eq('id', order.id)
    .eq('order_type', 'FNB')
    .in('kitchen_status', ['NOT_REQUIRED', 'REJECTED', 'AUTO_REJECTED']);

  // Do not block payment confirmation if the kitchen migration has not been run yet.
  if (error) return;
}

async function refreshFromBillplz(order: any) {
  const apiKey = String(process.env.BILLPLZ_API_KEY || '').trim();
  const billId = String(order?.payment_reference || '').trim();

  if (!apiKey || !billId || order?.status === 'PAID' || order?.status === 'FULFILLED') {
    return order;
  }

  const res = await fetch(`${billplzBaseUrl()}/bills/${encodeURIComponent(billId)}`, {
    headers: {
      Authorization: basicAuthHeader(apiKey),
    },
    cache: 'no-store',
  });

  const bill = await res.json().catch(() => ({}));
  if (!res.ok) return order;

  if (billFailed(bill)) {
    const { data: updated, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .update({ status: 'FAILED' })
      .eq('id', order.id)
      .eq('status', 'PENDING_PAYMENT')
      .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, paid_at, created_at, order_type, print_status, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status, voucher_redeemed_at, voucher_redeemed_by')
      .maybeSingle();

    if (error) throw error;
    return updated || order;
  }

  if (!billPaid(bill)) return order;

  await decrementPaidStock(order.items_json);

  const paidAt = bill?.paid_at || new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('guest_shop_orders')
    .update(paidOrderUpdatePayload(order, paidAt))
    .eq('id', order.id)
    .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, paid_at, created_at, order_type, print_status, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status, voucher_redeemed_at, voucher_redeemed_by')
    .single();

  if (error) throw error;
  const settledOrder = await ensureBreakfastVoucher(updated || order);
  await markKitchenPendingIfNeeded(settledOrder);
  if (!isBreakfastOrder(settledOrder)) {
    await createFoTaskForPaidGuestShopOrder(settledOrder);
  }
  return settledOrder || order;
}

export async function GET(req: NextRequest) {
  try {
    const orderId = String(req.nextUrl.searchParams.get('order_id') || '').trim();
    if (!orderId) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, paid_at, created_at, order_type, print_status, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status, voucher_redeemed_at, voucher_redeemed_by')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonNoCache({ ok: false, error: 'Order not found' }, 404);

    let refreshed = data;
    let paymentCheckError = '';

    try {
      refreshed = await refreshFromBillplz(data);
    } catch (billplzError: any) {
      paymentCheckError = billplzError?.message || 'Billplz status check failed';
    }

    return jsonNoCache({
      ok: true,
      payment_check_error: paymentCheckError,
      order: {
        id: String(refreshed.id || ''),
        room_number: String(refreshed.room_number || ''),
        guest_name: String(refreshed.guest_name || ''),
        status: String(refreshed.status || 'PENDING_PAYMENT'),
        payment_reference: String(refreshed.payment_reference || ''),
        total_myr: Number(refreshed.total_myr || 0),
        items_json: Array.isArray(refreshed.items_json) ? refreshed.items_json : [],
        paid_at: refreshed.paid_at || null,
        created_at: refreshed.created_at || null,
        order_type: String(refreshed.order_type || 'GUEST_SHOP'),
        print_status: String(refreshed.print_status || 'NOT_QUEUED'),
        voucher_code: String(refreshed.voucher_code || ''),
        voucher_quantity: Number(refreshed.voucher_quantity || 0),
        voucher_redeemed_quantity: Number(refreshed.voucher_redeemed_quantity || 0),
        voucher_status: String(refreshed.voucher_status || 'NOT_REQUIRED'),
        voucher_redeemed_at: refreshed.voucher_redeemed_at || null,
        voucher_redeemed_by: String(refreshed.voucher_redeemed_by || ''),
      },
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load order status' }, 500);
  }
}
