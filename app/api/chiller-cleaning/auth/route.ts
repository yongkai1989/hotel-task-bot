import { NextRequest, NextResponse } from 'next/server';
import {
  getChillerAdminSettings,
  getChillerSettings,
  hashPasscode,
  normalizeChillerBranch,
  tokenForHash,
} from '../../../../lib/chillerCleaning';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 15;

const DATABASE_TIMEOUT_MS = 10_000;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

export async function POST(req: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DATABASE_TIMEOUT_MS);

  try {
    const body = await req.json().catch(() => ({}));
    const passcode = String(body?.passcode || '').trim();
    const mode = body?.mode === 'admin' ? 'admin' : 'staff';
    const branch = normalizeChillerBranch(body?.branch);

    if (!passcode) {
      return jsonNoCache({ ok: false, error: 'Passcode is required' }, 400);
    }

    const settings = mode === 'admin'
      ? await getChillerAdminSettings(controller.signal)
      : await getChillerSettings(branch, controller.signal);
    const expectedHash = mode === 'admin' ? settings.admin_passcode_hash : settings.staff_passcode_hash;

    if (hashPasscode(passcode) !== expectedHash) {
      return jsonNoCache({ ok: false, error: 'Invalid passcode' }, 401);
    }

    return jsonNoCache({
      ok: true,
      mode,
      branch: mode === 'staff' ? branch : null,
      token: tokenForHash(expectedHash, mode === 'admin' ? 'admin' : `staff:${branch}`),
    });
  } catch (error: any) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      return jsonNoCache({
        ok: false,
        error: 'The database is temporarily busy. Please wait a moment and try once.',
      }, 503);
    }
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to verify passcode' }, 500);
  } finally {
    clearTimeout(timeout);
  }
}
