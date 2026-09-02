import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const LINK_SELECT = 'id, department, room_number, status, created_at, updated_at, checked_at' as const;

type LinkRow = {
  id: string;
  department: 'HK' | 'MT';
  room_number: string;
  status: 'OPEN' | 'PENDING_CHECK' | 'DONE';
  created_at: string | null;
  updated_at: string | null;
  checked_at: string | null;
};

function jsonNoCache(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizedRoom(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a: LinkRow, b: LinkRow) {
  return timestamp(b.created_at) - timestamp(a.created_at);
}

export async function GET(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    const canViewHousekeeping =
      user.role === 'SUPERUSER' || user.can_access_hk_manager_room_check === true;
    if (!canViewHousekeeping) {
      return jsonNoCache({ ok: false, error: 'Housekeeping Manager Room Check access required' }, 403);
    }

    const housekeepingResult = await supabaseAdmin
      .from('manager_room_checks')
      .select(LINK_SELECT)
      .eq('department', 'HK')
      .order('created_at', { ascending: false })
      .limit(120);

    if (housekeepingResult.error) {
      return jsonNoCache({ ok: false, error: housekeepingResult.error.message }, 500);
    }

    const housekeepingChecks = (housekeepingResult.data || []) as LinkRow[];
    const housekeepingRoomNumbers = Array.from(
      new Set(
        housekeepingChecks
          .map((check) => String(check.room_number || '').trim())
          .filter(Boolean)
      )
    );
    if (!housekeepingRoomNumbers.length) {
      return jsonNoCache({ ok: true, links: [] });
    }

    // A shared room number is the link. Assignment times are intentionally ignored.
    const maintenanceResult = await supabaseAdmin
      .from('manager_room_checks')
      .select(LINK_SELECT)
      .eq('department', 'MT')
      .in('room_number', housekeepingRoomNumbers)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (maintenanceResult.error) {
      return jsonNoCache({ ok: false, error: maintenanceResult.error.message }, 500);
    }

    const maintenanceChecks = (maintenanceResult.data || []) as LinkRow[];
    const maintenanceByRoom = new Map<string, LinkRow[]>();

    maintenanceChecks.forEach((check) => {
      const room = normalizedRoom(check.room_number);
      if (!room) return;
      const roomChecks = maintenanceByRoom.get(room) || [];
      roomChecks.push(check);
      maintenanceByRoom.set(room, roomChecks);
    });
    maintenanceByRoom.forEach((roomChecks) => roomChecks.sort(newestFirst));

    const links = housekeepingChecks.flatMap((housekeepingCheck) => {
      const room = normalizedRoom(housekeepingCheck.room_number);
      const candidates = maintenanceByRoom.get(room) || [];
      if (!candidates.length) return [];

      // Any unfinished MT assignment for the room keeps HK in Follow Up. If all MT
      // assignments are complete, use the most recently created one as the link.
      const linkedMaintenance =
        candidates.find((candidate) => candidate.status !== 'DONE') || candidates[0];

      return [
        {
          housekeeping_check_id: housekeepingCheck.id,
          maintenance_check_id: linkedMaintenance.id,
          room_number: room,
          status: linkedMaintenance.status === 'DONE' ? 'DONE' : 'PENDING',
          updated_at:
            linkedMaintenance.checked_at ||
            linkedMaintenance.updated_at ||
            linkedMaintenance.created_at,
        },
      ];
    });

    return jsonNoCache({ ok: true, links });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to load linked Maintenance status' },
      500
    );
  }
}
