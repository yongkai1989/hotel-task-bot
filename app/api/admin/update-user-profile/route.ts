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
  can_access_maintenance_manager_room_check?: boolean;
  can_access_maintenance_ot?: boolean;
  can_access_maintenance_stock_card?: boolean;
  can_access_maintenance_damaged?: boolean;
  can_access_hk_special_project?: boolean;
  can_access_hk_manager_room_check?: boolean;
  can_access_chambermaid_entry?: boolean;
  chambermaid_access_until?: string | null;
  can_access_supervisor_update?: boolean;
  can_access_laundry_count?: boolean;
  can_access_laundry_received?: boolean;
  can_access_stock_card?: boolean;
  can_access_damaged?: boolean;
  can_access_linen_history?: boolean;
  can_access_daily_forms?: boolean;
  can_access_management_tasks?: boolean;
  can_access_commission_checker?: boolean;
  can_access_admin_settings?: boolean;
  can_access_guest_shop_admin?: boolean;
  can_access_linen_admin?: boolean;
  can_access_lost_found?: boolean;
  can_access_fo_checklist?: boolean;
  can_access_supervisor_checklist?: boolean;
  can_access_price_guide?: boolean;
  can_access_guest_laundry?: boolean;
  can_access_fnb_checklist?: boolean;
  can_access_fnb_menu_admin?: boolean;
  can_access_fnb_orders?: boolean;
  can_access_pa_checklist?: boolean;
  can_access_pa_linen_entry?: boolean;
  can_create_task?: boolean;
  can_update_task_status?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
};

const permissionKeys = [
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
  'can_access_linen_admin',
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
  'can_create_task',
  'can_update_task_status',
  'can_edit_task',
  'can_delete_task',
] as const;

const allowedRoles = ['SUPERUSER', 'MANAGER', 'SUPERVISOR', 'HK', 'MT', 'FO'] as const;

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
  can_create_task,
  can_update_task_status,
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

function normalizeRole(value: unknown) {
  const role = String(value || 'FO').trim().toUpperCase();
  return allowedRoles.includes(role as (typeof allowedRoles)[number]) ? role : 'FO';
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

function withPermissions(row: any) {
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
    can_access_commission_checker:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_commission_checker),
    can_access_admin_settings:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_admin_settings),
    can_access_guest_shop_admin:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_guest_shop_admin),
    can_access_linen_admin:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_access_linen_admin),
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
    can_access_fnb_checklist:
      role === 'SUPERUSER' ||
      email === 'fnb@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_fnb_checklist),
    can_access_fnb_menu_admin:
      role === 'SUPERUSER' ||
      email === 'fnb@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_fnb_menu_admin),
    can_access_fnb_orders:
      role === 'SUPERUSER' ||
      email === 'fnb@hotelhallmark.com' ||
      email === 'fenny@hotelhallmark.com' ||
      toPermissionBoolean(row.can_access_fnb_orders),
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
    can_update_task_status:
      role === 'SUPERUSER' || toPermissionBoolean(row.can_update_task_status),
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

async function syncAuthUserMetadata(
  serviceClient: any,
  userId: string,
  nextName: string,
  nextRole: string
) {
  if (!userId) return { ok: true, role: nextRole };

  const { data: existingUserData, error: getUserError } =
    await serviceClient.auth.admin.getUserById(userId);

  if (getUserError) {
    return { ok: false, error: getUserError.message, role: null };
  }

  const currentMetadata = existingUserData?.user?.user_metadata || {};
  const { data: updatedUserData, error: updateUserError } =
    await serviceClient.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...currentMetadata,
        name: nextName,
        role: nextRole,
      },
    });

  if (updateUserError) {
    return { ok: false, error: updateUserError.message, role: null };
  }

  return {
    ok: true,
    role: updatedUserData?.user?.user_metadata?.role || nextRole,
  };
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

    const nextRole = normalizeRole(body.role);
    const payload = {
      email: targetEmail || null,
      name: String(body.name || '').trim(),
      role: nextRole,
      chambermaid_access_until: normalizeTimeValue(body.chambermaid_access_until),
      updated_at: new Date().toISOString(),
    } as Record<string, any>;

    for (const key of permissionKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        payload[key] = toPermissionBoolean(body[key]);
      }
    }

    if (nextRole === 'SUPERUSER') {
      for (const key of permissionKeys) {
        payload[key] = true;
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

    const canonicalUserId = authUserId || targetUserId;
    const authMetadataSync = authUserId
      ? await syncAuthUserMetadata(serviceClient, authUserId, payload.name, nextRole)
      : { ok: true, role: null };

    if (!authMetadataSync.ok) {
      return NextResponse.json(
        { ok: false, error: `Failed to update auth metadata: ${authMetadataSync.error}` },
        { status: 500 }
      );
    }

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
      .eq('user_id', canonicalUserId)
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
        requestedRole: nextRole,
        savedRole: freshRow.role,
        authMetadataRole: authMetadataSync.role,
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
