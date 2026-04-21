import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

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

    const body = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const normalizedUserId = String(body.user_id || '').trim();
    const normalizedEmail = String(body.email || '').trim().toLowerCase();

    if (!normalizedUserId) {
      return NextResponse.json(
        { ok: false, error: 'Missing user_id' },
        { status: 400 }
      );
    }

    const payload = {
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

    const { data: existingRow, error: existingError } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { ok: false, error: existingError.message },
        { status: 500 }
      );
    }

    if (existingRow) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(payload)
        .eq('user_id', normalizedUserId);

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
            user_id: normalizedUserId,
            email: normalizedEmail || null,
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

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(
      normalizedUserId,
      {
        user_metadata: {
          name: payload.name,
          role: payload.role,
        },
      }
    );

    if (authUpdateError) {
      return NextResponse.json(
        { ok: false, error: authUpdateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, user_id: normalizedUserId });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
