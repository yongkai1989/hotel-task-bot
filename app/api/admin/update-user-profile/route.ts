import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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

    const body = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const {
      user_id,
      email,
      name,
      role,
      can_access_preventive_maintenance,
      can_access_maintenance_ot,
      can_access_hk_special_project,
      can_access_chambermaid_entry,
      can_access_supervisor_update,
      can_access_laundry_count,
      can_access_stock_card,
      can_access_damaged,
      can_access_linen_history,
      can_access_daily_forms,
      can_access_management_tasks,
      can_access_admin_settings,
      can_create_task,
      can_edit_task,
      can_delete_task,
    } = body;

    if (!user_id && !email) {
      return NextResponse.json(
        { ok: false, error: 'Missing user_id or email' },
        { status: 400 }
      );
    }

    const payload = {
      name,
      role,
      can_access_preventive_maintenance: !!can_access_preventive_maintenance,
      can_access_maintenance_ot: !!can_access_maintenance_ot,
      can_access_hk_special_project: !!can_access_hk_special_project,
      can_access_chambermaid_entry: !!can_access_chambermaid_entry,
      can_access_supervisor_update: !!can_access_supervisor_update,
      can_access_laundry_count: !!can_access_laundry_count,
      can_access_stock_card: !!can_access_stock_card,
      can_access_damaged: !!can_access_damaged,
      can_access_linen_history: !!can_access_linen_history,
      can_access_daily_forms: !!can_access_daily_forms,
      can_access_management_tasks: !!can_access_management_tasks,
      can_access_admin_settings: !!can_access_admin_settings,
      can_create_task: !!can_create_task,
      can_edit_task: !!can_edit_task,
      can_delete_task: !!can_delete_task,
      updated_at: new Date().toISOString(),
    };

    let query = supabase.from('user_profiles').update(payload);

    if (user_id) {
      query = query.eq('user_id', user_id);
    } else {
      query = query.eq('email', String(email).trim().toLowerCase());
    }

    const { data, error: updateError } = await query.select('user_id').limit(1);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No matching user profile found to update' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, updated_user_id: data[0].user_id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
