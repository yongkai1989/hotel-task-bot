import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

type UpdateBody = {
  user_id?: string;
  email?: string;
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

const profileSelect = `
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
  updated_at
`;

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json({ ok: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'SUPERUSER') {
      return NextResponse.json({ ok: false, error: 'Superuser only' }, { status: 403 });
    }

    const body = (await req.json()) as UpdateBody;
    const targetUserId = String(body.user_id || '').trim();
    const targetEmail = String(body.email || '').trim().toLowerCase();

    if (!targetUserId) {
      return NextResponse.json({ ok: false, error: 'Missing user_id' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const payload = {
      email: targetEmail || null,
      name: String(body.name || '').trim(),
      role: String(body.role || 'FO').trim(),
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
      can_access_admin_settings: toPermissionBoolean(body.can_access_admin_settings),
      can_create_task: toPermissionBoolean(body.can_create_task),
      can_edit_task: toPermissionBoolean(body.can_edit_task),
      can_delete_task: toPermissionBoolean(body.can_delete_task),
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    }

    const { error: writeError } = await (existing
      ? supabase
          .from('user_profiles')
          .update(payload)
          .eq('user_id', targetUserId)
      : supabase
          .from('user_profiles')
          .insert([{ user_id: targetUserId, ...payload }]));

    if (writeError) {
      return NextResponse.json({ ok: false, error: writeError.message }, { status: 500 });
    }

    const { data: freshRow, error: freshError } = await supabase
      .from('user_profiles')
      .select(profileSelect)
      .eq('user_id', targetUserId)
      .single();

    if (freshError) {
      return NextResponse.json({ ok: false, error: freshError.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, user: withPermissions(freshRow) },
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
