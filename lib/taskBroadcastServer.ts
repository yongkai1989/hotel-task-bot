import {
  TASK_BROADCAST_CHANNEL,
  TASK_BROADCAST_EVENT,
  type TaskBroadcastEventType,
} from './taskRealtime';

export async function broadcastTaskChange(id: unknown, eventType: TaskBroadcastEventType) {
  const taskId = String(id || '').trim();
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!taskId || !supabaseUrl || !serviceRoleKey) return;

  try {
    const response = await fetch(
      `${supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(TASK_BROADCAST_CHANNEL)}/events/${encodeURIComponent(TASK_BROADCAST_EVENT)}?private=true`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: taskId,
          eventType,
          changedAt: new Date().toISOString(),
        }),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      console.warn(`Task broadcast failed with status ${response.status}.`);
    }
  } catch (error: any) {
    // A notification failure must never roll back an otherwise valid task change.
    console.warn('Task broadcast failed:', error?.message || error);
  }
}
