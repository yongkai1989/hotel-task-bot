import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

type CreateBody = {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
  can_access_preventive_maintenance?: boolean;
  can_access_maintenance_ot?: boolean;
  can_access_hk_special_project?: boolean;
  can_access_chambermaid_entry?: boolean;
  can_access_supervisor_update?: boolean;
  can_access_laundry_count?: boolean;
  can_access_stock_card?: boolean;
  can_access_damaged?: boolean;
  can_access_linen_history?: boolean;
  can_access_daily_forms?: boolean;
  can_access_management_tasks?: boolean;
  can_access_admin_settings?: boolean;
  can_create_task?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json({ ok: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'SUPERUSER') {
      return NextResponse.json({ ok: false, error: 'Superuser only' }, { status: 403 });
    }

    const body = (await req.json()) as CreateBody;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const name = String(body.name || '').trim();
    const role = String(body.role || 'FO').trim();

    if (!name) {
      return NextResponse.json({ ok: false, error: 'Missing name' }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      });

    if (createError || !created.user?.id) {
      return NextResponse.json(
        { ok: false, error: createError?.message || 'Failed to create auth user' },
        { status: 500 }
      );
    }

    const payload = {
      user_id: created.user.id,
      email,
      name,
      role,
      can_access_preventive_maintenance: !!body.can_access_preventive_maintenance,
      can_access_maintenance_ot: !!body.can_access_maintenance_ot,
      can_access_hk_special_project: !!body.can_access_hk_special_project,
      can_access_chambermaid_entry: !!body.can_access_chambermaid_entry,
      can_access_supervisor_update: !!body.can_access_supervisor_update,
      can_access_laundry_count: !!body.can_access_laundry_count,
      can_access_stock_card: !!body.can_access_stock_card,
      can_access_damaged: !!body.can_access_damaged,
      can_access_linen_history: !!body.can_access_linen_history,
      can_access_daily_forms: !!body.can_access_daily_forms,
      can_access_management_tasks: !!body.can_access_management_tasks,
      can_access_admin_settings: role === 'SUPERUSER' || !!body.can_access_admin_settings,
      can_create_task: !!body.can_create_task,
      can_edit_task: !!body.can_edit_task,
      can_delete_task: !!body.can_delete_task,
      updated_at: new Date().toISOString(),
    };

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .upsert([payload], { onConflict: 'user_id' })
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
      .single();

    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, user_id: created.user.id, user: profile },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
