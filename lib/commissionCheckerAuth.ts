import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { supabaseAdmin } from './supabaseAdmin';

export const COMMISSION_CHECKER_COOKIE = 'commission_checker_access';
export const COMMISSION_CHECKER_SESSION_SECONDS = 60 * 60 * 24 * 7;
export const COMMISSION_CHECKER_PASSCODE_SECONDS = 60 * 60 * 24 * 7;

type CommissionCheckerToken = {
  accessId: string;
  email: string;
  version: number;
  expiresAt: number;
};

function signingSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('Missing server authentication configuration');
  return secret;
}

function signature(payload: string) {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

export function createCommissionCheckerToken(
  access: { id: string; email: string; session_version: number },
  now = Date.now(),
  accessExpiresAt?: number
) {
  const sessionExpiresAt = now + COMMISSION_CHECKER_SESSION_SECONDS * 1000;
  const value: CommissionCheckerToken = {
    accessId: access.id,
    email: access.email,
    version: Number(access.session_version || 1),
    expiresAt: accessExpiresAt ? Math.min(sessionExpiresAt, accessExpiresAt) : sessionExpiresAt,
  };
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function hashCommissionCheckerPasscode(email: string, passcode: string) {
  return createHmac('sha256', signingSecret())
    .update(`${email.trim().toLowerCase()}:${passcode}`)
    .digest('hex');
}

export function commissionCheckerPasscodeMatches(email: string, passcode: string, storedHash: string) {
  try {
    const supplied = Buffer.from(hashCommissionCheckerPasscode(email, passcode), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

function decodeCommissionCheckerToken(token: string): CommissionCheckerToken | null {
  try {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return null;

    const expectedSignature = signature(payload);
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CommissionCheckerToken;
    if (
      !parsed?.accessId ||
      !parsed?.email ||
      !Number.isFinite(parsed.version) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getCommissionCheckerSession() {
  const token = cookies().get(COMMISSION_CHECKER_COOKIE)?.value || '';
  const decoded = decodeCommissionCheckerToken(token);
  if (!decoded) return null;

  const { data, error } = await supabaseAdmin
    .from('commission_checker_access')
    .select('id, email, label, is_active, session_version, passcode_expires_at')
    .eq('id', decoded.accessId)
    .maybeSingle();

  if (
    error ||
    !data ||
    data.is_active !== true ||
    !data.passcode_expires_at ||
    new Date(data.passcode_expires_at).getTime() <= Date.now() ||
    String(data.email || '').toLowerCase() !== decoded.email.toLowerCase() ||
    Number(data.session_version || 1) !== decoded.version
  ) {
    return null;
  }

  return {
    id: String(data.id),
    email: String(data.email),
    label: String(data.label || ''),
    expiresAt: decoded.expiresAt,
  };
}

