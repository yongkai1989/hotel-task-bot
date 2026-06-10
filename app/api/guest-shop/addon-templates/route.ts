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
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com';
}

function normalizeTemplate(row: any) {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    selection_type: String(row?.selection_type || 'single') === 'multiple' ? 'multiple' : 'single',
    is_required: row?.is_required === true,
    min_select: Math.max(0, Number(row?.min_select || 0)),
    max_select: Math.max(0, Number(row?.max_select || 1)),
    sort_order: Number(row?.sort_order || 0),
    is_active: row?.is_active !== false,
    options: Array.isArray(row?.options_json) ? row.options_json : [],
  };
}

function normalizePayload(body: any) {
  const name = String(body?.name || '').trim();
  const selectionType = String(body?.selection_type || 'single') === 'multiple' ? 'multiple' : 'single';
  const options = Array.isArray(body?.options) ? body.options : [];
  const sortOrder = Number(body?.sort_order ?? 0);

  if (!name) throw new Error('Add-on template name is required');

  return {
    name,
    selection_type: selectionType,
    is_required: body?.is_required === true,
    min_select: Math.max(0, Math.floor(Number(body?.min_select || 0))),
    max_select: selectionType === 'single'
      ? 1
      : Math.max(1, Math.floor(Number(body?.max_select || 5))),
    sort_order: Number.isFinite(sortOrder) ? Math.floor(sortOrder) : 0,
    is_active: body?.is_active === undefined ? true : body.is_active === true,
    options_json: options
      .map((option: any, index: number) => {
        const optionName = String(option?.name || '').trim();
        const priceDelta = Number(option?.price_delta_myr ?? 0);
        return {
          id: option?.id ? String(option.id) : `option-${index + 1}`,
          name: optionName,
          price_delta_myr: Number.isFinite(priceDelta) ? Math.round(priceDelta * 100) / 100 : 0,
          is_default: option?.is_default === true,
        };
      })
      .filter((option: any) => option.name),
  };
}

async function requireManager(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { error: error || 'Unauthorized', status: 401 };
  if (!canFullManageGuestShop(user)) return { error: 'Guest Shop Admin access denied', status: 403 };
  return { error: '', status: 200 };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error, templates: [] }, auth.status);

    const { data, error } = await supabaseAdmin
      .from('guest_shop_addon_templates')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;

    return jsonNoCache({ ok: true, templates: (data || []).map(normalizeTemplate) });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load add-on templates', templates: [] },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const payload = normalizePayload(await req.json());
    const { data, error } = await supabaseAdmin
      .from('guest_shop_addon_templates')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, template: normalizeTemplate(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to create add-on template' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) throw new Error('Missing add-on template id');

    const payload = normalizePayload(body);
    const { data, error } = await supabaseAdmin
      .from('guest_shop_addon_templates')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, template: normalizeTemplate(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update add-on template' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const id = String(req.nextUrl.searchParams.get('id') || '').trim();
    if (!id) throw new Error('Missing add-on template id');

    const { error } = await supabaseAdmin
      .from('guest_shop_addon_templates')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to delete add-on template' }, 500);
  }
}
