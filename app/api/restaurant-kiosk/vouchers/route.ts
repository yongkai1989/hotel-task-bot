import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

function canManageBreakfastVouchers(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return (
    role === 'SUPERUSER' ||
    role === 'FO' ||
    role === 'FNB' ||
    user?.can_access_lost_found === true ||
    user?.can_access_fnb_orders === true ||
    email === 'fo@hotelhallmark.com' ||
    email === 'walter@hotelhallmark.com' ||
    email === 'fnb@hotelhallmark.com' ||
    email === 'fenny@hotelhallmark.com'
  );
}

function normalizeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function singaporeDayRange(dateText: string) {
  const [yyyy, mm, dd] = normalizeDate(dateText).split('-').map(Number);
  const startUtcMs = Date.UTC(yyyy, mm - 1, dd, -8, 0, 0, 0);
  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function voucherSelect() {
  return `
    id,
    room_number,
    guest_name,
    guest_email,
    status,
    payment_reference,
    total_myr,
    items_json,
    paid_at,
    created_at,
    fulfilled_at,
    voucher_code,
    voucher_quantity,
    voucher_redeemed_quantity,
    voucher_status,
    voucher_redeemed_at,
    voucher_redeemed_by,
    manual_sale_channel,
    manual_payment_type,
    manual_amount_received,
    manual_sold_by_name,
    manual_issued_by_name,
    manual_issued_by_email,
    manual_issued_at
  `;
}

function normalizeVoucher(row: any) {
  return {
    id: String(row?.id || ''),
    room_number: String(row?.room_number || ''),
    guest_name: String(row?.guest_name || ''),
    guest_email: String(row?.guest_email || ''),
    status: String(row?.status || 'PENDING_PAYMENT'),
    payment_reference: String(row?.payment_reference || ''),
    total_myr: Number(row?.total_myr || 0),
    items_json: Array.isArray(row?.items_json) ? row.items_json : [],
    paid_at: row?.paid_at || null,
    created_at: row?.created_at || null,
    fulfilled_at: row?.fulfilled_at || null,
    voucher_code: String(row?.voucher_code || ''),
    voucher_quantity: Number(row?.voucher_quantity || 0),
    voucher_redeemed_quantity: Number(row?.voucher_redeemed_quantity || 0),
    voucher_status: String(row?.voucher_status || 'NOT_REQUIRED'),
    voucher_redeemed_at: row?.voucher_redeemed_at || null,
    voucher_redeemed_by: String(row?.voucher_redeemed_by || ''),
    manual_sale_channel: String(row?.manual_sale_channel || ''),
    manual_payment_type: String(row?.manual_payment_type || ''),
    manual_amount_received: row?.manual_amount_received == null ? null : Number(row.manual_amount_received || 0),
    manual_sold_by_name: String(row?.manual_sold_by_name || ''),
    manual_issued_by_name: String(row?.manual_issued_by_name || ''),
    manual_issued_by_email: String(row?.manual_issued_by_email || ''),
    manual_issued_at: row?.manual_issued_at || null,
  };
}

function cleanText(value: unknown) {
  return String(value || '').trim();
}

function breakfastVoucherCode() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `BF-${day}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function resolveVoucherType(typeId: string) {
  if (typeId && typeId !== 'default-breakfast') {
    const result: any = await supabaseAdmin
      .from('breakfast_voucher_types')
      .select('id, name, description, price_myr, is_active')
      .eq('id', typeId)
      .eq('is_active', true)
      .maybeSingle();

    if (result?.error) throw result.error;
    if (result?.data) {
      return {
        id: String(result.data.id),
        name: String(result.data.name || 'Breakfast Voucher'),
        description: String(result.data.description || ''),
        price_myr: Number(result.data.price_myr || 0),
      };
    }
  }

  const fallbackPrice = Number(process.env.BREAKFAST_VOUCHER_PRICE_MYR || 20);
  return {
    id: 'default-breakfast',
    name: 'Breakfast Voucher',
    description: 'Breakfast pass redeemable at the restaurant counter.',
    price_myr: Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 20,
  };
}

async function buildManualVoucherItems(rawItems: any[]) {
  const requested = (Array.isArray(rawItems) ? rawItems : [])
    .map((item: any) => ({
      voucherTypeId: cleanText(item?.voucherTypeId),
      quantity: Math.max(0, Math.min(20, Math.floor(Number(item?.quantity || 0)))),
    }))
    .filter((item: any) => item.voucherTypeId && item.quantity > 0);

  if (!requested.length) throw new Error('Please add at least one breakfast voucher.');

  const merged = new Map<string, number>();
  requested.forEach((item: any) => {
    merged.set(item.voucherTypeId, Math.min(20, (merged.get(item.voucherTypeId) || 0) + item.quantity));
  });

  const lines = [];
  for (const [voucherTypeId, quantity] of merged.entries()) {
    const voucherType = await resolveVoucherType(voucherTypeId);
    const unitPrice = Number.isFinite(voucherType.price_myr) && voucherType.price_myr > 0 ? voucherType.price_myr : 20;
    lines.push({
      id: `breakfast-voucher-${voucherType.id}`,
      voucher_type_id: voucherType.id,
      name: voucherType.name,
      description: voucherType.description,
      category: 'Breakfast',
      quantity,
      price_myr: unitPrice,
      line_total_myr: Number((unitPrice * quantity).toFixed(2)),
    });
  }

  return lines;
}

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
    if (!canManageBreakfastVouchers(user)) return jsonNoCache({ ok: false, error: 'Access denied' }, 403);

    const code = String(req.nextUrl.searchParams.get('code') || '').trim();
    const date = normalizeDate(String(req.nextUrl.searchParams.get('date') || ''));
    const room = String(req.nextUrl.searchParams.get('room') || '').trim();

    let query = supabaseAdmin
      .from('guest_shop_orders')
      .select(voucherSelect())
      .eq('order_type', 'BREAKFAST')
      .order('created_at', { ascending: false });

    if (code) {
      query = query.eq('voucher_code', code);
    } else {
      const range = singaporeDayRange(date);
      query = query.gte('created_at', range.start).lt('created_at', range.end);
      if (room) query = query.ilike('room_number', `%${room}%`);
    }

    const { data, error: loadError } = await query;
    if (loadError) throw loadError;

    return jsonNoCache({ ok: true, vouchers: (data || []).map(normalizeVoucher) });
  } catch (err: any) {
    return jsonNoCache({ ok: false, error: err?.message || 'Failed to load vouchers' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
    if (!canManageBreakfastVouchers(user)) return jsonNoCache({ ok: false, error: 'Access denied' }, 403);

    const body = await req.json().catch(() => ({}));
    const roomNumber = cleanText(body?.room_number);
    const sellingStaffName = cleanText(body?.manual_sold_by_name);
    const paymentType = cleanText(body?.manual_payment_type).toUpperCase();
    const allowedPaymentTypes = ['CASH', 'CARD_TERMINAL', 'MANUAL_QR', 'COMPLIMENTARY'];

    if (!roomNumber) return jsonNoCache({ ok: false, error: 'Room number is required' }, 400);
    if (!sellingStaffName) return jsonNoCache({ ok: false, error: 'Selling staff name is required' }, 400);
    if (!allowedPaymentTypes.includes(paymentType)) {
      return jsonNoCache({ ok: false, error: 'Payment type is required' }, 400);
    }

    const items = await buildManualVoucherItems(body?.items || []);
    const quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalMyr = Number(items.reduce((sum, item) => sum + Number(item.line_total_myr || 0), 0).toFixed(2));
    const amountReceived = Number(body?.manual_amount_received ?? totalMyr);

    if (paymentType !== 'COMPLIMENTARY' && (!Number.isFinite(amountReceived) || amountReceived < totalMyr)) {
      return jsonNoCache({ ok: false, error: 'Amount received must be at least the voucher total' }, 400);
    }

    const now = new Date().toISOString();
    const voucherCode = breakfastVoucherCode();
    const { data, error: insertError } = await supabaseAdmin
      .from('guest_shop_orders')
      .insert({
        room_number: roomNumber,
        guest_name: `Room ${roomNumber}`,
        guest_email: null,
        status: 'PAID',
        order_type: 'BREAKFAST',
        payment_provider: `MANUAL_${paymentType}`,
        payment_reference: `MANUAL-${voucherCode}`,
        total_myr: totalMyr,
        items_json: items,
        paid_at: now,
        voucher_code: voucherCode,
        voucher_quantity: quantity,
        voucher_redeemed_quantity: 0,
        voucher_status: 'ACTIVE',
        print_status: 'NOT_QUEUED',
        breakfast_print_status: 'NOT_QUEUED',
        fo_print_status: 'NOT_QUEUED',
        fnb_print_status: 'NOT_QUEUED',
        manual_sale_channel: 'FRONT_OFFICE',
        manual_payment_type: paymentType,
        manual_amount_received: paymentType === 'COMPLIMENTARY' ? 0 : Number(amountReceived.toFixed(2)),
        manual_sold_by_name: sellingStaffName,
        manual_issued_by_user_id: user?.user_id || null,
        manual_issued_by_name: String(user?.name || user?.email || 'Staff'),
        manual_issued_by_email: String(user?.email || ''),
        manual_issued_at: now,
      })
      .select(voucherSelect())
      .single();

    if (insertError) throw insertError;
    return jsonNoCache({ ok: true, voucher: normalizeVoucher(data) });
  } catch (err: any) {
    return jsonNoCache({ ok: false, error: err?.message || 'Failed to issue manual breakfast voucher' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
    if (!canManageBreakfastVouchers(user)) return jsonNoCache({ ok: false, error: 'Access denied' }, 403);

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || '').trim();
    const orderId = String(body?.order_id || '').trim();
    if (!code && !orderId) return jsonNoCache({ ok: false, error: 'Missing voucher code' }, 400);

    let lookup = supabaseAdmin
      .from('guest_shop_orders')
      .select(voucherSelect())
      .eq('order_type', 'BREAKFAST')
      .limit(1);

    lookup = code ? lookup.eq('voucher_code', code) : lookup.eq('id', orderId);
    const result: any = await lookup;
    const rows: any[] = Array.isArray(result?.data) ? result.data : [];
    const loadError = result?.error;
    if (loadError) throw loadError;

    const voucher: any = rows[0] || null;
    if (!voucher) return jsonNoCache({ ok: false, error: 'Voucher not found', tone: 'danger' }, 404);
    if (voucher.status !== 'PAID' && voucher.status !== 'FULFILLED') {
      return jsonNoCache({ ok: false, error: 'Payment is not verified', voucher: normalizeVoucher(voucher), tone: 'danger' }, 400);
    }
    if (String(voucher.voucher_status || '').toUpperCase() === 'REDEEMED' || voucher.fulfilled_at) {
      return jsonNoCache({ ok: false, error: 'Voucher already redeemed', voucher: normalizeVoucher(voucher), tone: 'danger' }, 409);
    }

    const now = new Date().toISOString();
    const redeemedBy = String(user?.name || user?.email || 'Staff');
    const quantity = Math.max(1, Number(voucher.voucher_quantity || 1));
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('guest_shop_orders')
      .update({
        status: 'FULFILLED',
        fulfilled_at: now,
        voucher_status: 'REDEEMED',
        voucher_redeemed_quantity: quantity,
        voucher_redeemed_at: now,
        voucher_redeemed_by: redeemedBy,
      })
      .eq('id', voucher.id)
      .neq('voucher_status', 'REDEEMED')
      .select(voucherSelect())
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return jsonNoCache({ ok: false, error: 'Voucher already redeemed', voucher: normalizeVoucher(voucher), tone: 'danger' }, 409);
    }

    return jsonNoCache({ ok: true, voucher: normalizeVoucher(updated), tone: 'success' });
  } catch (err: any) {
    return jsonNoCache({ ok: false, error: err?.message || 'Failed to redeem voucher' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);

    const role = String(user?.role || '').trim().toUpperCase();
    if (role !== 'SUPERUSER') {
      return jsonNoCache({ ok: false, error: 'Only superuser can delete breakfast voucher orders' }, 403);
    }

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return jsonNoCache({ ok: false, error: 'Missing voucher order id' }, 400);

    const { data, error: deleteError } = await supabaseAdmin
      .from('guest_shop_orders')
      .delete()
      .eq('id', id)
      .eq('order_type', 'BREAKFAST')
      .select('id')
      .maybeSingle();

    if (deleteError) throw deleteError;
    if (!data) return jsonNoCache({ ok: false, error: 'Breakfast voucher order not found' }, 404);

    return jsonNoCache({ ok: true });
  } catch (err: any) {
    return jsonNoCache({ ok: false, error: err?.message || 'Failed to delete voucher order' }, 500);
  }
}
