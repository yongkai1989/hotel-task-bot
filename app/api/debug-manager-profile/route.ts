import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const userId = 'd6643ce3-561a-4574-9e66-3fc34b27bca0';

  const { data, error } = await supabase
    .from('user_profiles')
    .select(`
      user_id,
      email,
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
      can_access_linen_admin,
      updated_at
    `)
    .eq('user_id', userId)
    .single();

  return NextResponse.json({
    ok: !error,
    error: error?.message || null,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    managerProfile: data,
  });
}
