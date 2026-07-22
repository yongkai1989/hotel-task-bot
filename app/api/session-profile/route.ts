import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRequestAccessToken } from '../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type DashboardRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';

const PROFILE_SELECT = `
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
  can_access_hk_special_project,
  can_access_hk_manager_room_check,
  can_access_chambermaid_entry,
  chambermaid_access_until,
  can_access_supervisor_update,
  can_access_laundry_count,
  can_access_laundry_received,
  can_access_stock_card,
  can_access_damaged,
  can_access_linen_history,
  can_access_daily_forms,
  can_access_management_tasks,
  can_access_commission_checker,
  can_access_admin_settings,
  can_access_guest_shop_admin,
  can_access_linen_admin,
  can_access_lost_found,
  can_access_fo_checklist,
  can_access_supervisor_checklist,
  can_access_price_guide,
  can_access_guest_laundry,
  can_access_fnb_checklist,
  can_access_fnb_menu_admin,
  can_access_fnb_orders,
  can_access_pa_checklist,
  can_access_pa_linen_entry,
  updated_at
`;

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeTimeValue(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function effectiveBoolean(role: DashboardRole, value: unknown) {
  return role === 'SUPERUSER' || toPermissionBoolean(value);
}

function effectiveFoChecklist(role: DashboardRole, email: unknown, value: unknown) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return (
    role === 'SUPERUSER' ||
    (
      toPermissionBoolean(value) &&
      (
        role === 'FO' ||
        normalizedEmail === 'walter@hotelhallmark.com' ||
        normalizedEmail === 'fenny@hotelhallmark.com'
      )
    )
  );
}

const permissionKeys = [
  'can_create_task',
  'can_update_task_status',
  'can_edit_task',
  'can_delete_task',
  'can_access_preventive_maintenance',
  'can_access_maintenance_manager_room_check',
  'can_access_maintenance_ot',
  'can_access_maintenance_stock_card',
  'can_access_maintenance_damaged',
  'can_access_hk_special_project',
  'can_access_hk_manager_room_check',
  'can_access_chambermaid_entry',
  'can_access_supervisor_update',
  'can_access_laundry_count',
  'can_access_laundry_received',
  'can_access_stock_card',
  'can_access_damaged',
  'can_access_linen_history',
  'can_access_daily_forms',
  'can_access_management_tasks',
  'can_access_commission_checker',
  'can_access_admin_settings',
  'can_access_guest_shop_admin',
  'can_access_lost_found',
  'can_access_fo_checklist',
  'can_access_supervisor_checklist',
  'can_access_price_guide',
  'can_access_guest_laundry',
  'can_access_fnb_checklist',
  'can_access_fnb_menu_admin',
  'can_access_fnb_orders',
  'can_access_pa_checklist',
  'can_access_pa_linen_entry',
];

function enabledCount(profile: any) {
  const role = String(profile?.role || 'FO') as DashboardRole;
  if (role === 'SUPERUSER') return permissionKeys.length;
  return permissionKeys.filter((key) => {
    if (key === 'can_access_fo_checklist') {
      return effectiveFoChecklist(role, profile?.email, profile?.[key]);
    }
    return toPermissionBoolean(profile?.[key]);
  }).length;
}

function pickBestProfile(profiles: any[]) {
  return profiles
    .filter(Boolean)
    .sort((a, b) => {
      const bTime = b?.updated_at ? Date.parse(b.updated_at) : 0;
      const aTime = a?.updated_at ? Date.parse(a.updated_at) : 0;

      if (bTime !== aTime) {
        return bTime - aTime;
      }

      return enabledCount(b) - enabledCount(a);
    })[0] || null;
}

