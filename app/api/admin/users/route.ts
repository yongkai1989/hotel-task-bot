import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, error: error || 'Unauthorized' },
      { status: 401 }
    );
  }

  if (user.role !== 'MANAGER') {
    return NextResponse.json(
      { ok: false, error: 'Manager only' },
      { status: 403 }
    );
  }

  const { data, error: listError } = await supabaseAdmin
    .from('dashboard_users')
    .select('email, name, role')
    .order('role', { ascending: true })
    .order('name', { ascending: true });

  if (listError) {
    return NextResponse.json(
      { ok: false, error: listError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, users: data || [] });
}
