import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';

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
  can_update_task_status: boolean;
  can_edit_task: boolean;
  can_delete_task: boolean;
  can_access_preventive_maintenance: boolean;
  can_access_maintenance_manager_room_check: boolean;
  can_access_maintenance_ot: boolean;
  can_access_maintenance_stock_card: boolean;
  can_access_maintenance_damaged: boolean;
  can_access_hk_schedule: boolean;
  can_access_hk_special_project: boolean;
  can_access_hk_manager_room_check: boolean;
  can_access_chambermaid_entry: boolean;
  can_access_supervisor_update: boolean;
  can_access_laundry_count: boolean;
  can_access_laundry_received: boolean;
  can_access_stock_card: boolean;
  can_access_damaged: boolean;
  can_access_linen_history: boolean;
  can_access_daily_forms: boolean;
  can_access_management_tasks: boolean;
  can_access_online_purchasing: boolean;
  can_access_daily_operations_summary: boolean;
  can_access_bank_in_cash: boolean;
  can_access_commission_checker: boolean;
  can_access_admin_settings: boolean;
  can_access_guest_shop_admin: boolean;
  can_access_linen_admin: boolean;
  can_access_lost_found: boolean;
  can_access_fo_checklist: boolean;
  can_access_fo_quick_actions: boolean;
  can_access_fo_schedule: boolean;
  can_access_supervisor_checklist: boolean;
  can_access_price_guide: boolean;
  can_access_guest_laundry: boolean;
  can_access_fnb_checklist: boolean;
  can_access_fnb_menu_admin: boolean;
  can_access_fnb_orders: boolean;
  can_access_guest_shop_orders: boolean;
  can_access_breakfast_vouchers: boolean;
  can_access_staff_meal: boolean;
  can_access_pa_checklist: boolean;
  can_access_pa_linen_entry: boolean;
  permissions: {
    can_create_task: boolean;
    can_update_task_status: boolean;
    can_edit_task: boolean;
    can_delete_task: boolean;
    can_access_preventive_maintenance: boolean;
    can_access_maintenance_manager_room_check: boolean;
    can_access_maintenance_ot: boolean;
    can_access_maintenance_stock_card: boolean;
    can_access_maintenance_damaged: boolean;
    can_access_hk_schedule: boolean;
    can_access_hk_special_project: boolean;
    can_access_hk_manager_room_check: boolean;
    can_access_chambermaid_entry: boolean;
    can_access_supervisor_update: boolean;
    can_access_laundry_count: boolean;
    can_access_laundry_received: boolean;
    can_access_stock_card: boolean;
    can_access_damaged: boolean;
    can_access_linen_history: boolean;
    can_access_daily_forms: boolean;
    can_access_management_tasks: boolean;
    can_access_online_purchasing: boolean;
    can_access_daily_operations_summary: boolean;
    can_access_bank_in_cash: boolean;
    can_access_commission_checker: boolean;
    can_access_admin_settings: boolean;
    can_access_guest_shop_admin: boolean;
    can_access_linen_admin: boolean;
    can_access_lost_found: boolean;
    can_access_fo_checklist: boolean;
    can_access_fo_quick_actions: boolean;
    can_access_fo_schedule: boolean;
    can_access_supervisor_checklist: boolean;
    can_access_price_guide: boolean;
    can_access_guest_laundry: boolean;
    can_access_fnb_checklist: boolean;
    can_access_fnb_menu_admin: boolean;
    can_access_fnb_orders: boolean;
  can_access_guest_shop_orders: boolean;
    can_access_breakfast_vouchers: boolean;
    can_access_staff_meal: boolean;
    can_access_pa_checklist: boolean;
    can_access_pa_linen_entry: boolean;
  };
};

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function tokenFromStoredSession(rawValue: string) {
  try {
    let value = decodeURIComponent(rawValue);
    if (value.startsWith('base64-')) {
      const encoded = value.slice(7).replace(/-/g, '+').replace(/_/g, '/');
      value = Buffer.from(encoded, 'base64').toString('utf8');
    }

    if (value.split('.').length === 3) return value;

    const parsed = JSON.parse(value);
    if (typeof parsed?.access_token === 'string') return parsed.access_token;
    if (typeof parsed?.currentSession?.access_token === 'string') {
      return parsed.currentSession.access_token;
    }
    if (Array.isArray(parsed)) {
      const jwt = parsed.find(
        (item) => typeof item === 'string' && item.split('.').length === 3
      );
      return typeof jwt === 'string' ? jwt : '';
    }
  } catch {}
  return '';
}

