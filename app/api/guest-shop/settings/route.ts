import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DEFAULT_SETTINGS = {
  id: 'main',
  hero_image_url: '',
  hero_kicker: 'Private in-room collection',
  hero_kicker_ms: '',
  hero_kicker_zh: '',
  hero_title: 'Quiet luxuries, ready on request.',
  hero_title_ms: '',
  hero_title_zh: '',
  hero_body:
    'Order selected comforts, guest essentials, and hotel services from your room. Prepared by the team after verified payment.',
  hero_body_ms: '',
  hero_body_zh: '',
  featured_item_id: null,
};

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

function rejectEmbeddedImageUrl(value: string, label: string) {
  if (value.startsWith('data:') || value.length > 2000) {
    throw new Error(`${label} must be uploaded first or saved as a normal hosted image URL`);
  }
}

function safeHeroImageUrl(value: unknown) {
  const imageUrl = String(value || '').trim();
  return imageUrl.startsWith('data:') || imageUrl.length > 2000 ? '' : imageUrl;
}

function normalizeSettings(row: any) {
  return {
    id: String(row?.id || 'main'),
    hero_image_url: safeHeroImageUrl(row?.hero_image_url || DEFAULT_SETTINGS.hero_image_url),
    hero_kicker: String(row?.hero_kicker || DEFAULT_SETTINGS.hero_kicker),
    hero_kicker_ms: String(row?.hero_kicker_ms || ''),
    hero_kicker_zh: String(row?.hero_kicker_zh || ''),
    hero_title: String(row?.hero_title || DEFAULT_SETTINGS.hero_title),
    hero_title_ms: String(row?.hero_title_ms || ''),
    hero_title_zh: String(row?.hero_title_zh || ''),
    hero_body: String(row?.hero_body || DEFAULT_SETTINGS.hero_body),
    hero_body_ms: String(row?.hero_body_ms || ''),
    hero_body_zh: String(row?.hero_body_zh || ''),
    featured_item_id: row?.featured_item_id ? String(row.featured_item_id) : null,
    updated_at: row?.updated_at || null,
  };
}

function normalizeSettingsPayload(body: any) {
  const heroImageUrl = String(body?.hero_image_url ?? body?.heroImageUrl ?? '').trim();
  const heroKicker = String(body?.hero_kicker ?? body?.heroKicker ?? '').trim();
  const heroKickerMs = String(body?.hero_kicker_ms ?? body?.heroKickerMs ?? '').trim();
  const heroKickerZh = String(body?.hero_kicker_zh ?? body?.heroKickerZh ?? '').trim();
  const heroTitle = String(body?.hero_title ?? body?.heroTitle ?? '').trim();
  const heroTitleMs = String(body?.hero_title_ms ?? body?.heroTitleMs ?? '').trim();
  const heroTitleZh = String(body?.hero_title_zh ?? body?.heroTitleZh ?? '').trim();
  const heroBody = String(body?.hero_body ?? body?.heroBody ?? '').trim();
  const heroBodyMs = String(body?.hero_body_ms ?? body?.heroBodyMs ?? '').trim();
  const heroBodyZh = String(body?.hero_body_zh ?? body?.heroBodyZh ?? '').trim();
  const featuredItemId = String(body?.featured_item_id ?? body?.featuredItemId ?? '').trim();

  if (!heroTitle) throw new Error('Hero title is required');
  if (heroImageUrl) rejectEmbeddedImageUrl(heroImageUrl, 'Hero image URL');

  return {
    id: 'main',
    hero_image_url: heroImageUrl,
    hero_kicker: heroKicker || DEFAULT_SETTINGS.hero_kicker,
    hero_kicker_ms: heroKickerMs || null,
    hero_kicker_zh: heroKickerZh || null,
    hero_title: heroTitle,
    hero_title_ms: heroTitleMs || null,
    hero_title_zh: heroTitleZh || null,
    hero_body: heroBody || DEFAULT_SETTINGS.hero_body,
    hero_body_ms: heroBodyMs || null,
    hero_body_zh: heroBodyZh || null,
    featured_item_id: featuredItemId || null,
  };
}

async function requireManager(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { error: error || 'Unauthorized', status: 401 };
  if (!canFullManageGuestShop(user)) return { error: 'Guest Shop Admin access denied', status: 403 };
  return { error: '', status: 200 };
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('guest_shop_settings')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (error) throw error;

    return jsonNoCache({ ok: true, settings: normalizeSettings(data || DEFAULT_SETTINGS) });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load guest shop settings', settings: DEFAULT_SETTINGS },
      500
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const payload = normalizeSettingsPayload(await req.json());
    const { data, error } = await supabaseAdmin
      .from('guest_shop_settings')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) throw error;

    return jsonNoCache({ ok: true, settings: normalizeSettings(data) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update settings' }, 500);
  }
}
