'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type DepartmentCode = 'MT' | 'HK';
type CheckStatus = 'OPEN' | 'PENDING_CHECK' | 'DONE';
type MediaType = 'image' | 'video';
type UserRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';

type Profile = {
  user_id?: string;
  email: string;
  name: string;
  role: UserRole;
  can_access_maintenance_manager_room_check?: boolean;
  can_access_hk_manager_room_check?: boolean;
};

type RoomCheck = {
  id: string;
  department: DepartmentCode;
  room_number: string;
  title: string;
  description: string | null;
  status: CheckStatus;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  submitted_for_check_at: string | null;
  submitted_for_check_by_name: string | null;
  checked_at: string | null;
  checked_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CheckMedia = {
  id: string;
  check_id: string;
  media_url: string;
  media_path: string | null;
  media_type: MediaType;
  caption: string | null;
  position: number;
  completed_at: string | null;
  completed_by_name: string | null;
  completed_by_email: string | null;
  created_at: string | null;
  upload_status?: 'uploading' | 'failed';
  upload_error?: string | null;
};

type DraftMedia = {
  id: string;
  file: File;
  previewUrl: string;
  media_type: MediaType;
  caption: string;
  assigned_department: DepartmentCode;
  marked: boolean;
};

type ManagerRoomCheckPageProps = {
  department: DepartmentCode;
};

const MAX_MEDIA_PER_CHECK = 30;
const MAX_VIDEO_DURATION_SECONDS = 5;
const MAX_VIDEO_SIZE_BYTES = 15 * 1024 * 1024;
const MANAGER_ROOM_CHECK_CLEANUP_KEY = 'manager-room-check-cleanup-at';
const MANAGER_ROOM_CHECK_CLEANUP_MIN_MS = 24 * 60 * 60 * 1000;

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

function compactDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-SG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: CheckStatus) {
  if (status === 'PENDING_CHECK') return 'Pending Check';
  if (status === 'DONE') return 'Done';
  return 'Open';
}

function departmentLabel(department: DepartmentCode) {
  return department === 'HK' ? 'Housekeeping' : 'Maintenance';
}

function managerRoomCheckDashboardTaskText(department: DepartmentCode, roomNumber: string) {
  return `Urgent Manager Room Check for room ${roomNumber}. Please open ${departmentLabel(department)} Manager Room Check to review.`;
}

function isLikelyFileName(value?: string | null) {
  return /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm)$/i.test(String(value || '').trim());
}

function mediaRemark(value?: string | null) {
  const trimmed = String(value || '').trim();
  if (!trimmed || isLikelyFileName(trimmed)) return '';
  return trimmed;
}

function fileToImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function remoteImageToImage(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load saved image for markup.');
  const blob = await res.blob();
  const file = new File([blob], 'saved-room-check-image.jpg', {
    type: blob.type || 'image/jpeg',
  });
  return fileToImage(file);
}

function getVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read video duration.'));
    };
    video.src = url;
  });
}

