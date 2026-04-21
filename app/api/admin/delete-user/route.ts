import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { ok: false, error: 'Missing user_id' },
        { status: 400 }
      );
    }

    // Delete from auth
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(user_id);

    if (deleteAuthError) {
      return NextResponse.json(
        { ok: false, error: deleteAuthError.message },
        { status: 500 }
      );
    }

    // Delete profile (optional, safe cleanup)
    const { error: profileError } = await supabase
      .from('user_profiles')
      .delete()
      .eq('user_id', user_id);

    if (profileError) {
      return NextResponse.json(
        { ok: false, error: profileError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'User deleted successfully',
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