function buildUser(profile: any, authEmail: string) {
  const role = String(profile.role || 'FO') as DashboardRole;
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
    can_access_hk_special_project:
      effectiveBoolean(role, profile.can_access_hk_special_project),
    can_access_hk_manager_room_check:
      effectiveBoolean(role, profile.can_access_hk_manager_room_check),
    can_access_chambermaid_entry:
      effectiveBoolean(role, profile.can_access_chambermaid_entry),
    chambermaid_access_until: normalizeTimeValue(profile.chambermaid_access_until),
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
      effectiveFoChecklist(role, profile.email || authEmail, profile.can_access_fo_checklist),
    can_access_supervisor_checklist:
      effectiveBoolean(role, profile.can_access_supervisor_checklist),
    can_access_price_guide:
      role === 'SUPERUSER' ||
      role === 'FO' ||
      String(profile.email || authEmail || '').trim().toLowerCase() === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(profile.can_access_price_guide),
    can_access_guest_laundry:
      role === 'SUPERUSER' ||
      role === 'FO' ||
      String(profile.email || authEmail || '').trim().toLowerCase() === 'walter@hotelhallmark.com' ||
      String(profile.email || authEmail || '').trim().toLowerCase() === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(profile.can_access_guest_laundry),
    can_access_fnb_checklist:
      (() => {
        const email = String(profile.email || authEmail || '').trim().toLowerCase();
        return role === 'SUPERUSER' || email === 'fnb@hotelhallmark.com' || email === 'fenny@hotelhallmark.com';
      })(),
    can_access_fnb_menu_admin:
      (() => {
        const email = String(profile.email || authEmail || '').trim().toLowerCase();
        return (
          role === 'SUPERUSER' ||
          email === 'fnb@hotelhallmark.com' ||
          email === 'fenny@hotelhallmark.com' ||
          toPermissionBoolean(profile.can_access_fnb_menu_admin)
        );
      })(),
    can_access_fnb_orders:
      (() => {
        const email = String(profile.email || authEmail || '').trim().toLowerCase();
        return (
          role === 'SUPERUSER' ||
          email === 'fnb@hotelhallmark.com' ||
          email === 'fenny@hotelhallmark.com' ||
          toPermissionBoolean(profile.can_access_fnb_orders)
        );
      })(),
    can_access_pa_checklist: (() => {
      const email = String(profile.email || authEmail || '').trim().toLowerCase();
      return (
        role === 'SUPERUSER' ||
        email === 'pa@hotelhallmark.com' ||
        email === 'fenny@hotelhallmark.com' ||
        email === 'manager@hotelhallmark.com' ||
        email === 'hksup1@hotelhallmark.com' ||
        email === 'hksup2@hotelhallmark.com' ||
        toPermissionBoolean(profile.can_access_pa_checklist)
      );
    })(),
    can_access_pa_linen_entry: (() => {
      const email = String(profile.email || authEmail || '').trim().toLowerCase();
      return (
        role === 'SUPERUSER' ||
        email === 'pa@hotelhallmark.com' ||
        email === 'laundry@hotelhallmark.com' ||
        email === 'fenny@hotelhallmark.com' ||
        email === 'manager@hotelhallmark.com' ||
        email === 'hksup1@hotelhallmark.com' ||
        email === 'hksup2@hotelhallmark.com' ||
        email === 'hksup3@hotelhallmark.com' ||
        toPermissionBoolean(profile.can_access_pa_linen_entry)
      );
    })(),
  };

  return {
    user_id: profile.user_id,
    email: profile.email || authEmail,
    name: profile.name || authEmail || 'User',
    role,
    chambermaid_access_until: normalizeTimeValue(profile.chambermaid_access_until),
    ...permissions,
    permissions,
  };
}

function buildDebugPayload(profileByUserId: any, emailProfiles: any[], authUserId: string) {
  const selectedProfile = profileByUserId || pickBestProfile(emailProfiles || []);

  return {
    source: 'direct-service-role-session-profile-auth-row-first',
    matchedProfileUserId: selectedProfile?.user_id || null,
    authUserId,
    selectedProfileReason: profileByUserId ? 'auth-user-id-row' : 'latest-email-row',
    matchedProfiles: [profileByUserId, ...(emailProfiles || [])]
      .filter(Boolean)
      .map((row) => ({
        user_id: row.user_id,
        email: row.email,
        role: row.role,
        enabled: enabledCount(row),
        updated_at: row.updated_at || null,
      })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const token = getRequestAccessToken(req);
    const includeDebug = req.nextUrl.searchParams.get('debug') === '1';

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Missing Supabase session' },
        { status: 401 }
      );
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
      return NextResponse.json(
        { ok: false, error: 'Invalid session' },
        { status: 401 }
      );
    }

    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profileByUserId, error: profileError } = await serviceClient
      .from('user_profiles')
      .select(PROFILE_SELECT)
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { ok: false, error: profileError.message },
        { status: 500 }
      );
    }

    if (profileByUserId) {
      return NextResponse.json(
        {
          ok: true,
          user: buildUser(profileByUserId, authUser.email),
          ...(includeDebug
            ? buildDebugPayload(profileByUserId, [profileByUserId], authUser.id)
            : {}),
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    const { data: emailProfiles, error: emailProfilesError } = await serviceClient
      .from('user_profiles')
      .select(PROFILE_SELECT)
      .ilike('email', authUser.email);

    if (emailProfilesError) {
      return NextResponse.json(
        { ok: false, error: emailProfilesError.message },
        { status: 500 }
      );
    }

    const profile = pickBestProfile(emailProfiles || []);

    if (!profile) {
      return NextResponse.json(
        { ok: false, error: 'User profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        user: buildUser(profile, authUser.email),
        ...(includeDebug ? buildDebugPayload(null, emailProfiles || [], authUser.id) : {}),
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
