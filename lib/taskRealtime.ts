export const TASK_BROADCAST_CHANNEL = 'dashboard-task-sync';
export const TASK_BROADCAST_EVENT = 'task-change';

export type TaskBroadcastEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export type TaskBroadcastPayload = {
  id: string;
  eventType: TaskBroadcastEventType;
  changedAt: string;
  alertUserIds?: string[];
};

export function readTaskBroadcastPayload(value: unknown): TaskBroadcastPayload | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TaskBroadcastPayload>;
  const id = String(candidate.id || '').trim();
  const eventType = String(candidate.eventType || '').trim().toUpperCase();
  if (!id || !['INSERT', 'UPDATE', 'DELETE'].includes(eventType)) return null;

  const alertUserIds = Array.isArray(candidate.alertUserIds)
    ? Array.from(new Set(candidate.alertUserIds.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  return {
    id,
    eventType: eventType as TaskBroadcastEventType,
    changedAt: String(candidate.changedAt || new Date().toISOString()),
    ...(alertUserIds.length ? { alertUserIds } : {}),
  };
}
