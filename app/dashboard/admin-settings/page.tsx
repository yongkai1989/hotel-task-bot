import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: error || 'Unauthorized' },
        { status: 401 }
      );
    }

    if (user.role !== 'SUPERUSER') {
      return NextResponse.json(
        { ok: false, error: 'Superuser only' },
        { status: 403 }
      );
    }

    const body = (await req.json()) as UpdateBody;

    const targetUserId = String(body.user_id || '').trim();
    const targetEmail = String(body.email || '').trim().toLowerCase();

    if (!targetUserId) {
      return NextResponse.json(
        { ok: false, error: 'Missing user_id' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const payload = {
      email: targetEmail || null,
      name: String(body.name || '').trim(),
      role: String(body.role || 'FO').trim(),
      can_access_preventive_maintenance: !!body.can_access_preventive_maintenance,
      can_access_maintenance_ot: !!body.can_access_maintenance_ot,
      can_access_hk_special_project: !!body.can_access_hk_special_project,
      can_access_chambermaid_entry: !!body.can_access_chambermaid_entry,
      can_access_supervisor_update: !!body.can_access_supervisor_update,
      can_access_laundry_count: !!body.can_access_laundry_count,
      can_access_stock_card: !!body.can_access_stock_card,
      can_access_damaged: !!body.can_access_damaged,
      can_access_linen_history: !!body.can_access_linen_history,
      can_access_daily_forms: !!body.can_access_daily_forms,
      can_access_management_tasks: !!body.can_access_management_tasks,
      can_access_admin_settings: !!body.can_access_admin_settings,
      can_create_task: !!body.can_create_task,
      can_edit_task: !!body.can_edit_task,
      can_delete_task: !!body.can_delete_task,
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { ok: false, error: existingError.message },
        { status: 500 }
      );
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(payload)
        .eq('user_id', targetUserId);

      if (updateError) {
        return NextResponse.json(
          { ok: false, error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from('user_profiles')
        .insert([
          {
            user_id: targetUserId,
            ...payload,
          },
        ]);

      if (insertError) {
        return NextResponse.json(
          { ok: false, error: insertError.message },
          { status: 500 }
        );
      }
    }

    const { data: freshRow, error: freshError } = await supabase
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
      .eq('user_id', targetUserId)
      .single();

    if (freshError) {
      return NextResponse.json(
        { ok: false, error: freshError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: freshRow,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
