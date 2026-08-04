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

function jsonPublicCatalog(body: any) {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canFullManageGuestShop(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);

  return (
    role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com'
  );
}

function canViewGuestShopAdmin(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return (
    canFullManageGuestShop(user) ||
    user?.can_access_guest_shop_admin === true ||
    user?.can_access_fnb_menu_admin === true ||
    role === 'FO' ||
    role === 'MANAGER' ||
    role === 'FNB' ||
    email === 'walter@hotelhallmark.com' ||
    email === 'fnb@hotelhallmark.com'
  );
}

function normalizeCategory(row: any) {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    name_ms: String(row?.name_ms || ''),
    name_zh: String(row?.name_zh || ''),
    sort_order: Number(row?.sort_order || 0),
    is_active: row?.is_active !== false,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

function normalizeCategoryPayload(body: any) {
  const name = String(body?.name || '').trim();
  const nameMs = String(body?.name_ms ?? body?.nameMs ?? '').trim();
  const nameZh = String(body?.name_zh ?? body?.nameZh ?? '').trim();
  const sortOrder = Number(body?.sort_order ?? body?.sortOrder ?? 0);
  const isActive = body?.is_active ?? body?.isActive;

  if (!name) throw new Error('Category name is required');
  if (name.length > 40) throw new Error('Category name must be 40 characters or less');

  return {
    name,
    name_ms: nameMs || null,
    name_zh: nameZh || null,
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
    is_active: isActive === undefined ? true : isActive === true,
  };
}

async function requireManager(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { error: error || 'Unauthorized', status: 401, user: null };
  if (!canFullManageGuestShop(user)) {
    return { error: 'Guest Shop Admin access denied', status: 403, user: null };
  }
  return { error: '', status: 200, user };
}

export async function GET(req: NextRequest) {
  try {
    const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1';

    if (includeInactive) {
      const { user, error } = await getDashboardUserFromRequest(req);
      if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
      if (!canViewGuestShopAdmin(user)) {
        return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
      }
    }

    let query = supabaseAdmin
      .from('guest_shop_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;

    const payload = { ok: true, categories: (data || []).map(normalizeCategory) };
    return includeInactive ? jsonNoCache(payload) : jsonPublicCatalog(payload);
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load guest shop categories', categories: [] },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const payload = normalizeCategoryPayload(await req.json());
    const { data, error } = await supabaseAdmin
      .from('guest_shop_categories')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, category: normalizeCategory(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create category' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) throw new Error('Missing category id');

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('guest_shop_categories')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    if (existingError) throw existingError;

    const payload = normalizeCategoryPayload(body);
    const { data, error } = await supabaseAdmin
      .from('guest_shop_categories')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    const oldName = String(existing?.name || '').trim();
    if (oldName && oldName !== payload.name) {
      const { error: itemError } = await supabaseAdmin
        .from('guest_shop_items')
        .update({ category: payload.name })
        .eq('category', oldName);

      if (itemError) throw itemError;
    }

    return jsonNoCache({ ok: true, category: normalizeCategory(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update category' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) throw new Error('Missing category id');

    const { data, error } = await supabaseAdmin
      .from('guest_shop_categories')
      .update({ is_active: false })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, category: normalizeCategory(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to remove category' }, 500);
  }
}
