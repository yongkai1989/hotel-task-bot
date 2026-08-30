import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';
import { logRouteTiming } from '../../../lib/routeTiming';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 15;

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
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    stages.auth_ms = Date.now() - authStartedAt;
    if (!user) return respond({ ok: false, error: authError || 'Unauthorized' }, 401);

    const recipientsStartedAt = Date.now();
    const { data: recipients, error: recipientError } = await supabaseAdmin
      .from('task_alert_recipients')
      .select('task_id, alert_cycle, created_at')
      .eq('user_id', user.user_id)
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
      .select('id, task_code, room, department, task_text, status, customer_waiting, customer_waiting_due_at, urgent, urgent_due_at, alert_cycle, created_at')
      .in('id', taskIds)
      .eq('status', 'OPEN');
    stages.tasks_ms = Date.now() - tasksStartedAt;

    if (taskError) return respond({ ok: false, error: taskError.message }, 500);

    const taskMap = new Map((tasks || []).map((task) => [String(task.id), task]));
    const alerts = recipients.flatMap((recipient) => {
      const task = taskMap.get(String(recipient.task_id));
      if (!task || Number(task.alert_cycle || 1) !== Number(recipient.alert_cycle || 1)) return [];
      if (task.urgent !== true && task.customer_waiting !== true) return [];
      return [{
        ...task,
        alert_kind: task.urgent === true ? 'URGENT' : 'CUSTOMER_WAITING',
        due_at: task.urgent === true ? task.urgent_due_at : task.customer_waiting_due_at,
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
      .select('id, status, urgent, customer_waiting, alert_cycle')
      .eq('id', taskId)
      .maybeSingle();

    if (taskError) return jsonNoCache({ ok: false, error: taskError.message }, 500);
    if (!task || task.status !== 'OPEN' || (task.urgent !== true && task.customer_waiting !== true)) {
      return jsonNoCache({ ok: false, error: 'This alert is no longer active' }, 409);
    }

    const acknowledgedAt = new Date().toISOString();
    const { data: acknowledgement, error: acknowledgementError } = await supabaseAdmin
      .from('task_alert_recipients')
      .update({
        acknowledged_at: acknowledgedAt,
        acknowledged_name: user.name,
        acknowledged_email: user.email,
      })
      .eq('task_id', taskId)
      .eq('alert_cycle', Number(task.alert_cycle || 1))
      .eq('user_id', user.user_id)
      .is('acknowledged_at', null)
      .select('task_id, user_name, user_email, acknowledged_at, alert_cycle')
      .maybeSingle();

    if (acknowledgementError) {
      return jsonNoCache({ ok: false, error: acknowledgementError.message }, 500);
    }
    if (!acknowledgement) {
      return jsonNoCache({ ok: false, error: 'This alert was already acknowledged or was not assigned to you' }, 409);
    }

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: 'ALERT_ACKNOWLEDGED',
      event_text: `${task.urgent === true ? 'Urgent' : 'Customer-waiting'} popup acknowledged by ${user.name} (${user.email}) at ${acknowledgedAt}`,
      actor_name: user.name,
    });

    await broadcastTaskChange(taskId, 'UPDATE');
    return jsonNoCache({ ok: true, acknowledgement });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unable to acknowledge task alert' }, 500);
  }
}
