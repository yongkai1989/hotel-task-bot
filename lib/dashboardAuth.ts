import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin';

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
};

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
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

    const { data: profile, error: profileError } = await supabaseAdmin
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

    return {
      user: {
        user_id: profile.user_id,
        email: profile.email || authUser.email,
        name: profile.name || authUser.email || 'User',
        role: profile.role as DashboardRole,
        can_create_task: profile.role === 'SUPERUSER' || profile.can_create_task === true,
        can_edit_task: profile.role === 'SUPERUSER' || profile.can_edit_task === true,
        can_delete_task: profile.role === 'SUPERUSER' || profile.can_delete_task === true,
        can_access_preventive_maintenance:
          profile.role === 'SUPERUSER' ||
          profile.can_access_preventive_maintenance === true,
        can_access_maintenance_ot:
          profile.role === 'SUPERUSER' ||
          profile.can_access_maintenance_ot === true,
        can_access_hk_special_project:
          profile.role === 'SUPERUSER' ||
          profile.can_access_hk_special_project === true,
        can_access_chambermaid_entry:
          profile.role === 'SUPERUSER' ||
          profile.can_access_chambermaid_entry === true,
        can_access_supervisor_update:
          profile.role === 'SUPERUSER' ||
          profile.can_access_supervisor_update === true,
        can_access_laundry_count:
          profile.role === 'SUPERUSER' ||
          profile.can_access_laundry_count === true,
        can_access_stock_card:
          profile.role === 'SUPERUSER' ||
          profile.can_access_stock_card === true,
        can_access_damaged:
          profile.role === 'SUPERUSER' ||
          profile.can_access_damaged === true,
        can_access_linen_history:
          profile.role === 'SUPERUSER' ||
          profile.can_access_linen_history === true,
        can_access_daily_forms:
          profile.role === 'SUPERUSER' ||
          profile.can_access_daily_forms === true,
        can_access_management_tasks:
          profile.role === 'SUPERUSER' ||
          profile.can_access_management_tasks === true,
        can_access_admin_settings:
          profile.role === 'SUPERUSER' ||
          profile.can_access_admin_settings === true,
        can_access_linen_admin:
          profile.role === 'SUPERUSER' ||
          profile.can_access_linen_admin === true ||
          profile.can_access_supervisor_update === true ||
          profile.can_access_laundry_count === true ||
          profile.can_access_stock_card === true ||
          profile.can_access_damaged === true ||
          profile.can_access_linen_history === true,
      },
      error: null,
    };
  } catch (error: any) {
    return { user: null, error: error?.message || 'Auth error' };
  }
}
