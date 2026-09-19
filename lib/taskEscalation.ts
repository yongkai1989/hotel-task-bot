import { supabaseAdmin } from './supabaseAdmin';
import { broadcastTaskChange } from './taskBroadcastServer';
import { sendTaskCompletionFollowUpPush, sendTaskEscalationPush } from './taskPush';

type EscalationTask = {
  id: string;
  task_code: string;
  room: string;
  department: string;
  task_text: string;
  chat_id: number;
  urgent: boolean;
  customer_waiting: boolean;
  due_at: string;
  alert_cycle: number;
  escalation_number: number;
};

type CompletionFollowUpTask = Omit<EscalationTask, 'due_at' | 'escalation_number'> & {
  alert_acknowledged_at: string;
  completion_follow_up_due_at: string;
};

type EscalationRunSummary = {
  escalations: number;
  completionFollowUps: number;
  skipped?: boolean;
};

let escalationRun: Promise<EscalationRunSummary> | null = null;
let lastEscalationCheckAt = 0;
const CHECK_INTERVAL_MS = 30_000;

async function sendTelegramEscalation(task: EscalationTask) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken || !task.chat_id) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const kind = task.urgent ? 'URGENT TASK' : 'CUSTOMER-WAITING TASK';
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: task.chat_id,
        text: [
          `⚠️ FOLLOW UP ${task.escalation_number} — ${kind} NOT ACKNOWLEDGED`,
          `Task ID: ${task.task_code}`,
          `Room: ${task.room}`,
          `Department: ${task.department}`,
          `Task: ${task.task_text}`,
          '',
          'PENTING: Tekan ACKNOWLEDGE dalam aplikasi hanya jika aras ini di bawah tanggungjawab anda.',
          'Jika bukan, tekan CLOSE supaya petugas yang bertanggungjawab boleh mengesahkannya.',
          '',
          'Mark Done only after the work is completed.',
        ].join('\n'),
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function runEscalations() {
  const { data, error } = await supabaseAdmin.rpc('claim_due_task_alert_escalations', {
    p_limit: 20,
  });
  if (error) throw error;

  const tasks = (data || []) as EscalationTask[];
  await Promise.all(tasks.map(async (task) => {
    const results = await Promise.allSettled([
      sendTaskEscalationPush(task),
      sendTelegramEscalation(task),
    ]);
    const pushResult = results[0].status === 'fulfilled' ? results[0].value : null;
    const alertUserIds = pushResult?.recipientUserIds || [];
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason?.message || result.reason));
    if (pushResult?.warning) failures.push(pushResult.warning);

    console.log(JSON.stringify({
      event: 'task_alert_escalation_delivery',
      taskId: task.id,
      taskCode: task.task_code,
      escalationNumber: task.escalation_number,
      recipientCount: alertUserIds.length,
      pushAttempted: pushResult?.attempted || 0,
      pushAccepted: pushResult?.delivered || 0,
      pushRemoved: pushResult?.removed || 0,
      pushWarning: pushResult?.warning || null,
      telegramSent: results[1].status === 'fulfilled',
      failure: failures[0] || null,
    }));

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'ALERT_ESCALATED',
      event_text: [
        `Unacknowledged alert follow-up ${task.escalation_number}.`,
        `Web Push accepted ${pushResult?.delivered || 0}/${pushResult?.attempted || 0}.`,
        results[1].status === 'fulfilled' ? 'Telegram sent.' : 'Telegram failed.',
        failures.length ? `Warning: ${failures[0]}` : '',
      ].filter(Boolean).join(' '),
      actor_name: 'System',
    });
    await broadcastTaskChange(task.id, 'UPDATE', { alertUserIds });
  }));
  return tasks.length;
}

