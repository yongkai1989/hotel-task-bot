import { supabaseAdmin } from './supabaseAdmin';

export type TaskAlertAcknowledgement = {
  user_name: string;
  acknowledged_at: string;
  alert_cycle: number;
};

export async function attachTaskAlertAcknowledgements<T extends { id: unknown }>(
  tasks: T[]
) {
  const taskIds = tasks.map((task) => String(task.id || '')).filter(Boolean);
  if (!taskIds.length) return tasks.map((task) => ({ ...task, acknowledgements: [] }));

  const { data, error } = await supabaseAdmin
    .from('task_alert_recipients')
    .select('task_id, acknowledged_name, acknowledged_at, alert_cycle')
    .in('task_id', taskIds)
    .not('acknowledged_at', 'is', null)
    .order('acknowledged_at', { ascending: true });

  if (error) throw error;

  const byTask = new Map<string, TaskAlertAcknowledgement[]>();
  const seen = new Set<string>();
  for (const row of data || []) {
    const taskId = String(row.task_id || '');
    const key = `${taskId}:${row.alert_cycle}:${row.acknowledged_at}:${row.acknowledged_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byTask.get(taskId) || [];
    list.push({
      user_name: String(row.acknowledged_name || ''),
      acknowledged_at: String(row.acknowledged_at || ''),
      alert_cycle: Number(row.alert_cycle || 1),
    });
    byTask.set(taskId, list);
  }

  return tasks.map((task) => ({
    ...task,
    acknowledgements: byTask.get(String(task.id)) || [],
  }));
}
