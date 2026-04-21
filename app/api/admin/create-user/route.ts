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
      password,
      name,
      role,
      can_access_preventive_maintenance = false,
      can_access_maintenance_ot = false,
      can_access_hk_special_project = false,
      can_access_chambermaid_entry = false,
      can_access_supervisor_update = false,
      can_access_laundry_count = false,
      can_access_stock_card = false,
      can_access_damaged = false,
      can_access_linen_history = false,
      can_access_daily_forms = false,
      can_access_management_tasks = false,
      can_access_admin_settings = false,
      can_create_task = false,
      can_edit_task = false,
      can_delete_task = false,
    } = body;

    if (!email || !password || !name || !role) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { data: createdUser, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
          role,
        },
      });

    if (createError || !createdUser?.user) {
      return NextResponse.json(
        { ok: false, error: createError?.message || 'Failed to create user' },
        { status: 500 }
      );
    }

    const userId = createdUser.user.id;

    const { error: profileError } = await supabase.from('user_profiles').insert([
      {
        user_id: userId,
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
      },
    ]);

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);

      return NextResponse.json(
        { ok: false, error: profileError.message || 'Failed to create profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      email,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
