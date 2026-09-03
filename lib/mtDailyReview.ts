import { supabaseAdmin } from './supabaseAdmin';

const MT_TASK_CHAT_ID = '-1003860980789';
const NOTIFICATION_TYPE = 'MT_DAILY_REVIEW_9AM';

type MtTask = {
  task_code?: string;
  room?: string;
  task_text?: string;
  created_at?: string;
};

type ManagerRoomCheck = {
  room_number?: string;
  status?: string;
  created_at?: string;
};

type PreventiveMaintenanceRun = {
  due_date?: string;
  status?: string;
  pm_tasks?: { title?: string } | Array<{ title?: string }>;
};

function displayDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}/${month}/${year}` : '-';
}

function telegramChunks(lines: string[]) {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const candidate = [...current, line].join('\n');
    if (candidate.length > 3800 && current.length) {
      chunks.push(current.join('\n'));
      current = ['🔧 9:00 AM MAINTENANCE DAILY REVIEW (CONTINUED)', '', line];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

async function sendTelegramMessage(text: string) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: MT_TASK_CHAT_ID,
      text: text.slice(0, 4090),
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Maintenance daily review Telegram send failed');
  }
  return Number(payload?.result?.message_id || 0) || null;
}

function pmTitle(run: PreventiveMaintenanceRun) {
  const task = Array.isArray(run.pm_tasks) ? run.pm_tasks[0] : run.pm_tasks;
  return String(task?.title || 'Maintenance task').trim();
}

async function sendMtDailyReview(today: string) {
  const [taskResult, managerRoomCheckResult, pmResult] = await Promise.all([
    supabaseAdmin
      .from('tasks')
      .select('task_code, room, task_text, created_at')
      .eq('department', 'MT')
      .eq('status', 'OPEN')
      .not('task_text', 'ilike', 'Urgent Manager Room Check%')
      .order('created_at', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('manager_room_checks')
      .select('room_number, status, created_at')
      .eq('department', 'MT')
      .neq('status', 'DONE')
      .order('created_at', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('pm_task_runs')
      .select('due_date, status, pm_tasks!inner(title)')
      .eq('pm_tasks.is_active', true)
      .neq('status', 'DONE')
      .order('due_date', { ascending: true })
      .limit(100),
  ]);
  if (taskResult.error) throw taskResult.error;
  if (managerRoomCheckResult.error) throw managerRoomCheckResult.error;
  if (pmResult.error) throw pmResult.error;

  const tasks = (taskResult.data || []) as MtTask[];
  const managerRoomChecks = (managerRoomCheckResult.data || []) as ManagerRoomCheck[];
  const pmRuns = (pmResult.data || []) as PreventiveMaintenanceRun[];
  const overduePm = pmRuns.filter((run) => String(run.due_date || '') < today);
  const otherOpenPm = pmRuns.filter((run) => String(run.due_date || '') >= today);

  const lines = [
    '🔧 9:00 AM MAINTENANCE DAILY REVIEW',
    `Date: ${displayDate(today)}`,
    '',
    `📋 OPEN MT TASKS — ${tasks.length ? `❌ ${tasks.length} pending` : '✅ none pending'}`,
  ];

  for (const task of tasks) {
    lines.push(`• ${task.task_code || 'Task'} | Room ${task.room || '-'} | ${task.task_text || 'No description'}`);
  }

  lines.push(
    '',
    `🏨 MANAGER ROOM CHECKS — ${managerRoomChecks.length ? `❌ ${managerRoomChecks.length} incomplete` : '✅ none incomplete'}`
  );
  for (const check of managerRoomChecks) {
    const status = String(check.status || 'OPEN').replaceAll('_', ' ');
    lines.push(`• Room ${check.room_number || '-'} | ${status}`);
  }

  lines.push(
    '',
    `🚨 OVERDUE PREVENTIVE MAINTENANCE — ${overduePm.length ? `❌ ${overduePm.length} overdue` : '✅ none overdue'}`
  );
  for (const run of overduePm) {
    lines.push(`• ${pmTitle(run)} | Due ${displayDate(String(run.due_date || ''))}`);
  }

  lines.push(
    '',
    `🛠️ OPEN PREVENTIVE MAINTENANCE — ${otherOpenPm.length ? `${otherOpenPm.length} pending` : 'none pending'}`
  );
  for (const run of otherOpenPm) {
    lines.push(`• ${pmTitle(run)} | Due ${displayDate(String(run.due_date || ''))}`);
  }

  lines.push(
    '',
    'Please follow up and update each item as work progresses.'
  );

  const messages = telegramChunks(lines);
  const telegramMessageIds: number[] = [];
  for (const message of messages) {
    const messageId = await sendTelegramMessage(message);
    if (messageId) telegramMessageIds.push(messageId);
  }

  return {
    findingCount: tasks.length + managerRoomChecks.length + pmRuns.length,
    attempted: messages.length,
    delivered: 0,
    telegramMessageId: telegramMessageIds[0] || null,
    details: {
      openTaskCount: tasks.length,
      managerRoomCheckCount: managerRoomChecks.length,
      overduePmCount: overduePm.length,
      otherOpenPmCount: otherOpenPm.length,
      telegramMessageIds,
    },
  };
}

export async function runMtDailyReviewOnce(today: string, force = false) {
  if (!force) {
    const { data: existing, error } = await supabaseAdmin
      .from('daily_operational_notification_runs')
      .select('status, sent_at, finding_count, delivered_count, telegram_message_id, details')
      .eq('notification_date', today)
      .eq('notification_type', NOTIFICATION_TYPE)
      .maybeSingle();
    if (error) throw error;
    if (existing?.status === 'SENT') {
      return { ok: true, alreadySent: true, notificationDate: today, reminderType: NOTIFICATION_TYPE, ...existing };
    }
  }

  await supabaseAdmin.from('daily_operational_notification_runs').upsert({
    notification_date: today,
    notification_type: NOTIFICATION_TYPE,
    status: 'SENDING',
    attempted_at: new Date().toISOString(),
    sent_at: null,
    error_text: null,
  });

  try {
    const result = await sendMtDailyReview(today);
    const sentAt = new Date().toISOString();
    await supabaseAdmin
      .from('daily_operational_notification_runs')
      .update({
        status: 'SENT',
        sent_at: sentAt,
        finding_count: result.findingCount,
        attempted_count: result.attempted,
        delivered_count: result.delivered,
        telegram_message_id: result.telegramMessageId,
        details: result.details,
        error_text: null,
      })
      .eq('notification_date', today)
      .eq('notification_type', NOTIFICATION_TYPE);

    return {
      ok: true,
      notificationDate: today,
      reminderType: NOTIFICATION_TYPE,
      status: 'SENT',
      sentAt,
      ...result,
    };
  } catch (error: any) {
    const message = error?.message || 'Maintenance daily review failed';
    await supabaseAdmin
      .from('daily_operational_notification_runs')
      .update({ status: 'FAILED', error_text: message })
      .eq('notification_date', today)
      .eq('notification_type', NOTIFICATION_TYPE);
    throw new Error(message);
  }
}
