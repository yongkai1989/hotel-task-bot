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

let escalationRun: Promise<void> | null = null;
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

  await Promise.all(((data || []) as EscalationTask[]).map(async (task) => {
    const results = await Promise.allSettled([
      sendTaskEscalationPush(task),
      sendTelegramEscalation(task),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => String(result.reason?.message || result.reason));

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'ALERT_ESCALATED',
      event_text: failures.length
        ? `Unacknowledged alert follow-up ${task.escalation_number} sent with warning: ${failures[0]}`
        : `Unacknowledged alert follow-up ${task.escalation_number} sent to the assigned ${task.department} team and Telegram`,
      actor_name: 'System',
    });
    await broadcastTaskChange(task.id, 'UPDATE');
  }));
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

  await Promise.all(((data || []) as CompletionFollowUpTask[]).map(async (task) => {
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

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'COMPLETION_FOLLOW_UP',
      event_text: failures.length
        ? `Acknowledged task completion follow-up sent with warning: ${failures[0]}`
        : `Acknowledged task remains Open; completion follow-up sent to ${task.department}, FO and Telegram`,
      actor_name: 'System',
    });
    await broadcastTaskChange(task.id, 'UPDATE', { alertUserIds });
  }));
}

export async function processDueTaskEscalations() {
  if (Date.now() - lastEscalationCheckAt < CHECK_INTERVAL_MS) return;
  if (!escalationRun) {
    lastEscalationCheckAt = Date.now();
    escalationRun = Promise.all([runEscalations(), runCompletionFollowUps()])
      .then(() => undefined)
      .catch((error) => console.warn('Task escalation check failed:', error?.message || error))
      .finally(() => { escalationRun = null; });
  }
  await escalationRun;
}
