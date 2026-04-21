import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    name?: string | null;
    role?: string | null;
  } | null;
};

function emptyPermissions() {
  return {
    can_access_preventive_maintenance: false,
    can_access_maintenance_ot: false,
    can_access_hk_special_project: false,
    can_access_chambermaid_entry: false,
    can_access_supervisor_update: false,
    can_access_laundry_count: false,
    can_access_stock_card: false,
    can_access_damaged: false,
    can_access_linen_history: false,
    can_access_daily_forms: false,
    can_access_management_tasks: false,
    can_access_admin_settings: false,
    can_create_task: false,
    can_edit_task: false,
    can_delete_task: false,
  };
}

export async function GET(req: NextRequest) {
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

    const [{ data: authData, error: authError }, { data: profileRows, error: profileError }] =
      await Promise.all([
        supabaseAdmin.auth.admin.listUsers(),
        supabaseAdmin.from('user_profiles').select('*'),
      ]);

    if (authError) {
      return NextResponse.json(
        { ok: false, error: authError.message || 'Failed to list auth users' },
        { status: 500 }
      );
    }

    if (profileError) {
      return NextResponse.json(
        { ok: false, error: profileError.message || 'Failed to load user profiles' },
        { status: 500 }
      );
    }

    const profilesByEmail = new Map<string, any>();
    (profileRows || []).forEach((row: any) => {
      const email = String(row.email || '').trim().toLowerCase();
      if (email) profilesByEmail.set(email, row);
    });

    const users = ((authData?.users || []) as AuthUser[]).map((authUser) => {
      const email = String(authUser.email || '').trim().toLowerCase();
      const profile = profilesByEmail.get(email);

      return {
        user_id: profile?.user_id || authUser.id,
        email,
        name:
          profile?.name ||
          authUser.user_metadata?.name ||
          email ||
          'Unnamed User',
        role:
          profile?.role ||
          authUser.user_metadata?.role ||
          'FO',
        ...emptyPermissions(),
        ...(profile || {}),
      };
    });

    users.sort((a, b) => {
      if (a.role === 'SUPERUSER' && b.role !== 'SUPERUSER') return -1;
      if (a.role !== 'SUPERUSER' && b.role === 'SUPERUSER') return 1;
      return String(a.email).localeCompare(String(b.email));
    });

    return NextResponse.json({ ok: true, users });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
