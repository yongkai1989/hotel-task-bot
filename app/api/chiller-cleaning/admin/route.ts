import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import {
  canManageChiller,
  cleanupOldChillerSubmissions,
  getCurrentSingaporeWeek,
  getChillerSettings,
  hashPasscode,
  signChillerRecord,
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

async function requireManager(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (!user) return { user: null, error: error || 'Unauthorized' };
  if (!canManageChiller(user)) return { user: null, error: 'Access denied' };
  return { user, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await requireManager(req);

    if (!user) {
      return jsonNoCache({ ok: false, error }, error === 'Access denied' ? 403 : 401);
    }

    await cleanupOldChillerSubmissions();

    const week = getCurrentSingaporeWeek();
    const cutoffDate = new Date(`${week.weekStart}T00:00:00Z`);
    cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - 3);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    const { data, error: loadError } = await supabaseAdmin
      .from('chiller_cleaning_submissions')
      .select('*')
      .gte('week_start', cutoff)
      .order('week_start', { ascending: false });

    if (loadError) throw loadError;

    const records = await Promise.all((data || []).map((row: any) => signChillerRecord(row)));

    return jsonNoCache({
      ok: true,
      week,
      records,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to load chiller records' },
      500
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, error } = await requireManager(req);

    if (!user) {
      return jsonNoCache({ ok: false, error }, error === 'Access denied' ? 403 : 401);
    }

    const body = await req.json().catch(() => ({}));
    const passcode = String(body?.passcode || '').trim();

    if (passcode.length < 4) {
      return jsonNoCache({ ok: false, error: 'Passcode must be at least 4 characters' }, 400);
    }

    const passcodeHash = hashPasscode(passcode);
    const { error: updateError } = await supabaseAdmin
      .from('chiller_cleaning_settings')
      .upsert(
        {
          id: 'singleton',
          passcode_hash: passcodeHash,
        },
        { onConflict: 'id' }
      );

    if (updateError) throw updateError;

    const settings = await getChillerSettings();

    return jsonNoCache({
      ok: true,
      token: tokenForHash(settings.passcode_hash),
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to update passcode' },
      500
    );
  }
}
