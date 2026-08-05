import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  COMMISSION_CHECKER_COOKIE,
  COMMISSION_CHECKER_SESSION_SECONDS,
  createCommissionCheckerToken,
} from '../../../../../lib/commissionCheckerAuth';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_FAILED_ATTEMPTS = 8;
const MIN_OTP_LENGTH = 6;
const MAX_OTP_LENGTH = 10;

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function requestIp(req: NextRequest) {
  return String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '')
    .split(',')[0]
    .trim()
    .slice(0, 80);
}

async function recordAttempt(email: string, ipAddress: string, successful: boolean) {
  await supabaseAdmin.from('commission_checker_auth_attempts').insert({
    email,
    action: 'verify',
    successful,
    ip_address: ipAddress || null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const token = String(body?.token || '').replace(/\D/g, '');
    const ipAddress = requestIp(req);

    if (!email || token.length < MIN_OTP_LENGTH || token.length > MAX_OTP_LENGTH) {
      return NextResponse.json({ ok: false, error: 'Enter the complete access code' }, { status: 400 });
    }

    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from('commission_checker_auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('action', 'verify')
      .eq('successful', false)
      .gte('created_at', since);

    if (Number(count || 0) >= MAX_FAILED_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: 'Too many incorrect attempts. Please wait 15 minutes and request a new code.' },
        { status: 429 }
      );
    }

    const { data: access } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, email, session_version, is_active')
      .eq('email', email)
      .eq('is_active', true)
      .maybeSingle();

    if (!access) {
      await recordAttempt(email, ipAddress, false);
      return NextResponse.json({ ok: false, error: 'This email is not approved for Commission Checker access' }, { status: 403 });
    }

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
    const { data, error } = await authClient.auth.verifyOtp({ email, token, type: 'email' });
    const verifiedEmail = normalizeEmail(data?.user?.email);

    if (error || verifiedEmail !== email) {
      await recordAttempt(email, ipAddress, false);
      return NextResponse.json({ ok: false, error: 'The code is invalid or has expired' }, { status: 401 });
    }

    const sessionToken = createCommissionCheckerToken({
      id: String(access.id),
      email,
      session_version: Number(access.session_version || 1),
    });
    await Promise.all([
      recordAttempt(email, ipAddress, true),
      supabaseAdmin
        .from('commission_checker_access')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', access.id),
    ]);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COMMISSION_CHECKER_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: COMMISSION_CHECKER_SESSION_SECONDS,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unable to verify access code' },
      { status: 500 }
    );
  }
}