async function sendTelegramCompletionFollowUp(task: CompletionFollowUpTask) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) return;

  const foChatId = Number(String(process.env.FO_TELEGRAM_CHAT_ID || process.env.ALLOWED_CHAT_ID || '').trim());
  const chatIds = Array.from(new Set([
    Number(task.chat_id || 0),
    Number.isFinite(foChatId) ? foChatId : 0,
  ].filter((chatId) => Number.isFinite(chatId) && chatId !== 0)));
  if (!chatIds.length) return;

  const kind = task.urgent ? 'URGENT TASK' : 'CUSTOMER-WAITING TASK';
  const target = task.urgent ? '5 minutes' : '10 minutes';
  await Promise.all(chatIds.map(async (chatId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: [
            `⏰ COMPLETION FOLLOW-UP — ${kind} STILL OPEN`,
            `Task ID: ${task.task_code}`,
            `Room: ${task.room}`,
            `Department: ${task.department}`,
            `Task: ${task.task_text}`,
            '',
            `This task was acknowledged but remains Open after ${target}.`,
            `${task.department}: Adakah tugasan ini sudah selesai? Jika sudah, sila tandakan DONE dalam aplikasi.`,
            `FO: Sila follow up dengan ${task.department} sehingga tugasan selesai.`,
          ].join('\n'),
        }),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }));
}

async function runCompletionFollowUps() {
  const { data, error } = await supabaseAdmin.rpc('claim_due_acknowledged_task_followups', {
    p_limit: 20,
  });
  if (error) throw error;

  const tasks = (data || []) as CompletionFollowUpTask[];
  await Promise.all(tasks.map(async (task) => {
    const [pushResult, telegramResult] = await Promise.allSettled([
      sendTaskCompletionFollowUpPush(task),
      sendTelegramCompletionFollowUp(task),
    ]);
    const alertUserIds = pushResult.status === 'fulfilled'
      ? pushResult.value.recipientUserIds || []
      : [];
    const failures = [pushResult, telegramResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason?.message || result.reason));
    if (pushResult.status === 'fulfilled' && pushResult.value.warning) {
      failures.push(pushResult.value.warning);
    }

    console.log(JSON.stringify({
      event: 'task_completion_followup_delivery',
      taskId: task.id,
      taskCode: task.task_code,
      recipientCount: alertUserIds.length,
      pushAttempted: pushResult.status === 'fulfilled' ? pushResult.value.attempted : 0,
      pushAccepted: pushResult.status === 'fulfilled' ? pushResult.value.delivered : 0,
      telegramSent: telegramResult.status === 'fulfilled',
      failure: failures[0] || null,
    }));

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'COMPLETION_FOLLOW_UP',
      event_text: [
        `Acknowledged task remains Open; completion follow-up prepared for ${task.department} and FO.`,
        `Web Push accepted ${pushResult.status === 'fulfilled' ? pushResult.value.delivered : 0}/${pushResult.status === 'fulfilled' ? pushResult.value.attempted : 0}.`,
        telegramResult.status === 'fulfilled' ? 'Telegram sent.' : 'Telegram failed.',
        failures.length ? `Warning: ${failures[0]}` : '',
      ].filter(Boolean).join(' '),
      actor_name: 'System',
    });
    await broadcastTaskChange(task.id, 'UPDATE', { alertUserIds });
  }));
  return tasks.length;
}

export async function processDueTaskEscalations(options: {
  force?: boolean;
  throwOnError?: boolean;
} = {}): Promise<EscalationRunSummary> {
  if (!options.force && Date.now() - lastEscalationCheckAt < CHECK_INTERVAL_MS) {
    return { escalations: 0, completionFollowUps: 0, skipped: true };
  }
  if (!escalationRun) {
    lastEscalationCheckAt = Date.now();
    escalationRun = Promise.all([runEscalations(), runCompletionFollowUps()])
      .then(([escalations, completionFollowUps]) => ({ escalations, completionFollowUps }))
      .finally(() => { escalationRun = null; });
  }
  try {
    return await escalationRun;
  } catch (error: any) {
    if (options.throwOnError) throw error;
    console.warn('Task escalation check failed:', error?.message || error);
    return { escalations: 0, completionFollowUps: 0 };
  }
}
