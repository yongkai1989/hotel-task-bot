import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type DepartmentCode = 'MT' | 'HK';
const MANAGER_ROOM_CHECK_MEDIA_RETENTION_DAYS = 15;
const MANAGER_ROOM_CHECK_RETENTION_DAYS = 60;
const CLEANUP_BATCH_SIZE = 100;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeDepartment(value: unknown): DepartmentCode | null {
  const department = String(value || '').trim().toUpperCase();
  if (department === 'MT' || department === 'HK') return department;
  return null;
}

function hasDepartmentAccess(user: any, department: DepartmentCode) {
  if (user?.role === 'SUPERUSER') return true;
  if (department === 'MT') return user?.can_access_maintenance_manager_room_check === true;
  return user?.can_access_hk_manager_room_check === true;
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const department = normalizeDepartment(body.department);

    if (!department) {
      return jsonNoCache({ ok: false, error: 'Invalid department' }, 400);
    }

    if (!hasDepartmentAccess(user, department)) {
      return jsonNoCache({ ok: false, error: 'Access denied' }, 403);
    }

    const mediaCutoff = new Date(
      Date.now() - MANAGER_ROOM_CHECK_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const checkCutoff = new Date(
      Date.now() - MANAGER_ROOM_CHECK_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // checked_at is deliberately required. updated_at is not proof that a room
    // check was completed and must never be used to qualify media for removal.
    const { data: mediaEligibleChecks, error: mediaEligibleError } = await supabaseAdmin
      .from('manager_room_checks')
      .select('id, checked_at')
      .eq('department', department)
      .eq('status', 'DONE')
      .not('checked_at', 'is', null)
      .lt('checked_at', mediaCutoff)
      .order('checked_at', { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);

    if (mediaEligibleError) {
      return jsonNoCache({ ok: false, error: mediaEligibleError.message }, 500);
    }

    const mediaEligibleIds = (mediaEligibleChecks || []).map((check) => check.id).filter(Boolean);
    let removedMedia = 0;

    if (mediaEligibleIds.length) {
      const [mediaResult, uploadResult] = await Promise.all([
        supabaseAdmin
          .from('manager_room_check_media')
          .select('media_path')
          .in('check_id', mediaEligibleIds),
        supabaseAdmin
          .from('manager_room_check_uploads')
          .select('storage_path')
          .in('check_id', mediaEligibleIds),
      ]);

      if (mediaResult.error) return jsonNoCache({ ok: false, error: mediaResult.error.message }, 500);
      if (uploadResult.error) return jsonNoCache({ ok: false, error: uploadResult.error.message }, 500);

      const mediaPaths = Array.from(new Set([
        ...(mediaResult.data || []).map((row) => String(row.media_path || '').trim()),
        ...(uploadResult.data || []).map((row) => String(row.storage_path || '').trim()),
      ].filter(Boolean)));

      if (mediaPaths.length) {
        const { error: storageError } = await supabaseAdmin.storage.from('task-images').remove(mediaPaths);
        if (storageError) return jsonNoCache({ ok: false, error: storageError.message }, 500);
      }

      const [mediaDelete, uploadDelete] = await Promise.all([
        supabaseAdmin.from('manager_room_check_media').delete().in('check_id', mediaEligibleIds),
        supabaseAdmin.from('manager_room_check_uploads').delete().in('check_id', mediaEligibleIds),
      ]);
      if (mediaDelete.error) return jsonNoCache({ ok: false, error: mediaDelete.error.message }, 500);
      if (uploadDelete.error) return jsonNoCache({ ok: false, error: uploadDelete.error.message }, 500);
      removedMedia = mediaPaths.length;
    }

    const { data: expiredChecks, error: expiredChecksError } = await supabaseAdmin
      .from('manager_room_checks')
      .select('id')
      .eq('department', department)
      .eq('status', 'DONE')
      .not('checked_at', 'is', null)
      .lt('checked_at', checkCutoff)
      .order('checked_at', { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);
    if (expiredChecksError) {
      return jsonNoCache({ ok: false, error: expiredChecksError.message }, 500);
    }
    const expiredCheckIds = (expiredChecks || []).map((check) => check.id).filter(Boolean);
    if (expiredCheckIds.length) {
      const { error: deleteError } = await supabaseAdmin
        .from('manager_room_checks')
        .delete()
        .in('id', expiredCheckIds);
      if (deleteError) return jsonNoCache({ ok: false, error: deleteError.message }, 500);
    }

    return jsonNoCache({
      ok: true,
      deleted: expiredCheckIds.length,
      mediaEligibleChecks: mediaEligibleIds.length,
      removedMedia,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to clean old room checks' },
      500
    );
  }
}
