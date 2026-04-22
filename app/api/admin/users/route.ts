import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeProfileRow(row: any) {
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

  return {
    user_id: String(row.user_id || ''),
    email: String(row.email || '').toLowerCase(),
    name: String(row.name || ''),
    role: String(row.role || 'FO'),
    ...permissions,
    permissions,
    updated_at: row.updated_at || null,
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

    const { data: profiles, error: usersError } = await supabase
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
        can_delete_task,
        updated_at
      `)
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    if (usersError) {
      return NextResponse.json(
        { ok: false, error: usersError.message },
        { status: 500 }
      );
    }

    const { data: authUsers, error: authUsersError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

    if (authUsersError) {
      return NextResponse.json(
        { ok: false, error: authUsersError.message },
        { status: 500 }
      );
    }

    const profilesByUserId = new Map<string, any>();

    for (const profile of profiles || []) {
      const existing = profilesByUserId.get(profile.user_id);
      const existingTime = existing?.updated_at ? Date.parse(existing.updated_at) : 0;
      const profileTime = profile.updated_at ? Date.parse(profile.updated_at) : 0;

      if (!existing || profileTime >= existingTime) {
        profilesByUserId.set(profile.user_id, profile);
      }
    }

    const profileRows = [...profilesByUserId.values()].map(normalizeProfileRow);
    const missingProfileRows = (authUsers?.users || [])
      .filter((authUser) => !profilesByUserId.has(authUser.id))
      .map((authUser) => ({
        user_id: authUser.id,
        email: authUser.email || '',
        name:
          String(authUser.user_metadata?.name || '').trim() ||
          authUser.email ||
          'User',
        role: 'FO',
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
        permissions: {
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
        },
      }));

    const users = [...profileRows, ...missingProfileRows].sort((a, b) => {
      const roleCompare = String(a.role || '').localeCompare(String(b.role || ''));
      if (roleCompare !== 0) return roleCompare;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    return NextResponse.json(
      {
        ok: true,
        users,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
