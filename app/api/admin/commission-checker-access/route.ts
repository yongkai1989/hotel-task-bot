import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  COMMISSION_CHECKER_PASSCODE_SECONDS,
  decryptCommissionCheckerPasscode,
  encryptCommissionCheckerPasscode,
  hashCommissionCheckerPasscode,
  recoverCommissionCheckerPasscode,
} from '../../../../lib/commissionCheckerAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const PERMANENT_ACCESS_EMAIL = 'ryan.tan@hotelhallmark.com';
const ACCESS_SELECT =
  'id, email, label, is_active, created_at, updated_at, last_login_at, passcode_hash, passcode_ciphertext, passcode_generated_at, passcode_expires_at, passcode_never_expires';

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

function createPasscode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function passcodeDates(email: string) {
  const generatedAt = new Date();
  const neverExpires = email === PERMANENT_ACCESS_EMAIL;
  return {
    generatedAt,
    neverExpires,
    expiresAt: neverExpires
      ? null
      : new Date(generatedAt.getTime() + COMMISSION_CHECKER_PASSCODE_SECONDS * 1000),
  };
}

function hasValidPasscode(row: any) {
  if (row?.is_active !== true || !row?.passcode_hash) return false;
  if (row?.passcode_never_expires === true) return true;
  return Boolean(
    row?.passcode_expires_at &&
    new Date(row.passcode_expires_at).getTime() > Date.now()
  );
}

function publicAccess(row: any) {
  const valid = hasValidPasscode(row);
  const passcode = valid
    ? decryptCommissionCheckerPasscode(String(row?.passcode_ciphertext || ''))
    : null;
  const { passcode_hash: _hash, passcode_ciphertext: _ciphertext, ...safeRow } = row || {};
  return {
    ...safeRow,
    passcode,
    has_active_passcode: valid,
    can_recover_passcode: valid && !passcode,
  };
}

export async function GET(req: NextRequest) {
  if (!(await requireSuperuser(req))) return unauthorized();

  const revealId = String(req.nextUrl.searchParams.get('reveal') || '').trim();
  if (revealId) {
    const { data: row, error } = await supabaseAdmin
      .from('commission_checker_access')
      .select(ACCESS_SELECT)
      .eq('id', revealId)
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!hasValidPasscode(row)) {
      return NextResponse.json({ ok: false, error: 'This code is missing or has expired' }, { status: 400 });
    }

    let passcode = decryptCommissionCheckerPasscode(String(row.passcode_ciphertext || ''));
    if (!passcode) {
      passcode = await recoverCommissionCheckerPasscode(String(row.email), String(row.passcode_hash || ''));
      if (!passcode) {
        return NextResponse.json({ ok: false, error: 'Unable to recover this code. Generate a new code instead.' }, { status: 409 });
      }
      const passcodeCiphertext = encryptCommissionCheckerPasscode(passcode);
      const { error: saveError } = await supabaseAdmin
        .from('commission_checker_access')
        .update({ passcode_ciphertext: passcodeCiphertext, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (saveError) return NextResponse.json({ ok: false, error: saveError.message }, { status: 500 });
      row.passcode_ciphertext = passcodeCiphertext;
    }

    return NextResponse.json(
      { ok: true, access: publicAccess(row), passcode },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('commission_checker_access')
    .select(ACCESS_SELECT)
    .order('is_active', { ascending: false })
    .order('label', { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json(
    { ok: true, access: (data || []).map(publicAccess) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: NextRequest) {
  const requester = await requireSuperuser(req);
  if (!requester) return unauthorized();

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const label = String(body?.label || '').trim().slice(0, 80);
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      return NextResponse.json({ ok: false, error: 'Enter a valid email username' }, { status: 400 });
    }
    if (!label) {
      return NextResponse.json({ ok: false, error: 'Enter a branch or description' }, { status: 400 });
    }

    const passcode = createPasscode();
    const { generatedAt, expiresAt, neverExpires } = passcodeDates(email);
    const passcodeHash = hashCommissionCheckerPasscode(email, passcode);
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, session_version')
      .eq('email', email)
      .maybeSingle();
    if (existingError) throw existingError;

    const values = {
      email,
      label,
      is_active: true,
      passcode_hash: passcodeHash,
      passcode_ciphertext: encryptCommissionCheckerPasscode(passcode),
      passcode_generated_at: generatedAt.toISOString(),
      passcode_expires_at: expiresAt?.toISOString() || null,
      passcode_never_expires: neverExpires,
      passcode_generated_by: requester.user_id,
      updated_at: generatedAt.toISOString(),
    };

    const result = existing
      ? await supabaseAdmin
          .from('commission_checker_access')
          .update({ ...values, session_version: Number(existing.session_version || 1) + 1 })
          .eq('id', existing.id)
          .select(ACCESS_SELECT)
          .single()
      : await supabaseAdmin
          .from('commission_checker_access')
          .insert({ ...values, created_by: requester.user_id })
          .select(ACCESS_SELECT)
          .single();
    if (result.error) throw result.error;

    return NextResponse.json({
      ok: true,
      access: publicAccess(result.data),
      passcode,
      passcode_expires_at: expiresAt?.toISOString() || null,
      passcode_never_expires: neverExpires,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unable to create Commission Checker access' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const requester = await requireSuperuser(req);
  if (!requester) return unauthorized();

  try {
    const body = await req.json();
    const id = String(body?.id || '').trim();
    if (!id) return NextResponse.json({ ok: false, error: 'Access record is required' }, { status: 400 });

    const { data: existing, error: findError } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id, email, session_version')
      .eq('id', id)
      .single();
    if (findError) throw findError;

    const passcode = createPasscode();
    const { generatedAt, expiresAt, neverExpires } = passcodeDates(existing.email);
    const { data, error } = await supabaseAdmin
      .from('commission_checker_access')
      .update({
        is_active: true,
        passcode_hash: hashCommissionCheckerPasscode(existing.email, passcode),
        passcode_ciphertext: encryptCommissionCheckerPasscode(passcode),
        passcode_generated_at: generatedAt.toISOString(),
        passcode_expires_at: expiresAt?.toISOString() || null,
        passcode_never_expires: neverExpires,
        passcode_generated_by: requester.user_id,
        session_version: Number(existing.session_version || 1) + 1,
        updated_at: generatedAt.toISOString(),
      })
      .eq('id', id)
      .select(ACCESS_SELECT)
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      access: publicAccess(data),
      passcode,
      passcode_expires_at: expiresAt?.toISOString() || null,
      passcode_never_expires: neverExpires,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unable to generate passcode' },
      { status: 500 }
    );
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

    const updates: Record<string, unknown> = {
      label,
      is_active: isActive,
      session_version: Number(existing.session_version || 1) + 1,
      updated_at: new Date().toISOString(),
    };
    if (!isActive) {
      updates.passcode_hash = null;
      updates.passcode_ciphertext = null;
      updates.passcode_generated_at = null;
      updates.passcode_expires_at = null;
      updates.passcode_generated_by = null;
    }

    const { data, error } = await supabaseAdmin
      .from('commission_checker_access')
      .update(updates)
      .eq('id', id)
      .select(ACCESS_SELECT)
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, access: publicAccess(data) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Unable to update access' }, { status: 500 });
  }
}

