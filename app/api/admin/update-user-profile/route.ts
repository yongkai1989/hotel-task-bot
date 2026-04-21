import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const {
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

    if (!email) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 });
    }

    const { error } = await supabase
      .from('user_profiles')
      .update({
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
        updated_at: new Date().toISOString(),
      })
      .eq('email', email);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
