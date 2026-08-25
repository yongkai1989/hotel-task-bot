import { NextRequest, NextResponse } from 'next/server';
import {
  ChillerBranch,
  ChillerKind,
  CHILLER_RECORD_SELECT,
  chillerBucketForBranch,
  chillerNamesForBranch,
  chillerStoragePath,
  cleanupOldChillerSubmissions,
  getCurrentChillerWeek,
  normalizeChillerBranch,
  signChillerRecord,
  verifyChillerToken,
} from '../../../../lib/chillerCleaning';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

async function getCurrentWeekRows(branch: ChillerBranch) {
  const week = getCurrentChillerWeek();
  const { start: weekStart, end: weekEnd } = week;
  let query = supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select(CHILLER_RECORD_SELECT)
    .eq('branch', branch)
    .eq('week_start', weekStart);

  if (branch === 'grand') query = query.neq('chiller_name', 'Grease Trap 3');
  const { data, error } = await query.order('chiller_name', { ascending: true });

  if (error) throw new Error(error.message);
  const records = await Promise.all((data || []).map((row: any) => signChillerRecord(row)));
  return { week: { start: weekStart, end: weekEnd }, records };
}

export async function GET(req: NextRequest) {
  try {
    const branch = normalizeChillerBranch(req.headers.get('x-chiller-branch'));
    const allowed = await verifyChillerToken(req, 'staff', branch);
    if (!allowed) return jsonNoCache({ ok: false, error: 'Access denied' }, 401);

    await cleanupOldChillerSubmissions();
    const { week, records } = await getCurrentWeekRows(branch);
    return jsonNoCache({ ok: true, branch, week, current_week: week, chillers: chillerNamesForBranch(branch), records });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to load submissions' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const branch = normalizeChillerBranch(req.headers.get('x-chiller-branch'));
    const allowed = await verifyChillerToken(req, 'staff', branch);
    if (!allowed) return jsonNoCache({ ok: false, error: 'Access denied' }, 401);

    const form = await req.formData();
    const requestedChiller = String(form.get('chiller_name') || '').trim();
    const chillerName = chillerNamesForBranch(branch).find(
      (name) => name.toLowerCase() === requestedChiller.toLowerCase(),
    );
    const kind = String(form.get('kind') || '') as ChillerKind;
    const staffName = String(form.get('staff_name') || '').trim();
    const file = form.get('file');

    if (!chillerName) {
      return jsonNoCache({ ok: false, error: 'This routine duty is not available for the selected branch' }, 400);
    }
    if (kind !== 'before' && kind !== 'after') {
      return jsonNoCache({ ok: false, error: 'Please choose Before or After photo' }, 400);
    }
    if (!(file instanceof File)) {
      return jsonNoCache({ ok: false, error: 'Photo is required' }, 400);
    }
    if (!file.type.startsWith('image/')) {
      return jsonNoCache({ ok: false, error: 'Only image uploads are accepted' }, 400);
    }
    if (file.size > 15 * 1024 * 1024) {
      return jsonNoCache({ ok: false, error: 'Photo is too large. Please upload below 15MB.' }, 400);
    }

    const week = getCurrentChillerWeek();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('chiller_cleaning_submissions')
      .select(CHILLER_RECORD_SELECT)
      .eq('branch', branch)
      .eq('week_start', week.start)
      .eq('chiller_name', chillerName)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    // The first submitter owns the weekly record. Photo replacements must not
    // overwrite that audit name, even if a different value is sent manually.
    const firstSubmitter = String(existing?.staff_name || '').trim();
    const resolvedStaffName = firstSubmitter || staffName;
    if (!resolvedStaffName) {
      return jsonNoCache({ ok: false, error: 'Staff name is required' }, 400);
    }

    const path = chillerStoragePath(branch, kind, week.start, chillerName);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage.from(chillerBucketForBranch(branch)).upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    });

    if (uploadError) throw new Error(uploadError.message);

    const now = new Date().toISOString();
    const updateData: any = {
      staff_name: resolvedStaffName,
      updated_at: now,
      [`${kind}_path`]: path,
      [`${kind}_submitted_at`]: now,
    };

    let saved: any;
    if (existing) {
      const oldPath = existing[`${kind}_path`];
      if (oldPath && oldPath !== path) {
        await supabaseAdmin.storage.from(chillerBucketForBranch(branch)).remove([oldPath]);
      }

      const { data, error } = await supabaseAdmin
        .from('chiller_cleaning_submissions')
        .update(updateData)
        .eq('id', existing.id)
        .select(CHILLER_RECORD_SELECT)
        .single();

      if (error) throw new Error(error.message);
      saved = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('chiller_cleaning_submissions')
        .insert({
          branch,
          week_start: week.start,
          week_end: week.end,
          chiller_name: chillerName,
          staff_name: resolvedStaffName,
          ...updateData,
        })
        .select(CHILLER_RECORD_SELECT)
        .single();

      if (error) throw new Error(error.message);
      saved = data;
    }

    const signed = await signChillerRecord(saved);
    const { records } = await getCurrentWeekRows(branch);
    return jsonNoCache({ ok: true, branch, week, current_week: week, record: signed, records, chillers: chillerNamesForBranch(branch) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to save submission' }, 500);
  }
}
