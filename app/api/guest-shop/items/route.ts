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

function canManageGuestShop(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);

  return (
    role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com' ||
    email === 'walter@hotelhallmark.com'
  );
}

function normalizeItemPayload(body: any) {
  const name = String(body?.name || '').trim();
  const category = String(body?.category || '').trim();
  const description = String(body?.description || '').trim();
  const imageUrl = String(body?.image_url ?? body?.imageUrl ?? '').trim();
  const label = String(body?.label || '').trim();
  const accent = String(body?.accent || '#b6813a').trim();
  const price = Number(body?.price_myr ?? body?.price ?? 0);
  const stock = Number(body?.stock ?? 0);
  const sortOrder = Number(body?.sort_order ?? body?.sortOrder ?? 0);
  const isActive = body?.is_active ?? body?.isActive;
  const outOfStock = body?.out_of_stock ?? body?.outOfStock;

  if (!name) throw new Error('Item name is required');
  if (!category) throw new Error('Category is required');
  if (!Number.isFinite(price) || price < 0) throw new Error('Price must be 0 or higher');
  if (!Number.isFinite(stock) || stock < 0) throw new Error('Stock must be 0 or higher');

  return {
    name,
    category,
    description,
    price_myr: Math.round(price * 100) / 100,
    stock: Math.floor(stock),
    image_url: imageUrl || null,
    label: label || null,
    accent: accent || '#b6813a',
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
    is_active: isActive === undefined ? true : isActive === true,
    out_of_stock: outOfStock === true,
  };
}

function normalizeItem(row: any) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    category: String(row.category || 'Essentials'),
    description: String(row.description || ''),
    price_myr: Number(row.price_myr || 0),
    stock: Number(row.stock || 0),
    image_url: row.image_url || '',
    label: row.label || '',
    accent: row.accent || '#b6813a',
    sort_order: Number(row.sort_order || 0),
    is_active: row.is_active !== false,
    out_of_stock: row.out_of_stock === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1';

    if (includeInactive) {
      const { user, error: authError } = await getDashboardUserFromRequest(req);
      if (authError || !user) {
        return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
      }
      if (!canManageGuestShop(user)) {
        return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
      }
    }

    let query = supabaseAdmin
      .from('guest_shop_items')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return jsonNoCache({ ok: true, items: (data || []).map(normalizeItem) });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load guest shop items', items: [] },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canManageGuestShop(user)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const payload = normalizeItemPayload(await req.json());
    const { data, error } = await supabaseAdmin
      .from('guest_shop_items')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, item: normalizeItem(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create item' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canManageGuestShop(user)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) throw new Error('Missing item id');

    const payload = normalizeItemPayload(body);
    const { data, error } = await supabaseAdmin
      .from('guest_shop_items')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, item: normalizeItem(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update item' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canManageGuestShop(user)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) throw new Error('Missing item id');

    const { error } = await supabaseAdmin.from('guest_shop_items').delete().eq('id', id);
    if (error) throw error;

    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to delete item' }, 500);
  }
}