async function validateVideoFile(file: File) {
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error(
      `${file.name} is too large (${formatMegabytes(file.size)}). Maximum video size is 15MB.`
    );
  }

  const duration = await getVideoDuration(file);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${file.name} cannot be checked. Please choose another video.`);
  }
  if (duration > MAX_VIDEO_DURATION_SECONDS + 0.25) {
    throw new Error(
      `${file.name} is ${Math.ceil(duration)} seconds. Maximum video duration is 5 seconds.`
    );
  }
}

async function compressImageFile(file: File, maxSide = 1280, quality = 0.72) {
  const img = await fileToImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  );

  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function isAccessAllowed(profile: Profile | null, department: DepartmentCode) {
  if (!profile) return false;
  if (profile.role === 'SUPERUSER') return true;
  if (department === 'MT') return profile.can_access_maintenance_manager_room_check === true;
  return profile.can_access_hk_manager_room_check === true;
}

function canManageRoomCheckContent(profile: Profile | null) {
  return profile?.role === 'SUPERUSER' || profile?.role === 'MANAGER';
}

function canFinalCheckRoomCheck(profile: Profile | null) {
  return profile?.role === 'SUPERUSER' || profile?.role === 'MANAGER';
}

function mediaCount(media: CheckMedia[], checkId: string) {
  return media.filter((item) => item.check_id === checkId).length;
}

function completedCount(media: CheckMedia[], checkId: string) {
  return media.filter((item) => item.check_id === checkId && item.completed_at).length;
}

export default function ManagerRoomCheckPage({ department }: ManagerRoomCheckPageProps) {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const departmentName = department === 'MT' ? 'Maintenance' : 'Housekeeping';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CheckStatus | 'ALL'>('OPEN');
  const [checks, setChecks] = useState<RoomCheck[]>([]);
  const [media, setMedia] = useState<CheckMedia[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [uploadProgressMsg, setUploadProgressMsg] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [roomNumber, setRoomNumber] = useState('');
  const [description, setDescription] = useState('');
  const [draftMedia, setDraftMedia] = useState<DraftMedia[]>([]);

  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addingToCheckId, setAddingToCheckId] = useState<string | null>(null);
  const [mediaChoiceOpen, setMediaChoiceOpen] = useState(false);
  const [markupIndex, setMarkupIndex] = useState<number | null>(null);
  const [existingMarkupMedia, setExistingMarkupMedia] = useState<CheckMedia | null>(null);
  const [markupDrawMode, setMarkupDrawMode] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupDoneRef = useRef(false);

  const canAccess = isAccessAllowed(profile, department);
  const canManageContent = canManageRoomCheckContent(profile);
  const canFinalCheck = canFinalCheckRoomCheck(profile);
  const selectedCheck = checks.find((item) => item.id === selectedCheckId) || null;
  const selectedMedia = selectedCheck
    ? media
        .filter((item) => item.check_id === selectedCheck.id)
        .sort((a, b) => a.position - b.position)
    : [];
  const quickAddCheck = addingToCheckId ? checks.find((item) => item.id === addingToCheckId) || null : null;

  const visibleChecks = checks.filter((check) =>
    statusFilter === 'ALL' ? true : check.status === statusFilter
  );

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        if (!supabase) throw new Error('Supabase is not configured.');
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user) {
          if (mounted) setProfile(null);
          return;
        }

        const res = await fetch('/api/session-profile', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to load access.');
        }
        const data = json.user || {};
        if (!mounted) return;
        setProfile({
          user_id: data.user_id || session.user.id,
          email: data?.email || session.user.email || '',
          name: data?.name || session.user.email || 'User',
          role: (data?.role || 'FO') as UserRole,
          can_access_maintenance_manager_room_check:
            data?.can_access_maintenance_manager_room_check === true ||
            data?.permissions?.can_access_maintenance_manager_room_check === true,
          can_access_hk_manager_room_check:
            data?.can_access_hk_manager_room_check === true ||
            data?.permissions?.can_access_hk_manager_room_check === true,
        } as Profile);
      } catch (error: any) {
        if (mounted) setErrorMsg(error?.message || 'Failed to load access.');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!authLoading && canAccess) {
      void loadChecks();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading, canAccess]);

  useEffect(() => {
    if (markupIndex === null && !existingMarkupMedia) return;
    setMarkupDrawMode(true);
    const item = markupIndex !== null ? draftMedia[markupIndex] : null;
    if (markupIndex !== null && (!item || item.media_type !== 'image')) return;
    let cancelled = false;

    async function drawImage() {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const img = item
          ? await fileToImage(item.file)
          : await remoteImageToImage(existingMarkupMedia?.media_url || '');
        if (cancelled) return;
        const maxWidth = Math.max(220, Math.min(980, window.innerWidth - 44));
        const maxHeight = Math.max(260, window.innerHeight - 188);
        const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch (error: any) {
        if (!cancelled) setErrorMsg(error?.message || 'Failed to open image markup.');
      }
    }

    void drawImage();
    return () => {
      cancelled = true;
    };
  }, [draftMedia, markupIndex, existingMarkupMedia]);

  async function loadChecks() {
    if (!supabase) return;
    setLoading(true);
    setErrorMsg('');
    try {
      if (!cleanupDoneRef.current) {
        cleanupDoneRef.current = true;
        void cleanupOldDoneChecks();
      }
      await mergeDuplicateActiveRoomChecks();

      const { data: checkRows, error: checkError } = await supabase
        .from('manager_room_checks')
        .select('*')
        .eq('department', department)
        .order('created_at', { ascending: false })
        .limit(120);
      if (checkError) throw checkError;

      const ids = (checkRows || []).map((row) => row.id);
      let mediaRows: CheckMedia[] = [];
      if (ids.length) {
        const { data: loadedMedia, error: mediaError } = await supabase
          .from('manager_room_check_media')
          .select('*')
          .in('check_id', ids)
          .order('position', { ascending: true });
        if (mediaError) throw mediaError;
        mediaRows = (loadedMedia || []) as CheckMedia[];
      }

      setChecks((checkRows || []) as RoomCheck[]);
      setMedia(mediaRows);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to load room checks.');
    } finally {
      setLoading(false);
    }
  }

  async function getAccessToken() {
    if (!supabase) throw new Error('Supabase is not configured.');
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Please log in again.');
    return session.access_token;
  }

  async function cleanupOldDoneChecks() {
    try {
      if (typeof window !== 'undefined') {
        const lastCleanup = Number(window.localStorage.getItem(MANAGER_ROOM_CHECK_CLEANUP_KEY) || '0');
        if (lastCleanup && Date.now() - lastCleanup < MANAGER_ROOM_CHECK_CLEANUP_MIN_MS) return;
      }

      const token = await getAccessToken();
      await fetch('/api/manager-room-checks/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ department }),
        cache: 'no-store',
      });

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MANAGER_ROOM_CHECK_CLEANUP_KEY, String(Date.now()));
      }
    } catch {
      // Cleanup saves storage but should never block normal page use.
    }
  }

  async function getMediaCountForCheck(checkId: string) {
    if (!supabase) return mediaCount(media, checkId);
    const { count, error } = await supabase
      .from('manager_room_check_media')
      .select('id', { count: 'exact', head: true })
      .eq('check_id', checkId);
    if (error) throw error;
    return count ?? 0;
  }

  async function renumberCheckMedia(checkId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('manager_room_check_media')
      .select('id, position, created_at')
      .eq('check_id', checkId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    for (let index = 0; index < (data || []).length; index += 1) {
      const nextPosition = index + 1;
      if (data?.[index]?.position === nextPosition) continue;
      const { error: updateError } = await supabase
        .from('manager_room_check_media')
        .update({ position: nextPosition })
        .eq('id', data?.[index]?.id);
      if (updateError) throw updateError;
    }
  }

  async function deleteCheckIfEmpty(checkId: string) {
    if (!supabase) return;
    const count = await getMediaCountForCheck(checkId);
    if (count > 0) return;
    const { error } = await supabase.from('manager_room_checks').delete().eq('id', checkId);
    if (error) throw error;
  }

  async function findActiveRoomCheck(targetDepartment: DepartmentCode, targetRoomNumber: string) {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('manager_room_checks')
      .select('*')
      .eq('department', targetDepartment)
      .eq('room_number', targetRoomNumber)
      .neq('status', 'DONE')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data || null) as RoomCheck | null;
  }

  async function mergeDuplicateActiveRoomChecks() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('manager_room_checks')
      .select('id, room_number, created_at')
      .eq('department', department)
      .neq('status', 'DONE')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const keeperByRoom = new Map<string, string>();
    const duplicatePairs: Array<{ keepId: string; duplicateId: string }> = [];
    for (const row of data || []) {
      const room = String(row.room_number || '').trim();
      if (!room) continue;
      const keepId = keeperByRoom.get(room);
      if (keepId) {
        duplicatePairs.push({ keepId, duplicateId: row.id });
      } else {
        keeperByRoom.set(room, row.id);
      }
    }

    for (const pair of duplicatePairs) {
      const { error: moveError } = await supabase
        .from('manager_room_check_media')
        .update({ check_id: pair.keepId })
        .eq('check_id', pair.duplicateId);
      if (moveError) throw moveError;

      const { error: deleteError } = await supabase
        .from('manager_room_checks')
        .delete()
        .eq('id', pair.duplicateId);
      if (deleteError) throw deleteError;

      await renumberCheckMedia(pair.keepId);
    }
  }

  async function addFiles(files: FileList | File[]) {
    setErrorMsg('');
    const incoming = Array.from(files);
    if (draftMedia.length + incoming.length > MAX_MEDIA_PER_CHECK) {
      setErrorMsg(`Maximum ${MAX_MEDIA_PER_CHECK} photos or videos per room check.`);
      return;
    }

    const nextItems: DraftMedia[] = [];
    const rejected: string[] = [];
    for (const rawFile of incoming) {
      const isImage = rawFile.type.startsWith('image/');
      const isVideo = rawFile.type.startsWith('video/');
      if (!isImage && !isVideo) continue;
      if (isVideo) {
        try {
          await validateVideoFile(rawFile);
        } catch (error: any) {
          rejected.push(error?.message || `${rawFile.name} was rejected.`);
          continue;
        }
      }
      const file = isImage ? await compressImageFile(rawFile) : rawFile;
      nextItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        media_type: isVideo ? 'video' : 'image',
        caption: '',
        assigned_department: 'HK',
        marked: false,
      });
    }
    if (rejected.length) {
      setErrorMsg(rejected.slice(0, 3).join(' '));
    }
    setDraftMedia((current) => [...current, ...nextItems]);
  }

  async function uploadDraftMedia(items: DraftMedia[]) {
    const token = await getAccessToken();
    const form = new FormData();
    form.set('folder', 'manager-room-check-media');
    items.forEach((item) => form.append('media', item.file, item.file.name));

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || 'Failed to upload media.');
    }
    return json.items as Array<{
      url: string;
      path: string | null;
      media_type: MediaType;
      caption: string | null;
    }>;
  }

  function groupedDraftMedia(items: DraftMedia[]) {
    return items.reduce<Record<DepartmentCode, DraftMedia[]>>(
      (groups, item) => {
        groups[item.assigned_department].push(item);
        return groups;
      },
      { HK: [], MT: [] }
    );
  }

  async function createUrgentDashboardTask(targetDepartment: DepartmentCode, targetRoomNumber: string) {
    try {
      const token = await getAccessToken();
      const label = departmentLabel(targetDepartment);
      const taskText = managerRoomCheckDashboardTaskText(targetDepartment, targetRoomNumber);

      if (supabase) {
        const { data: existingTask } = await supabase
          .from('tasks')
          .select('id')
          .eq('room', targetRoomNumber)
          .eq('department', targetDepartment)
          .eq('task_text', taskText)
          .neq('status', 'DONE')
          .limit(1)
          .maybeSingle();

        if (existingTask?.id) return;
      }

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          room: targetRoomNumber,
          department: targetDepartment,
          task_text: taskText,
        }),
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErrorMsg(json?.error || `Urgent dashboard task was not created for ${label}.`);
      }
    } catch (error: any) {
      setErrorMsg(error?.message || 'Urgent dashboard task was not created.');
    }
  }

  async function syncDashboardReminderStatus(check: RoomCheck, nextStatus: 'OPEN' | 'DONE') {
    if (!supabase) return 0;
    try {
      const token = await getAccessToken();
      const taskText = managerRoomCheckDashboardTaskText(check.department, check.room_number);
      const query = supabase
        .from('tasks')
        .select('id, status')
        .eq('room', check.room_number)
        .eq('department', check.department)
        .eq('task_text', taskText)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data, error } =
        nextStatus === 'DONE'
          ? await query.neq('status', 'DONE')
          : await query.eq('status', 'DONE');

      if (error) throw error;

      let synced = 0;
      for (const task of data || []) {
        const res = await fetch('/api/task-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ taskId: task.id, status: nextStatus }),
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || 'Dashboard reminder status sync failed.');
        }
        synced += 1;
      }

      return synced;
    } catch (error: any) {
      setErrorMsg(error?.message || 'Dashboard reminder status sync failed.');
      return 0;
    }
  }

  async function deleteDashboardReminderForCheck(check: RoomCheck) {
    if (!supabase) return;
    const taskText = managerRoomCheckDashboardTaskText(check.department, check.room_number);
    const { data, error } = await supabase
      .from('tasks')
      .select('id')
      .eq('room', check.room_number)
      .eq('department', check.department)
      .eq('task_text', taskText)
      .limit(20);

    if (error) throw error;
    if (!data?.length) return;

    const token = await getAccessToken();
    for (const task of data) {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Dashboard reminder delete failed.');
      }
    }
  }

  async function insertRoomCheckWithMedia(
    targetDepartment: DepartmentCode,
    targetRoomNumber: string,
    notes: string,
    items: DraftMedia[],
    createDashboardReminder = false
  ) {
    if (!supabase || !profile) return null;
    const existingCheck = await findActiveRoomCheck(targetDepartment, targetRoomNumber);
    if (existingCheck) {
      if (items.length) {
        await appendMediaToRoomCheck(existingCheck, items, createDashboardReminder);
      } else if (createDashboardReminder) {
        await createUrgentDashboardTask(targetDepartment, targetRoomNumber);
      }
      return existingCheck;
    }

    const uploaded = items.length ? await uploadDraftMedia(items) : [];
    const now = new Date().toISOString();
    const { data: check, error: checkError } = await supabase
      .from('manager_room_checks')
      .insert([
        {
          department: targetDepartment,
          room_number: targetRoomNumber,
          title: `Room ${targetRoomNumber} Check`,
          description: notes.trim() || null,
          status: 'OPEN',
          created_by_user_id: profile.user_id || null,
          created_by_name: profile.name || null,
          created_by_email: profile.email || null,
          created_at: now,
          updated_at: now,
        },
      ])
      .select('*')
      .single();
    if (checkError) throw checkError;

    if (uploaded.length) {
      const rows = uploaded.map((item, index) => ({
        check_id: check.id,
        media_url: item.url,
        media_path: item.path,
        media_type: item.media_type,
        caption: items[index]?.caption.trim() || null,
        position: index + 1,
      }));

      const { error: mediaError } = await supabase
        .from('manager_room_check_media')
        .insert(rows);
      if (mediaError) throw mediaError;
    }

    if (createDashboardReminder) {
      await createUrgentDashboardTask(targetDepartment, targetRoomNumber);
    }

    return check as RoomCheck;
  }

  async function getOrCreateRoomCheck(
    targetDepartment: DepartmentCode,
    targetRoomNumber: string,
    notes: string,
    createDashboardReminder = false
  ) {
    if (!supabase || !profile) return null;
    const existingCheck = await findActiveRoomCheck(targetDepartment, targetRoomNumber);
    if (existingCheck) {
      if (createDashboardReminder) {
        await createUrgentDashboardTask(targetDepartment, targetRoomNumber);
      }
      return existingCheck;
    }

    const now = new Date().toISOString();
    const { data: check, error: checkError } = await supabase
      .from('manager_room_checks')
      .insert([
        {
          department: targetDepartment,
          room_number: targetRoomNumber,
          title: `Room ${targetRoomNumber} Check`,
          description: notes.trim() || null,
          status: 'OPEN',
          created_by_user_id: profile.user_id || null,
          created_by_name: profile.name || null,
          created_by_email: profile.email || null,
          created_at: now,
          updated_at: now,
        },
      ])
      .select('*')
      .single();
    if (checkError) throw checkError;

    if (createDashboardReminder) {
      await createUrgentDashboardTask(targetDepartment, targetRoomNumber);
    }

    return check as RoomCheck;
  }

  async function appendMediaToRoomCheck(check: RoomCheck, items: DraftMedia[], createDashboardReminder = false) {
    if (!supabase || !items.length) return;
    const existingCount = await getMediaCountForCheck(check.id);
    if (existingCount + items.length > MAX_MEDIA_PER_CHECK) {
      throw new Error(`Maximum ${MAX_MEDIA_PER_CHECK} photos or videos per room check.`);
    }
    const uploaded = await uploadDraftMedia(items);
    const rows = uploaded.map((item, index) => ({
      check_id: check.id,
      media_url: item.url,
      media_path: item.path,
      media_type: item.media_type,
      caption: items[index]?.caption.trim() || null,
      position: existingCount + index + 1,
    }));
    const { error } = await supabase.from('manager_room_check_media').insert(rows);
    if (error) throw error;
    await supabase
      .from('manager_room_checks')
      .update({ status: 'OPEN', updated_at: new Date().toISOString() })
      .eq('id', check.id);

    if (createDashboardReminder) {
      await createUrgentDashboardTask(check.department, check.room_number);
    }
  }

  function optimisticMediaRows(check: RoomCheck, items: DraftMedia[], startPosition: number): CheckMedia[] {
    const now = new Date().toISOString();
    return items.map((item, index) => ({
      id: `uploading-${check.id}-${item.id}`,
      check_id: check.id,
      media_url: item.previewUrl,
      media_path: null,
      media_type: item.media_type,
      caption: item.caption.trim() || null,
      position: startPosition + index,
      completed_at: null,
      completed_by_name: null,
      completed_by_email: null,
      created_at: now,
      upload_status: 'uploading',
      upload_error: null,
    }));
  }

  function queueMediaUploadJobs(jobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }>) {
    if (!jobs.length) return;
    const totalMedia = jobs.reduce((sum, job) => sum + job.items.length, 0);
    setUploadProgressMsg(`Uploading media 0/${totalMedia} in background...`);

    void (async () => {
      let uploadedMedia = 0;
      try {
        for (const job of jobs) {
          setUploadProgressMsg(`Uploading ${job.label} media ${uploadedMedia}/${totalMedia} in background...`);
          await appendMediaToRoomCheck(job.check, job.items, false);
          uploadedMedia += job.items.length;
          setUploadProgressMsg(`Uploading media ${uploadedMedia}/${totalMedia} in background...`);
        }
        jobs.forEach((job) => job.items.forEach((item) => URL.revokeObjectURL(item.previewUrl)));
        setUploadProgressMsg('');
        setSuccessMsg(`${totalMedia} media item${totalMedia === 1 ? '' : 's'} uploaded.`);
        await loadChecks();
      } catch (error: any) {
        const failedIds = new Set(
          jobs.flatMap((job) => job.items.map((item) => `uploading-${job.check.id}-${item.id}`))
        );
        setMedia((current) =>
          current.filter((item) => !failedIds.has(item.id))
        );
        jobs.forEach((job) => job.items.forEach((item) => URL.revokeObjectURL(item.previewUrl)));
        setUploadProgressMsg('');
        setErrorMsg(error?.message || 'Background media upload failed. Please add the media again.');
        await loadChecks();
      }
    })();
  }

  async function createCheck() {
    if (!supabase || !profile || !canManageContent) return;
    if (!roomNumber.trim()) {
      setErrorMsg('Room number is required.');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    setUploadProgressMsg('');
    try {
      const normalizedRoomNumber = roomNumber.trim();
      const groups = groupedDraftMedia(draftMedia);
      const createdDepartments: string[] = [];
      const uploadJobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }> = [];
      if (draftMedia.length) {
        for (const targetDepartment of (['HK', 'MT'] as DepartmentCode[])) {
          const items = groups[targetDepartment];
          if (!items.length) continue;
          const check = await getOrCreateRoomCheck(targetDepartment, normalizedRoomNumber, description, true);
          if (check) {
            createdDepartments.push(departmentLabel(targetDepartment));
            uploadJobs.push({ check, items, label: departmentLabel(targetDepartment) });
          }
        }
      } else {
        const check = await getOrCreateRoomCheck(department, normalizedRoomNumber, description, true);
        if (check) createdDepartments.push(departmentLabel(department));
      }

      setShowCreate(false);
      setRoomNumber('');
      setDescription('');
      setDraftMedia([]);
      setChecks((current) => {
        const next = [...current];
        uploadJobs.forEach(({ check }) => {
          if (!next.some((item) => item.id === check.id)) next.unshift(check);
        });
        return next;
      });
      setSaving(false);
      setSuccessMsg(`Manager room check created for ${createdDepartments.join(' and ')}.`);

      if (uploadJobs.length) {
        const totalMedia = uploadJobs.reduce((sum, job) => sum + job.items.length, 0);
        let uploadedMedia = 0;
        setUploadProgressMsg(`Uploading media 0/${totalMedia}...`);
        for (const job of uploadJobs) {
          setUploadProgressMsg(`Uploading ${job.label} media ${uploadedMedia}/${totalMedia}...`);
          await appendMediaToRoomCheck(job.check, job.items, false);
          uploadedMedia += job.items.length;
          setUploadProgressMsg(`Uploading media ${uploadedMedia}/${totalMedia}...`);
        }
        draftMedia.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setUploadProgressMsg('');
        setSuccessMsg(`Manager room check and ${totalMedia} media item${totalMedia === 1 ? '' : 's'} uploaded.`);
      }
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to create room check.');
      setUploadProgressMsg('');
    } finally {
      setSaving(false);
    }
  }

  async function addMediaToCheck(checkId: string) {
    if (!supabase || !draftMedia.length || !canManageContent) return;
    const check = checks.find((item) => item.id === checkId);
    if (!check) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const mediaToUpload = [...draftMedia];
      const groups = groupedDraftMedia(mediaToUpload);
      const uploadJobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }> = [];
      const optimisticRows: CheckMedia[] = [];
      const touchedChecks: RoomCheck[] = [];

      for (const targetDepartment of (['HK', 'MT'] as DepartmentCode[])) {
        const items = groups[targetDepartment];
        if (!items.length) continue;

        const targetCheck =
          targetDepartment === check.department
            ? check
            : await getOrCreateRoomCheck(targetDepartment, check.room_number, check.description || '', true);

        if (!targetCheck) continue;
        if (targetDepartment === check.department) {
          await createUrgentDashboardTask(targetDepartment, check.room_number);
        }

        const existingCount = await getMediaCountForCheck(targetCheck.id);
        if (existingCount + items.length > MAX_MEDIA_PER_CHECK) {
          throw new Error(`Maximum ${MAX_MEDIA_PER_CHECK} photos or videos per room check.`);
        }

        uploadJobs.push({ check: targetCheck, items, label: departmentLabel(targetDepartment) });
        optimisticRows.push(...optimisticMediaRows(targetCheck, items, existingCount + 1));
        touchedChecks.push(targetCheck);
      }

      setMedia((current) => [...optimisticRows, ...current]);
      setChecks((current) => {
        const next = [...current];
        touchedChecks.forEach((targetCheck) => {
          const existingIndex = next.findIndex((item) => item.id === targetCheck.id);
          const updatedCheck = {
            ...targetCheck,
            status: 'OPEN' as CheckStatus,
            submitted_for_check_at: null,
            submitted_for_check_by_name: null,
            updated_at: new Date().toISOString(),
          };
          if (existingIndex >= 0) next[existingIndex] = updatedCheck;
          else next.unshift(updatedCheck);
        });
        return next;
      });
      setDraftMedia([]);
      setAddingToCheckId(null);
      setMediaChoiceOpen(false);
      setSuccessMsg('Media queued. You can take the next photo now.');
      setSaving(false);
      queueMediaUploadJobs(uploadJobs);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to add media.');
    } finally {
      setSaving(false);
    }
  }

  async function addCameraPhotoToCheck(check: RoomCheck, rawFile?: File | null) {
    if (!rawFile || !canManageContent) return;
    if (!rawFile.type.startsWith('image/')) {
      setErrorMsg('Camera upload must be a photo.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const file = await compressImageFile(rawFile);
      const item: DraftMedia = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        media_type: 'image',
        caption: '',
        assigned_department: check.department,
        marked: false,
      };
      setDraftMedia((current) => {
        current.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
        return [item];
      });
      setAddingToCheckId(check.id);
      setMediaChoiceOpen(false);
      setDetailOpen(false);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to prepare camera photo.');
    } finally {
      setSaving(false);
    }
  }

  async function completeMedia(item: CheckMedia) {
    if (!supabase || !profile) return;
    setErrorMsg('');
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('manager_room_check_media')
        .update({
          completed_at: now,
          completed_by_name: profile.name || null,
          completed_by_email: profile.email || null,
        })
        .eq('id', item.id);
      if (error) throw error;

      const nextMedia = media.map((mediaItem) =>
        mediaItem.id === item.id
          ? {
              ...mediaItem,
              completed_at: now,
              completed_by_name: profile.name || null,
              completed_by_email: profile.email || null,
            }
          : mediaItem
      );
      setMedia(nextMedia);

      const checkItems = nextMedia.filter((mediaItem) => mediaItem.check_id === item.check_id);
      const allCompleted = checkItems.length > 0 && checkItems.every((mediaItem) => mediaItem.completed_at);
      if (allCompleted) {
        const { error: checkError } = await supabase
          .from('manager_room_checks')
          .update({
            status: 'PENDING_CHECK',
            submitted_for_check_at: now,
            submitted_for_check_by_name: profile.name || null,
            updated_at: now,
          })
          .eq('id', item.check_id)
          .neq('status', 'DONE');
        if (checkError) throw checkError;
        setChecks((current) =>
          current.map((check) =>
            check.id === item.check_id
              ? {
                  ...check,
                  status: 'PENDING_CHECK',
                  submitted_for_check_at: now,
                  submitted_for_check_by_name: profile.name || null,
                }
              : check
          )
        );
      }
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to complete media item.');
    }
  }

  async function uncompleteMedia(item: CheckMedia) {
    if (!supabase) return;
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('manager_room_check_media')
        .update({
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
        })
        .eq('id', item.id);
      if (error) throw error;
      await supabase
        .from('manager_room_checks')
        .update({
          status: 'OPEN',
          submitted_for_check_at: null,
          submitted_for_check_by_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.check_id)
        .neq('status', 'DONE');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to reopen media item.');
    }
  }

  async function markChecked(check: RoomCheck) {
    if (!supabase || !profile) return;
    setErrorMsg('');
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('manager_room_checks')
        .update({
          status: 'DONE',
          checked_at: now,
          checked_by_name: profile.name || null,
          updated_at: now,
        })
        .eq('id', check.id);
      if (error) throw error;
      const synced = await syncDashboardReminderStatus(check, 'DONE');
      setSuccessMsg(
        synced
          ? `Room check marked as checked. ${synced} dashboard reminder${synced === 1 ? '' : 's'} marked done.`
          : 'Room check marked as checked.'
      );
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to mark as checked.');
    }
  }

  async function reopenCheck(check: RoomCheck) {
    if (!supabase) return;
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('manager_room_checks')
        .update({
          status: 'OPEN',
          checked_at: null,
          checked_by_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', check.id);
      if (error) throw error;
      await syncDashboardReminderStatus(check, 'OPEN');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to reopen check.');
    }
  }

  async function deleteCheck(check: RoomCheck) {
    if (!supabase || profile?.role !== 'SUPERUSER') return;
    if (!window.confirm(`Delete Manager Room Check for room ${check.room_number}?`)) return;
    setErrorMsg('');
    try {
      await deleteDashboardReminderForCheck(check);
      const { error } = await supabase.from('manager_room_checks').delete().eq('id', check.id);
      if (error) throw error;
      setDetailOpen(false);
      setSelectedCheckId(null);
      setSuccessMsg('Room check deleted.');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to delete room check.');
    }
  }

  async function deleteMedia(item: CheckMedia) {
    if (!supabase || !canManageContent) return;
    if (!window.confirm('Remove this media item?')) return;
    setErrorMsg('');
    try {
      const { error } = await supabase.from('manager_room_check_media').delete().eq('id', item.id);
      if (error) throw error;
      await supabase
        .from('manager_room_checks')
        .update({ status: 'OPEN', updated_at: new Date().toISOString() })
        .eq('id', item.check_id)
        .neq('status', 'DONE');
      await deleteCheckIfEmpty(item.check_id);
      await renumberCheckMedia(item.check_id);
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to remove media.');
    }
  }

  async function moveMediaToDepartment(item: CheckMedia, targetDepartment: DepartmentCode) {
    if (!supabase || !selectedCheck || !canManageContent) return;
    if (targetDepartment === selectedCheck.department) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const targetCheck = await findActiveRoomCheck(targetDepartment, selectedCheck.room_number);
      let destinationCheck = targetCheck;
      if (!destinationCheck) {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from('manager_room_checks')
          .insert([
            {
              department: targetDepartment,
              room_number: selectedCheck.room_number,
              title: `Room ${selectedCheck.room_number} Check`,
              description: selectedCheck.description || null,
              status: 'OPEN',
              created_by_user_id: profile?.user_id || null,
              created_by_name: profile?.name || null,
              created_by_email: profile?.email || null,
              created_at: now,
              updated_at: now,
            },
          ])
          .select('*')
          .single();
        if (error) throw error;
        destinationCheck = data as RoomCheck;
      }

      const nextPosition = (await getMediaCountForCheck(destinationCheck.id)) + 1;
      const { error: moveError } = await supabase
        .from('manager_room_check_media')
        .update({
          check_id: destinationCheck.id,
          position: nextPosition,
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
        })
        .eq('id', item.id);
      if (moveError) throw moveError;

      const now = new Date().toISOString();
      await supabase
        .from('manager_room_checks')
        .update({ status: 'OPEN', updated_at: now })
        .eq('id', destinationCheck.id);
      await supabase
        .from('manager_room_checks')
        .update({
          status: 'OPEN',
          submitted_for_check_at: null,
          submitted_for_check_by_name: null,
          updated_at: now,
        })
        .eq('id', selectedCheck.id)
        .neq('status', 'DONE');

      await renumberCheckMedia(selectedCheck.id);
      await renumberCheckMedia(destinationCheck.id);
      await deleteCheckIfEmpty(selectedCheck.id);
      setSuccessMsg(`Media moved to ${departmentLabel(targetDepartment)}.`);
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to change media department.');
    } finally {
      setSaving(false);
    }
  }

  async function replaceMedia(item: CheckMedia, file: File) {
    if (!supabase || !canManageContent) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) throw new Error('Please choose an image or video.');
      if (isVideo) await validateVideoFile(file);
      const nextFile = isImage ? await compressImageFile(file) : file;
      const token = await getAccessToken();
      const form = new FormData();
      form.set('folder', 'manager-room-check-media');
      form.append('media', nextFile, file.name);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed.');
      const uploaded = json.items?.[0];
      if (!uploaded?.url) throw new Error('Upload failed.');
      const { error } = await supabase
        .from('manager_room_check_media')
        .update({
          media_url: uploaded.url,
          media_path: uploaded.path || null,
          media_type: uploaded.media_type,
          caption: file.name,
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
        })
        .eq('id', item.id);
      if (error) throw error;
      await supabase
        .from('manager_room_checks')
        .update({
          status: 'OPEN',
          submitted_for_check_at: null,
          submitted_for_check_by_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.check_id)
        .neq('status', 'DONE');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to replace media.');
    } finally {
      setSaving(false);
    }
  }

  function removeDraftMedia(id: string) {
    setDraftMedia((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearDraftMedia() {
    setMediaChoiceOpen(false);
    setDraftMedia((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }

  function updateDraftMediaCaption(id: string, caption: string) {
    setDraftMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, caption } : item))
    );
  }

  function updateDraftMediaDepartment(id: string, assigned_department: DepartmentCode) {
    setDraftMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, assigned_department } : item))
    );
  }

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = pointerPosition(event);
    const last = lastPointRef.current;
    if (!canvas || !ctx || !point || !last) return;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(4, canvas.width / 160);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function stopDrawing() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function closeMarkup() {
    setMarkupIndex(null);
    setExistingMarkupMedia(null);
    setMarkupDrawMode(false);
  }

  async function uploadSingleMediaFile(file: File) {
    const token = await getAccessToken();
    const form = new FormData();
    form.set('folder', 'manager-room-check-media');
    form.append('media', file, file.name);
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Upload failed.');
    const uploaded = json.items?.[0];
    if (!uploaded?.url) throw new Error('Upload failed.');
    return uploaded;
  }

  async function saveMarkup() {
    if (markupIndex === null && !existingMarkupMedia) return;
    const canvas = canvasRef.current;
    const item = markupIndex !== null ? draftMedia[markupIndex] : null;
    if (!canvas || (!item && !existingMarkupMedia)) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    );
    if (!blob) return;
    const baseName = item?.file.name || `room-check-${existingMarkupMedia?.id || Date.now()}.jpg`;
    const file = new File([blob], baseName.replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    if (item && markupIndex !== null) {
      URL.revokeObjectURL(item.previewUrl);
      const previewUrl = URL.createObjectURL(file);
      setDraftMedia((current) =>
        current.map((entry, index) =>
          index === markupIndex ? { ...entry, file, previewUrl, marked: true } : entry
        )
      );
      closeMarkup();
      return;
    }

    if (!supabase || !existingMarkupMedia) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const uploaded = await uploadSingleMediaFile(file);
      const { error } = await supabase
        .from('manager_room_check_media')
        .update({
          media_url: uploaded.url,
          media_path: uploaded.path || null,
          media_type: 'image',
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
        })
        .eq('id', existingMarkupMedia.id);
      if (error) throw error;
      await supabase
        .from('manager_room_checks')
        .update({
          status: 'OPEN',
          submitted_for_check_at: null,
          submitted_for_check_by_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingMarkupMedia.check_id)
        .neq('status', 'DONE');
      closeMarkup();
      setSuccessMsg('Markup saved.');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to save markup.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return <div className="mrc-shell"><div className="mrc-card">Loading Manager Room Check...</div></div>;
  }

  if (!canAccess) {
    return (
      <div className="mrc-shell">
        <div className="mrc-denied">
          <h1>Access denied</h1>
          <p>{departmentName} Manager Room Check access is not enabled for this account.</p>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
        <StyleBlock />
      </div>
    );
  }

  return (
    <div className="mrc-shell">
      <section className="mrc-hero">
        <div>
          <div className="mrc-eyebrow">{departmentName} workspace</div>
          <h1>Manager Room Check</h1>
          <p>Upload room photos or videos, complete each item, then submit for manager checking.</p>
        </div>
        <div className="mrc-actions">
          <button className="mrc-secondary" type="button" onClick={() => void loadChecks()}>
            Refresh
          </button>
          {canManageContent ? (
            <button className="mrc-primary" type="button" onClick={() => setShowCreate(true)}>
              + New Check
            </button>
          ) : null}
          <Link className="mrc-secondary" href="/dashboard">Back</Link>
        </div>
      </section>

      {errorMsg ? <div className="mrc-alert mrc-alert-error">{errorMsg}</div> : null}
      {successMsg ? <div className="mrc-alert mrc-alert-success">{successMsg}</div> : null}
      {uploadProgressMsg ? <div className="mrc-alert mrc-alert-info">{uploadProgressMsg}</div> : null}

      <section className="mrc-summary">
        {(['OPEN', 'PENDING_CHECK', 'DONE'] as CheckStatus[]).map((status) => (
          <button
            key={status}
            className={`mrc-stat ${statusFilter === status ? 'is-active' : ''}`}
            type="button"
            onClick={() => setStatusFilter(status)}
          >
            <span>{statusLabel(status)}</span>
            <strong>{checks.filter((check) => check.status === status).length}</strong>
          </button>
        ))}
        <button
          className={`mrc-stat ${statusFilter === 'ALL' ? 'is-active' : ''}`}
          type="button"
          onClick={() => setStatusFilter('ALL')}
        >
          <span>All</span>
          <strong>{checks.length}</strong>
        </button>
      </section>

      <section className="mrc-card">
        <div className="mrc-card-head">
          <div>
            <h2>{statusFilter === 'ALL' ? 'All Checks' : statusLabel(statusFilter)}</h2>
            <p>{visibleChecks.length} room checks shown</p>
          </div>
        </div>

        {visibleChecks.length ? (
          <div className="mrc-list">
            {visibleChecks.map((check) => {
              const total = mediaCount(media, check.id);
              const done = completedCount(media, check.id);
              const progress = total ? Math.round((done / total) * 100) : 0;
              return (
                <div
                  key={check.id}
                  className="mrc-row"
                >
                  <button
                    className="mrc-row-open"
                    type="button"
                    onClick={() => {
                      setSelectedCheckId(check.id);
                      setDetailOpen(true);
                    }}
                  >
                    <span className="mrc-room">Room {check.room_number}</span>
                    <span className="mrc-row-main">
                      <strong>{total} media item{total === 1 ? '' : 's'}</strong>
                      <small>{check.description || 'Notes optional'}</small>
                    </span>
                    <span className={`mrc-status mrc-status-${check.status.toLowerCase()}`}>
                      {statusLabel(check.status)}
                    </span>
                    <span className="mrc-progress">{done}/{total} media</span>
                    <span className="mrc-bar"><span style={{ width: `${progress}%` }} /></span>
                  </button>
                  {canManageContent && check.status !== 'DONE' ? (
                    <label className="mrc-camera-button" title="Take photo for this room">
                      <CameraIcon />
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void addCameraPhotoToCheck(check, file);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mrc-empty">No room checks found for this filter.</div>
        )}
      </section>

      {showCreate && canManageContent ? (
        <Modal title="New Manager Room Check" onClose={() => {
          clearDraftMedia();
          setShowCreate(false);
        }}>
          <div className="mrc-form-grid">
            <label>
              <span>Room Number</span>
              <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="1201" />
            </label>
          </div>
          <label className="mrc-full-label">
            <span>Notes <em>(optional)</em></span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes" />
          </label>
          <MediaPicker
            draftMedia={draftMedia}
            addFiles={addFiles}
            removeDraftMedia={removeDraftMedia}
            setMarkupIndex={setMarkupIndex}
            updateDraftMediaCaption={updateDraftMediaCaption}
            updateDraftMediaDepartment={updateDraftMediaDepartment}
            compact
            choiceOpen={mediaChoiceOpen}
            setChoiceOpen={setMediaChoiceOpen}
          />
          <div className="mrc-modal-actions">
            <button
              type="button"
              className="mrc-secondary"
              onClick={() => {
                clearDraftMedia();
                setShowCreate(false);
              }}
            >
              Cancel
            </button>
            <button type="button" className="mrc-primary" disabled={saving} onClick={() => void createCheck()}>
              {saving ? 'Saving...' : 'Create Check'}
            </button>
          </div>
        </Modal>
      ) : null}

      {canManageContent && quickAddCheck && !detailOpen && addingToCheckId === quickAddCheck.id ? (
        <Modal title={`Add Media - Room ${quickAddCheck.room_number}`} onClose={() => {
          clearDraftMedia();
          setAddingToCheckId(null);
        }}>
          <MediaPicker
            draftMedia={draftMedia}
            addFiles={addFiles}
            removeDraftMedia={removeDraftMedia}
            setMarkupIndex={setMarkupIndex}
            updateDraftMediaCaption={updateDraftMediaCaption}
            updateDraftMediaDepartment={updateDraftMediaDepartment}
          />
          <div className="mrc-modal-actions">
            <button
              type="button"
              className="mrc-secondary"
              onClick={() => {
                clearDraftMedia();
                setAddingToCheckId(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className="mrc-primary" disabled={saving || !draftMedia.length} onClick={() => void addMediaToCheck(quickAddCheck.id)}>
              {saving ? 'Uploading...' : 'Upload Media'}
            </button>
          </div>
        </Modal>
      ) : null}

      {detailOpen && selectedCheck ? (
        <Modal title={`Room ${selectedCheck.room_number}`} onClose={() => {
          clearDraftMedia();
          setAddingToCheckId(null);
          setDetailOpen(false);
        }}>
          <div className="mrc-detail-head">
            <div>
              <h3>Room {selectedCheck.room_number}</h3>
              <p>{selectedCheck.description || 'No notes'}</p>
            </div>
            <span className={`mrc-status mrc-status-${selectedCheck.status.toLowerCase()}`}>
              {statusLabel(selectedCheck.status)}
            </span>
          </div>
          <div className="mrc-meta-grid">
            <span>Created by <strong>{selectedCheck.created_by_name || '-'}</strong></span>
            <span>Created <strong>{compactDateTime(selectedCheck.created_at)}</strong></span>
            <span>Submitted <strong>{compactDateTime(selectedCheck.submitted_for_check_at)}</strong></span>
            <span>Checked <strong>{selectedCheck.checked_by_name || '-'}</strong></span>
          </div>

          <div className="mrc-media-grid">
            {selectedMedia.map((item) => {
              const remark = mediaRemark(item.caption);
              const isUploading = item.upload_status === 'uploading';
              return (
              <div key={item.id} className={`mrc-media-card ${isUploading ? 'is-uploading' : ''}`}>
                {item.media_type === 'video' ? (
                  <video src={item.media_url} controls preload="metadata" />
                ) : (
                  <img src={item.media_url} alt={remark || 'Room check media'} loading="lazy" decoding="async" />
                )}
                <div className="mrc-media-info">
                  <strong>Issue {item.position}</strong>
                  {remark ? <p className="mrc-media-remark">{remark}</p> : null}
                  <span>
                    {isUploading
                      ? 'Uploading in background...'
                      : item.completed_at
                      ? `Completed by ${item.completed_by_name || '-'}`
                      : 'Not completed'}
                  </span>
                  {isUploading ? <span className="mrc-upload-chip">Uploading</span> : null}
                  {canManageContent && selectedCheck.status !== 'DONE' && !isUploading ? (
                    <div className="mrc-media-route">
                      <span>Assigned to</span>
                      <div>
                        {(['HK', 'MT'] as DepartmentCode[]).map((targetDepartment) => (
                          <button
                            key={targetDepartment}
                            type="button"
                            className={selectedCheck.department === targetDepartment ? 'is-selected' : ''}
                            disabled={saving || selectedCheck.department === targetDepartment}
                            onClick={() => void moveMediaToDepartment(item, targetDepartment)}
                          >
                            {targetDepartment === 'HK' ? 'Housekeeping' : 'Maintenance'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="mrc-media-actions">
                  {isUploading ? (
                    <button type="button" className="mrc-secondary" disabled>
                      Uploading...
                    </button>
                  ) : item.completed_at ? (
                    <button type="button" className="mrc-secondary" onClick={() => void uncompleteMedia(item)}>
                      Reopen
                    </button>
                  ) : (
                    <button type="button" className="mrc-primary" onClick={() => void completeMedia(item)}>
                      Mark Complete
                    </button>
                  )}
                  {canManageContent && !isUploading ? (
                    <>
                      {item.media_type === 'image' ? (
                        <button
                          type="button"
                          className="mrc-secondary"
                          onClick={() => {
                            setMarkupIndex(null);
                            setExistingMarkupMedia(item);
                          }}
                        >
                          Mark Up
                        </button>
                      ) : null}
                      <label className="mrc-secondary mrc-file-button">
                        Replace
                        <input
                          type="file"
                          accept="image/*,video/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void replaceMedia(item, file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <button type="button" className="mrc-danger" onClick={() => void deleteMedia(item)}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              );
            })}
          </div>

          {canManageContent && addingToCheckId === selectedCheck.id ? (
            <div className="mrc-add-panel">
              <MediaPicker
                draftMedia={draftMedia}
                addFiles={addFiles}
                removeDraftMedia={removeDraftMedia}
                setMarkupIndex={setMarkupIndex}
                updateDraftMediaCaption={updateDraftMediaCaption}
                updateDraftMediaDepartment={updateDraftMediaDepartment}
                compact
                choiceOpen={mediaChoiceOpen}
                setChoiceOpen={setMediaChoiceOpen}
              />
              <div className="mrc-modal-actions">
                <button
                  type="button"
                  className="mrc-secondary"
                  onClick={() => {
                    clearDraftMedia();
                    setAddingToCheckId(null);
                  }}
                >
                  Cancel Add
                </button>
                <button type="button" className="mrc-primary" disabled={saving || !draftMedia.length} onClick={() => void addMediaToCheck(selectedCheck.id)}>
                  {saving ? 'Uploading...' : 'Add Media'}
                </button>
              </div>
            </div>
          ) : null}

          {addingToCheckId !== selectedCheck.id ? (
          <div className="mrc-modal-actions">
            {canManageContent ? (
              <button
                type="button"
                className="mrc-secondary"
                onClick={() => {
                  clearDraftMedia();
                  setAddingToCheckId(selectedCheck.id);
                  setMediaChoiceOpen(true);
                }}
              >
                Add Media
              </button>
            ) : null}
            {canFinalCheck && selectedCheck.status === 'PENDING_CHECK' ? (
              <button type="button" className="mrc-primary" onClick={() => void markChecked(selectedCheck)}>
                Mark Checked
              </button>
            ) : null}
            {canFinalCheck && selectedCheck.status === 'DONE' ? (
              <button type="button" className="mrc-secondary" onClick={() => void reopenCheck(selectedCheck)}>
                Reopen
              </button>
            ) : null}
            {profile?.role === 'SUPERUSER' ? (
              <button type="button" className="mrc-danger" onClick={() => void deleteCheck(selectedCheck)}>
                Delete Check
              </button>
            ) : null}
          </div>
          ) : null}
        </Modal>
      ) : null}

      {markupIndex !== null || existingMarkupMedia ? (
        <Modal title={existingMarkupMedia ? 'Mark Up Saved Image' : `Mark Up Image ${(markupIndex || 0) + 1}`} onClose={closeMarkup} wide markup>
          <div className="mrc-markup-toolbar">
            <button
              type="button"
              className={`mrc-tool-btn ${!markupDrawMode ? 'is-active' : ''}`}
              onClick={() => setMarkupDrawMode(false)}
              aria-label="Scroll image"
              title="Scroll image"
            >
              <span aria-hidden="true">↕</span>
              <span>Scroll</span>
            </button>
            <button
              type="button"
              className={`mrc-tool-btn mrc-pen-btn ${markupDrawMode ? 'is-active' : ''}`}
              onClick={() => setMarkupDrawMode(true)}
              aria-label="Draw red markup"
              title="Draw red markup"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m16.9 3.7 3.4 3.4" />
                <path d="M19 9 8.2 19.8 4 20l.2-4.2L15 5" />
                <path d="M12 20h8" />
              </svg>
              <span>Pen</span>
            </button>
            <span className="mrc-markup-mode-label">Red pen ready</span>
            <div className="mrc-markup-toolbar-actions">
              <button type="button" className="mrc-secondary" onClick={closeMarkup}>Cancel</button>
              <button type="button" className="mrc-primary" disabled={saving} onClick={() => void saveMarkup()}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div className="mrc-markup">
            <canvas
              ref={canvasRef}
              className="is-drawing"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          </div>
        </Modal>
      ) : null}

      <StyleBlock />
    </div>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M8.2 5.5 9.4 3.8h5.2l1.2 1.7H19c1.2 0 2.2 1 2.2 2.2v10.1c0 1.2-1 2.2-2.2 2.2H5c-1.2 0-2.2-1-2.2-2.2V7.7c0-1.2 1-2.2 2.2-2.2h3.2Zm3.8 11a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm0-1.8a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M4.8 5.2h14.4c1 0 1.8.8 1.8 1.8v10c0 1-.8 1.8-1.8 1.8H4.8C3.8 18.8 3 18 3 17V7c0-1 .8-1.8 1.8-1.8Z" />
      <path d="m5.5 16 3.7-4 2.4 2.5 2.9-3.4 4 4.9" />
      <path d="M15.8 8.6h.01" />
    </svg>
  );
}

function MediaPicker({
  draftMedia,
  addFiles,
  removeDraftMedia,
  setMarkupIndex,
  updateDraftMediaCaption,
  updateDraftMediaDepartment,
  compact = false,
  choiceOpen = false,
  setChoiceOpen,
}: {
  draftMedia: DraftMedia[];
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeDraftMedia: (id: string) => void;
  setMarkupIndex: (index: number) => void;
  updateDraftMediaCaption: (id: string, caption: string) => void;
  updateDraftMediaDepartment: (id: string, assigned_department: DepartmentCode) => void;
  compact?: boolean;
  choiceOpen?: boolean;
  setChoiceOpen?: (open: boolean) => void;
}) {
  const handlePick = (files: FileList | null) => {
    if (files) void addFiles(files);
    setChoiceOpen?.(false);
  };

  const sourceButtons = (
    <>
      <label className="mrc-media-choice-btn">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            handlePick(e.target.files);
            e.currentTarget.value = '';
          }}
        />
        <CameraIcon />
        <span>Take Photo</span>
      </label>
      <label className="mrc-media-choice-btn">
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => {
            handlePick(e.target.files);
            e.currentTarget.value = '';
          }}
        />
        <LibraryIcon />
        <span>Photo Library</span>
      </label>
    </>
  );

  return (
    <div className={`mrc-picker ${compact ? 'is-compact' : ''}`}>
      {compact ? (
        <div className="mrc-media-menu-wrap">
          <button
            type="button"
            className="mrc-media-menu-trigger"
            onClick={() => setChoiceOpen?.(!choiceOpen)}
          >
            <CameraIcon />
            <span>Choose source</span>
          </button>
          {choiceOpen ? <div className="mrc-media-popover">{sourceButtons}</div> : null}
        </div>
      ) : (
        <div className="mrc-media-choice">{sourceButtons}</div>
      )}
      <div className="mrc-picker-hint">Up to 30 items. Images can be marked up before upload.</div>
      {draftMedia.length ? (
        <div className="mrc-draft-grid">
          {draftMedia.map((item, index) => (
            <div key={item.id} className="mrc-draft-card">
              {item.media_type === 'video' ? (
                <video src={item.previewUrl} muted />
              ) : (
                <img src={item.previewUrl} alt={`Media preview ${index + 1}`} />
              )}
              <label className="mrc-draft-remark">
                <span>Remark for staff (optional)</span>
                <textarea
                  value={item.caption}
                  onChange={(e) => updateDraftMediaCaption(item.id, e.target.value)}
                  placeholder={`Example: ${item.media_type === 'video' ? 'Leaking sound from AC' : 'Stain on bedsheet'}`}
                />
              </label>
              <div className="mrc-draft-routing">
                <div className="mrc-dept-choice" aria-label="Assign media to department">
                  <span>Assign to</span>
                  <div>
                    <label className={`mrc-dept-check ${item.assigned_department === 'HK' ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={item.assigned_department === 'HK'}
                        onChange={() => updateDraftMediaDepartment(item.id, 'HK')}
                      />
                      <span>Housekeeping</span>
                    </label>
                    <label className={`mrc-dept-check ${item.assigned_department === 'MT' ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={item.assigned_department === 'MT'}
                        onChange={() => updateDraftMediaDepartment(item.id, 'MT')}
                      />
                      <span>Maintenance</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="mrc-draft-actions">
                {item.media_type === 'image' ? (
                  <button
                    type="button"
                    className="mrc-secondary"
                    onClick={() => setMarkupIndex(index)}
                  >
                    {item.marked ? 'Edit Markup' : 'Mark Up'}
                  </button>
                ) : null}
                <button type="button" className="mrc-danger" onClick={() => removeDraftMedia(item.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  markup = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  markup?: boolean;
}) {
  return (
    <div className="mrc-modal-backdrop">
      <div className={`mrc-modal ${wide ? 'is-wide' : ''} ${markup ? 'is-markup-modal' : ''}`}>
        <div className="mrc-modal-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>x</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StyleBlock() {
  return (
    <style jsx global>{`
      .mrc-shell {
        max-width: 1260px;
        margin: 0 auto;
        color: #0f172a;
      }
      .mrc-hero,
      .mrc-card,
      .mrc-denied {
        border: 1px solid #d9e5f5;
        background: rgba(255,255,255,0.94);
        border-radius: 22px;
        box-shadow: 0 20px 60px rgba(15,23,42,0.08);
      }
      .mrc-hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 22px;
      }
      .mrc-eyebrow {
        color: #2563eb;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .mrc-hero h1,
      .mrc-denied h1 {
        margin: 4px 0 6px;
        font-size: clamp(30px, 4vw, 44px);
        line-height: 1.02;
      }
      .mrc-hero p,
      .mrc-denied p,
      .mrc-card-head p {
        margin: 0;
        color: #64748b;
        font-weight: 650;
      }
      .mrc-actions,
      .mrc-modal-actions,
      .mrc-media-actions,
      .mrc-draft-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }
      .mrc-modal > .mrc-modal-actions {
        position: sticky;
        bottom: calc(-18px - env(safe-area-inset-bottom, 0px));
        z-index: 6;
        margin: 16px -18px calc(-18px - env(safe-area-inset-bottom, 0px));
        padding: 12px 18px calc(12px + env(safe-area-inset-bottom, 0px));
        background: rgba(255,255,255,.97);
        border-top: 1px solid #e2e8f0;
        backdrop-filter: blur(10px);
      }
      .mrc-primary,
      .mrc-secondary,
      .mrc-danger,
      .mrc-file-button {
        min-height: 42px;
        border-radius: 14px;
        border: 1px solid #cbd5e1;
        padding: 0 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-weight: 900;
        cursor: pointer;
        text-decoration: none;
      }
      .mrc-primary {
        background: linear-gradient(135deg,#2563eb,#1d4ed8);
        border-color: #2563eb;
        color: #fff;
        box-shadow: 0 14px 28px rgba(37,99,235,.22);
      }
      .mrc-secondary {
        background: #fff;
        color: #0f172a;
      }
      .mrc-danger {
        background: #fff1f2;
        color: #be123c;
        border-color: #fecdd3;
      }
      .mrc-primary:disabled {
        opacity: .55;
        cursor: not-allowed;
      }
      .mrc-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin: 14px 0;
      }
      .mrc-stat {
        border: 1px solid #d9e5f5;
        background: rgba(255,255,255,.9);
        border-radius: 18px;
        padding: 14px;
        text-align: left;
        cursor: pointer;
      }
      .mrc-stat span {
        display: block;
        color: #64748b;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .mrc-stat strong {
        display: block;
        font-size: 28px;
        margin-top: 4px;
      }
      .mrc-stat.is-active {
        border-color: #60a5fa;
        box-shadow: 0 0 0 4px rgba(96,165,250,.16);
      }
      .mrc-card {
        padding: 18px;
        margin-top: 14px;
      }
      .mrc-card-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .mrc-card-head h2 {
        margin: 0 0 3px;
        font-size: 24px;
      }
      .mrc-list {
        display: grid;
        gap: 10px;
      }
      .mrc-row {
        border: 1px solid #e2e8f0;
        background: #fff;
        border-radius: 16px;
        padding: 10px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 54px;
        gap: 10px;
        align-items: stretch;
      }
      .mrc-row-open {
        appearance: none;
        border: 0;
        background: transparent;
        padding: 2px;
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr) 130px 96px;
        gap: 12px;
        align-items: center;
        text-align: left;
        color: inherit;
        cursor: pointer;
        min-width: 0;
      }
      .mrc-camera-button {
        position: relative;
        border: 1px solid #bfdbfe;
        background: linear-gradient(180deg, #eff6ff, #dbeafe);
        color: #1d4ed8;
        border-radius: 14px;
        display: grid;
        place-items: center;
        cursor: pointer;
        min-height: 52px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.7);
      }
      .mrc-camera-button svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }
      .mrc-camera-button input {
        display: none;
      }
      .mrc-room {
        color: #2563eb;
        font-weight: 950;
      }
      .mrc-row-main strong,
      .mrc-media-info strong {
        display: block;
      }
      .mrc-row-main small,
      .mrc-media-info span {
        display: block;
        margin-top: 3px;
        color: #64748b;
        font-weight: 650;
      }
      .mrc-status {
        border-radius: 999px;
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 950;
        text-align: center;
      }
      .mrc-status-open {
        background: #eff6ff;
        color: #1d4ed8;
      }
      .mrc-status-pending_check {
        background: #fff7ed;
        color: #c2410c;
      }
      .mrc-status-done {
        background: #ecfdf5;
        color: #047857;
      }
      .mrc-progress {
        color: #334155;
        font-weight: 850;
      }
      .mrc-bar {
        grid-column: 1 / -1;
        height: 7px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .mrc-bar span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg,#2563eb,#22c55e);
      }
      .mrc-empty {
        border: 1px dashed #cbd5e1;
        border-radius: 18px;
        padding: 30px;
        text-align: center;
        color: #64748b;
        font-weight: 850;
      }
      .mrc-alert {
        border-radius: 16px;
        padding: 14px 16px;
        margin: 14px 0;
        font-weight: 900;
      }
      .mrc-alert-error {
        background: #fff1f2;
        border: 1px solid #fecdd3;
        color: #be123c;
      }
      .mrc-alert-success {
        background: #ecfdf5;
        border: 1px solid #bbf7d0;
        color: #047857;
      }
      .mrc-alert-info {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        color: #1d4ed8;
      }
      .mrc-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(15,23,42,.48);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px));
      }
      .mrc-modal {
        box-sizing: border-box;
        width: min(920px, 100%);
        max-height: calc(100dvh - 36px - env(safe-area-inset-bottom, 0px));
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        background: #fff;
        border-radius: 22px;
        padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px));
        box-shadow: 0 30px 80px rgba(15,23,42,.28);
      }
      .mrc-modal *,
      .mrc-modal *::before,
      .mrc-modal *::after {
        box-sizing: border-box;
      }
      .mrc-modal.is-wide {
        width: min(1120px, 100%);
      }
      .mrc-modal.is-markup-modal {
        width: min(1120px, 100%);
        height: calc(100dvh - 28px);
        max-height: calc(100dvh - 28px);
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
      }
      .mrc-modal-head {
        position: sticky;
        top: -18px;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: -18px -18px 14px;
        padding: 18px;
        background: rgba(255,255,255,0.96);
        border-bottom: 1px solid #eef2f7;
        backdrop-filter: blur(10px);
      }
      .mrc-modal-head h2 {
        margin: 0;
      }
      .mrc-modal-head button {
        width: 40px;
        height: 40px;
        border-radius: 14px;
        border: 1px solid #cbd5e1;
        background: #fff;
        font-weight: 950;
        cursor: pointer;
      }
      .mrc-modal.is-markup-modal .mrc-modal-head {
        position: static;
        flex: 0 0 auto;
        margin: 0;
        padding: 12px 14px;
      }
      .mrc-modal.is-markup-modal .mrc-modal-head h2 {
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: clamp(18px, 4.8vw, 24px);
        line-height: 1.12;
      }
      .mrc-form-grid,
      .mrc-meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .mrc-form-grid label,
      .mrc-full-label {
        display: grid;
        gap: 7px;
        font-weight: 900;
        min-width: 0;
      }
      .mrc-form-grid label:only-child {
        grid-column: 1 / -1;
        max-width: 360px;
      }
      .mrc-full-label em {
        color: #64748b;
        font-style: normal;
        font-weight: 750;
      }
      .mrc-form-grid input,
      .mrc-full-label textarea {
        width: 100%;
        max-width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        padding: 12px 14px;
        font: inherit;
        min-width: 0;
      }
      .mrc-full-label {
        margin-top: 12px;
      }
      .mrc-full-label textarea {
        min-height: 92px;
        resize: vertical;
      }
      .mrc-picker {
        margin-top: 14px;
        position: relative;
      }
      .mrc-media-choice {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .mrc-media-menu-wrap {
        position: relative;
        display: inline-flex;
        max-width: 100%;
      }
      .mrc-media-menu-trigger {
        min-height: 46px;
        border: 1px solid #bfdbfe;
        background: linear-gradient(180deg, #fff 0%, #eef6ff 100%);
        border-radius: 14px;
        color: #1d4ed8;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        padding: 0 16px;
        font-weight: 950;
        box-shadow: 0 12px 24px rgba(37, 99, 235, 0.08);
      }
      .mrc-media-menu-trigger svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      .mrc-media-popover {
        position: absolute;
        left: 0;
        top: auto;
        bottom: calc(100% + 8px);
        z-index: 70;
        width: min(300px, calc(100vw - 48px));
        display: grid;
        gap: 8px;
        border: 1px solid #dbeafe;
        background: #fff;
        border-radius: 16px;
        padding: 8px;
        box-shadow: 0 22px 50px rgba(15, 23, 42, 0.18);
      }
      .mrc-media-popover .mrc-media-choice-btn {
        min-height: 50px;
        justify-content: flex-start;
        box-shadow: none;
        background: #f8fbff;
      }
      .mrc-media-choice-btn {
        min-height: 72px;
        border: 1px solid #bfdbfe;
        background: linear-gradient(180deg, #fff 0%, #f8fbff 100%);
        border-radius: 16px;
        color: #1d4ed8;
        cursor: pointer;
        display: flex !important;
        align-items: center;
        justify-content: center;
        gap: 9px !important;
        padding: 12px;
        font-weight: 950;
        box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
      }
      .mrc-media-choice-btn svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
        flex-shrink: 0;
      }
      .mrc-media-choice-btn input,
      .mrc-file-button input {
        display: none;
      }
      .mrc-picker-hint {
        margin-top: 8px;
        color: #64748b;
        font-weight: 750;
        font-size: 12px;
      }
      .mrc-draft-grid,
      .mrc-media-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
        margin-top: 14px;
        touch-action: pan-y;
      }
      .mrc-draft-card,
      .mrc-media-card {
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        overflow: hidden;
        background: #fff;
      }
      .mrc-media-card.is-uploading {
        border-color: #bfdbfe;
        background: linear-gradient(180deg, #ffffff, #eff6ff);
        box-shadow: 0 0 0 4px rgba(96,165,250,.12);
      }
      .mrc-draft-card img,
      .mrc-draft-card video,
      .mrc-media-card img,
      .mrc-media-card video {
        width: 100%;
        aspect-ratio: 4 / 3;
        object-fit: cover;
        background: #0f172a;
        display: block;
      }
      .mrc-draft-remark {
        display: grid;
        gap: 6px;
        width: calc(100% - 20px);
        margin: 10px;
        color: #334155;
        font-size: 13px;
        font-weight: 850;
      }
      .mrc-draft-remark textarea {
        width: 100%;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 9px;
        min-height: 72px;
        resize: vertical;
        font: inherit;
        font-weight: 650;
        color: #0f172a;
      }
      .mrc-draft-routing {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        align-items: end;
        padding: 0 10px 10px;
      }
      .mrc-dept-choice {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .mrc-dept-choice > span,
      .mrc-draft-routing label {
        color: #334155;
        font-size: 13px;
        font-weight: 850;
      }
      .mrc-dept-choice > div {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .mrc-dept-check {
        min-height: 40px;
        border: 1px solid #dbeafe;
        background: #fff;
        border-radius: 12px;
        padding: 0 10px;
        display: flex !important;
        flex-direction: row !important;
        align-items: center;
        justify-content: center;
        gap: 7px !important;
        cursor: pointer;
        white-space: nowrap;
      }
      .mrc-dept-check.is-selected {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1d4ed8;
        box-shadow: inset 0 0 0 1px rgba(37,99,235,.18);
      }
      .mrc-dept-check input {
        width: 16px;
        height: 16px;
        accent-color: #2563eb;
      }
      .mrc-draft-routing label {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .mrc-draft-actions,
      .mrc-media-actions {
        padding: 10px;
        justify-content: flex-start;
      }
      .mrc-detail-head {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 12px;
      }
      .mrc-detail-head h3 {
        margin: 0 0 4px;
      }
      .mrc-detail-head p {
        margin: 0;
        color: #64748b;
        font-weight: 700;
      }
      .mrc-meta-grid {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 12px;
        color: #64748b;
        font-weight: 700;
      }
      .mrc-meta-grid strong {
        color: #0f172a;
      }
      .mrc-media-info {
        padding: 10px 10px 0;
      }
      .mrc-media-route {
        display: grid;
        gap: 7px;
        margin-top: 10px;
      }
      .mrc-media-route > span {
        color: #64748b;
        font-size: 12px;
        font-weight: 900;
        text-transform: uppercase;
      }
      .mrc-media-route > div {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .mrc-media-route button {
        min-height: 38px;
        border: 1px solid #dbeafe;
        border-radius: 12px;
        background: #fff;
        color: #334155;
        font-weight: 900;
        cursor: pointer;
      }
      .mrc-media-route button.is-selected {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1d4ed8;
        cursor: default;
      }
      .mrc-media-remark {
        margin: 5px 0 0;
        color: #0f172a;
        font-weight: 750;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .mrc-upload-chip {
        display: inline-flex;
        width: max-content;
        margin-top: 8px;
        border-radius: 999px;
        padding: 5px 9px;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 12px;
        font-weight: 950;
      }
      .mrc-secondary:disabled,
      .mrc-danger:disabled {
        opacity: .55;
        cursor: not-allowed;
      }
      .mrc-add-panel {
        margin-top: 14px;
        border-top: 1px solid #e2e8f0;
        padding-top: 14px;
      }
      .mrc-add-panel .mrc-media-popover {
        top: auto;
        bottom: calc(100% + 8px);
      }
      .mrc-markup {
        display: grid;
        justify-items: center;
        padding-bottom: 92px;
      }
      .mrc-markup canvas {
        max-width: 100%;
        border-radius: 16px;
        border: 1px solid #cbd5e1;
        touch-action: pan-y pinch-zoom;
        cursor: grab;
      }
      .mrc-markup canvas.is-drawing {
        touch-action: none;
        cursor: crosshair;
      }
      .mrc-tool-btn {
        min-height: 42px;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        background: #fff;
        color: #334155;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 14px;
        font-weight: 950;
        cursor: pointer;
      }
      .mrc-tool-btn > span[aria-hidden="true"] {
        display: none;
      }
      .mrc-tool-btn.is-active {
        border-color: #2563eb;
        background: #2563eb;
        color: #fff;
        box-shadow: 0 10px 24px rgba(37,99,235,.18);
      }
      .mrc-pen-btn {
        width: 46px;
        padding: 0;
        color: #dc2626;
      }
      .mrc-pen-btn span {
        display: none;
      }
      .mrc-pen-btn.is-active {
        border-color: #ef4444;
        background: #ef4444;
        color: #fff;
        box-shadow: 0 10px 24px rgba(239,68,68,.2);
      }
      .mrc-markup-toolbar {
        position: sticky;
        top: 61px;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: -4px 0 12px;
        padding: 10px;
        border: 1px solid #dbeafe;
        border-radius: 16px;
        background: rgba(239,246,255,.96);
        backdrop-filter: blur(10px);
      }
      .mrc-markup-toolbar span {
        color: #475569;
        font-size: 13px;
        font-weight: 850;
      }
      .mrc-markup-actions {
        position: sticky;
        bottom: -18px;
        z-index: 5;
        margin: 12px -18px -18px;
        padding: 12px 18px;
        background: rgba(255,255,255,.97);
        border-top: 1px solid #eef2f7;
        backdrop-filter: blur(10px);
      }
      .mrc-modal.is-markup-modal .mrc-markup-toolbar {
        position: static;
        flex: 0 0 auto;
        margin: 0 14px 8px;
        padding: 8px;
        flex-wrap: nowrap;
      }
      .mrc-modal.is-markup-modal .mrc-tool-btn {
        display: none;
      }
      .mrc-markup-toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .mrc-markup-toolbar-actions .mrc-primary,
      .mrc-markup-toolbar-actions .mrc-secondary {
        min-height: 40px;
        padding: 0 14px;
        white-space: nowrap;
      }
      .mrc-modal.is-markup-modal .mrc-markup-toolbar > span:last-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mrc-modal.is-markup-modal .mrc-markup {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        align-content: center;
        padding: 8px 14px 14px;
      }
      .mrc-modal.is-markup-modal .mrc-markup canvas {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
      }
      .mrc-modal.is-markup-modal .mrc-markup-actions {
        position: static;
        flex: 0 0 auto;
        margin: 0;
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
      }
      .mrc-denied {
        padding: 28px;
        text-align: center;
      }
      .mrc-denied a {
        display: inline-flex;
        margin-top: 14px;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        padding: 0 18px;
        border-radius: 14px;
        background: #0f172a;
        color: #fff;
        text-decoration: none;
        font-weight: 900;
      }
      @media (max-width: 820px) {
        .mrc-hero,
        .mrc-card-head,
        .mrc-detail-head {
          align-items: stretch;
          flex-direction: column;
        }
        .mrc-actions {
          justify-content: stretch;
        }
        .mrc-actions > * {
          flex: 1;
        }
        .mrc-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .mrc-row {
          grid-template-columns: minmax(0, 1fr) 50px;
        }
        .mrc-row-open {
          grid-template-columns: 1fr;
        }
        .mrc-form-grid,
        .mrc-meta-grid {
          grid-template-columns: 1fr;
        }
        .mrc-modal-actions {
          justify-content: stretch;
        }
        .mrc-modal-actions > button,
        .mrc-modal-actions > a,
        .mrc-modal-actions > label {
          flex: 1;
        }
      }
      @media (max-width: 520px) {
        .mrc-shell {
          margin: 0 -4px;
        }
        .mrc-hero,
        .mrc-card {
          border-radius: 18px;
          padding: 14px;
        }
        .mrc-summary {
          gap: 8px;
        }
        .mrc-stat {
          padding: 11px;
        }
        .mrc-stat strong {
          font-size: 24px;
        }
        .mrc-primary,
        .mrc-secondary,
        .mrc-danger {
          min-height: 40px;
          padding: 0 12px;
          font-size: 13px;
        }
        .mrc-draft-routing {
          grid-template-columns: 1fr;
        }
        .mrc-media-choice {
          grid-template-columns: 1fr;
        }
        .mrc-media-choice-btn {
          min-height: 54px;
        }
        .mrc-modal {
          padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px));
          border-radius: 18px;
          max-height: calc(100dvh - 22px - env(safe-area-inset-bottom, 0px));
        }
        .mrc-modal > .mrc-modal-actions {
          bottom: calc(-14px - env(safe-area-inset-bottom, 0px));
          margin: 14px -14px calc(-14px - env(safe-area-inset-bottom, 0px));
          padding: 10px 14px calc(12px + env(safe-area-inset-bottom, 0px));
        }
        .mrc-modal-head {
          top: -14px;
          margin: -14px -14px 12px;
          padding: 14px;
        }
        .mrc-markup-toolbar {
          top: 55px;
        }
        .mrc-modal.is-markup-modal .mrc-markup-toolbar {
          gap: 8px;
          margin: 0 10px 8px;
          padding: 8px;
        }
        .mrc-modal.is-markup-modal .mrc-markup-mode-label {
          display: none;
        }
        .mrc-markup-toolbar-actions {
          margin-left: auto;
        }
        .mrc-markup-toolbar-actions .mrc-secondary {
          display: inline-flex;
        }
        .mrc-markup-toolbar-actions .mrc-primary,
        .mrc-markup-toolbar-actions .mrc-secondary {
          min-height: 42px;
          padding: 0 13px;
        }
        .mrc-markup-actions {
          bottom: -14px;
          margin: 12px -14px -14px;
          padding: 12px 14px;
        }
        .mrc-draft-grid,
        .mrc-media-grid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
