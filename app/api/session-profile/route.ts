import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select(`
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
        can_delete_task
      `)
      .eq('user_id', session.user.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: 'Profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, user: data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || 'Server error' },
      { status: 500 }
    );
  }
}
