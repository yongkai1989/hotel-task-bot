import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { cleanupManagerRoomChecks } from '../../../../lib/storageMaintenance';

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

    const result = await cleanupManagerRoomChecks(department);

    return jsonNoCache({
      ok: true,
      deleted: result.checksRemoved,
      removedMedia: result.mediaRemoved,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to clean old room checks' },
      500
    );
  }
}
