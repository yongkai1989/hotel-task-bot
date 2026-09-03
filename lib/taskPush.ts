import webPush from 'web-push';
import { supabaseAdmin } from './supabaseAdmin';

type TaskForPush = {
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

type PushProfile = {
  user_id: string;
  name?: string | null;
  email?: string | null;
};

type StoredSubscription = {
  endpoint: string;
  subscription: webPush.PushSubscription;
};

export type PushPayload = {
  title: string;
  body: string;
  kind?: 'TASK' | 'URGENT' | 'CUSTOMER_WAITING' | 'REMINDER';
  taskId?: string;
  url?: string;
  dueAt?: string | null;
  timestamp?: number;
};

export type TaskPushResult = {
  configured: boolean;
  attempted: number;
  delivered: number;
  removed: number;
  warning?: string;
};

export const HK_SUPERVISOR_PUSH_EMAILS = [
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
] as const;

export const HK_PUSH_EMAILS = [
  ...HK_SUPERVISOR_PUSH_EMAILS,
  'manager@hotelhallmark.com',
] as const;

export const MT_SUPERVISOR_PUSH_EMAILS = [
  'mtsup1@hotelhallmark.com',
  'mtsup2@hotelhallmark.com',
] as const;

const PROFILE_CACHE_MS = 60_000;
let profileCache: { expiresAt: number; profiles: PushProfile[] } | null = null;

function pushConfiguration() {
  const publicKey = String(process.env.WEB_PUSH_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEB_PUSH_PRIVATE_KEY || '').trim();
  const subject = String(process.env.WEB_PUSH_SUBJECT || '').trim();

  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function normalizedDepartment(value: unknown) {
  const department = String(value || '').trim().toUpperCase();
  return department === 'HK' || department === 'MT' ? department : '';
}

function normalizedEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizedName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function loadPushProfiles() {
  if (profileCache && profileCache.expiresAt > Date.now()) return profileCache.profiles;

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, name, email')
    .not('user_id', 'is', null);

  if (error) throw error;
  const profiles = (data || []) as PushProfile[];
  profileCache = { expiresAt: Date.now() + PROFILE_CACHE_MS, profiles };
  return profiles;
}

export async function resolvePushProfiles(params: {
  emails?: readonly string[];
  names?: readonly string[];
}) {
  const emailSet = new Set((params.emails || []).map(normalizedEmail).filter(Boolean));
  const nameSet = new Set((params.names || []).map(normalizedName).filter(Boolean));
  if (!emailSet.size && !nameSet.size) return [] as PushProfile[];

  const profiles = await loadPushProfiles();
  return profiles.filter((profile) => {
    const email = normalizedEmail(profile.email);
    const name = normalizedName(profile.name);
    return (email && emailSet.has(email)) || (name && nameSet.has(name));
  });
}

export async function resolveDepartmentPushProfiles(departmentValue: unknown) {
  const department = normalizedDepartment(departmentValue);
  if (department === 'HK') return resolvePushProfiles({ emails: HK_PUSH_EMAILS });
  if (department === 'MT') {
    return resolvePushProfiles({
      emails: MT_SUPERVISOR_PUSH_EMAILS,
      names: ['Maintenance'],
    });
  }
  return [] as PushProfile[];
}

function taskPayload(task: TaskForPush): PushPayload {
  const isUrgent = task.urgent === true;
  const isCustomerWaiting = task.customer_waiting === true;
  const taskCode = String(task.task_code || 'Task').trim();
  const room = String(task.room || 'No room/area').trim();
  const department = normalizedDepartment(task.department);
  const description = String(task.task_text || 'Attention required').trim();
  const kind = isUrgent ? 'URGENT' : isCustomerWaiting ? 'CUSTOMER_WAITING' : 'TASK';

  return {
    title: isUrgent
      ? `URGENT ${department || 'HOTEL'} TASK`
      : isCustomerWaiting
        ? 'CUSTOMER WAITING'
        : `NEW ${department || 'HOTEL'} TASK`,
    body: `${taskCode} · ${room}\n${description}`,
    taskId: task.id,
    kind,
    dueAt: isUrgent
      ? task.urgent_due_at
      : isCustomerWaiting
        ? task.customer_waiting_due_at
        : null,
    url: `/dashboard?task=${encodeURIComponent(task.id)}`,
    timestamp: Date.now(),
  };
}

function safeTopic(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'hotel-alert';
}

export function getWebPushPublicKey() {
  return String(process.env.WEB_PUSH_PUBLIC_KEY || '').trim();
}

export async function sendPushNotifications(params: {
  userIds: string[];
  payload: PushPayload;
  topic: string;
  ttlSeconds?: number;
}): Promise<TaskPushResult> {
  const config = pushConfiguration();
  const userIds = Array.from(new Set(params.userIds.map(String).filter(Boolean)));
  if (!config || !userIds.length) {
    return {
      configured: Boolean(config),
      attempted: 0,
      delivered: 0,
      removed: 0,
    };
  }

  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

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
  const payload = JSON.stringify({ ...params.payload, timestamp: params.payload.timestamp || Date.now() });
  let delivered = 0;
  let removed = 0;
  const failures: string[] = [];

  await Promise.all(stored.map(async (row) => {
    try {
      await webPush.sendNotification(row.subscription, payload, {
        TTL: Math.max(60, Number(params.ttlSeconds || 10 * 60)),
        urgency: 'high',
        topic: safeTopic(params.topic),
        timeout: 5_000,
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

async function ensureTimedTaskRecipients(task: TaskForPush, profiles: PushProfile[]) {
  if (task.urgent !== true && task.customer_waiting !== true) {
    return profiles.map((profile) => profile.user_id);
  }

  const cycle = Math.max(Number(task.alert_cycle || 1), 1);
  if (profiles.length) {
    const rows = profiles.map((profile) => ({
      task_id: task.id,
      alert_cycle: cycle,
      user_id: profile.user_id,
      user_name: String(profile.name || profile.email || 'Staff').trim(),
      user_email: normalizedEmail(profile.email),
    }));
    const { error: upsertError } = await supabaseAdmin
      .from('task_alert_recipients')
      .upsert(rows, {
        onConflict: 'task_id,alert_cycle,user_id',
        ignoreDuplicates: true,
      });
    if (upsertError) throw upsertError;
  }

  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('task_alert_recipients')
    .select('user_id')
    .eq('task_id', task.id)
    .eq('alert_cycle', cycle)
    .is('acknowledged_at', null);

  if (recipientsError) throw recipientsError;
  return Array.from(
    new Set((recipients || []).map((row) => String(row.user_id || '')).filter(Boolean))
  );
}

export async function sendTaskPushNotifications(
  task: TaskForPush
): Promise<TaskPushResult> {
  const department = normalizedDepartment(task.department);
  if (!department) {
    return { configured: Boolean(pushConfiguration()), attempted: 0, delivered: 0, removed: 0 };
  }

  try {
    const profiles = await resolveDepartmentPushProfiles(department);
    const userIds = await ensureTimedTaskRecipients(task, profiles);
    return sendPushNotifications({
      userIds,
      payload: taskPayload(task),
      topic: `task-${task.id}`,
      ttlSeconds: 10 * 60,
    });
  } catch (error: any) {
    return {
      configured: Boolean(pushConfiguration()),
      attempted: 0,
      delivered: 0,
      removed: 0,
      warning: `Web Push recipients could not be loaded: ${error?.message || 'Unknown error'}`,
    };
  }
}

export async function sendChambermaidDefectSupervisorAlerts(
  task: TaskForPush,
  submittedBy: string
): Promise<TaskPushResult> {
  try {
    const profiles = await resolvePushProfiles({ emails: HK_SUPERVISOR_PUSH_EMAILS });
    const cycle = Math.max(Number(task.alert_cycle || 1), 1);
    if (profiles.length) {
      const { error: recipientError } = await supabaseAdmin
        .from('task_alert_recipients')
        .upsert(
          profiles.map((profile) => ({
            task_id: task.id,
            alert_cycle: cycle,
            user_id: profile.user_id,
            user_name: String(profile.name || profile.email || 'HK Supervisor').trim(),
            user_email: normalizedEmail(profile.email),
          })),
          { onConflict: 'task_id,alert_cycle,user_id', ignoreDuplicates: true }
        );
      if (recipientError) throw recipientError;
    }

    const taskCode = String(task.task_code || 'Task').trim();
    const room = String(task.room || 'No room').trim();
    return sendPushNotifications({
      userIds: profiles.map((profile) => profile.user_id),
      payload: {
        title: 'NEW CHAMBERMAID DEFECT',
        body: `${taskCode} · Room ${room}\nSubmitted by ${String(submittedBy || 'Chambermaid').trim()}`,
        taskId: task.id,
        kind: 'TASK',
        url: '/dashboard/chambermaid-entry',
        timestamp: Date.now(),
      },
      topic: `chambermaid-defect-${task.id}`,
      ttlSeconds: 60 * 60,
    });
  } catch (error: any) {
    return {
      configured: Boolean(pushConfiguration()),
      attempted: 0,
      delivered: 0,
      removed: 0,
      warning: `HK supervisor alerts could not be created: ${error?.message || 'Unknown error'}`,
    };
  }
}
