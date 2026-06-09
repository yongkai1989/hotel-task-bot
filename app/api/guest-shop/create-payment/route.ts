import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

type CheckoutItem = {
  id: string;
  quantity: number;
  special_instructions?: string;
  selected_options?: Array<{
    group_id: string;
    option_ids: string[];
  }>;
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

  const merged = new Map<string, CheckoutItem>();
  for (const row of value) {
    const id = sanitizeText((row as any)?.id, 80);
    const quantity = Math.max(0, Math.floor(Number((row as any)?.quantity || 0)));
    if (!id || quantity <= 0) continue;
    const specialInstructions = sanitizeText((row as any)?.special_instructions, 240);

    const selectedOptions = Array.isArray((row as any)?.selected_options)
      ? (row as any).selected_options.map((group: any) => ({
          group_id: sanitizeText(group?.group_id, 80),
          option_ids: Array.isArray(group?.option_ids)
            ? group.option_ids.map((optionId: any) => sanitizeText(optionId, 80)).filter(Boolean)
            : [],
        })).filter((group: any) => group.group_id && group.option_ids.length)
      : [];

    const key = `${id}:${JSON.stringify(selectedOptions)}:${specialInstructions}`;
    const existing = merged.get(key);
    merged.set(key, {
      id,
      quantity: Math.min((existing?.quantity || 0) + quantity, 99),
      special_instructions: specialInstructions,
      selected_options: selectedOptions,
    });
  }

  return Array.from(merged.values());
}

