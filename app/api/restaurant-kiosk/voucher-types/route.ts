import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DEFAULT_TYPE = {
  id: 'default-breakfast',
  name: 'Breakfast Voucher',
  description: 'Breakfast pass redeemable at the restaurant counter.',
  price_myr: 20,
  is_active: true,
  display_order: 1,
};

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeType(row: any) {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || 'Breakfast Voucher'),
    description: String(row?.description || ''),
    price_myr: Number(row?.price_myr || 0),
    is_active: row?.is_active !== false,
    display_order: Number(row?.display_order || 0),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

async function requireSuperuser(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { ok: false, status: 401, error: error || 'Unauthorized', user: null as any };
  const role = String(user?.role || '').trim().toUpperCase();
  if (role !== 'SUPERUSER') return { ok: false, status: 403, error: 'Superuser only', user };
  return { ok: true, status: 200, error: '', user };
}

export async function GET(req: NextRequest) {
  try {
    const admin = req.nextUrl.searchParams.get('admin') === '1';

    if (admin) {
      const access = await requireSuperuser(req);
      if (!access.ok) return jsonNoCache({ ok: false, error: access.error }, access.status);
    }

    let query = supabaseAdmin
      .from('breakfast_voucher_types')
      .select('id, name, description, price_myr, is_active, display_order, created_at, updated_at')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (!admin) query = query.eq('is_active', true);

    const result: any = await query;
    if (result?.error) {
      if (!admin) return jsonNoCache({ ok: true, types: [DEFAULT_TYPE] });
      throw result.error;
    }

    const types = Array.isArray(result?.data) ? result.data.map(normalizeType) : [];
    return jsonNoCache({ ok: true, types: types.length ? types : [DEFAULT_TYPE] });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load voucher types' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireSuperuser(req);
    if (!access.ok) return jsonNoCache({ ok: false, error: access.error }, access.status);

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    const description = String(body?.description || '').trim();
    const price = Number(body?.price_myr || 0);
    const displayOrder = Math.max(0, Math.floor(Number(body?.display_order || 0)));

    if (!name) return jsonNoCache({ ok: false, error: 'Voucher type name is required' }, 400);
    if (!Number.isFinite(price) || price <= 0) {
      return jsonNoCache({ ok: false, error: 'Price must be more than RM0.00' }, 400);
    }

    const result: any = await supabaseAdmin
      .from('breakfast_voucher_types')
      .insert({
        name,
        description,
        price_myr: Number(price.toFixed(2)),
        is_active: body?.is_active !== false,
        display_order: displayOrder,
      })
      .select('id, name, description, price_myr, is_active, display_order, created_at, updated_at')
      .single();

    if (result?.error) throw result.error;
    return jsonNoCache({ ok: true, type: normalizeType(result.data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create voucher type' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const access = await requireSuperuser(req);
    if (!access.ok) return jsonNoCache({ ok: false, error: access.error }, access.status);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const name = String(body?.name || '').trim();
    const description = String(body?.description || '').trim();
    const price = Number(body?.price_myr || 0);
    const displayOrder = Math.max(0, Math.floor(Number(body?.display_order || 0)));

    if (!id) return jsonNoCache({ ok: false, error: 'Missing voucher type id' }, 400);
    if (!name) return jsonNoCache({ ok: false, error: 'Voucher type name is required' }, 400);
    if (!Number.isFinite(price) || price <= 0) {
      return jsonNoCache({ ok: false, error: 'Price must be more than RM0.00' }, 400);
    }

    const result: any = await supabaseAdmin
      .from('breakfast_voucher_types')
      .update({
        name,
        description,
        price_myr: Number(price.toFixed(2)),
        is_active: body?.is_active !== false,
        display_order: displayOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, name, description, price_myr, is_active, display_order, created_at, updated_at')
      .single();

    if (result?.error) throw result.error;
    return jsonNoCache({ ok: true, type: normalizeType(result.data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update voucher type' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const access = await requireSuperuser(req);
    if (!access.ok) return jsonNoCache({ ok: false, error: access.error }, access.status);

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) return jsonNoCache({ ok: false, error: 'Missing voucher type id' }, 400);

    const result: any = await supabaseAdmin
      .from('breakfast_voucher_types')
      .delete()
      .eq('id', id);

    if (result?.error) throw result.error;
    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to delete voucher type' }, 500);
  }
}
