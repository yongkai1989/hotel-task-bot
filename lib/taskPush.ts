import webPush from 'web-push';
import { supabaseAdmin } from './supabaseAdmin';

type TimedTask = {
  id: string;
  task_code?: string | null;
  room?: string | null;
  department?: string | null;
  task_text?: string | null;
  customer_waiting?: boolean | null;
  customer_waiting_due_at?: string | null;
  urgent?: boolean | null;
  urgent_due_at?: string | null;
  alert_cycle?: number | null;
};

type StoredSubscription = {
  endpoint: string;
  subscription: webPush.PushSubscription;
};

export type TaskPushResult = {
  configured: boolean;
  attempted: number;
  delivered: number;
  removed: number;
  warning?: string;
};

function pushConfiguration() {
  const publicKey = String(process.env.WEB_PUSH_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEB_PUSH_PRIVATE_KEY || '').trim();
  const subject = String(process.env.WEB_PUSH_SUBJECT || '').trim();

  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function taskPayload(task: TimedTask) {
  const isUrgent = task.urgent === true;
  const taskCode = String(task.task_code || 'Task').trim();
  const room = String(task.room || 'No room/area').trim();
  const department = String(task.department || '').trim().toUpperCase();
  const description = String(task.task_text || 'Attention required').trim();

  return {
    title: isUrgent
      ? `URGENT ${department || 'HOTEL'} TASK`
      : 'CUSTOMER WAITING',
    body: `${taskCode} · ${room}\n${description}`,
    taskId: task.id,
    kind: isUrgent ? 'URGENT' : 'CUSTOMER_WAITING',
    dueAt: isUrgent ? task.urgent_due_at : task.customer_waiting_due_at,
    url: `/dashboard?task=${encodeURIComponent(task.id)}`,
    timestamp: Date.now(),
  };
}

export function getWebPushPublicKey() {
  return String(process.env.WEB_PUSH_PUBLIC_KEY || '').trim();
}

export async function sendTaskPushNotifications(
  task: TimedTask
): Promise<TaskPushResult> {
  const config = pushConfiguration();
  if (!config || (!task.urgent && !task.customer_waiting)) {
    return {
      configured: Boolean(config),
      attempted: 0,
      delivered: 0,
      removed: 0,
    };
  }

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const cycle = Math.max(Number(task.alert_cycle || 1), 1);
  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('task_alert_recipients')
    .select('user_id')
    .eq('task_id', task.id)
    .eq('alert_cycle', cycle)
    .is('acknowledged_at', null);

  if (recipientsError) {
    return {
      configured: true,
      attempted: 0,
      delivered: 0,
      removed: 0,
      warning: `Web Push recipients could not be loaded: ${recipientsError.message}`,
    };
  }

  const userIds = Array.from(
    new Set((recipients || []).map((row) => String(row.user_id || '')).filter(Boolean))
  );
  if (!userIds.length) {
    return { configured: true, attempted: 0, delivered: 0, removed: 0 };
  }

  const { data: subscriptions, error: subscriptionsError } = await supabaseAdmin
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('active', true)
    .in('user_id', userIds);

  if (subscriptionsError) {
    return {
      configured: true,
      attempted: 0,
      delivered: 0,
      removed: 0,
      warning: `Web Push subscriptions could not be loaded: ${subscriptionsError.message}`,
    };
  }

  const stored = (subscriptions || []) as StoredSubscription[];
  const payload = JSON.stringify(taskPayload(task));
  let delivered = 0;
  let removed = 0;
  const failures: string[] = [];

  await Promise.all(stored.map(async (row) => {
    try {
      await webPush.sendNotification(row.subscription, payload, {
        TTL: 10 * 60,
        urgency: 'high',
        topic: `task-${task.id}`.slice(0, 32),
      });
      delivered += 1;
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await supabaseAdmin
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', row.endpoint);
        if (!deleteError) removed += 1;
        return;
      }
      failures.push(error?.message || `Push service returned ${statusCode || 'an error'}`);
    }
  }));

  return {
    configured: true,
    attempted: stored.length,
    delivered,
    removed,
    warning: failures.length
      ? `${failures.length} Web Push notification(s) failed: ${failures[0]}`
      : undefined,
  };
}
