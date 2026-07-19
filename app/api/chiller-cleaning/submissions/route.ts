import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import {
  CHILLER_BUCKET,
  ChillerKind,
  ChillerRecord,
  chillerExtensionFor,
  chillerStoragePath,
  cleanupOldChillerSubmissions,
  getCurrentSingaporeWeek,
  signChillerRecord,
  verifyChillerToken,
} from '../../../../lib/chillerCleaning';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

async function currentWeekRecord() {
  const week = getCurrentSingaporeWeek();
  const { data, error } = await supabaseAdmin
    .from('chiller_cleaning_submissions')
    .select('*')
    .eq('week_start', week.weekStart)
    .maybeSingle();

  if (error) throw error;
  return { week, record: data as ChillerRecord | null };
}

export async function GET(req: NextRequest) {
  try {
    if (!(await verifyChillerToken(req))) {
      return jsonNoCache({ ok: false, error: 'Access denied' }, 401);
    }

    await cleanupOldChillerSubmissions();

    const { week, record } = await currentWeekRecord();
    return jsonNoCache({
      ok: true,
      week,
      record: await signChillerRecord(record),
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to load submission' },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await verifyChillerToken(req))) {
      return jsonNoCache({ ok: false, error: 'Access denied' }, 401);
    }

    const form = await req.formData();
    const kind = String(form.get('kind') || '') as ChillerKind;
    const staffName = String(form.get('staff_name') || '').trim();
    const file = form.get('file') as File | null;

    if (kind !== 'before' && kind !== 'after') {
      return jsonNoCache({ ok: false, error: 'Invalid image type' }, 400);
    }

    if (!staffName) {
      return jsonNoCache({ ok: false, error: 'Staff name is required' }, 400);
    }

    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonNoCache({ ok: false, error: 'Image is required' }, 400);
    }

    const type = file.type || 'image/jpeg';

    if (!type.startsWith('image/')) {
      return jsonNoCache({ ok: false, error: 'Only images are allowed' }, 400);
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return jsonNoCache({ ok: false, error: 'Image must be 15MB or smaller' }, 400);
    }

    await cleanupOldChillerSubmissions();

    const { week, record } = await currentWeekRecord();
    const ext = chillerExtensionFor(type);
    const path = `${chillerStoragePath(kind, week.weekStart)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(CHILLER_BUCKET)
      .upload(path, buffer, {
        contentType: type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const timestampColumn =
      kind === 'before' ? 'before_submitted_at' : 'after_submitted_at';
    const pathColumn = kind === 'before' ? 'before_path' : 'after_path';
    const oldPath =
      kind === 'before' ? record?.before_path || null : record?.after_path || null;

    let saved: ChillerRecord;

    if (record?.id) {
      const { data, error } = await supabaseAdmin
        .from('chiller_cleaning_submissions')
        .update({
          staff_name: staffName,
          [pathColumn]: path,
          [timestampColumn]: new Date().toISOString(),
        })
        .eq('id', record.id)
        .select('*')
        .single();

      if (error) throw error;
      saved = data as ChillerRecord;
    } else {
      const { data, error } = await supabaseAdmin
        .from('chiller_cleaning_submissions')
        .insert({
          week_start: week.weekStart,
          week_end: week.weekEnd,
          staff_name: staffName,
          [pathColumn]: path,
          [timestampColumn]: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (error) throw error;
      saved = data as ChillerRecord;
    }

    if (oldPath && oldPath !== path) {
      await supabaseAdmin.storage.from(CHILLER_BUCKET).remove([oldPath]);
    }

    return jsonNoCache({
      ok: true,
      week,
      record: await signChillerRecord(saved),
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to save image' },
      500
    );
  }
}
