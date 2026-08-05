import { NextRequest, NextResponse } from 'next/server';
import {
  COMMISSION_CHECKER_COOKIE,
  commissionCheckerPasscodeMatches,
  createCommissionCheckerToken,
} from '../../../../../lib/commissionCheckerAuth';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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
    action: 'login',
    successful,
    ip_address: ipAddress || null,
  });
}

function invalidAccess(status = 401) {
  return NextResponse.json(
    { ok: false, error: 'The username or passcode is invalid or has expired' },
    { status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const passcode = String(body?.passcode || '').replace(/\D/g, '');
    const ipAddress = requestIp(req);

    if (!email || !/^\d{6}$/.test(passcode)) return invalidAccess(400);

    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();
    const [emailAttempts, ipAttempts] = await Promise.all([
      supabaseAdmin
        .from('commission_checker_auth_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('email', email)
        .eq('action', 'login')
        .eq('successful', false)
        .gte('created_at', since),
      ipAddress
        ? supabaseAdmin
            .from('commission_checker_auth_attempts')
            .select('id', { count: 'exact', head: true })
            .eq('ip_address', ipAddress)
            .eq('action', 'login')
            .eq('successful', false)
            .gte('created_at', since)
        : Promise.resolve({ count: 0 }),
    ]);

    if (
      Number(emailAttempts.count || 0) >= MAX_FAILED_ATTEMPTS ||
      Number(ipAttempts.count || 0) >= MAX_FAILED_ATTEMPTS
    ) {
      return NextResponse.json(
        { ok: false, error: 'Too many incorrect attempts. Please wait 15 minutes and try again.' },
        { status: 429 }
      );
    }

    const { data: access, error: accessError } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, email, session_version, is_active, passcode_hash, passcode_expires_at')
      .eq('email', email)
      .maybeSingle();

    const expiresAt = access?.passcode_expires_at
      ? new Date(access.passcode_expires_at).getTime()
      : 0;
    const valid =
      !accessError &&
      access?.is_active === true &&
      Boolean(access.passcode_hash) &&
      expiresAt > Date.now() &&
      commissionCheckerPasscodeMatches(email, passcode, String(access.passcode_hash || ''));

    if (!valid || !access) {
      await recordAttempt(email, ipAddress, false);
      return invalidAccess();
    }

    const sessionToken = createCommissionCheckerToken(
      {
        id: String(access.id),
        email,
        session_version: Number(access.session_version || 1),
      },
      Date.now(),
      expiresAt
    );
    const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));

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
      maxAge,
    });
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unable to sign in' },
      { status: 500 }
    );
  }
}

