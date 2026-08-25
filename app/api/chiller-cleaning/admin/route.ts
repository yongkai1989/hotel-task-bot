import { NextRequest, NextResponse } from 'next/server';
import {
  ChillerBranch,
  CHILLER_RECORD_SELECT,
  canManageChillerCleaning,
  chillerBucketForBranch,
  chillerNamesForBranch,
  clearChillerSettingsCache,
  cleanupOldChillerSubmissions,
  getChillerAdminSettings,
  getChillerSettings,
  getCurrentChillerWeek,
  hashPasscode,
  normalizeChillerBranch,
  signChillerRecord,
  tokenForHash,
  verifyChillerToken,
} from '../../../../lib/chillerCleaning';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

async function requireManager(req: NextRequest) {
  if (await verifyChillerToken(req, 'admin')) return true;

  const { user } = await getDashboardUserFromRequest(req);
  return canManageChillerCleaning(user);
}

async function loadAdminRecords(branch: ChillerBranch) {
  await cleanupOldChillerSubmissions();
  let query = supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select(CHILLER_RECORD_SELECT)
    .eq('branch', branch)
    .gte('week_start', '2026-07-20');

  if (branch === 'grand') query = query.neq('chiller_name', 'Grease Trap 3');
  const { data, error } = await query
    .order('week_start', { ascending: false })
    .order('chiller_name', { ascending: true });

  if (error) throw new Error(error.message);
  return Promise.all((data || []).map((row: any) => signChillerRecord(row)));
}

export async function GET(req: NextRequest) {
  try {
    const allowed = await requireManager(req);
    if (!allowed) return jsonNoCache({ ok: false, error: 'Access denied' }, 401);

    const branch = normalizeChillerBranch(req.nextUrl.searchParams.get('branch'));
    const [settings, records] = await Promise.all([getChillerSettings(branch), loadAdminRecords(branch)]);
    const week = getCurrentChillerWeek();
    return jsonNoCache({
      ok: true,
      branch,
      settings: {
        updated_at: settings.updated_at,
      },
      week,
      current_week: week,
      chillers: chillerNamesForBranch(branch),
      records,
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to load chiller admin' }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const allowed = await requireManager(req);
    if (!allowed) return jsonNoCache({ ok: false, error: 'Access denied' }, 401);

    const body = await req.json().catch(() => ({}));
    const branch = normalizeChillerBranch(body?.branch);
    const staffPasscode = String(body?.staff_passcode || '').trim();
    const adminPasscode = String(body?.admin_passcode || '').trim();

    if (!staffPasscode && !adminPasscode) {
      return jsonNoCache({ ok: false, error: 'Enter at least one new passcode' }, 400);
    }
    if (staffPasscode && staffPasscode.length < 4) {
      return jsonNoCache({ ok: false, error: 'Staff passcode must be at least 4 characters' }, 400);
    }
    if (adminPasscode && adminPasscode.length < 4) {
      return jsonNoCache({ ok: false, error: 'Admin passcode must be at least 4 characters' }, 400);
    }

    const [current, currentAdmin] = await Promise.all([
      getChillerSettings(branch),
      getChillerAdminSettings(),
    ]);
    const staffHash = staffPasscode ? hashPasscode(staffPasscode) : current.staff_passcode_hash;
    const adminHash = adminPasscode ? hashPasscode(adminPasscode) : currentAdmin.admin_passcode_hash;

    const { data, error } = await supabaseAdmin
      .from('chiller_cleaning_settings')
      .upsert(
        {
          id: branch,
          passcode_hash: staffHash,
          staff_passcode_hash: staffHash,
          admin_passcode_hash: adminHash,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'id' },
      )
      .select('id, passcode_hash, staff_passcode_hash, admin_passcode_hash, updated_at')
      .single();

    if (error) throw new Error(error.message);

    if (adminPasscode) {
      const { error: adminUpdateError } = await supabaseAdmin
        .from('chiller_cleaning_settings')
        .upsert(
          {
            id: 'singleton',
            passcode_hash: currentAdmin.passcode_hash,
            staff_passcode_hash: currentAdmin.staff_passcode_hash,
            admin_passcode_hash: adminHash,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: 'id' },
        );
      if (adminUpdateError) throw new Error(adminUpdateError.message);
    }

    clearChillerSettingsCache();

    return jsonNoCache({
      ok: true,
      branch,
      settings: {
        updated_at: data?.updated_at || current.updated_at,
      },
      token: tokenForHash(adminHash, 'admin'),
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to update passcodes' }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const allowed = await requireManager(req);
    if (!allowed) return jsonNoCache({ ok: false, error: 'Access denied' }, 401);

    const body = await req.json().catch(() => ({}));
    const branch = normalizeChillerBranch(body?.branch);
    const requestedChiller = String(body?.chiller_name || '').trim();
    const chillerName = chillerNamesForBranch(branch).find(
      (name) => name.toLowerCase() === requestedChiller.toLowerCase(),
    );
    if (!chillerName) {
      return jsonNoCache({ ok: false, error: 'This routine duty is not available for the selected branch' }, 400);
    }
    const week = getCurrentChillerWeek();

    const { data: rows, error: loadError } = await supabaseAdmin
      .from('chiller_cleaning_submissions')
      .select('id, before_path, after_path')
      .eq('branch', branch)
      .eq('week_start', week.start)
      .eq('chiller_name', chillerName);

    if (loadError) throw new Error(loadError.message);

    const paths = (rows || []).flatMap((row: any) => [row.before_path, row.after_path].filter(Boolean));
    if (paths.length) {
      await supabaseAdmin.storage.from(chillerBucketForBranch(branch)).remove(paths as string[]);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('chiller_cleaning_submissions')
      .delete()
      .eq('branch', branch)
      .eq('week_start', week.start)
      .eq('chiller_name', chillerName);

    if (deleteError) throw new Error(deleteError.message);

    const records = await loadAdminRecords(branch);
    return jsonNoCache({ ok: true, branch, week, current_week: week, chiller_name: chillerName, records });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to reset current week' }, 500);
  }
}
