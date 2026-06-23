import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

type CreateBody = {
  email?: string;
  password?: string;
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

const allowedRoles = ['SUPERUSER', 'MANAGER', 'SUPERVISOR', 'HK', 'MT', 'FO'] as const;

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
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
  const email = String(row.email || '').trim().toLowerCase();
  const permissions = {
    can_access_preventive_maintenance: toPermissionBoolean(row.can_access_preventive_maintenance),
    can_access_maintenance_manager_room_check: toPermissionBoolean(row.can_access_maintenance_manager_room_check),
    can_access_maintenance_ot: toPermissionBoolean(row.can_access_maintenance_ot),
    can_access_maintenance_stock_card: toPermissionBoolean(row.can_access_maintenance_stock_card),
    can_access_maintenance_damaged: toPermissionBoolean(row.can_access_maintenance_damaged),
    can_access_hk_special_project: toPermissionBoolean(row.can_access_hk_special_project),
    can_access_hk_manager_room_check: toPermissionBoolean(row.can_access_hk_manager_room_check),
    can_access_chambermaid_entry: toPermissionBoolean(row.can_access_chambermaid_entry),
    chambermaid_access_until: normalizeTimeValue(row.chambermaid_access_until),
    can_access_supervisor_update: toPermissionBoolean(row.can_access_supervisor_update),
    can_access_laundry_count: toPermissionBoolean(row.can_access_laundry_count),
    can_access_laundry_received: toPermissionBoolean(row.can_access_laundry_received),
    can_access_stock_card: toPermissionBoolean(row.can_access_stock_card),
    can_access_damaged: toPermissionBoolean(row.can_access_damaged),
    can_access_linen_history: toPermissionBoolean(row.can_access_linen_history),
    can_access_daily_forms: toPermissionBoolean(row.can_access_daily_forms),
    can_access_management_tasks: toPermissionBoolean(row.can_access_management_tasks),
    can_access_commission_checker: toPermissionBoolean(row.can_access_commission_checker),
    can_access_admin_settings: toPermissionBoolean(row.can_access_admin_settings),
    can_access_guest_shop_admin: toPermissionBoolean(row.can_access_guest_shop_admin),
    can_access_lost_found: toPermissionBoolean(row.can_access_lost_found),
    can_access_supervisor_checklist: toPermissionBoolean(row.can_access_supervisor_checklist),
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
      role === 'SUPERUSER' || email === 'fnb@hotelhallmark.com' || email === 'fenny@hotelhallmark.com',
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
    can_create_task: toPermissionBoolean(row.can_create_task),
    can_update_task_status: toPermissionBoolean(row.can_update_task_status),
    can_edit_task: toPermissionBoolean(row.can_edit_task),
    can_delete_task: toPermissionBoolean(row.can_delete_task),
  };

  return { ...row, ...permissions, permissions };
}

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json({ ok: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'SUPERUSER') {
      return NextResponse.json({ ok: false, error: 'Superuser only' }, { status: 403 });
    }

    const body = (await req.json()) as CreateBody;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const name = String(body.name || '').trim();
    const role = normalizeRole(body.role);

    if (!name) {
      return NextResponse.json({ ok: false, error: 'Missing name' }, { status: 400 });
    }

    if (!email) {
      return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      });

    if (createError || !created.user?.id) {
      return NextResponse.json(
        { ok: false, error: createError?.message || 'Failed to create auth user' },
        { status: 500 }
      );
    }

    const payload = {
      user_id: created.user.id,
      email,
      name,
      role,
      can_access_preventive_maintenance: toPermissionBoolean(body.can_access_preventive_maintenance),
      can_access_maintenance_manager_room_check: toPermissionBoolean(body.can_access_maintenance_manager_room_check),
      can_access_maintenance_ot: toPermissionBoolean(body.can_access_maintenance_ot),
      can_access_maintenance_stock_card: toPermissionBoolean(body.can_access_maintenance_stock_card),
      can_access_maintenance_damaged: toPermissionBoolean(body.can_access_maintenance_damaged),
      can_access_hk_special_project: toPermissionBoolean(body.can_access_hk_special_project),
      can_access_hk_manager_room_check: toPermissionBoolean(body.can_access_hk_manager_room_check),
      can_access_chambermaid_entry: toPermissionBoolean(body.can_access_chambermaid_entry),
      chambermaid_access_until: normalizeTimeValue(body.chambermaid_access_until),
      can_access_supervisor_update: toPermissionBoolean(body.can_access_supervisor_update),
      can_access_laundry_count: toPermissionBoolean(body.can_access_laundry_count),
      can_access_laundry_received: toPermissionBoolean(body.can_access_laundry_received),
      can_access_stock_card: toPermissionBoolean(body.can_access_stock_card),
      can_access_damaged: toPermissionBoolean(body.can_access_damaged),
      can_access_linen_history: toPermissionBoolean(body.can_access_linen_history),
      can_access_daily_forms: toPermissionBoolean(body.can_access_daily_forms),
      can_access_management_tasks: toPermissionBoolean(body.can_access_management_tasks),
      can_access_commission_checker:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_commission_checker),
      can_access_admin_settings:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_admin_settings),
      can_access_guest_shop_admin:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_guest_shop_admin),
      can_access_lost_found:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_lost_found),
      can_access_supervisor_checklist:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_supervisor_checklist),
      can_access_fo_checklist:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_fo_checklist),
      can_access_price_guide:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_price_guide),
      can_access_guest_laundry:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_guest_laundry),
      can_access_fnb_checklist:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_fnb_checklist),
      can_access_fnb_menu_admin:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_fnb_menu_admin),
      can_access_fnb_orders:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_fnb_orders),
      can_access_pa_checklist:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_pa_checklist),
      can_access_pa_linen_entry:
        role === 'SUPERUSER' || toPermissionBoolean(body.can_access_pa_linen_entry),
      can_create_task: toPermissionBoolean(body.can_create_task),
      can_update_task_status: toPermissionBoolean(body.can_update_task_status),
      can_edit_task: toPermissionBoolean(body.can_edit_task),
      can_delete_task: toPermissionBoolean(body.can_delete_task),
      updated_at: new Date().toISOString(),
    };

    if (role === 'SUPERUSER') {
      payload.can_access_preventive_maintenance = true;
      payload.can_access_maintenance_manager_room_check = true;
      payload.can_access_maintenance_ot = true;
      payload.can_access_maintenance_stock_card = true;
      payload.can_access_maintenance_damaged = true;
      payload.can_access_hk_special_project = true;
      payload.can_access_hk_manager_room_check = true;
      payload.can_access_chambermaid_entry = true;
      payload.can_access_supervisor_update = true;
      payload.can_access_laundry_count = true;
      payload.can_access_laundry_received = true;
      payload.can_access_stock_card = true;
      payload.can_access_damaged = true;
      payload.can_access_linen_history = true;
      payload.can_access_daily_forms = true;
      payload.can_access_management_tasks = true;
      payload.can_access_commission_checker = true;
      payload.can_access_admin_settings = true;
      payload.can_access_guest_shop_admin = true;
      payload.can_access_lost_found = true;
      payload.can_access_supervisor_checklist = true;
      payload.can_access_fo_checklist = true;
      payload.can_access_price_guide = true;
      payload.can_access_guest_laundry = true;
      payload.can_access_fnb_checklist = true;
      payload.can_access_fnb_menu_admin = true;
      payload.can_access_fnb_orders = true;
      payload.can_access_pa_checklist = true;
      payload.can_access_pa_linen_entry = true;
      payload.can_create_task = true;
      payload.can_update_task_status = true;
      payload.can_edit_task = true;
      payload.can_delete_task = true;
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .upsert([payload], { onConflict: 'user_id' })
      .select(`
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
        can_access_lost_found,
        can_access_supervisor_checklist,
        can_access_fo_checklist,
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
        can_delete_task
      `)
      .single();

    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, user_id: created.user.id, user: withPermissions(profile) },
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
