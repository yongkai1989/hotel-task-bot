import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type DashboardRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function effectiveBoolean(role: DashboardRole, value: unknown) {
  return role === 'SUPERUSER' || toPermissionBoolean(value);
}

const permissionKeys = [
  'can_create_task',
  'can_edit_task',
  'can_delete_task',
  'can_access_preventive_maintenance',
  'can_access_maintenance_ot',
  'can_access_hk_special_project',
  'can_access_chambermaid_entry',
  'can_access_supervisor_update',
  'can_access_laundry_count',
  'can_access_stock_card',
  'can_access_damaged',
  'can_access_linen_history',
  'can_access_daily_forms',
  'can_access_management_tasks',
  'can_access_admin_settings',
  'can_access_linen_admin',
];

function enabledCount(profile: any) {
  const role = String(profile?.role || 'FO') as DashboardRole;
  if (role === 'SUPERUSER') return permissionKeys.length;
  return permissionKeys.filter((key) => toPermissionBoolean(profile?.[key])).length;
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
    user_id: profile.user_id,
    email: profile.email || authEmail,
    name: profile.name || authEmail || 'User',
    role,
    ...permissions,
    permissions,
  };
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Missing authorization token' },
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
      .select(`
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
        can_access_linen_admin,
        updated_at
      `)
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { ok: false, error: profileError.message },
        { status: 500 }
      );
    }

    const { data: emailProfiles, error: emailProfilesError } = await serviceClient
      .from('user_profiles')
      .select(`
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
        can_access_linen_admin,
        updated_at
      `)
      .ilike('email', authUser.email);

    if (emailProfilesError) {
      return NextResponse.json(
        { ok: false, error: emailProfilesError.message },
        { status: 500 }
      );
    }

    const profile = pickBestProfile([profileByUserId, ...(emailProfiles || [])]);

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
        source: 'direct-service-role-session-profile',
        matchedProfileUserId: profile.user_id,
        authUserId: authUser.id,
        matchedProfiles: [profileByUserId, ...(emailProfiles || [])]
          .filter(Boolean)
          .map((row) => ({
            user_id: row.user_id,
            email: row.email,
            role: row.role,
            enabled: enabledCount(row),
            updated_at: row.updated_at || null,
          })),
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
