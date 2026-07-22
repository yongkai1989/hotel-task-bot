import { supabaseAdmin } from './supabaseAdmin';

type LinkedTask = {
  id?: string;
  room?: string | null;
  department?: string | null;
  task_text?: string | null;
  status?: string | null;
  created_at?: string | null;
};

export type LinkedTaskStatus = 'OPEN' | 'DONE';

export function managerRoomCheckDepartment(value: unknown): 'HK' | 'MT' | null {
  const department = String(value || '').trim().toUpperCase();
  return department === 'HK' || department === 'MT' ? department : null;
}

function departmentLabel(department: 'HK' | 'MT') {
  return department === 'HK' ? 'Housekeeping' : 'Maintenance';
}

export function managerRoomCheckTaskText(department: 'HK' | 'MT', room: string) {
  return `Urgent Manager Room Check for room ${room}. Please open ${departmentLabel(department)} Manager Room Check to review.`;
}

export function isManagerRoomCheckTask(task: LinkedTask) {
  const department = managerRoomCheckDepartment(task.department);
  const room = String(task.room || '').trim();
  return Boolean(
    department &&
      room &&
      String(task.task_text || '').trim() === managerRoomCheckTaskText(department, room)
  );
}

function linkedKey(department: string, room: string) {
  return `${department}:${room}`;
}

function closestByCreatedAt<T extends { created_at?: string | null }>(
  rows: T[],
  createdAt?: string | null
) {
  const targetTime = new Date(createdAt || 0).getTime();
  if (!Number.isFinite(targetTime) || targetTime <= 0) return rows[0];
  return [...rows].sort((a, b) => {
    const aDistance = Math.abs(new Date(a.created_at || 0).getTime() - targetTime);
    const bDistance = Math.abs(new Date(b.created_at || 0).getTime() - targetTime);
    return aDistance - bDistance;
  })[0];
}

export async function syncLinkedManagerRoomCheckStatus(
  task: LinkedTask,
  nextStatus: LinkedTaskStatus,
  actorName: string
) {
  if (!isManagerRoomCheckTask(task)) return { linked: false, updated: 0 };
  const department = managerRoomCheckDepartment(task.department)!;
  const room = String(task.room || '').trim();
  const { data: checks, error: checksError } = await supabaseAdmin
    .from('manager_room_checks')
    .select('id, status, created_at')
    .eq('department', department)
    .eq('room_number', room)
    .order('created_at', { ascending: false });
  if (checksError) throw checksError;

  const target = closestByCreatedAt(checks || [], task.created_at);
  if (!target) return { linked: true, updated: 0 };

  const now = new Date().toISOString();
  if (nextStatus === 'DONE') {
    const { error: mediaError } = await supabaseAdmin
      .from('manager_room_check_media')
      .update({
        completed_at: now,
        completed_by_name: actorName,
        completed_by_email: null,
      })
      .eq('check_id', target.id)
      .is('completed_at', null);
    if (mediaError) throw mediaError;

    const { error: checkError } = await supabaseAdmin
      .from('manager_room_checks')
      .update({
        status: 'DONE',
        submitted_for_check_at: now,
        submitted_for_check_by_name: actorName,
        checked_at: now,
        checked_by_name: actorName,
        updated_at: now,
      })
      .eq('id', target.id);
    if (checkError) throw checkError;
  } else {
    const { error: mediaError } = await supabaseAdmin
      .from('manager_room_check_media')
      .update({ completed_at: null, completed_by_name: null, completed_by_email: null })
      .eq('check_id', target.id);
    if (mediaError) throw mediaError;

    const { error: checkError } = await supabaseAdmin
      .from('manager_room_checks')
      .update({
        status: 'OPEN',
        submitted_for_check_at: null,
        submitted_for_check_by_name: null,
        checked_at: null,
        checked_by_name: null,
        updated_at: now,
      })
      .eq('id', target.id);
    if (checkError) throw checkError;
  }
  return { linked: true, updated: 1 };
}

