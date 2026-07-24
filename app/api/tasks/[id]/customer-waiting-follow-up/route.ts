import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = String(params.id || '').trim();
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    if (
      user.role !== 'SUPERUSER'
      && user.role !== 'FO'
      && !user.can_access_fo_checklist
    ) {
      return jsonNoCache(
        { ok: false, error: 'You are not allowed to follow up customer-waiting tasks' },
        403
      );
    }

    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || '').trim();

    if (reason.length < 3) {
      return jsonNoCache({ ok: false, error: 'Enter the reason for the delay' }, 400);
    }
    if (reason.length > 500) {
      return jsonNoCache({ ok: false, error: 'Delay reason must be 500 characters or less' }, 400);
    }

    const { data, error: rpcError } = await supabaseAdmin.rpc(
      'record_customer_waiting_follow_up',
      {
        p_task_id: taskId,
        p_reason: reason,
        p_actor_name: user.name,
      }
    );

    if (rpcError) {
      const message = rpcError.message || 'Unable to save customer follow-up';
      const status = /no longer open|not found/i.test(message) ? 409 : 500;
      return jsonNoCache({ ok: false, error: message }, status);
    }

    const task = Array.isArray(data) ? data[0] : data;
    if (!task) {
      return jsonNoCache({ ok: false, error: 'Updated task was not returned' }, 500);
    }

    return jsonNoCache({
      ok: true,
      task,
      nextDueAt: task.customer_waiting_due_at,
      followUpCount: task.customer_waiting_follow_up_count,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unable to save customer follow-up' },
      500
    );
  }
}
