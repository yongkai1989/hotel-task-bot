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

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function withPermissions(row: any) {
  const permissions = {
    can_access_preventive_maintenance: toPermissionBoolean(row.can_access_preventive_maintenance),
    can_access_maintenance_ot: toPermissionBoolean(row.can_access_maintenance_ot),
    can_access_hk_special_project: toPermissionBoolean(row.can_access_hk_special_project),
    can_access_chambermaid_entry: toPermissionBoolean(row.can_access_chambermaid_entry),
    can_access_supervisor_update: toPermissionBoolean(row.can_access_supervisor_update),
    can_access_laundry_count: toPermissionBoolean(row.can_access_laundry_count),
    can_access_stock_card: toPermissionBoolean(row.can_access_stock_card),
    can_access_damaged: toPermissionBoolean(row.can_access_damaged),
    can_access_linen_history: toPermissionBoolean(row.can_access_linen_history),
    can_access_daily_forms: toPermissionBoolean(row.can_access_daily_forms),
    can_access_management_tasks: toPermissionBoolean(row.can_access_management_tasks),
    can_access_admin_settings: toPermissionBoolean(row.can_access_admin_settings),
    can_create_task: toPermissionBoolean(row.can_create_task),
    can_edit_task: toPermissionBoolean(row.can_edit_task),
    can_delete_task: toPermissionBoolean(row.can_delete_task),
  };

  return { ...row, ...permissions, permissions };
}

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
      can_access_preventive_maintenance: toPermissionBoolean(body.can_access_preventive_maintenance),
      can_access_maintenance_ot: toPermissionBoolean(body.can_access_maintenance_ot),
      can_access_hk_special_project: toPermissionBoolean(body.can_access_hk_special_project),
      can_access_chambermaid_entry: toPermissionBoolean(body.can_access_chambermaid_entry),
      can_access_supervisor_update: toPermissionBoolean(body.can_access_supervisor_update),
      can_access_laundry_count: toPermissionBoolean(body.can_access_laundry_count),
      can_access_stock_card: toPermissionBoolean(body.can_access_stock_card),
      can_access_damaged: toPermissionBoolean(body.can_access_damaged),
      can_access_linen_history: toPermissionBoolean(body.can_access_linen_history),
      can_access_daily_forms: toPermissionBoolean(body.can_access_daily_forms),
      can_access_management_tasks: toPermissionBoolean(body.can_access_management_tasks),
      can_access_admin_settings:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_admin_settings),
      can_create_task: toPermissionBoolean(body.can_create_task),
      can_edit_task: toPermissionBoolean(body.can_edit_task),
      can_delete_task: toPermissionBoolean(body.can_delete_task),
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
      { ok: true, user_id: created.user.id, user: withPermissions(profile) },
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
