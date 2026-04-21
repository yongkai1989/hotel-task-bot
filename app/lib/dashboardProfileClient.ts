'use client';

import { createBrowserSupabaseClient } from './supabaseBrowser';

export type DashboardProfile = {
  user_id: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
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
  can_create_task: boolean;
  can_edit_task: boolean;
  can_delete_task: boolean;
};

export function getEffectiveProfile(profile: DashboardProfile): DashboardProfile {
  const isSuper = profile.role === 'SUPERUSER';
  const isManager = profile.role === 'MANAGER';
  const isSupervisor = profile.role === 'SUPERVISOR';
  const isMt = profile.role === 'MT';

  return {
    ...profile,
    can_access_preventive_maintenance:
      isSuper || isManager || isMt || profile.can_access_preventive_maintenance,
    can_access_maintenance_ot:
      isSuper || isManager || isMt || profile.can_access_maintenance_ot,
    can_access_hk_special_project:
      isSuper || isManager || profile.can_access_hk_special_project,
    can_access_chambermaid_entry:
      isSuper || isManager || isSupervisor || profile.can_access_chambermaid_entry,
    can_access_supervisor_update:
      isSuper || isManager || isSupervisor || profile.can_access_supervisor_update,
    can_access_laundry_count:
      isSuper || isManager || isSupervisor || profile.can_access_laundry_count,
    can_access_stock_card:
      isSuper || isManager || isSupervisor || profile.can_access_stock_card,
    can_access_damaged:
      isSuper || isManager || isSupervisor || profile.can_access_damaged,
    can_access_linen_history:
      isSuper || isManager || isSupervisor || profile.can_access_linen_history,
    can_access_daily_forms:
      isSuper || isManager || profile.can_access_daily_forms,
    can_access_management_tasks:
      isSuper || isManager || profile.can_access_management_tasks,
    can_access_admin_settings:
      isSuper || profile.can_access_admin_settings,
    can_create_task:
      isSuper || profile.can_create_task,
    can_edit_task:
      isSuper || profile.can_edit_task,
    can_delete_task:
      isSuper || profile.can_delete_task,
  };
}

export async function loadDashboardProfileClient(): Promise<DashboardProfile | null> {
  const supabase = createBrowserSupabaseClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return null;

  const { data } = await supabase
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

  return data;
}
