import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);

  if (!user) {
    return NextResponse.json(
      { ok: false, error: error || 'Unauthorized' },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true, user });
  console.log('API USER', user);
}