export function getRequestAccessToken(req: NextRequest) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) return bearerToken;

  const authCookies = req.cookies
    .getAll()
    .filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name));
  const cookieBases = Array.from(
    new Set(authCookies.map((cookie) => cookie.name.replace(/\.\d+$/, '')))
  );

  for (const baseName of cookieBases) {
    const value = authCookies
      .filter((cookie) => cookie.name === baseName || cookie.name.startsWith(`${baseName}.`))
      .sort((a, b) => {
        const aPart = Number(a.name.match(/\.(\d+)$/)?.[1] || 0);
        const bPart = Number(b.name.match(/\.(\d+)$/)?.[1] || 0);
        return aPart - bPart;
      })
      .map((cookie) => cookie.value)
      .join('');
    const cookieToken = tokenFromStoredSession(value);
    if (cookieToken) return cookieToken;
  }

  return '';
}

function savedBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function effectiveBoolean(role: DashboardRole, value: unknown) {
  return role === 'SUPERUSER' || savedBoolean(value);
}

function effectiveFoChecklist(role: DashboardRole, email: unknown, value: unknown) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return (
    role === 'SUPERUSER' ||
    (
      savedBoolean(value) &&
      (
        role === 'FO' ||
        normalizedEmail === 'walter@hotelhallmark.com' ||
        normalizedEmail === 'fenny@hotelhallmark.com'
      )
    )
  );
}

