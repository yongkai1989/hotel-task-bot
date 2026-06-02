import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
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

function enabledCount(row: any) {
  const role = String(row?.role || 'FO');
  const email = normalizeEmail(row?.email);
  return [
    row?.can_access_preventive_maintenance,
    row?.can_access_maintenance_manager_room_check,
    row?.can_access_maintenance_ot,
    row?.can_access_maintenance_stock_card,
    row?.can_access_maintenance_damaged,
    row?.can_access_hk_special_project,
    row?.can_access_hk_manager_room_check,
    row?.can_access_chambermaid_entry,
    row?.can_access_supervisor_update,
    row?.can_access_laundry_count,
    row?.can_access_laundry_received,
    row?.can_access_stock_card,
    row?.can_access_damaged,
    row?.can_access_linen_history,
    row?.can_access_daily_forms,
    row?.can_access_management_tasks,
    row?.can_access_admin_settings,
    row?.can_access_lost_found,
    row?.can_access_supervisor_checklist,
    row?.can_access_price_guide,
    row?.can_access_guest_laundry,
    row?.can_access_pa_checklist,
    row?.can_access_pa_linen_entry,
    role === 'SUPERUSER' ||
      (
        toPermissionBoolean(row?.can_access_fo_checklist) &&
        (role === 'FO' || email === 'walter@hotelhallmark.com' || email === 'fenny@hotelhallmark.com')
      ),
    row?.can_create_task,
    row?.can_edit_task,
    row?.can_delete_task,
  ].filter(toPermissionBoolean).length;
}

function normalizeProfileRow(row: any) {
  const role = String(row.role || 'FO');
  const email = normalizeEmail(row.email);

  const permissions = {
    can_access_preventive_maintenance:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_preventive_maintenance),
    can_access_maintenance_manager_room_check:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_maintenance_manager_room_check),
    can_access_maintenance_ot:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_maintenance_ot),
    can_access_maintenance_stock_card:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_maintenance_stock_card),
    can_access_maintenance_damaged:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_maintenance_damaged),
    can_access_hk_special_project:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_hk_special_project),
    can_access_hk_manager_room_check:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_hk_manager_room_check),
    can_access_chambermaid_entry:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_chambermaid_entry),
    chambermaid_access_until: normalizeTimeValue(row.chambermaid_access_until),
    can_access_supervisor_update:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_supervisor_update),
    can_access_laundry_count:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_laundry_count),
    can_access_laundry_received:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_laundry_received),
    can_access_stock_card:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_stock_card),
    can_access_damaged:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_damaged),
    can_access_linen_history:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_linen_history),
    can_access_daily_forms:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_daily_forms),
    can_access_management_tasks:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_management_tasks),
    can_access_admin_settings:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_admin_settings),
    can_access_lost_found:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_lost_found),
    can_access_supervisor_checklist:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_supervisor_checklist),
    can_access_fo_checklist:
      role === 'SUPERUSER' ||
      (
        toPermissionBoolean(row.can_access_fo_checklist) &&
        (role === 'FO' || email === 'walter@hotelhallmark.com' || email === 'fenny@hotelhallmark.com')
      ),
    can_access_price_guide:
      role === 'SUPERUSER' ||
      role === 'FO' ||
      email === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_price_guide),
    can_access_guest_laundry:
      role === 'SUPERUSER' ||
      role === 'FO' ||
      email === 'walter@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_guest_laundry),
    can_access_pa_checklist:
      role === 'SUPERUSER' ||
      email === 'pa@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      email === 'manager@hotelhallmark.com' ||
      email === 'hksup1@hotelhallmark.com' ||
      email === 'hksup2@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_pa_checklist),
    can_access_pa_linen_entry:
      role === 'SUPERUSER' ||
      email === 'pa@hotelhallmark.com' ||
      email === 'laundry@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      email === 'manager@hotelhallmark.com' ||
      email === 'hksup1@hotelhallmark.com' ||
      email === 'hksup2@hotelhallmark.com' ||
      email === 'hksup3@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_pa_linen_entry),
    can_create_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_create_task),
    can_edit_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_edit_task),
    can_delete_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_delete_task),
  };

  return {
    user_id: String(row.user_id || ''),
    email,
    name: String(row.name || ''),
    role,
    chambermaid_access_until: normalizeTimeValue(row.chambermaid_access_until),
    ...permissions,
    permissions,
    updated_at: row.updated_at || null,
  };
}

async function listAuthUsers(serviceClient: any) {
  const users: any[] = [];
  let page = 1;

  while (page <= 20) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw error;
    }

    const pageUsers = data?.users || [];
    users.push(...pageUsers);

    if (pageUsers.length < 1000) {
      break;
    }

    page += 1;
  }

  return users;
}

