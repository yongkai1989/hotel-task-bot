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

    const {
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
    } = body;

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUserId = String(user_id || '').trim();

    if (!normalizedUserId && !normalizedEmail) {
      return NextResponse.json(
        { ok: false, error: 'Missing user_id or email' },
        { status: 400 }
      );
    }

    const payload = {
      user_id: normalizedUserId || undefined,
      email: normalizedEmail || undefined,
      name: String(name || '').trim(),
      role: String(role || 'FO').trim(),
      can_access_preventive_maintenance: !!can_access_preventive_maintenance,
      can_access_maintenance_ot: !!can_access_maintenance_ot,
      can_access_hk_special_project: !!can_access_hk_special_project,
      can_access_chambermaid_entry: !!can_access_chambermaid_entry,
      can_access_supervisor_update: !!can_access_supervisor_update,
      can_access_laundry_count: !!can_access_laundry_count,
      can_access_stock_card: !!can_access_stock_card,
      can_access_damaged: !!can_access_damaged,
      can_access_linen_history: !!can_access_linen_history,
      can_access_daily_forms: !!can_access_daily_forms,
      can_access_management_tasks: !!can_access_management_tasks,
      can_access_admin_settings: !!can_access_admin_settings,
      can_create_task: !!can_create_task,
      can_edit_task: !!can_edit_task,
      can_delete_task: !!can_delete_task,
    };

    let existingProfile = null;

    if (normalizedUserId) {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', normalizedUserId)
        .maybeSingle();
      existingProfile = data;
    }

    if (!existingProfile && normalizedEmail) {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', normalizedEmail)
        .maybeSingle();
      existingProfile = data;
    }

    if (existingProfile) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          ...payload,
          user_id: existingProfile.user_id,
          email: existingProfile.email,
        })
        .eq('user_id', existingProfile.user_id);

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
            ...payload,
            user_id: normalizedUserId || null,
            email: normalizedEmail || null,
          },
        ]);

      if (insertError) {
        return NextResponse.json(
          { ok: false, error: insertError.message },
          { status: 500 }
        );
      }
    }

    if (normalizedUserId) {
      await supabase.auth.admin.updateUserById(normalizedUserId, {
        user_metadata: {
          name: String(name || '').trim(),
          role: String(role || 'FO').trim(),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
