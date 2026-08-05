import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function bearerToken(req: NextRequest) {
  const header = req.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function requireSuperuser(req: NextRequest) {
  const token = bearerToken(req);
  if (!token) return null;

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user } } = await authClient.auth.getUser();
  if (!user?.id) return null;

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, role')
    .eq('user_id', user.id)
    .maybeSingle();
  return profile?.role === 'SUPERUSER' ? profile : null;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Superuser access required' }, { status: 403 });
}

export async function GET(req: NextRequest) {
  if (!(await requireSuperuser(req))) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('commission_checker_access')
    .select('id, email, label, is_active, created_at, updated_at, last_login_at')
    .order('is_active', { ascending: false })
    .order('label', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, access: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const requester = await requireSuperuser(req);
  if (!requester) return unauthorized();

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const label = String(body?.label || '').trim().slice(0, 80);
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      return NextResponse.json({ ok: false, error: 'Enter a valid email address' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, session_version')
      .eq('email', email)
      .maybeSingle();
    if (existingError) throw existingError;

    let access;
    if (existing) {
      const result = await supabaseAdmin
        .from('commission_checker_access')
        .update({
          label,
          is_active: true,
          session_version: Number(existing.session_version || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id, email, label, is_active, created_at, updated_at, last_login_at')
        .single();
      if (result.error) throw result.error;
      access = result.data;
    } else {
      const result = await supabaseAdmin
        .from('commission_checker_access')
        .insert({ email, label, created_by: requester.user_id })
        .select('id, email, label, is_active, created_at, updated_at, last_login_at')
        .single();
      if (result.error) throw result.error;
      access = result.data;
    }

    const createResult = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { commission_checker_only: true },
    });
    if (createResult.error && !/already|registered|exists/i.test(createResult.error.message || '')) {
      await supabaseAdmin
        .from('commission_checker_access')
        .update({ is_active: false, session_version: Number(existing?.session_version || 1) + 2 })
        .eq('id', access.id);
      throw createResult.error;
    }

    // A project-level Auth trigger may create a default dashboard profile for every
    // new Auth identity. Remove that auto-created profile for checker-only users.
    // Existing dashboard users are left unchanged when createUser reports a duplicate.
    if (!createResult.error && createResult.data?.user?.id) {
      const { error: profileDeleteError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('user_id', createResult.data.user.id);
      if (profileDeleteError) {
        await Promise.all([
          supabaseAdmin
            .from('commission_checker_access')
            .update({ is_active: false, session_version: Number(existing?.session_version || 1) + 2 })
            .eq('id', access.id),
          supabaseAdmin.auth.admin.deleteUser(createResult.data.user.id),
        ]);
        throw new Error('Unable to isolate this email from dashboard access. No access was granted.');
      }
    }

    return NextResponse.json({ ok: true, access });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to add approved email' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireSuperuser(req))) return unauthorized();

  try {
    const body = await req.json();
    const id = String(body?.id || '').trim();
    const isActive = body?.is_active === true;
    const label = String(body?.label || '').trim().slice(0, 80);
    if (!id) return NextResponse.json({ ok: false, error: 'Access record is required' }, { status: 400 });

    const { data: existing, error: findError } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, session_version')
      .eq('id', id)
      .single();
    if (findError) throw findError;

    const { data, error } = await supabaseAdmin
      .from('commission_checker_access')
      .update({
        label,
        is_active: isActive,
        session_version: Number(existing.session_version || 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, email, label, is_active, created_at, updated_at, last_login_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, access: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update access' }, { status: 500 });
  }
}

