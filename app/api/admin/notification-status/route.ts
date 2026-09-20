import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 15;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}

function deviceLabel(userAgent: unknown) {
  const value = String(userAgent || '').toLowerCase();
  if (!value) return 'Unknown device';
  const browser = value.includes('samsungbrowser')
    ? 'Samsung Internet'
    : value.includes('edg/')
      ? 'Microsoft Edge'
      : value.includes('firefox/')
        ? 'Firefox'
        : value.includes('chrome/')
          ? 'Chrome'
          : value.includes('safari/')
            ? 'Safari'
            : 'Browser';
  const device = value.includes('android')
    ? 'Android'
    : value.includes('iphone') || value.includes('ipad')
      ? 'iPhone/iPad'
      : value.includes('windows')
        ? 'Windows'
        : value.includes('macintosh')
          ? 'Mac'
          : 'Device';
  return `${browser} · ${device}`;
}

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (!user) return response({ ok: false, error: error || 'Unauthorized' }, 401);
    if (user.role !== 'SUPERUSER' && user.role !== 'MANAGER') {
      return response({ ok: false, error: 'Manager access required' }, 403);
    }

    const [profilesResult, subscriptionsResult] = await Promise.all([
      supabaseAdmin
        .from('user_profiles')
        .select('user_id, email, name, role, created_at')
        .order('name', { ascending: true })
        .abortSignal(AbortSignal.timeout(6_000)),
      supabaseAdmin
        .from('push_subscriptions')
        .select('user_id, active, user_agent, department_filter, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .abortSignal(AbortSignal.timeout(6_000)),
    ]);

    if (profilesResult.error) return response({ ok: false, error: profilesResult.error.message }, 500);
    if (subscriptionsResult.error) return response({ ok: false, error: subscriptionsResult.error.message }, 500);

    const subscriptionsByUser = new Map<string, any[]>();
    for (const subscription of subscriptionsResult.data || []) {
      const userId = String(subscription.user_id || '');
      if (!userId) continue;
      subscriptionsByUser.set(userId, [
        ...(subscriptionsByUser.get(userId) || []),
        subscription,
      ]);
    }

    const users = (profilesResult.data || []).map((profile) => {
      const subscriptions = subscriptionsByUser.get(String(profile.user_id)) || [];
      const activeSubscriptions = subscriptions.filter((item) => item.active === true);
      const deviceRows = activeSubscriptions.length ? activeSubscriptions : subscriptions.slice(0, 1);
      const devices = Array.from(new Set(deviceRows.map((item) => deviceLabel(item.user_agent))));
      const departments = Array.from(new Set(
        activeSubscriptions.flatMap((item) => Array.isArray(item.department_filter) ? item.department_filter : [])
      ));
      return {
        user_id: profile.user_id,
        email: profile.email || '',
        name: profile.name || profile.email || 'Unnamed user',
        role: profile.role,
        alerts_enabled: activeSubscriptions.length > 0,
        active_devices: activeSubscriptions.length,
        devices,
        departments,
        last_updated_at: subscriptions[0]?.updated_at || null,
      };
    });

    return response({
      ok: true,
      captured_at: new Date().toISOString(),
      summary: {
        total: users.length,
        enabled: users.filter((item) => item.alerts_enabled).length,
        disabled: users.filter((item) => !item.alerts_enabled).length,
      },
      users,
    });
  } catch (error: any) {
    return response({ ok: false, error: error?.message || 'Unable to load notification status' }, 500);
  }
}
