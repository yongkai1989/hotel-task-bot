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
  const isFnb = String(order?.order_type || '').trim().toUpperCase() === 'FNB';
  return {
    status: 'PAID',
    paid_at: paidAt || new Date().toISOString(),
    ...(isFnb
      ? {
          print_status: 'QUEUED',
          print_requested_at: new Date().toISOString(),
          print_error: null,
        }
      : {}),
  };
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
      .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type')
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
        .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type')
        .single();

      if (updateError) throw updateError;

      await createFoTaskForPaidGuestShopOrder(updatedOrder || order);
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
