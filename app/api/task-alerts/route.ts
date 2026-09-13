import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
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
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    stages.auth_ms = Date.now() - authStartedAt;
    if (!user) return respond({ ok: false, error: authError || 'Unauthorized' }, 401);
    const userId = user.user_id;

    const escalationStartedAt = Date.now();
    await processDueTaskEscalations();
    stages.escalation_ms = Date.now() - escalationStartedAt;

    const recipientsStartedAt = Date.now();
    const isFoFollowUpUser = user.role === 'FO' && user.can_access_fo_quick_actions === true;
    let completionQuery = supabaseAdmin
      .from('tasks')
      .select('id, task_code, room, department, task_text, status, customer_waiting, urgent, alert_cycle, alert_acknowledged_at, completion_follow_up_due_at, completion_follow_up_sent_at, created_at')
      .eq('status', 'OPEN')
      .not('alert_acknowledged_at', 'is', null)
      .not('completion_follow_up_sent_at', 'is', null)
      .or('urgent.eq.true,customer_waiting.eq.true')
      .order('completion_follow_up_due_at', { ascending: true })
      .limit(30);
    if (!isFoFollowUpUser) {
      if (
        (user.role === 'HK' || user.role === 'SUPERVISOR')
        && user.can_access_chambermaid_entry === true
        && user.can_update_task_status === true
      ) completionQuery = completionQuery.eq('department', 'HK');
      else if (user.role === 'MT' && user.can_update_task_status === true) {
        completionQuery = completionQuery.eq('department', 'MT');
      } else completionQuery = completionQuery.eq('department', '__NONE__');
    }
    const [recipientResult, completionResult] = await Promise.all([
      supabaseAdmin
        .from('task_alert_recipients')
        .select('task_id, alert_cycle, created_at')
        .eq('user_id', userId)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: true })
        .limit(30),
      completionQuery,
    ]);
    const { data: recipients, error: recipientError } = recipientResult;
    const { data: completionTasks, error: completionError } = completionResult;
    stages.recipients_ms = Date.now() - recipientsStartedAt;

    if (recipientError) return respond({ ok: false, error: recipientError.message }, 500);
    if (completionError) return respond({ ok: false, error: completionError.message }, 500);

    const taskIds = Array.from(new Set((recipients || []).map((row) => String(row.task_id))));
    const tasksStartedAt = Date.now();
    const { data: tasks, error: taskError } = taskIds.length
      ? await supabaseAdmin
          .from('tasks')
          .select('id, task_code, room, department, task_text, status, source_page, customer_waiting, customer_waiting_due_at, urgent, urgent_due_at, alert_cycle, alert_acknowledged_at, alert_escalation_count, created_at')
          .in('id', taskIds)
          .eq('status', 'OPEN')
      : { data: [], error: null };
    stages.tasks_ms = Date.now() - tasksStartedAt;

    if (taskError) return respond({ ok: false, error: taskError.message }, 500);

    const taskMap = new Map((tasks || []).map((task) => [String(task.id), task]));
    const acknowledgementAlerts = (recipients || []).flatMap((recipient) => {
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

    const completionAlerts = (completionTasks || []).flatMap((task) => {
      const department = String(task.department || '').trim().toUpperCase();
      const isDepartmentUser =
        (department === 'HK'
          && (user.role === 'HK' || user.role === 'SUPERVISOR')
          && user.can_access_chambermaid_entry === true
          && user.can_update_task_status === true)
        || (department === 'MT' && user.role === 'MT' && user.can_update_task_status === true);
      if (!isDepartmentUser && !isFoFollowUpUser) return [];
      return [{
        ...task,
        alert_kind: isFoFollowUpUser ? 'FOLLOW_UP_FO' : 'FOLLOW_UP_DEPARTMENT',
        due_at: task.completion_follow_up_due_at,
      }];
    });
    const alerts = [...acknowledgementAlerts, ...completionAlerts]
      .sort((a, b) => Date.parse(String(a.created_at || '')) - Date.parse(String(b.created_at || '')));

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
    const action = String(body.action || 'ACKNOWLEDGE').trim().toUpperCase();
    if (!taskId) return jsonNoCache({ ok: false, error: 'Task is required' }, 400);

    const { data: task, error: taskError } = await supabaseAdmin
      .from('tasks')
      .select('id, status, department, source_page, urgent, customer_waiting, alert_cycle, alert_acknowledged_at, completion_follow_up_sent_at')
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

    if (action === 'DOING_NOW') {
      const department = String(task.department || '').trim().toUpperCase();
      const canHandleDepartmentFollowUp =
        (department === 'HK'
          && (user.role === 'HK' || user.role === 'SUPERVISOR')
          && user.can_access_chambermaid_entry === true
          && user.can_update_task_status === true)
        || (department === 'MT' && user.role === 'MT' && user.can_update_task_status === true);
      if (!canHandleDepartmentFollowUp) {
        return jsonNoCache({ ok: false, error: 'This completion check is not assigned to your department' }, 403);
      }
      if (!task.alert_acknowledged_at || !task.completion_follow_up_sent_at) {
        return jsonNoCache({ ok: false, error: 'This completion check is no longer active' }, 409);
      }

      const nextDueAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const updatedAt = new Date().toISOString();
      const { data: updatedTask, error: updateError } = await supabaseAdmin
        .from('tasks')
        .update({
          completion_follow_up_repeat: true,
          completion_follow_up_due_at: nextDueAt,
          completion_follow_up_sent_at: null,
          updated_at: updatedAt,
        })
        .eq('id', taskId)
        .eq('alert_cycle', Number(task.alert_cycle || 1))
        .eq('status', 'OPEN')
        .not('alert_acknowledged_at', 'is', null)
        .not('completion_follow_up_sent_at', 'is', null)
        .select('id')
        .maybeSingle();

      if (updateError) return jsonNoCache({ ok: false, error: updateError.message }, 500);
      if (!updatedTask) {
        return jsonNoCache({ ok: false, error: 'This completion check was already handled' }, 409);
      }

      await supabaseAdmin.from('task_events').insert({
        task_id: taskId,
        event_type: 'COMPLETION_DOING_NOW',
        event_text: `${user.name} selected Doing Now; the next completion check is scheduled in 5 minutes and will repeat until Done.`,
        actor_name: user.name,
      });

      await broadcastTaskChange(taskId, 'UPDATE');
      return jsonNoCache({ ok: true, nextDueAt });
    }

    if (action !== 'ACKNOWLEDGE') {
      return jsonNoCache({ ok: false, error: 'Unsupported task alert action' }, 400);
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
    const completionFollowUpDueAt = task.urgent === true
      ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : task.customer_waiting === true
        ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
        : null;
    const { data: claimedTask, error: claimError } = await supabaseAdmin
      .from('tasks')
      .update({
        alert_acknowledged_at: acknowledgedAt,
        alert_acknowledged_by_name: user.name,
        alert_acknowledged_by_email: user.email,
        completion_follow_up_due_at: completionFollowUpDueAt,
        completion_follow_up_sent_at: null,
        completion_follow_up_repeat: false,
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
