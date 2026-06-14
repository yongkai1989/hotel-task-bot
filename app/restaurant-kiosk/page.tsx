import { NextRequest, NextResponse } from 'next/server';
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
    role === 'FNB' ||
    user?.can_access_fnb_orders === true ||
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
    voucher_redeemed_by
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
  };
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
