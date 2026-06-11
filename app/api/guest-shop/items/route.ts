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

function canFullManageGuestShop(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);

  return (
    role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com'
  );
}

function canManageFnbStock(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return role === 'FNB' || email === 'fnb@hotelhallmark.com';
}

function canViewGuestShopAdmin(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return (
    canFullManageGuestShop(user) ||
    canManageFnbStock(user) ||
    role === 'FO' ||
    role === 'MANAGER' ||
    email === 'walter@hotelhallmark.com'
  );
}

function isFnbItem(row: any) {
  return row?.is_fnb === true || String(row?.category || '').trim().toLowerCase() === 'f&b';
}

function rejectEmbeddedImageUrl(value: string, label: string) {
  if (value.startsWith('data:') || value.length > 2000) {
    throw new Error(`${label} must be uploaded first or saved as a normal hosted image URL`);
  }
}

function safeImageUrl(value: unknown) {
  const imageUrl = String(value || '').trim();
  return imageUrl.startsWith('data:') || imageUrl.length > 2000 ? '' : imageUrl;
}

function normalizeItemPayload(body: any) {
  const name = String(body?.name || '').trim();
  const category = String(body?.category || '').trim();
  const submenu = String(body?.submenu || '').trim();
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
  if (imageUrl) rejectEmbeddedImageUrl(imageUrl, 'SKU image URL');

  return {
    name,
    category,
    submenu,
    description,
    price_myr: Math.round(price * 100) / 100,
    stock: Math.floor(stock),
    image_url: imageUrl || null,
    label: label || null,
    accent: accent || '#b6813a',
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
    is_active: isActive === undefined ? true : isActive === true,
    out_of_stock: outOfStock === true,
    is_fnb: body?.is_fnb === true || body?.isFnb === true || category.toLowerCase() === 'f&b',
  };
}

function normalizeOptionGroups(value: any) {
  if (!Array.isArray(value)) return [];

  return value
    .map((group, groupIndex) => {
      const name = String(group?.name || '').trim();
      const selectionType = String(group?.selection_type || group?.selectionType || 'single').toLowerCase();
      const options = Array.isArray(group?.options) ? group.options : [];

      return {
        id: group?.id ? String(group.id) : '',
        name,
        selection_type: selectionType === 'multiple' ? 'multiple' : 'single',
        is_required: group?.is_required === true || group?.isRequired === true,
        min_select: Math.max(0, Math.floor(Number(group?.min_select ?? group?.minSelect ?? 0))),
        max_select: Math.max(0, Math.floor(Number(group?.max_select ?? group?.maxSelect ?? (selectionType === 'multiple' ? 99 : 1)))),
        sort_order: Number.isFinite(Number(group?.sort_order ?? group?.sortOrder))
          ? Math.floor(Number(group?.sort_order ?? group?.sortOrder))
          : groupIndex,
        is_active: group?.is_active === undefined ? true : group.is_active === true,
        options: options
          .map((option: any, optionIndex: number) => {
            const optionName = String(option?.name || '').trim();
            const priceDelta = Number(option?.price_delta_myr ?? option?.priceDeltaMyr ?? option?.price ?? 0);
            return {
              id: option?.id ? String(option.id) : '',
              name: optionName,
              price_delta_myr: Number.isFinite(priceDelta) ? Math.round(priceDelta * 100) / 100 : 0,
              is_default: option?.is_default === true || option?.isDefault === true,
              sort_order: Number.isFinite(Number(option?.sort_order ?? option?.sortOrder))
                ? Math.floor(Number(option?.sort_order ?? option?.sortOrder))
                : optionIndex,
              is_active: option?.is_active === undefined ? true : option.is_active === true,
            };
          })
          .filter((option: any) => option.name),
      };
    })
    .filter((group: any) => group.name);
}

