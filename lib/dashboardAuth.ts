import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export type DashboardRole =
  | 'SUPERUSER'
  | 'MANAGER'
  | 'SUPERVISOR'
  | 'FO'
  | 'HK'
  | 'MT';

export type DashboardUser = {
  user_id: string;
  email: string;
  name: string;
  role: DashboardRole;
  can_create_task: boolean;
  can_edit_task: boolean;
  can_delete_task: boolean;
  can_access_preventive_maintenance: boolean;
  can_access_maintenance_ot: boolean;
  can_access_hk_special_project: boolean;
  can_access_chambermaid_entry: boolean;
  can_access_supervisor_update: boolean;
  can_access_laundry_count: boolean;
  can_access_stock_card: boolean;
  can_access_damaged: boolean;
  can_access_linen_history: boolean;
  can_access_daily_forms: boolean;
  can_access_management_tasks: boolean;
  can_access_admin_settings: boolean;
  can_access_linen_admin: boolean;
  permissions: {
    can_create_task: boolean;
    can_edit_task: boolean;
    can_delete_task: boolean;
    can_access_preventive_maintenance: boolean;
    can_access_maintenance_ot: boolean;
    can_access_hk_special_project: boolean;
    can_access_chambermaid_entry: boolean;
    can_access_supervisor_update: boolean;
    can_access_laundry_count: boolean;
    can_access_stock_card: boolean;
    can_access_damaged: boolean;
    can_access_linen_history: boolean;
    can_access_daily_forms: boolean;
    can_access_management_tasks: boolean;
    can_access_admin_settings: boolean;
    can_access_linen_admin: boolean;
  };
};

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function savedBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function effectiveBoolean(role: DashboardRole, value: unknown) {
  return role === 'SUPERUSER' || savedBoolean(value);
}

export async function getDashboardUserFromRequest(
  req: NextRequest
): Promise<{ user: DashboardUser | null; error: string | null }> {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return { user: null, error: 'Missing authorization token' };
    }

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user: authUser },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !authUser?.id || !authUser?.email) {
      return { user: null, error: 'Invalid session' };
    }

    const profileClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error: profileError } = await profileClient
      .from('user_profiles')
      .select(
        `
        user_id,
        email,
        name,
        role,
        can_create_task,
        can_edit_task,
        can_delete_task,
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
        can_access_linen_admin
        `
      )
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      return { user: null, error: profileError.message };
    }

    if (!profile) {
      return { user: null, error: 'User profile not found' };
    }

    const role = profile.role as DashboardRole;
    const permissions = {
      can_create_task: effectiveBoolean(role, profile.can_create_task),
      can_edit_task: effectiveBoolean(role, profile.can_edit_task),
      can_delete_task: effectiveBoolean(role, profile.can_delete_task),
      can_access_preventive_maintenance:
        effectiveBoolean(role, profile.can_access_preventive_maintenance),
      can_access_maintenance_ot:
        effectiveBoolean(role, profile.can_access_maintenance_ot),
      can_access_hk_special_project:
        effectiveBoolean(role, profile.can_access_hk_special_project),
      can_access_chambermaid_entry:
        effectiveBoolean(role, profile.can_access_chambermaid_entry),
      can_access_supervisor_update:
        effectiveBoolean(role, profile.can_access_supervisor_update),
      can_access_laundry_count:
        effectiveBoolean(role, profile.can_access_laundry_count),
      can_access_stock_card:
        effectiveBoolean(role, profile.can_access_stock_card),
      can_access_damaged:
        effectiveBoolean(role, profile.can_access_damaged),
      can_access_linen_history:
        effectiveBoolean(role, profile.can_access_linen_history),
      can_access_daily_forms:
        effectiveBoolean(role, profile.can_access_daily_forms),
      can_access_management_tasks:
        effectiveBoolean(role, profile.can_access_management_tasks),
      can_access_admin_settings:
        effectiveBoolean(role, profile.can_access_admin_settings),
      can_access_linen_admin:
        effectiveBoolean(role, profile.can_access_linen_admin),
    };

    return {
      user: {
        user_id: profile.user_id,
        email: profile.email || authUser.email,
        name: profile.name || authUser.email || 'User',
        role,
        ...permissions,
        permissions,
      },
      error: null,
    };
  } catch (error: any) {
    return { user: null, error: error?.message || 'Auth error' };
  }
}
