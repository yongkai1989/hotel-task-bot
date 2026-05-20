import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type DepartmentCode = 'MT' | 'HK';

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

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: doneChecks, error: oldChecksError } = await supabaseAdmin
      .from('manager_room_checks')
      .select('id, checked_at, updated_at')
      .eq('department', department)
      .eq('status', 'DONE')
      .limit(100);

    if (oldChecksError) {
      return jsonNoCache({ ok: false, error: oldChecksError.message }, 500);
    }

    const cutoffMs = Date.parse(cutoff);
    const checkIds = (doneChecks || [])
      .filter((check) => {
        const referenceDate = check.checked_at || check.updated_at;
        const referenceMs = referenceDate ? Date.parse(referenceDate) : 0;
        return Number.isFinite(referenceMs) && referenceMs < cutoffMs;
      })
      .map((check) => check.id)
      .filter(Boolean);

    if (!checkIds.length) {
      return jsonNoCache({ ok: true, deleted: 0 });
    }

    const { data: mediaRows, error: mediaError } = await supabaseAdmin
      .from('manager_room_check_media')
      .select('media_path')
      .in('check_id', checkIds);

    if (mediaError) {
      return jsonNoCache({ ok: false, error: mediaError.message }, 500);
    }

    const mediaPaths = (mediaRows || [])
      .map((row) => String(row.media_path || '').trim())
      .filter(Boolean);

    if (mediaPaths.length) {
      await supabaseAdmin.storage.from('task-images').remove(mediaPaths);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('manager_room_checks')
      .delete()
      .in('id', checkIds);

    if (deleteError) {
      return jsonNoCache({ ok: false, error: deleteError.message }, 500);
    }

    return jsonNoCache({
      ok: true,
      deleted: checkIds.length,
      removedMedia: mediaPaths.length,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to clean old room checks' },
      500
    );
  }
}
