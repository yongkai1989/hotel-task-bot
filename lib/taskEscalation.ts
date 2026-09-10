import { supabaseAdmin } from './supabaseAdmin';
import { broadcastTaskChange } from './taskBroadcastServer';
import { sendTaskEscalationPush } from './taskPush';

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
          'Please acknowledge in the app immediately. Mark Done only after the work is completed.',
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
    p_limit: 5,
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
        : `Unacknowledged alert follow-up ${task.escalation_number} sent to ${task.department} supervisors and Telegram`,
      actor_name: 'System',
    });
    await broadcastTaskChange(task.id, 'UPDATE');
  }));
}

export async function processDueTaskEscalations() {
  if (Date.now() - lastEscalationCheckAt < CHECK_INTERVAL_MS) return;
  if (!escalationRun) {
    lastEscalationCheckAt = Date.now();
    escalationRun = runEscalations()
      .catch((error) => console.warn('Task escalation check failed:', error?.message || error))
      .finally(() => { escalationRun = null; });
  }
  await escalationRun;
}
