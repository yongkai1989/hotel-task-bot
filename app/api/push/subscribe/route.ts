import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function response(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function validSubscription(value: any) {
  const endpoint = String(value?.endpoint || '').trim();
  const p256dh = String(value?.keys?.p256dh || '').trim();
  const auth = String(value?.keys?.auth || '').trim();
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime:
      typeof value?.expirationTime === 'number' ? value.expirationTime : null,
    keys: { p256dh, auth },
  };
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await getDashboardUserFromRequest(req);
  if (!user) return response({ ok: false, error: authError || 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const subscription = validSubscription(body?.subscription);
  if (!subscription) {
    return response({ ok: false, error: 'Invalid browser push subscription' }, 400);
  }

  const userAgent = String(req.headers.get('user-agent') || '').slice(0, 500) || null;
  const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
    {
      user_id: user.user_id,
      email: String(user.email || '').trim().toLowerCase(),
      endpoint: subscription.endpoint,
      subscription,
      user_agent: userAgent,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );

  if (error) return response({ ok: false, error: error.message }, 500);
  return response({ ok: true });
}
