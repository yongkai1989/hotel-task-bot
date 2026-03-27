import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';

type AuthUser = {
  id: string;
  email?: string | null;
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

    if (user.role !== 'MANAGER') {
      return NextResponse.json(
        { ok: false, error: 'Manager only' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const targetEmail = String(body.targetEmail || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '').trim();

    if (!targetEmail) {
      return NextResponse.json(
        { ok: false, error: 'Target email is required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // 🔥 FIX: explicitly type users
    const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError || !data?.users) {
      return NextResponse.json(
        { ok: false, error: listError?.message || 'Failed to list users' },
        { status: 500 }
      );
    }

    const users = data.users as AuthUser[];

    const targetUser = users.find(
      (u) => (u.email || '').toLowerCase() === targetEmail
    );

    if (!targetUser) {
      return NextResponse.json(
        { ok: false, error: 'Auth user not found' },
        { status: 404 }
      );
    }

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
        password: newPassword,
      });

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
