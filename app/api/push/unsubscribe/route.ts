import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const { user, error: authError } = await getDashboardUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: authError || 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || '').trim();
  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: 'Push endpoint is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.user_id)
    .eq('endpoint', endpoint);

  return NextResponse.json(
    error ? { ok: false, error: error.message } : { ok: true },
    {
      status: error ? 500 : 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
