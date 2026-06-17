import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { createFoTaskForPaidGuestShopOrder } from '../../../../lib/guestShopTask';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function plainText(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function truthy(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'paid';
}

function failedState(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  return ['due', 'failed', 'cancelled', 'canceled', 'expired'].includes(text);
}

function readParam(params: Record<string, string>, key: string) {
  return params[key] || params[`billplz[${key}]`] || '';
}

async function parsePayload(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';
  const params: Record<string, string> = {};

  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => ({}));
    for (const [key, value] of Object.entries(json || {})) {
      params[key] = String(value ?? '');
    }
    return params;
  }

  const form = await req.formData();
  for (const [key, value] of form.entries()) {
    params[key] = String(value ?? '');
  }
  return params;
}

function buildSignatureSource(params: Record<string, string>) {
  return Object.entries(params)
    .filter(([key]) => key !== 'x_signature' && key !== 'billplz[x_signature]')
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([key, value]) => `${key}${value}`)
    .join('|');
}

function verifySignature(params: Record<string, string>) {
  const signatureKey = String(process.env.BILLPLZ_X_SIGNATURE_KEY || '').trim();
  const received = readParam(params, 'x_signature');
  if (!signatureKey || !received) return false;

  const digest = crypto
    .createHmac('sha256', signatureKey)
    .update(buildSignatureSource(params))
    .digest('hex');

  const expectedBuffer = Buffer.from(digest);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
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

async function paidOrderUpdatePayload(order: any, paidAt: string | null) {
  const orderType = String(order?.order_type || '').trim().toUpperCase();
  const isFnb = orderType === 'FNB';
  const isGuestShop = orderType === 'GUEST_SHOP';
  const now = new Date().toISOString();

  return {
    status: 'PAID',
    paid_at: paidAt || now,
    ...(isFnb
      ? {
          print_status: 'QUEUED',
          print_requested_at: now,
          print_error: null,
          fnb_print_status: 'QUEUED',
          fnb_print_requested_at: now,
          fnb_print_error: null,
          fo_print_status: 'QUEUED',
          fo_print_requested_at: now,
          fo_print_error: null,
        }
      : {}),
    ...(isGuestShop
      ? {
          fo_print_status: 'QUEUED',
          fo_print_requested_at: now,
          fo_print_error: null,
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
    .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status')
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

  // Keep Billplz payment verification safe even if the kitchen SQL has not been installed yet.
  if (error) return;
}

export async function POST(req: NextRequest) {
  try {
    const params = await parsePayload(req);

    if (!verifySignature(params)) {
      return plainText('invalid signature', 401);
    }

    const billId = readParam(params, 'id');
    const paid = truthy(readParam(params, 'paid')) || truthy(readParam(params, 'state'));
    const paidAt = readParam(params, 'paid_at') || null;

    if (!billId) return plainText('missing bill id', 400);

    const { data: order, error: orderError } = await supabaseAdmin
      .from('guest_shop_orders')
      .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status')
      .eq('payment_reference', billId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) return plainText('order not found', 404);

    if (paid) {
      if (order.status !== 'PAID' && order.status !== 'FULFILLED') {
        await decrementPaidStock(order.items_json);
      }

      const { data: updatedOrder, error: updateError } = await supabaseAdmin
        .from('guest_shop_orders')
        .update(await paidOrderUpdatePayload(order, paidAt))
        .eq('id', order.id)
        .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type, voucher_code, voucher_quantity, voucher_redeemed_quantity, voucher_status')
        .single();

      if (updateError) throw updateError;

      const settledOrder = await ensureBreakfastVoucher(updatedOrder || order);
      await markKitchenPendingIfNeeded(settledOrder);
      if (!isBreakfastOrder(settledOrder)) {
        await createFoTaskForPaidGuestShopOrder(settledOrder);
      }
      return plainText('ok');
    }

    if (order.status === 'PENDING_PAYMENT' && failedState(readParam(params, 'state'))) {
      const { error: updateError } = await supabaseAdmin
        .from('guest_shop_orders')
        .update({ status: 'FAILED' })
        .eq('id', order.id);

      if (updateError) throw updateError;
    }

    return plainText('ok');
  } catch (error: any) {
    return plainText(error?.message || 'callback failed', 500);
  }
}
