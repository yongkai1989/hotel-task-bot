import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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

const permissionKeys = [
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
  'can_create_task',
  'can_edit_task',
  'can_delete_task',
] as const;

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

function withPermissions(row: any) {
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

  return { ...row, ...permissions, permissions };
}

async function findAuthUserIdByEmail(serviceClient: any, email: string) {
  if (!email) return '';

  let page = 1;

  while (page <= 20) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw error;
    }

    const users = data?.users || [];
    const match = users.find(
      (user: any) => String(user.email || '').trim().toLowerCase() === email
    );

    if (match?.id) {
      return match.id;
    }

    if (users.length < 1000) {
      return '';
    }

    page += 1;
  }

  return '';
}

async function getRequester(req: NextRequest, serviceClient: any) {
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

export async function POST(req: NextRequest) {
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

    const canUseAdminSettings =
      requester.role === 'SUPERUSER' ||
      requester.can_access_admin_settings === true;

    if (!canUseAdminSettings) {
      return NextResponse.json(
        { ok: false, error: 'Admin Settings access required' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as UpdateBody;
    const targetUserId = String(body.user_id || '').trim();
    const targetEmail = normalizeEmail(body.email);

    if (!targetUserId) {
      return NextResponse.json({ ok: false, error: 'Missing user_id' }, { status: 400 });
    }

    const payload = {
      email: targetEmail || null,
      name: String(body.name || '').trim(),
      role: String(body.role || 'FO').trim(),
      updated_at: new Date().toISOString(),
    } as Record<string, any>;

    for (const key of permissionKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        payload[key] = toPermissionBoolean(body[key]);
      }
    }

    const { error: exactProfileError } = await serviceClient
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (exactProfileError) {
      return NextResponse.json({ ok: false, error: exactProfileError.message }, { status: 500 });
    }

    const authUserId = targetEmail
      ? await findAuthUserIdByEmail(serviceClient, targetEmail)
      : '';

    const { data: allProfiles, error: emailProfilesError } = targetEmail
      ? await serviceClient
          .from('user_profiles')
          .select('user_id, email')
      : { data: [], error: null };

    if (emailProfilesError) {
      return NextResponse.json(
        { ok: false, error: emailProfilesError.message },
        { status: 500 }
      );
    }

    const emailProfiles = (allProfiles || []).filter(
      (profile: any) => normalizeEmail(profile?.email) === targetEmail
    );

    const targetUserIds = new Set<string>();
    targetUserIds.add(targetUserId);

    if (authUserId) {
      targetUserIds.add(authUserId);
    }

    for (const profile of emailProfiles || []) {
      if (profile?.user_id) {
        targetUserIds.add(profile.user_id);
      }
    }

    const touchedUserIds: string[] = [];

    for (const userId of targetUserIds) {
      const { data: profile, error: profileError } = await serviceClient
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError) {
        return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
      }

      const rowPayload =
        userId === targetUserId
          ? payload
          : {
              ...payload,
              user_id: undefined,
            };
      delete rowPayload.user_id;

      const { error: rowWriteError } = await (profile
        ? serviceClient
            .from('user_profiles')
            .update(rowPayload)
            .eq('user_id', userId)
        : serviceClient
            .from('user_profiles')
            .insert([{ user_id: userId, ...payload }]));

      if (rowWriteError) {
        return NextResponse.json({ ok: false, error: rowWriteError.message }, { status: 500 });
      }

      touchedUserIds.push(userId);
    }

    const { data: freshRow, error: freshError } = await serviceClient
      .from('user_profiles')
      .select(profileSelect)
      .eq('user_id', authUserId || targetUserId)
      .single();

    if (freshError) {
      return NextResponse.json({ ok: false, error: freshError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        user: withPermissions(freshRow),
        source: 'direct-admin-update-user-profile-normalized-email',
        touchedUserIds,
        selectedUserId: targetUserId,
        authUserId: authUserId || null,
        returnedUserId: freshRow.user_id,
        matchedEmailProfileIds: emailProfiles.map((profile: any) => profile.user_id),
      },
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
