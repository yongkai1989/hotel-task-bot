import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardIdentityFromRequest, getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';
import { logRouteTiming } from '../../../lib/routeTiming';
import { processDueTaskEscalations } from '../../../lib/taskEscalation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

function jsonNoCache(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' },
  });
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = req.headers.get('x-vercel-id');
  const stages: Record<string, number> = {};
  const respond = (body: unknown, status = 200) => {
    const error = status >= 400 && body && typeof body === 'object'
      ? String((body as { error?: unknown }).error || '')
      : undefined;
    logRouteTiming({ route: '/api/task-alerts', method: 'GET', startedAt, status, requestId, stages, error });
    return jsonNoCache(body, status);
  };
  try {
    const authStartedAt = Date.now();
    const { user_id: userId, error: authError } = await getDashboardIdentityFromRequest(req);
    stages.auth_ms = Date.now() - authStartedAt;
    if (!userId) return respond({ ok: false, error: authError || 'Unauthorized' }, 401);

    const escalationStartedAt = Date.now();
    await processDueTaskEscalations();
    stages.escalation_ms = Date.now() - escalationStartedAt;

    const recipientsStartedAt = Date.now();
    const { data: recipients, error: recipientError } = await supabaseAdmin
      .from('task_alert_recipients')
      .select('task_id, alert_cycle, created_at')
      .eq('user_id', userId)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: true })
      .limit(30);
    stages.recipients_ms = Date.now() - recipientsStartedAt;

    if (recipientError) return respond({ ok: false, error: recipientError.message }, 500);
    if (!recipients?.length) return respond({ ok: true, alerts: [] });

    const taskIds = Array.from(new Set(recipients.map((row) => String(row.task_id))));
    const tasksStartedAt = Date.now();
    const { data: tasks, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id, task_code, room, department, task_text, status, source_page, customer_waiting, customer_waiting_due_at, urgent, urgent_due_at, alert_cycle, alert_acknowledged_at, alert_escalation_count, created_at')
      .in('id', taskIds)
      .eq('status', 'OPEN');
    stages.tasks_ms = Date.now() - tasksStartedAt;

    if (taskError) return respond({ ok: false, error: taskError.message }, 500);

    const taskMap = new Map((tasks || []).map((task) => [String(task.id), task]));
    const alerts = recipients.flatMap((recipient) => {
      const task = taskMap.get(String(recipient.task_id));
      if (
        !task ||
        task.alert_acknowledged_at ||
        Number(task.alert_cycle || 1) !== Number(recipient.alert_cycle || 1)
      ) return [];
      const isChambermaidDefect = task.source_page === 'CHAMBERMAID_ENTRY';
      if (task.urgent !== true && task.customer_waiting !== true && !isChambermaidDefect) return [];
      return [{
        ...task,
        alert_kind: task.urgent === true
          ? 'URGENT'
          : task.customer_waiting === true
            ? 'CUSTOMER_WAITING'
            : 'CHAMBERMAID_DEFECT',
        due_at: task.urgent === true ? task.urgent_due_at : task.customer_waiting_due_at,
        escalation_count: Number(task.alert_escalation_count || 0),
      }];
    });

    return respond({ ok: true, alerts });
  } catch (error: any) {
    return respond({ ok: false, error: error?.message || 'Unable to load task alerts' }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (!user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const taskId = String(body.taskId || '').trim();
    if (!taskId) return jsonNoCache({ ok: false, error: 'Task is required' }, 400);

    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id, status, source_page, urgent, customer_waiting, alert_cycle, alert_acknowledged_at')
      .eq('id', taskId)
      .maybeSingle();

    if (taskError) return jsonNoCache({ ok: false, error: taskError.message }, 500);
    if (
      !task ||
      task.status !== 'OPEN' ||
      (task.urgent !== true && task.customer_waiting !== true && task.source_page !== 'CHAMBERMAID_ENTRY')
    ) {
      return jsonNoCache({ ok: false, error: 'This alert is no longer active' }, 409);
    }

    const currentCycle = Number(task.alert_cycle || 1);
    const { data: recipient, error: recipientError } = await supabaseAdmin
      .from('task_alert_recipients')
      .select('task_id')
      .eq('task_id', taskId)
      .eq('alert_cycle', currentCycle)
      .eq('user_id', user.user_id)
      .is('acknowledged_at', null)
      .maybeSingle();

    if (recipientError) return jsonNoCache({ ok: false, error: recipientError.message }, 500);
    if (!recipient) {
      return jsonNoCache({ ok: false, error: 'This alert is not assigned to your department' }, 403);
    }

    const acknowledgedAt = new Date().toISOString();
    const { data: claimedTask, error: claimError } = await supabaseAdmin
      .from('tasks')
      .update({
        alert_acknowledged_at: acknowledgedAt,
        alert_acknowledged_by_name: user.name,
        alert_acknowledged_by_email: user.email,
        updated_at: acknowledgedAt,
      })
      .eq('id', taskId)
      .eq('alert_cycle', currentCycle)
      .eq('status', 'OPEN')
      .is('alert_acknowledged_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) return jsonNoCache({ ok: false, error: claimError.message }, 500);
    if (!claimedTask) {
      return jsonNoCache({ ok: false, error: 'This alert was already acknowledged' }, 409);
    }

    const { data: acknowledgementRows, error: acknowledgementError } = await supabaseAdmin
      .from('task_alert_recipients')
      .update({
        acknowledged_at: acknowledgedAt,
        acknowledged_name: user.name,
        acknowledged_email: user.email,
      })
      .eq('task_id', taskId)
      .eq('alert_cycle', currentCycle)
      .is('acknowledged_at', null)
      .select('task_id, user_name, user_email, acknowledged_at, alert_cycle');

    if (acknowledgementError) {
      return jsonNoCache({ ok: false, error: acknowledgementError.message }, 500);
    }
    const acknowledgement = {
      task_id: taskId,
      acknowledged_at: acknowledgedAt,
      acknowledged_name: user.name,
      alert_cycle: currentCycle,
      recipients_cleared: acknowledgementRows?.length || 0,
    };

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'ALERT_ACKNOWLEDGED',
      event_text: `${task.urgent === true ? 'Urgent' : task.customer_waiting === true ? 'Customer-waiting' : 'Chambermaid defect'} popup acknowledged by ${user.name} (${user.email}) at ${acknowledgedAt}`,
      actor_name: user.name,
    });

    await broadcastTaskChange(taskId, 'UPDATE');
    return jsonNoCache({ ok: true, acknowledgement });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to acknowledge task alert' }, 500);
  }
}
