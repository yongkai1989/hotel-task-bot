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

function canViewGuestShopAdmin(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);

  return (
    role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com' ||
    email === 'walter@hotelhallmark.com' ||
    role === 'FO' ||
    role === 'MANAGER' ||
    role === 'FNB' ||
    email === 'fnb@hotelhallmark.com'
  );
}

function normalizeDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function singaporeDayRange(dateText: string) {
  const [yyyy, mm, dd] = normalizeDate(dateText).split('-').map(Number);
  const startUtcMs = Date.UTC(yyyy, mm - 1, dd, -8, 0, 0, 0);
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(endUtcMs).toISOString(),
  };
}

function normalizeOrder(row: any) {
  return {
    id: String(row?.id || ''),
    room_number: String(row?.room_number || ''),
    guest_name: String(row?.guest_name || ''),
    guest_email: String(row?.guest_email || ''),
    status: String(row?.status || 'PENDING_PAYMENT'),
    payment_provider: String(row?.payment_provider || ''),
    payment_reference: String(row?.payment_reference || ''),
    total_myr: Number(row?.total_myr || 0),
    items_json: Array.isArray(row?.items_json) ? row.items_json : [],
    paid_at: row?.paid_at || null,
    fulfilled_at: row?.fulfilled_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canViewGuestShopAdmin(user)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const date = normalizeDate(req.nextUrl.searchParams.get('date') || '');
    const status = String(req.nextUrl.searchParams.get('status') || 'ALL').trim().toUpperCase();
    const { start, end } = singaporeDayRange(date);

    let query = supabaseAdmin
      .from('guest_shop_orders')
      .select('*')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false });

    if (status && status !== 'ALL') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    return jsonNoCache({
      ok: true,
      date,
      orders: (data || []).map(normalizeOrder),
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load guest shop orders', orders: [] },
      500
    );
  }
}
