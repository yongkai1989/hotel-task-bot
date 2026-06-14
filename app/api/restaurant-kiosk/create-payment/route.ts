import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const BREAKFAST_PRICE_MYR = Number(process.env.BREAKFAST_VOUCHER_PRICE_MYR || 20);

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

function siteBaseUrl(req: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function cleanText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function billplzErrorMessage(status: number, raw: any) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
  if (status === 401 || status === 403) {
    return 'Billplz access denied. Please check the API key and collection ID.';
  }
  return text || 'Failed to create Billplz bill';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(body?.quantity || 1))));
    const guestName = cleanText(body?.guestName, 'Restaurant Guest') || 'Restaurant Guest';
    const roomNumber = cleanText(body?.roomNumber, 'Kiosk') || 'Kiosk';
    const guestEmail = cleanText(body?.email);
    const billplzEmail =
      guestEmail ||
      cleanText(process.env.BILLPLZ_RECEIPT_EMAIL) ||
      cleanText(process.env.GUEST_SHOP_FALLBACK_EMAIL) ||
      'frontoffice@hotelhallmark.com';

    const apiKey = cleanText(process.env.BILLPLZ_API_KEY);
    const collectionId = cleanText(process.env.BILLPLZ_COLLECTION_ID);
    if (!apiKey || !collectionId) {
      return jsonNoCache({ ok: false, error: 'Billplz environment variables are not configured' }, 500);
    }

    const unitPrice = Number.isFinite(BREAKFAST_PRICE_MYR) && BREAKFAST_PRICE_MYR > 0 ? BREAKFAST_PRICE_MYR : 20;
    const totalMyr = Number((unitPrice * quantity).toFixed(2));
    const orderItems = [
      {
        id: 'breakfast-voucher',
        name: 'Breakfast Voucher',
        category: 'Breakfast',
        quantity,
        price_myr: unitPrice,
        line_total_myr: totalMyr,
      },
    ];

    const { data: order, error: orderError } = await supabaseAdmin
      .from('guest_shop_orders')
      .insert({
        room_number: roomNumber,
        guest_name: guestName,
        guest_email: guestEmail || null,
        status: 'PENDING_PAYMENT',
        order_type: 'BREAKFAST',
        payment_provider: `BILLPLZ_${String(process.env.BILLPLZ_MODE || 'sandbox').toUpperCase()}`,
        total_myr: totalMyr,
        items_json: orderItems,
        voucher_quantity: quantity,
        voucher_redeemed_quantity: 0,
        voucher_status: 'PENDING_PAYMENT',
      })
      .select('id')
      .single();

    if (orderError) throw orderError;

    const baseUrl = siteBaseUrl(req);
    const orderId = String(order.id);
    const callbackUrl = `${baseUrl}/api/guest-shop/billplz-callback`;
    const redirectUrl = `${baseUrl}/restaurant-kiosk/payment-status?order_id=${encodeURIComponent(orderId)}`;

    const billBody = new URLSearchParams();
    billBody.set('collection_id', collectionId);
    billBody.set('email', billplzEmail);
    billBody.set('name', guestName);
    billBody.set('amount', String(Math.round(totalMyr * 100)));
    billBody.set('callback_url', callbackUrl);
    billBody.set('redirect_url', redirectUrl);
    billBody.set('description', `Hallmark Crown Breakfast Voucher - ${quantity} pax`);
    billBody.set('reference_1_label', 'Order ID');
    billBody.set('reference_1', orderId);
    billBody.set('reference_2_label', 'Room');
    billBody.set('reference_2', roomNumber);
    billBody.set('deliver', 'false');

    const billRes = await fetch(`${billplzBaseUrl()}/bills`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(apiKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: billBody,
      cache: 'no-store',
    });

    const billJson = await billRes.json().catch(() => ({}));
    if (!billRes.ok || !billJson?.id || !billJson?.url) {
      await supabaseAdmin
        .from('guest_shop_orders')
        .update({ status: 'FAILED', payment_reference: String(billJson?.id || '') })
        .eq('id', orderId);

      return jsonNoCache(
        {
          ok: false,
          error: billplzErrorMessage(billRes.status, billJson?.error || billJson?.message || billJson),
          billplz_status: billRes.status,
        },
        502
      );
    }

    await supabaseAdmin
      .from('guest_shop_orders')
      .update({ payment_reference: String(billJson.id) })
      .eq('id', orderId);

    return jsonNoCache({
      ok: true,
      order_id: orderId,
      bill_id: String(billJson.id),
      payment_url: String(billJson.url),
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create breakfast voucher payment' }, 500);
  }
}
