import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const WINDOW_MINUTES = 15;
const MAX_REQUESTS_PER_WINDOW = 5;

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
    action: 'request',
    successful,
    ip_address: ipAddress || null,
  });
}

export async function POST(req: NextRequest) {
  const genericResponse = NextResponse.json({ ok: true });

  try {
    const body = await req.json();
    const email = normalizeEmail(body?.email);
    const ipAddress = requestIp(req);
    if (!email || !email.includes('@') || email.length > 254) return genericResponse;

    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from('commission_checker_auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('action', 'request')
      .gte('created_at', since);

    if (Number(count || 0) >= MAX_REQUESTS_PER_WINDOW) return genericResponse;

    const { data: access } = await supabaseAdmin
      .from('commission_checker_access')
      .select('id')
      .eq('email', email)
      .eq('is_active', true)
      .maybeSingle();

    if (!access) {
      await recordAttempt(email, ipAddress, false);
      return genericResponse;
    }

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );
    const { error } = await authClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    await recordAttempt(email, ipAddress, !error);
    return genericResponse;
  } catch {
    return genericResponse;
  }
}

