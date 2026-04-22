import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeProfileRow(row: any) {
  const role = String(row.role || 'FO');

  const permissions = {
    can_access_preventive_maintenance:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_preventive_maintenance),
    can_access_maintenance_ot:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_maintenance_ot),
    can_access_hk_special_project:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_hk_special_project),
    can_access_chambermaid_entry:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_chambermaid_entry),
    can_access_supervisor_update:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_supervisor_update),
    can_access_laundry_count:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_laundry_count),
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
    can_create_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_create_task),
    can_edit_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_edit_task),
    can_delete_task:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_delete_task),
  };

  return {
    user_id: String(row.user_id || ''),
    email: String(row.email || '').toLowerCase(),
    name: String(row.name || ''),
    role,
    ...permissions,
    permissions,
    updated_at: row.updated_at || null,
  };
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

async function getRequester(req: NextRequest, serviceClient: ReturnType<typeof createClient>) {
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

    const { requester, error } = await getRequester(req, serviceClient);

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
      const { data: profile, error: profileError } = await serviceClient
        .from('user_profiles')
        .select(profileSelect)
        .eq('user_id', requestedUserId)
        .maybeSingle();

      if (profileError) {
        return NextResponse.json(
          { ok: false, error: profileError.message },
          { status: 500 }
        );
      }

      if (!profile) {
        return NextResponse.json(
          { ok: false, error: 'User profile not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { ok: true, user: normalizeProfileRow(profile), source: 'direct-admin-users-single' },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
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

    return NextResponse.json(
      {
        ok: true,
        users: (profiles || []).map(normalizeProfileRow),
        source: 'direct-admin-users-list',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