export async function deleteLinkedManagerRoomCheck(task: LinkedTask) {
  if (!isManagerRoomCheckTask(task)) return { linked: false, deleted: 0 };
  const department = managerRoomCheckDepartment(task.department)!;
  const room = String(task.room || '').trim();
  const query = supabaseAdmin
    .from('manager_room_checks')
    .select('id, status, created_at')
    .eq('department', department)
    .eq('room_number', room)
    .order('created_at', { ascending: false });
  const { data: checks, error: checkError } = await query;
  if (checkError) throw checkError;
  const check = closestByCreatedAt(checks || [], task.created_at);
  if (!check) return { linked: true, deleted: 0 };

  const [mediaResult, uploadResult] = await Promise.all([
    supabaseAdmin.from('manager_room_check_media').select('media_path').eq('check_id', check.id),
    supabaseAdmin.from('manager_room_check_uploads').select('storage_path').eq('check_id', check.id),
  ]);
  if (mediaResult.error) throw mediaResult.error;
  if (uploadResult.error) throw uploadResult.error;
  const mediaRows = mediaResult.data;
  const uploadRows = uploadResult.data;
  const storagePaths = Array.from(
    new Set([
      ...(mediaRows || []).map((row) => row.media_path),
      ...(uploadRows || []).map((row) => row.storage_path),
    ].filter(Boolean) as string[])
  );
  if (storagePaths.length) {
    const { error: storageError } = await supabaseAdmin.storage.from('task-images').remove(storagePaths);
    if (storageError) throw storageError;
  }
  const { error: deleteError } = await supabaseAdmin
    .from('manager_room_checks')
    .delete()
    .eq('id', check.id);
  if (deleteError) throw deleteError;
  return { linked: true, deleted: 1 };
}

export async function reconcileManagerRoomCheckTasks<T extends LinkedTask>(tasks: T[]) {
  const linkedTasks = tasks.filter(isManagerRoomCheckTask);
  if (!linkedTasks.length) return tasks;
  const rooms = Array.from(new Set(linkedTasks.map((task) => String(task.room || '').trim())));
  const { data: checks, error: checksError } = await supabaseAdmin
    .from('manager_room_checks')
    .select('id, department, room_number, status, created_at, updated_at, checked_at, checked_by_name')
    .in('department', ['HK', 'MT'])
    .in('room_number', rooms)
    .order('created_at', { ascending: false });
  if (checksError) throw checksError;

  const checksByKey = new Map<string, any[]>();
  for (const check of checks || []) {
    const key = linkedKey(check.department, check.room_number);
    checksByKey.set(key, [...(checksByKey.get(key) || []), check]);
  }
  const orphanTaskIds: string[] = [];
  const reconciled: T[] = [];
  const matchedCheckIds = new Set<string>();
  for (const task of tasks) {
    if (!isManagerRoomCheckTask(task)) {
      reconciled.push(task);
      continue;
    }
    const department = managerRoomCheckDepartment(task.department)!;
    const room = String(task.room || '').trim();
    const candidates = (checksByKey.get(linkedKey(department, room)) || []).filter(
      (check) => !matchedCheckIds.has(check.id)
    );
    const check = closestByCreatedAt(candidates, task.created_at);
    if (!check) {
      if (task.id) orphanTaskIds.push(task.id);
      continue;
    }
    matchedCheckIds.add(check.id);
    const status: LinkedTaskStatus = check.status === 'DONE' || check.status === 'PENDING_CHECK' ? 'DONE' : 'OPEN';
    const nextTask = {
      ...task,
      status,
      done_at: status === 'DONE' ? check.checked_at || check.updated_at : null,
      done_by_name: status === 'DONE' ? check.checked_by_name || 'Manager Room Check' : null,
    } as T;
    reconciled.push(nextTask);
    if (task.id && task.status !== status) {
      const { error: updateError } = await supabaseAdmin
        .from('tasks')
        .update({
          status,
          done_at: status === 'DONE' ? check.checked_at || check.updated_at : null,
          done_by_name: status === 'DONE' ? check.checked_by_name || 'Manager Room Check' : null,
          updated_at: new Date().toISOString(),
          last_updated_by_name: 'Manager Room Check',
        })
        .eq('id', task.id);
      if (updateError) throw updateError;
    }
  }

  if (orphanTaskIds.length) {
    const [imageDeleteResult, eventDeleteResult] = await Promise.all([
      supabaseAdmin.from('task_images').delete().in('task_id', orphanTaskIds),
      supabaseAdmin.from('task_events').delete().in('task_id', orphanTaskIds),
    ]);
    if (imageDeleteResult.error) throw imageDeleteResult.error;
    if (eventDeleteResult.error) throw eventDeleteResult.error;
    const { error: orphanDeleteError } = await supabaseAdmin.from('tasks').delete().in('id', orphanTaskIds);
    if (orphanDeleteError) throw orphanDeleteError;
  }
  return reconciled;
}
