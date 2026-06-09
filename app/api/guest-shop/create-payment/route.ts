import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

type CheckoutItem = {
  id: string;
  quantity: number;
};

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function sanitizeText(value: unknown, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function billplzBaseUrl() {
  return String(process.env.BILLPLZ_MODE || '').trim().toLowerCase() === 'production'
    ? 'https://www.billplz.com/api/v3'
    : 'https://www.billplz-sandbox.com/api/v3';
}

function siteBaseUrl(req: NextRequest) {
  return String(process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin || '').replace(/\/$/, '');
}

function basicAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function billplzErrorMessage(status: number, rawError: unknown) {
  const text = String(
    (rawError as any)?.message ||
      (rawError as any)?.title ||
      rawError ||
      ''
  ).trim();

  if (status === 401 || /access denied/i.test(text)) {
    return 'Billplz sandbox access denied. Please check that BILLPLZ_API_KEY and BILLPLZ_COLLECTION_ID are from the same Billplz sandbox account.';
  }

  if (/collection/i.test(text)) {
    return `Billplz collection issue: ${text}`;
  }

  return text || 'Failed to create Billplz bill';
}

function normalizeCheckoutItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value)) return [];

  const merged = new Map<string, number>();
  for (const row of value) {
    const id = sanitizeText((row as any)?.id, 80);
    const quantity = Math.max(0, Math.floor(Number((row as any)?.quantity || 0)));
    if (!id || quantity <= 0) continue;
    merged.set(id, Math.min((merged.get(id) || 0) + quantity, 99));
  }

  return Array.from(merged.entries()).map(([id, quantity]) => ({ id, quantity }));
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = String(process.env.BILLPLZ_API_KEY || '').trim();
    const collectionId = String(process.env.BILLPLZ_COLLECTION_ID || '').trim();

    if (!apiKey || !collectionId) {
      return jsonNoCache({ ok: false, error: 'Billplz environment variables are not configured' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const roomNumber = sanitizeText(body?.roomNumber, 40);
    const guestName = sanitizeText(body?.guestName, 120);
    const guestEmail = sanitizeText(body?.email, 180).toLowerCase();
    const checkoutItems = normalizeCheckoutItems(body?.items);

    if (!roomNumber || !guestName || !guestEmail) {
      return jsonNoCache({ ok: false, error: 'Room number, guest name, and email are required' }, 400);
    }

    if (!checkoutItems.length) {
      return jsonNoCache({ ok: false, error: 'Please select at least one item' }, 400);
    }

    const ids = checkoutItems.map((item) => item.id);
    const { data: catalogRows, error: catalogError } = await supabaseAdmin
      .from('guest_shop_items')
      .select('id, name, category, price_myr, stock, is_active, out_of_stock')
      .in('id', ids);

    if (catalogError) throw catalogError;

    const catalogById = new Map((catalogRows || []).map((row: any) => [String(row.id), row]));
    const orderItems = checkoutItems.map((item) => {
      const catalog = catalogById.get(item.id);
      if (!catalog || catalog.is_active === false || catalog.out_of_stock === true) {
        throw new Error('One of the selected items is no longer available');
      }

      const stock = Math.max(0, Number(catalog.stock || 0));
      if (item.quantity > stock) {
        throw new Error(`${catalog.name || 'Selected item'} only has ${stock} available`);
      }

      const price = Number(catalog.price_myr || 0);
      return {
        id: String(catalog.id),
        name: String(catalog.name || ''),
        category: String(catalog.category || ''),
        quantity: item.quantity,
        price_myr: price,
        line_total_myr: Number((price * item.quantity).toFixed(2)),
      };
    });

    const totalMyr = Number(
      orderItems.reduce((total, item) => total + item.line_total_myr, 0).toFixed(2)
    );

    if (totalMyr <= 0) {
      return jsonNoCache({ ok: false, error: 'Order total must be more than RM0.00' }, 400);
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('guest_shop_orders')
      .insert({
        room_number: roomNumber,
        guest_name: guestName,
        guest_email: guestEmail,
        status: 'PENDING_PAYMENT',
        payment_provider: `BILLPLZ_${String(process.env.BILLPLZ_MODE || 'sandbox').toUpperCase()}`,
        total_myr: totalMyr,
        items_json: orderItems,
      })
      .select('id')
      .single();

    if (orderError) throw orderError;

    const baseUrl = siteBaseUrl(req);
    const orderId = String(order.id);
    const callbackUrl = `${baseUrl}/api/guest-shop/billplz-callback`;
    const redirectUrl = `${baseUrl}/guest-shop/payment-status?order_id=${encodeURIComponent(orderId)}`;
    const description = `Hallmark Crown Guest Shop - Room ${roomNumber}`;

    const billBody = new URLSearchParams();
    billBody.set('collection_id', collectionId);
    billBody.set('email', guestEmail);
    billBody.set('name', guestName);
    billBody.set('amount', String(Math.round(totalMyr * 100)));
    billBody.set('callback_url', callbackUrl);
    billBody.set('redirect_url', redirectUrl);
    billBody.set('description', description);
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

      const rawError = billJson?.error || billJson?.message || billJson;
      return jsonNoCache(
        {
          ok: false,
          error: billplzErrorMessage(billRes.status, rawError),
          billplz_status: billRes.status,
          billplz_mode: String(process.env.BILLPLZ_MODE || 'sandbox').trim().toLowerCase() || 'sandbox',
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
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create payment' }, 500);
  }
}