export async function getDashboardUserFromRequest(
  req: NextRequest
): Promise<{ user: DashboardUser | null; error: string | null }> {
  try {
    const token = getRequestAccessToken(req);

    if (!token) {
      return { user: null, error: 'Missing Supabase session' };
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
        can_update_task_status,
        can_edit_task,
        can_delete_task,
        can_access_preventive_maintenance,
        can_access_maintenance_manager_room_check,
        can_access_maintenance_ot,
        can_access_maintenance_stock_card,
        can_access_maintenance_damaged,
        can_access_hk_schedule,
        can_access_hk_special_project,
        can_access_hk_manager_room_check,
        can_access_chambermaid_entry,
        can_access_supervisor_update,
        can_access_laundry_count,
        can_access_laundry_received,
        can_access_stock_card,
        can_access_damaged,
        can_access_linen_history,
        can_access_daily_forms,
        can_access_management_tasks,
        can_access_online_purchasing,
        can_access_daily_operations_summary,
        can_access_bank_in_cash,
        can_access_commission_checker,
        can_access_admin_settings,
        can_access_guest_shop_admin,
        can_access_linen_admin,
        can_access_lost_found,
        can_access_fo_checklist,
        can_access_fo_quick_actions,
        can_access_fo_schedule,
        can_access_supervisor_checklist,
        can_access_price_guide,
        can_access_guest_laundry,
        can_access_fnb_checklist,
        can_access_fnb_menu_admin,
        can_access_fnb_orders,
        can_access_guest_shop_orders,
        can_access_breakfast_vouchers,
        can_access_staff_meal,
        can_access_pa_checklist,
        can_access_pa_linen_entry
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
      can_update_task_status: effectiveBoolean(role, profile.can_update_task_status),
      can_edit_task: effectiveBoolean(role, profile.can_edit_task),
      can_delete_task: effectiveBoolean(role, profile.can_delete_task),
      can_access_preventive_maintenance:
        effectiveBoolean(role, profile.can_access_preventive_maintenance),
      can_access_maintenance_manager_room_check:
        effectiveBoolean(role, profile.can_access_maintenance_manager_room_check),
      can_access_maintenance_ot:
        effectiveBoolean(role, profile.can_access_maintenance_ot),
      can_access_maintenance_stock_card:
        effectiveBoolean(role, profile.can_access_maintenance_stock_card),
      can_access_maintenance_damaged:
        effectiveBoolean(role, profile.can_access_maintenance_damaged),
      can_access_hk_schedule:
        effectiveBoolean(role, profile.can_access_hk_schedule),
      can_access_hk_special_project:
        effectiveBoolean(role, profile.can_access_hk_special_project),
      can_access_hk_manager_room_check:
        effectiveBoolean(role, profile.can_access_hk_manager_room_check),
      can_access_chambermaid_entry:
        effectiveBoolean(role, profile.can_access_chambermaid_entry),
      can_access_supervisor_update:
        effectiveBoolean(role, profile.can_access_supervisor_update),
      can_access_laundry_count:
        effectiveBoolean(role, profile.can_access_laundry_count),
      can_access_laundry_received:
        effectiveBoolean(role, profile.can_access_laundry_received),
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
      can_access_online_purchasing:
        effectiveBoolean(role, profile.can_access_online_purchasing),
      can_access_daily_operations_summary:
        effectiveBoolean(role, profile.can_access_daily_operations_summary),
      can_access_bank_in_cash:
        effectiveBoolean(role, profile.can_access_bank_in_cash),
      can_access_commission_checker:
        effectiveBoolean(role, profile.can_access_commission_checker),
      can_access_admin_settings:
        effectiveBoolean(role, profile.can_access_admin_settings),
      can_access_guest_shop_admin:
        effectiveBoolean(role, profile.can_access_guest_shop_admin),
      can_access_linen_admin:
        effectiveBoolean(role, profile.can_access_linen_admin),
      can_access_lost_found:
        effectiveBoolean(role, profile.can_access_lost_found),
      can_access_fo_checklist:
        effectiveFoChecklist(role, profile.email || authUser.email, profile.can_access_fo_checklist),
      can_access_fo_quick_actions:
        effectiveBoolean(role, profile.can_access_fo_quick_actions),
      can_access_fo_schedule:
        effectiveBoolean(role, profile.can_access_fo_schedule),
      can_access_supervisor_checklist:
        effectiveBoolean(role, profile.can_access_supervisor_checklist),
      can_access_price_guide:
        role === 'SUPERUSER' ||
        role === 'FO' ||
        String(profile.email || authUser.email || '').trim().toLowerCase() === 'fenny@hotelhallmark.com' ||
        savedBoolean(profile.can_access_price_guide),
      can_access_guest_laundry:
        role === 'SUPERUSER' ||
        role === 'FO' ||
        String(profile.email || authUser.email || '').trim().toLowerCase() === 'walter@hotelhallmark.com' ||
        String(profile.email || authUser.email || '').trim().toLowerCase() === 'fenny@hotelhallmark.com' ||
        savedBoolean(profile.can_access_guest_laundry),
      can_access_fnb_checklist:
        (() => {
          const email = String(profile.email || authUser.email || '').trim().toLowerCase();
          return role === 'SUPERUSER' || email === 'fnb@hotelhallmark.com' || email === 'fenny@hotelhallmark.com';
        })(),
      can_access_fnb_menu_admin:
        (() => {
          const email = String(profile.email || authUser.email || '').trim().toLowerCase();
          return (
            role === 'SUPERUSER' ||
            email === 'fnb@hotelhallmark.com' ||
            email === 'fenny@hotelhallmark.com' ||
            savedBoolean(profile.can_access_fnb_menu_admin)
          );
        })(),
      can_access_breakfast_vouchers:
        effectiveBoolean(role, profile.can_access_breakfast_vouchers),
      can_access_staff_meal:
        effectiveBoolean(role, profile.can_access_staff_meal),
      can_access_fnb_orders:
        (() => {
          const email = String(profile.email || authUser.email || '').trim().toLowerCase();
          return (
            role === 'SUPERUSER' ||
            email === 'fnb@hotelhallmark.com' ||
            email === 'fenny@hotelhallmark.com' ||
            savedBoolean(profile.can_access_fnb_orders)
          );
        })(),
      can_access_guest_shop_orders:
        (() => {
          const email = String(profile.email || authUser.email || '').trim().toLowerCase();
          return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com' || savedBoolean(profile.can_access_guest_shop_orders);
        })(),
      can_access_pa_checklist: (() => {
        const email = String(profile.email || authUser.email || '').trim().toLowerCase();
        return (
          role === 'SUPERUSER' ||
          email === 'pa@hotelhallmark.com' ||
          email === 'fenny@hotelhallmark.com' ||
          email === 'manager@hotelhallmark.com' ||
          email === 'hksup1@hotelhallmark.com' ||
          email === 'hksup2@hotelhallmark.com' ||
          savedBoolean(profile.can_access_pa_checklist)
        );
      })(),
      can_access_pa_linen_entry: (() => {
        const email = String(profile.email || authUser.email || '').trim().toLowerCase();
        return (
          role === 'SUPERUSER' ||
          email === 'pa@hotelhallmark.com' ||
          email === 'laundry@hotelhallmark.com' ||
          email === 'fenny@hotelhallmark.com' ||
          email === 'manager@hotelhallmark.com' ||
          email === 'hksup1@hotelhallmark.com' ||
          email === 'hksup2@hotelhallmark.com' ||
          email === 'hksup3@hotelhallmark.com' ||
          savedBoolean(profile.can_access_pa_linen_entry)
        );
      })(),
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
