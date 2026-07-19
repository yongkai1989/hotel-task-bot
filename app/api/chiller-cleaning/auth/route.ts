import { NextRequest, NextResponse } from 'next/server';
import {
  getChillerSettings,
  getCurrentSingaporeWeek,
  hashPasscode,
  tokenForHash,
} from '../../../../lib/chillerCleaning';

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

    if (!passcode) {
      return jsonNoCache({ ok: false, error: 'Passcode is required' }, 400);
    }

    const settings = await getChillerSettings();
    const valid = hashPasscode(passcode) === settings.passcode_hash;

    if (!valid) {
      return jsonNoCache({ ok: false, error: 'Incorrect passcode' }, 401);
    }

    return jsonNoCache({
      ok: true,
      token: tokenForHash(settings.passcode_hash),
      week: getCurrentSingaporeWeek(),
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to verify passcode' },
      500
    );
  }
}