async function loadOptionsForItems(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, any[]>();

  const { data: groups, error: groupError } = await supabaseAdmin
    .from('guest_shop_item_option_groups')
    .select('*')
    .in('item_id', itemIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (groupError) throw groupError;

  const groupIds = (groups || []).map((group: any) => String(group.id));
  const { data: options, error: optionError } = groupIds.length
    ? await supabaseAdmin
        .from('guest_shop_item_options')
        .select('*')
        .in('group_id', groupIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (optionError) throw optionError;

  const optionsByGroupId = new Map<string, any[]>();
  for (const option of options || []) {
    const groupId = String((option as any).group_id);
    const next = optionsByGroupId.get(groupId) || [];
    next.push(option);
    optionsByGroupId.set(groupId, next);
  }

  const groupsByItemId = new Map<string, any[]>();
  for (const group of groups || []) {
    const itemId = String((group as any).item_id);
    const next = groupsByItemId.get(itemId) || [];
    next.push({
      ...group,
      options: optionsByGroupId.get(String((group as any).id)) || [],
    });
    groupsByItemId.set(itemId, next);
  }

  return groupsByItemId;
}

function resolveSelectedOptions(item: CheckoutItem, groups: any[]) {
  const selectedByGroupId = new Map(
    (item.selected_options || []).map((group) => [
      String(group.group_id),
      new Set((group.option_ids || []).map(String)),
    ])
  );

  const selected: any[] = [];
  let addOnTotal = 0;

  for (const group of groups) {
    const groupId = String(group.id);
    const groupOptions = Array.isArray(group.options) ? group.options : [];
    const requested = selectedByGroupId.get(groupId) || new Set<string>();
    const picked = groupOptions.filter((option: any) => requested.has(String(option.id)));

    if (group.is_required === true && picked.length < Math.max(1, Number(group.min_select || 0))) {
      throw new Error(`${group.name || 'Required option'} must be selected`);
    }

    if (String(group.selection_type || 'single') === 'single' && picked.length > 1) {
      throw new Error(`${group.name || 'Option group'} only allows one choice`);
    }

    const maxSelect = Number(group.max_select || 0);
    if (maxSelect > 0 && picked.length > maxSelect) {
      throw new Error(`${group.name || 'Option group'} allows up to ${maxSelect} choices`);
    }

    if (!picked.length) continue;

    selected.push({
      group_id: groupId,
      group_name: String(group.name || ''),
      selection_type: String(group.selection_type || 'single'),
      options: picked.map((option: any) => {
        const priceDelta = Number(option.price_delta_myr || 0);
        addOnTotal += priceDelta;
        return {
          id: String(option.id),
          name: String(option.name || ''),
          price_delta_myr: priceDelta,
        };
      }),
    });
  }

  return {
    selected_options: selected,
    add_on_total_myr: Number(addOnTotal.toFixed(2)),
  };
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
    const billplzEmail =
      guestEmail || String(process.env.BILLPLZ_FALLBACK_EMAIL || 'frontoffice@hotelhallmark.com').trim();
    const checkoutItems = normalizeCheckoutItems(body?.items);

    if (!roomNumber || !guestName) {
      return jsonNoCache({ ok: false, error: 'Room number and guest name are required' }, 400);
    }

    if (!checkoutItems.length) {
      return jsonNoCache({ ok: false, error: 'Please select at least one item' }, 400);
    }

    const ids = checkoutItems.map((item) => item.id);
    const { data: catalogRows, error: catalogError } = await supabaseAdmin
      .from('guest_shop_items')
      .select('id, name, category, submenu, price_myr, stock, is_active, out_of_stock, is_fnb')
      .in('id', ids);

    if (catalogError) throw catalogError;

    const catalogById = new Map((catalogRows || []).map((row: any) => [String(row.id), row]));
    const groupsByItemId = await loadOptionsForItems(ids);
    const quantityByItemId = new Map<string, number>();
    for (const item of checkoutItems) {
      quantityByItemId.set(item.id, (quantityByItemId.get(item.id) || 0) + item.quantity);
    }

    for (const [id, quantity] of quantityByItemId.entries()) {
      const catalog = catalogById.get(id);
      const stock = Math.max(0, Number(catalog?.stock || 0));
      if (!catalog || catalog.is_active === false || catalog.out_of_stock === true) {
        throw new Error('One of the selected items is no longer available');
      }
      if (quantity > stock) {
        throw new Error(`${catalog.name || 'Selected item'} only has ${stock} available`);
      }
    }

    const orderItems = checkoutItems.map((item) => {
      const catalog = catalogById.get(item.id);
      if (!catalog || catalog.is_active === false || catalog.out_of_stock === true) {
        throw new Error('One of the selected items is no longer available');
      }

      const price = Number(catalog.price_myr || 0);
      const selected = resolveSelectedOptions(item, groupsByItemId.get(item.id) || []);
      const unitPrice = Number((price + selected.add_on_total_myr).toFixed(2));
      return {
        id: String(catalog.id),
        name: String(catalog.name || ''),
        category: String(catalog.category || ''),
        submenu: String(catalog.submenu || ''),
        quantity: item.quantity,
        base_price_myr: price,
        add_on_total_myr: selected.add_on_total_myr,
        price_myr: unitPrice,
        line_total_myr: Number((unitPrice * item.quantity).toFixed(2)),
        special_instructions: item.special_instructions || '',
        selected_options: selected.selected_options,
      };
    });

    const totalMyr = Number(
      orderItems.reduce((total, item) => total + item.line_total_myr, 0).toFixed(2)
    );

    if (totalMyr <= 0) {
      return jsonNoCache({ ok: false, error: 'Order total must be more than RM0.00' }, 400);
    }

    const isFnbOrder = orderItems.some((item) => {
      const catalog = catalogById.get(item.id);
      return catalog?.is_fnb === true || String(item.category).trim().toLowerCase() === 'f&b';
    });

    const { data: order, error: orderError } = await supabaseAdmin
      .from('guest_shop_orders')
      .insert({
        room_number: roomNumber,
        guest_name: guestName,
        guest_email: guestEmail,
        status: 'PENDING_PAYMENT',
        order_type: isFnbOrder ? 'FNB' : 'GUEST_SHOP',
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
    billBody.set('email', billplzEmail);
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
