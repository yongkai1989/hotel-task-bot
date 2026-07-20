import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import {
  CHILLER_BUCKET,
  canManageChiller,
  cleanupOldChillerSubmissions,
  getCurrentSingaporeWeek,
  getChillerSettings,
  hashPasscode,
  signChillerRecord,
  tokenForHash,
  verifyChillerToken,
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
  if (await verifyChillerToken(req)) {
    return {
      user: {
        user_id: 'chiller-standalone-admin',
        email: 'chiller-admin@local',
        name: 'Chiller Admin',
        role: 'SUPERUSER',
      } as any,
      error: null,
    };
  }

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
    cutoffDate.setUTCMonth(cutoffDate.getUTCMonth() - 4);
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

export async function DELETE(req: NextRequest) {
  try {
    const { user, error } = await requireManager(req);

    if (!user) {
      return jsonNoCache({ ok: false, error }, error === 'Access denied' ? 403 : 401);
    }

    const week = getCurrentSingaporeWeek();
    const body = await req.json().catch(() => ({}));

    if (body?.week_start && body.week_start !== week.weekStart) {
      return jsonNoCache({ ok: false, error: 'Only the current week can be reset' }, 400);
    }

    const { data: rows, error: loadError } = await supabaseAdmin
      .from('chiller_cleaning_submissions')
      .select('id, before_path, after_path')
      .eq('week_start', week.weekStart);

    if (loadError) throw loadError;

    const uploadPaths = Array.from(
      new Set(
        (rows || [])
          .flatMap((row: any) => [row.before_path, row.after_path])
          .filter(Boolean)
          .map(String)
      )
    );

    if (uploadPaths.length) {
      await supabaseAdmin.storage.from(CHILLER_BUCKET).remove(uploadPaths);
    }

    if (rows?.length) {
      const { error: deleteError } = await supabaseAdmin
        .from('chiller_cleaning_submissions')
        .delete()
        .eq('week_start', week.weekStart);

      if (deleteError) throw deleteError;
    }

    return jsonNoCache({
      ok: true,
      week,
      deletedRecords: rows?.length || 0,
      removedFiles: uploadPaths.length,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to reset current week' },
      500
    );
  }
}
