import { NextRequest, NextResponse } from 'next/server';
import { getChillerSettings, hashPasscode, tokenForHash } from '../../../../lib/chillerCleaning';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const passcode = String(body?.passcode || '').trim();
    const mode = body?.mode === 'admin' ? 'admin' : 'staff';

    if (!passcode) {
      return jsonNoCache({ ok: false, error: 'Passcode is required' }, 400);
    }

    const settings = await getChillerSettings();
    const expectedHash = mode === 'admin' ? settings.admin_passcode_hash : settings.staff_passcode_hash;

    if (hashPasscode(passcode) !== expectedHash) {
      return jsonNoCache({ ok: false, error: 'Invalid passcode' }, 401);
    }

    return jsonNoCache({
      ok: true,
      mode,
      token: tokenForHash(expectedHash),
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to verify passcode' }, 500);
  }
}