function normalizeItem(row: any, optionGroups: any[] = []) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    category: String(row.category || 'Essentials'),
    submenu: String(row.submenu || ''),
    description: String(row.description || ''),
    price_myr: Number(row.price_myr || 0),
    stock: Number(row.stock || 0),
    image_url: safeImageUrl(row.image_url),
    label: row.label || '',
    accent: row.accent || '#b6813a',
    sort_order: Number(row.sort_order || 0),
    is_active: row.is_active !== false,
    out_of_stock: row.out_of_stock === true,
    is_fnb: row.is_fnb === true,
    option_groups: optionGroups,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function loadOptionGroups(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, any[]>();

  const { data: groups, error: groupsError } = await supabaseAdmin
    .from('guest_shop_item_option_groups')
    .select('*')
    .in('item_id', itemIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (groupsError) throw groupsError;

  const groupIds = (groups || []).map((group: any) => String(group.id));
  const { data: options, error: optionsError } = groupIds.length
    ? await supabaseAdmin
        .from('guest_shop_item_options')
        .select('*')
        .in('group_id', groupIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null };

  if (optionsError) throw optionsError;

  const optionsByGroupId = new Map<string, any[]>();
  for (const option of options || []) {
    const groupId = String((option as any).group_id);
    const next = optionsByGroupId.get(groupId) || [];
    next.push({
      id: String((option as any).id),
      name: String((option as any).name || ''),
      price_delta_myr: Number((option as any).price_delta_myr || 0),
      is_default: (option as any).is_default === true,
      sort_order: Number((option as any).sort_order || 0),
      is_active: (option as any).is_active !== false,
    });
    optionsByGroupId.set(groupId, next);
  }

  const groupsByItemId = new Map<string, any[]>();
  for (const group of groups || []) {
    const itemId = String((group as any).item_id);
    const next = groupsByItemId.get(itemId) || [];
    next.push({
      id: String((group as any).id),
      name: String((group as any).name || ''),
      selection_type: String((group as any).selection_type || 'single'),
      is_required: (group as any).is_required === true,
      min_select: Number((group as any).min_select || 0),
      max_select: Number((group as any).max_select || 0),
      sort_order: Number((group as any).sort_order || 0),
      is_active: (group as any).is_active !== false,
      options: optionsByGroupId.get(String((group as any).id)) || [],
    });
    groupsByItemId.set(itemId, next);
  }

  return groupsByItemId;
}

async function replaceOptionGroups(itemId: string, value: any) {
  if (!Array.isArray(value)) return;

  const groups = normalizeOptionGroups(value);

  const { error: deleteError } = await supabaseAdmin
    .from('guest_shop_item_option_groups')
    .delete()
    .eq('item_id', itemId);

  if (deleteError) throw deleteError;

  for (const group of groups) {
    const { data: savedGroup, error: groupError } = await supabaseAdmin
      .from('guest_shop_item_option_groups')
      .insert({
        item_id: itemId,
        name: group.name,
        selection_type: group.selection_type,
        is_required: group.is_required,
        min_select: group.min_select,
        max_select: group.selection_type === 'single' ? 1 : group.max_select,
        sort_order: group.sort_order,
        is_active: group.is_active,
      })
      .select('id')
      .single();

    if (groupError) throw groupError;

    const optionRows = group.options.map((option: any) => ({
      group_id: String(savedGroup.id),
      name: option.name,
      price_delta_myr: option.price_delta_myr,
      is_default: option.is_default,
      sort_order: option.sort_order,
      is_active: option.is_active,
    }));

    if (optionRows.length) {
      const { error: optionError } = await supabaseAdmin
        .from('guest_shop_item_options')
        .insert(optionRows);

      if (optionError) throw optionError;
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const includeInactive = req.nextUrl.searchParams.get('include_inactive') === '1';
    const requestedScope = String(req.nextUrl.searchParams.get('scope') || '').trim().toLowerCase();
    let scope: 'all' | 'shop' | 'fnb' =
      requestedScope === 'fnb' ? 'fnb' : requestedScope === 'shop' ? 'shop' : 'all';

    if (includeInactive) {
      const { user, error: authError } = await getDashboardUserFromRequest(req);
      if (authError || !user) {
        return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
      }
      if (!canViewGuestShopAdmin(user)) {
        return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
      }
      if (scope === 'fnb' && !canFullManageGuestShop(user) && !canManageFnbStock(user)) {
        return jsonNoCache({ ok: false, error: 'F&B Menu Admin access denied' }, 403);
      }
      if (!canFullManageGuestShop(user) && canManageFnbStock(user)) {
        scope = 'fnb';
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

    const scopedData = (data || []).filter((row: any) => {
      if (scope === 'fnb') return isFnbItem(row);
      if (scope === 'shop') return !isFnbItem(row);
      return true;
    });

    const groupsByItemId = await loadOptionGroups(scopedData.map((row: any) => String(row.id)));

    return jsonNoCache({
      ok: true,
      scope,
      items: scopedData.map((row: any) => normalizeItem(row, groupsByItemId.get(String(row.id)) || [])),
    });
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
    if (!canFullManageGuestShop(user)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const body = await req.json();
    const payload = normalizeItemPayload(body);
    const { data, error } = await supabaseAdmin
      .from('guest_shop_items')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;
    await replaceOptionGroups(String(data.id), body?.option_groups);
    const groupsByItemId = await loadOptionGroups([String(data.id)]);

    return jsonNoCache({ ok: true, item: normalizeItem(data, groupsByItemId.get(String(data.id)) || []) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create item' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    const canFullManage = canFullManageGuestShop(user);
    const canFnbStock = canManageFnbStock(user);
    if (!canFullManage && !canFnbStock) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) throw new Error('Missing item id');

    if (!canFullManage) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('guest_shop_items')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (existingError) throw existingError;
      if (!existing) throw new Error('Item not found');
      if (existing.is_fnb !== true && String(existing.category || '').trim().toLowerCase() !== 'f&b') {
        return jsonNoCache({ ok: false, error: 'F&B can only update F&B menu stock' }, 403);
      }

      const stock = Number(body?.stock ?? existing.stock ?? 0);
      if (!Number.isFinite(stock) || stock < 0) throw new Error('Stock must be 0 or higher');

      const { data, error } = await supabaseAdmin
        .from('guest_shop_items')
        .update({
          stock: Math.floor(stock),
          out_of_stock: body?.out_of_stock === true || body?.outOfStock === true,
        })
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;
      const groupsByItemId = await loadOptionGroups([String(data.id)]);
      return jsonNoCache({ ok: true, item: normalizeItem(data, groupsByItemId.get(String(data.id)) || []) });
    }

    const payload = normalizeItemPayload(body);
    const { data, error } = await supabaseAdmin
      .from('guest_shop_items')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    await replaceOptionGroups(String(data.id), body?.option_groups);
    const groupsByItemId = await loadOptionGroups([String(data.id)]);

    return jsonNoCache({ ok: true, item: normalizeItem(data, groupsByItemId.get(String(data.id)) || []) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update item' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canFullManageGuestShop(user)) {
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