async function getAuthUserIdByEmailMap(serviceClient: any) {
  const users = await listAuthUsers(serviceClient);
  const map = new Map<string, string>();

  for (const user of users) {
    const email = normalizeEmail(user?.email);
    if (email && user?.id && !map.has(email)) {
      map.set(email, user.id);
    }
  }

  return map;
}

function chooseBestProfileForEmail(profiles: any[], authUserId?: string) {
  if (authUserId) {
    const authProfile = profiles.find((profile) => profile?.user_id === authUserId);
    if (authProfile) return authProfile;
  }

  return [...profiles].sort((a, b) => {
    const bTime = b?.updated_at ? Date.parse(b.updated_at) : 0;
    const aTime = a?.updated_at ? Date.parse(a.updated_at) : 0;

    if (bTime !== aTime) {
      return bTime - aTime;
    }

    return enabledCount(b) - enabledCount(a);
  })[0] || null;
}

async function getProfileByUserId(serviceClient: any, userId: string) {
  const { data, error } = await serviceClient
    .from('user_profiles')
    .select(profileSelect)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

const profileSelect = `
  user_id,
  email,
  name,
  role,
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
  can_access_admin_settings,
  can_access_lost_found,
  can_access_supervisor_checklist,
  can_access_fo_checklist,
  can_access_price_guide,
  can_access_guest_laundry,
  can_access_pa_checklist,
  can_access_pa_linen_entry,
  can_create_task,
  can_edit_task,
  can_delete_task,
  updated_at
`;

async function getRequester(req: NextRequest) {
  const token = getBearerToken(req);

  if (!token) {
    return { requester: null, error: 'Missing authorization token' };
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

  if (authError || !authUser?.id) {
    return { requester: null, error: 'Invalid session' };
  }

  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: requester, error: profileError } = await serviceClient
    .from('user_profiles')
    .select('user_id, role, can_access_admin_settings')
    .eq('user_id', authUser.id)
    .maybeSingle();

  if (profileError) {
    return { requester: null, error: profileError.message };
  }

  if (!requester) {
    return { requester: null, error: 'Requester profile not found' };
  }

  return { requester, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { requester, error } = await getRequester(req);

    if (!requester) {
      return NextResponse.json(
        { ok: false, error: error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const isAllowed =
      requester.role === 'SUPERUSER' ||
      requester.can_access_admin_settings === true;

    if (!isAllowed) {
      return NextResponse.json(
        { ok: false, error: 'Admin Settings access required' },
        { status: 403 }
      );
    }

    const requestedUserId = String(req.nextUrl.searchParams.get('user_id') || '').trim();

    if (requestedUserId) {
      const requestedProfile = await getProfileByUserId(serviceClient, requestedUserId);

      if (!requestedProfile) {
        return NextResponse.json(
          { ok: false, error: 'User profile not found' },
          { status: 404 }
        );
      }

      const profileEmail = normalizeEmail(requestedProfile.email);
      const authUserIdByEmail = await getAuthUserIdByEmailMap(serviceClient);
      const authUserId = authUserIdByEmail.get(profileEmail) || '';
      const authProfile =
        authUserId && authUserId !== requestedUserId
          ? await getProfileByUserId(serviceClient, authUserId)
          : null;
      const profile = authProfile || requestedProfile;

      return NextResponse.json(
        {
          ok: true,
          user: normalizeProfileRow(profile),
          source: 'direct-admin-users-single-auth-row-first',
          requestedUserId,
          returnedUserId: profile.user_id,
          authUserId: authUserId || null,
          selectedProfileReason: authProfile ? 'auth-user-id-row' : 'requested-user-id-row',
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0',
          },
        }
      );
    }

    const { data: profiles, error: usersError } = await serviceClient
      .from('user_profiles')
      .select(profileSelect)
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    if (usersError) {
      return NextResponse.json(
        { ok: false, error: usersError.message },
        { status: 500 }
      );
    }

    const authUserIdByEmail = await getAuthUserIdByEmailMap(serviceClient);
    const profilesByEmail = new Map<string, any[]>();
    const profilesWithoutEmail: any[] = [];

    for (const profile of profiles || []) {
      const email = normalizeEmail(profile?.email);

      if (!email) {
        profilesWithoutEmail.push(profile);
        continue;
      }

      const group = profilesByEmail.get(email) || [];
      group.push(profile);
      profilesByEmail.set(email, group);
    }

    const resolvedProfiles = [
      ...Array.from(profilesByEmail.entries()).map(([email, groupedProfiles]) =>
        chooseBestProfileForEmail(groupedProfiles, authUserIdByEmail.get(email))
      ),
      ...profilesWithoutEmail,
    ].filter(Boolean);

    return NextResponse.json(
      {
        ok: true,
        users: resolvedProfiles.map(normalizeProfileRow),
        source: 'direct-admin-users-list-auth-row-first',
        rawProfileCount: (profiles || []).length,
        resolvedProfileCount: resolvedProfiles.length,
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
