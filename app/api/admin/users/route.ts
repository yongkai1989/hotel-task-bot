import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

function emptyPermissions() {
  return {
    can_access_preventive_maintenance: false,
    can_access_maintenance_ot: false,
    can_access_hk_special_project: false,
    can_access_chambermaid_entry: false,
    can_access_supervisor_update: false,
    can_access_laundry_count: false,
    can_access_stock_card: false,
    can_access_damaged: false,
    can_access_linen_history: false,
    can_access_daily_forms: false,
    can_access_management_tasks: false,
    can_access_admin_settings: false,
    can_create_task: false,
    can_edit_task: false,
    can_delete_task: false,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: error || 'Unauthorized' },
        { status: 401 }
      );
    }

    if (user.role !== 'SUPERUSER') {
      return NextResponse.json(
        { ok: false, error: 'Superuser only' },
        { status: 403 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error: usersError } = await supabase
      .from('user_profiles')
      .select('*')
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    if (usersError) {
      return NextResponse.json(
        { ok: false, error: usersError.message },
        { status: 500 }
      );
    }

    const users = (data || []).map((row: any) => ({
      ...emptyPermissions(),
      ...row,
    }));

    return NextResponse.json({ ok: true, users });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
