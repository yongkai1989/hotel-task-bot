import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

function passcodeEncryptionKey() {
  return createHash('sha256')
    .update(`commission-checker-passcode:${signingSecret()}`)
    .digest();
}

export function encryptCommissionCheckerPasscode(passcode: string) {
  if (!/^\d{6}$/.test(passcode)) throw new Error('Commission Checker passcode must contain six digits');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', passcodeEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(passcode, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptCommissionCheckerPasscode(value: string) {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = String(value || '').split('.');
    if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext || extra) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      passcodeEncryptionKey(),
      Buffer.from(encodedIv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return /^\d{6}$/.test(decrypted) ? decrypted : null;
  } catch {
    return null;
  }
}

export async function recoverCommissionCheckerPasscode(email: string, storedHash: string) {
  const normalizedHash = String(storedHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedHash)) return null;

  for (let value = 0; value < 1_000_000; value += 1) {
    const passcode = value.toString().padStart(6, '0');
    if (hashCommissionCheckerPasscode(email, passcode) === normalizedHash) return passcode;
    if (value > 0 && value % 10_000 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return null;
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
    .select('id, email, label, is_active, session_version, passcode_expires_at, passcode_never_expires')
    .eq('id', decoded.accessId)
    .maybeSingle();

  if (
    error ||
    !data ||
    data.is_active !== true ||
    (
      data.passcode_never_expires !== true &&
      (
        !data.passcode_expires_at ||
        new Date(data.passcode_expires_at).getTime() <= Date.now()
      )
    ) ||
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

