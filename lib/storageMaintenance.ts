import { cleanupOldChillerSubmissions } from './chillerCleaning';
import { supabaseAdmin } from './supabaseAdmin';

const TASK_MEDIA_RETENTION_DAYS = 90;
const MANAGER_MEDIA_RETENTION_DAYS = 15;
const MANAGER_CHECK_RETENTION_DAYS = 60;
const CLEANUP_BATCH_SIZE = 100;

type DepartmentCode = 'MT' | 'HK';

export type StorageMaintenanceSummary = {
  chillerCleanupChecked: boolean;
  completedTaskMediaRemoved: number;
  managerMediaRemoved: number;
  managerChecksRemoved: number;
};

let maintenanceRun: Promise<StorageMaintenanceSummary> | null = null;

function cutoffIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function taskImagesPath(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const pathname = new URL(raw).pathname;
    const marker = '/storage/v1/object/public/task-images/';
    const index = pathname.indexOf(marker);
    if (index < 0) return '';
    return decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return '';
  }
}

async function cleanupCompletedTaskMedia() {
  const { data: mediaRows, error: mediaError } = await supabaseAdmin
    .from('task_images')
    .select('id, image_url, task_id, tasks!inner(status, done_at)')
    .eq('tasks.status', 'DONE')
    .not('tasks.done_at', 'is', null)
    .lt('tasks.done_at', cutoffIso(TASK_MEDIA_RETENTION_DAYS))
    .like('image_url', '%/storage/v1/object/public/task-images/task-media/%')
    .limit(CLEANUP_BATCH_SIZE);
  if (mediaError) throw mediaError;

  const eligibleRows = (mediaRows || []).filter((row) => {
    const path = taskImagesPath(row.image_url);
    return path === 'task-media' || path.startsWith('task-media/');
  });
  if (!eligibleRows.length) return 0;

  const taskIds = Array.from(
    new Set(eligibleRows.map((row) => String(row.task_id || '')).filter(Boolean))
  );
  const paths = Array.from(new Set(eligibleRows.map((row) => taskImagesPath(row.image_url)).filter(Boolean)));

  if (paths.length) {
    const { error: storageError } = await supabaseAdmin.storage.from('task-images').remove(paths);
    if (storageError) throw storageError;
  }

  const mediaIds = eligibleRows.map((row) => row.id).filter(Boolean);
  if (mediaIds.length) {
    const { error: deleteError } = await supabaseAdmin.from('task_images').delete().in('id', mediaIds);
    if (deleteError) throw deleteError;
  }

  const { error: taskUpdateError } = await supabaseAdmin
    .from('tasks')
    .update({ image_url: null })
    .in('id', taskIds)
    .like('image_url', '%/storage/v1/object/public/task-images/task-media/%');
  if (taskUpdateError) throw taskUpdateError;

  return paths.length;
}

export async function cleanupManagerRoomChecks(department: DepartmentCode) {
  const { data: mediaEligibleChecks, error: mediaEligibleError } = await supabaseAdmin
    .from('manager_room_checks')
    .select('id')
    .eq('department', department)
    .eq('status', 'DONE')
    .not('checked_at', 'is', null)
    .lt('checked_at', cutoffIso(MANAGER_MEDIA_RETENTION_DAYS))
    .order('checked_at', { ascending: true })
    .limit(CLEANUP_BATCH_SIZE);
  if (mediaEligibleError) throw mediaEligibleError;

  const checkIds = (mediaEligibleChecks || []).map((check) => String(check.id)).filter(Boolean);
  let mediaRemoved = 0;

  if (checkIds.length) {
    const [mediaResult, uploadResult] = await Promise.all([
      supabaseAdmin.from('manager_room_check_media').select('media_path').in('check_id', checkIds),
      supabaseAdmin.from('manager_room_check_uploads').select('storage_path').in('check_id', checkIds),
    ]);
    if (mediaResult.error) throw mediaResult.error;
    if (uploadResult.error) throw uploadResult.error;

    const paths = Array.from(new Set([
      ...(mediaResult.data || []).map((row) => String(row.media_path || '').trim()),
      ...(uploadResult.data || []).map((row) => String(row.storage_path || '').trim()),
    ].filter(Boolean)));

    if (paths.length) {
      const { error: storageError } = await supabaseAdmin.storage.from('task-images').remove(paths);
      if (storageError) throw storageError;
    }

    const [mediaDelete, uploadDelete] = await Promise.all([
      supabaseAdmin.from('manager_room_check_media').delete().in('check_id', checkIds),
      supabaseAdmin.from('manager_room_check_uploads').delete().in('check_id', checkIds),
    ]);
    if (mediaDelete.error) throw mediaDelete.error;
    if (uploadDelete.error) throw uploadDelete.error;
    mediaRemoved = paths.length;
  }

  const { data: expiredChecks, error: expiredError } = await supabaseAdmin
    .from('manager_room_checks')
    .select('id')
    .eq('department', department)
    .eq('status', 'DONE')
    .not('checked_at', 'is', null)
    .lt('checked_at', cutoffIso(MANAGER_CHECK_RETENTION_DAYS))
    .order('checked_at', { ascending: true })
    .limit(CLEANUP_BATCH_SIZE);
  if (expiredError) throw expiredError;

  const expiredIds = (expiredChecks || []).map((check) => String(check.id)).filter(Boolean);
  if (expiredIds.length) {
    const { error: deleteError } = await supabaseAdmin
      .from('manager_room_checks')
      .delete()
      .in('id', expiredIds);
    if (deleteError) throw deleteError;
  }

  return { mediaRemoved, checksRemoved: expiredIds.length };
}

export async function runStorageMaintenance(): Promise<StorageMaintenanceSummary> {
  if (maintenanceRun) return maintenanceRun;

  maintenanceRun = (async () => {
    await cleanupOldChillerSubmissions();
    const [completedTaskMediaRemoved, housekeeping, maintenance] = await Promise.all([
      cleanupCompletedTaskMedia(),
      cleanupManagerRoomChecks('HK'),
      cleanupManagerRoomChecks('MT'),
    ]);

    return {
      chillerCleanupChecked: true,
      completedTaskMediaRemoved,
      managerMediaRemoved: housekeeping.mediaRemoved + maintenance.mediaRemoved,
      managerChecksRemoved: housekeeping.checksRemoved + maintenance.checksRemoved,
    };
  })().finally(() => {
    maintenanceRun = null;
  });

  return maintenanceRun;
}
