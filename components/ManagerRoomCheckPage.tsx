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

type MediaUploadJob = {
  id: string;
};

type DurableUploadRow = {
  id: string;
  check_id: string;
  media_type: MediaType;
  caption: string | null;
  position: number;
  storage_path: string;
  file_name: string;
  file_size: number;
  content_type: string;
  status: 'PENDING' | 'UPLOADING' | 'READY' | 'FAILED';
  error_message: string | null;
  created_at: string | null;
};

type StoredUploadFile = {
  id: string;
  file: File;
  prepared: boolean;
  uploadUrl: string | null;
  checkId?: string;
  mediaType?: MediaType;
  caption?: string | null;
  position?: number;
  storagePath?: string;
};

type ManagerRoomCheckPageProps = {
  department: DepartmentCode;
};

const MAX_MEDIA_PER_CHECK = 30;
const MAX_VIDEO_DURATION_SECONDS = 10;
const MAX_VIDEO_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_OUTPUT_BYTES = 15 * 1024 * 1024;
const MAX_CONCURRENT_UPLOAD_JOBS = 3;
const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;
const UPLOAD_DB_NAME = 'hotelhallmark-manager-room-check-uploads';
const UPLOAD_DB_STORE = 'files';
const MANAGER_ROOM_CHECK_CLEANUP_KEY = 'manager-room-check-cleanup-at';
const MANAGER_ROOM_CHECK_CLEANUP_MIN_MS = 24 * 60 * 60 * 1000;

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function normalizedMediaContentType(type: string, mediaType: MediaType) {
  const baseType = String(type || '').split(';')[0].trim().toLowerCase();
  if (mediaType === 'video') {
    if (baseType === 'video/webm') return 'video/webm';
    if (baseType === 'video/quicktime') return 'video/quicktime';
    return 'video/mp4';
  }
  if (baseType === 'image/png' || baseType === 'image/webp' || baseType === 'image/gif') return baseType;
  return 'image/jpeg';
}

function withNormalizedFileType(file: File, mediaType: MediaType) {
  const contentType = normalizedMediaContentType(file.type, mediaType);
  if (file.type === contentType) return file;
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified });
}

function openUploadDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot preserve uploads after the page closes.'));
      return;
    }
    const request = indexedDB.open(UPLOAD_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(UPLOAD_DB_STORE)) {
        request.result.createObjectStore(UPLOAD_DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the upload store.'));
  });
}

async function readStoredUpload(id: string) {
  const db = await openUploadDatabase();
  try {
    return await new Promise<StoredUploadFile | null>((resolve, reject) => {
      const request = db.transaction(UPLOAD_DB_STORE, 'readonly').objectStore(UPLOAD_DB_STORE).get(id);
      request.onsuccess = () => resolve((request.result as StoredUploadFile | undefined) || null);
      request.onerror = () => reject(request.error || new Error('Unable to read the saved upload.'));
    });
  } finally {
    db.close();
  }
}

async function readAllStoredUploads() {
  const db = await openUploadDatabase();
  try {
    return await new Promise<StoredUploadFile[]>((resolve, reject) => {
      const request = db.transaction(UPLOAD_DB_STORE, 'readonly').objectStore(UPLOAD_DB_STORE).getAll();
      request.onsuccess = () => resolve((request.result as StoredUploadFile[] | undefined) || []);
      request.onerror = () => reject(request.error || new Error('Unable to read saved uploads.'));
    });
  } finally {
    db.close();
  }
}

async function writeStoredUpload(record: StoredUploadFile) {
  const db = await openUploadDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(UPLOAD_DB_STORE, 'readwrite').objectStore(UPLOAD_DB_STORE).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Unable to save the upload on this device.'));
    });
  } finally {
    db.close();
  }
}

async function deleteStoredUpload(id: string) {
  const db = await openUploadDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(UPLOAD_DB_STORE, 'readwrite').objectStore(UPLOAD_DB_STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Unable to clear the completed upload.'));
    });
  } finally {
    db.close();
  }
}

function encodeTusMetadata(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function storageResumableEndpoint() {
  const configuredUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!configuredUrl) throw new Error('Supabase is not configured.');
  const url = new URL(configuredUrl);
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

async function tusFetch(url: string, init: RequestInit, retryDelays = [0, 3000, 5000, 10000, 20000]) {
  let lastError: Error | null = null;
  for (const delay of retryDelays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Upload paused while this device is offline.');
    }
    try {
      const response = await fetch(url, init);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) return response;
      lastError = new Error(`Storage temporarily returned ${response.status}.`);
    } catch (error: any) {
      lastError = new Error(error?.message || 'The upload connection was interrupted.');
    }
  }
  throw lastError || new Error('The upload connection was interrupted.');
}

async function uploadFileResumably(params: {
  file: File;
  storagePath: string;
  uploadUrl: string | null;
  getAccessToken: () => Promise<string>;
  saveUploadUrl: (uploadUrl: string) => Promise<void>;
}) {
  let uploadUrl = params.uploadUrl;
  let token = await params.getAccessToken();
  const commonHeaders = () => ({
    Authorization: `Bearer ${token}`,
    'Tus-Resumable': '1.0.0',
    'x-upsert': 'true',
  });

  if (uploadUrl) {
    let head = await tusFetch(uploadUrl, { method: 'HEAD', headers: commonHeaders(), cache: 'no-store' }, [0, 3000]);
    if (head.status === 401) {
      token = await params.getAccessToken();
      head = await tusFetch(uploadUrl, { method: 'HEAD', headers: commonHeaders(), cache: 'no-store' }, [0, 3000]);
      if (!head.ok) throw new Error(`Unable to resume upload (${head.status}).`);
    } else if (head.status === 404 || head.status === 410) {
      uploadUrl = null;
    } else if (!head.ok) {
      throw new Error(`Unable to resume upload (${head.status}).`);
    }
  }

  if (!uploadUrl) {
    const metadata = [
      ['bucketName', 'task-images'],
      ['objectName', params.storagePath],
      ['contentType', normalizedMediaContentType(params.file.type, params.file.type.startsWith('video/') ? 'video' : 'image')],
      ['cacheControl', '3600'],
    ]
      .map(([key, value]) => `${key} ${encodeTusMetadata(value)}`)
      .join(',');
    const create = await tusFetch(storageResumableEndpoint(), {
      method: 'POST',
      headers: {
        ...commonHeaders(),
        'Upload-Length': String(params.file.size),
        'Upload-Metadata': metadata,
      },
      cache: 'no-store',
    });
    if (!create.ok) throw new Error((await create.text()) || `Unable to start upload (${create.status}).`);
    const location = create.headers.get('location');
    if (!location) throw new Error('Storage did not return a resumable upload URL.');
    uploadUrl = new URL(location, storageResumableEndpoint()).toString();
    await params.saveUploadUrl(uploadUrl);
  }

  const offsetResponse = await tusFetch(uploadUrl, {
    method: 'HEAD',
    headers: commonHeaders(),
    cache: 'no-store',
  }, [0, 3000]);
  if (!offsetResponse.ok) throw new Error(`Unable to read upload progress (${offsetResponse.status}).`);
  let offset = Number(offsetResponse.headers.get('upload-offset') || '0');
  if (!Number.isFinite(offset) || offset < 0 || offset > params.file.size) offset = 0;

  while (offset < params.file.size) {
    token = await params.getAccessToken();
    const chunk = params.file.slice(offset, Math.min(offset + RESUMABLE_CHUNK_BYTES, params.file.size));
    const patch = await tusFetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        ...commonHeaders(),
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: chunk,
      cache: 'no-store',
    });
    if (patch.status === 409) {
      const head = await tusFetch(uploadUrl, { method: 'HEAD', headers: commonHeaders(), cache: 'no-store' }, [0, 3000]);
      if (!head.ok) throw new Error('Unable to recover upload progress.');
      offset = Number(head.headers.get('upload-offset') || '0');
      continue;
    }
    if (!patch.ok) throw new Error((await patch.text()) || `Upload failed (${patch.status}).`);
    offset = Number(patch.headers.get('upload-offset') || offset + chunk.size);
  }
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
  if (status === 'DONE') return 'Done';
  if (status === 'PENDING_CHECK') return 'Done';
  return 'Open';
}

function isDoneLikeStatus(status: CheckStatus) {
  return status === 'DONE' || status === 'PENDING_CHECK';
}

function statusClass(status: CheckStatus) {
  return isDoneLikeStatus(status) ? 'done' : 'open';
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
  if (file.size > MAX_VIDEO_INPUT_BYTES) {
    throw new Error(
      `${file.name} is too large (${formatMegabytes(file.size)}). Maximum source video size is 50MB.`
    );
  }

  const duration = await getVideoDuration(file);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${file.name} cannot be checked. Please choose another video.`);
  }
  if (duration > MAX_VIDEO_DURATION_SECONDS + 0.25) {
    throw new Error(
      `${file.name} is ${Math.ceil(duration)} seconds. Maximum video duration is 10 seconds.`
    );
  }
}

async function compressVideoFile(file: File) {
  await validateVideoFile(file);
  if (typeof MediaRecorder === 'undefined') {
    return file;
  }

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-10000px';
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Unable to prepare video for compression.'));
    });

    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round((video.videoWidth || 2) * scale));
    canvas.height = Math.max(2, Math.round((video.videoHeight || 2) * scale));
    const context = canvas.getContext('2d');
    const sourceCapture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!context || typeof canvas.captureStream !== 'function' || typeof sourceCapture !== 'function') {
      return file;
    }

    const preferredTypes = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const stream = canvas.captureStream(24);
    const sourceStream = sourceCapture.call(video);
    sourceStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 1_000_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };

    const compressed = await new Promise<Blob>((resolve, reject) => {
      let frameId = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.cancelAnimationFrame(frameId);
        video.pause();
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.onerror = () => reject(new Error('Video compression failed.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      const drawFrame = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (video.ended || video.currentTime >= MAX_VIDEO_DURATION_SECONDS) finish();
        else frameId = window.requestAnimationFrame(drawFrame);
      };
      recorder.start(250);
      void video.play().then(drawFrame).catch(() => reject(new Error('Video compression could not start.')));
    });

    stream.getTracks().forEach((track) => track.stop());
    sourceStream.getTracks().forEach((track) => track.stop());
    if (!compressed.size) throw new Error('Video compression produced an empty file.');
    if (compressed.size > MAX_VIDEO_OUTPUT_BYTES) {
      throw new Error(`Compressed video is still too large (${formatMegabytes(compressed.size)}).`);
    }
    const extension = compressed.type.includes('mp4') ? 'mp4' : 'webm';
    return new File([compressed], file.name.replace(/\.[^.]+$/, `.${extension}`), {
      type: normalizedMediaContentType(compressed.type || `video/${extension}`, 'video'),
      lastModified: Date.now(),
    });
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}

async function compressImageFile(file: File, maxSide = 1920, quality = 0.88) {
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
  const [orphanedUploads, setOrphanedUploads] = useState<StoredUploadFile[]>([]);

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
  const [fullMedia, setFullMedia] = useState<CheckMedia | null>(null);
  const [markupDrawMode, setMarkupDrawMode] = useState(false);
  const [commentEditingId, setCommentEditingId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSavingId, setCommentSavingId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const cleanupDoneRef = useRef(false);
  const deepLinkOpenedRef = useRef(false);
  const uploadQueueRef = useRef<MediaUploadJob[]>([]);
  const queuedUploadIdsRef = useRef(new Set<string>());
  const uploadPreviewUrlsRef = useRef(new Map<string, string>());
  const activeUploadWorkersRef = useRef(0);
  const uploadStatsRef = useRef({
    total: 0,
    completed: 0,
    failed: 0,
    paused: 0,
  });

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

  const visibleChecks = checks.filter((check) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'DONE') return isDoneLikeStatus(check.status);
    return check.status === statusFilter;
  });

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
    if (authLoading || !canAccess) return;
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
    const resume = () => void resumeDurableUploadJobs();
    const resumeWhenVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resumeWhenVisible);
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resumeWhenVisible);
    };
  }, [authLoading, canAccess]);

  useEffect(() => {
    if (deepLinkOpenedRef.current || !checks.length || typeof window === 'undefined') return;
    const requestedRoom = new URLSearchParams(window.location.search).get('room')?.trim();
    if (!requestedRoom) return;
    const matchingCheck = checks.find(
      (check) => check.department === department && check.room_number === requestedRoom
    );
    if (!matchingCheck) return;
    deepLinkOpenedRef.current = true;
    setSelectedCheckId(matchingCheck.id);
    setDetailOpen(true);
  }, [checks, department]);

  useEffect(() => {
    return () => {
      uploadPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      uploadPreviewUrlsRef.current.clear();
    };
  }, []);

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
        // Keep the saved markup sharp. CSS scales this full canvas down for drawing
        // instead of permanently reducing the file to the phone's preview size.
        const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
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
      let durableRows: DurableUploadRow[] = [];
      if (ids.length) {
        const [{ data: loadedMedia, error: mediaError }, { data: loadedUploads, error: uploadsError }] =
          await Promise.all([
            supabase
              .from('manager_room_check_media')
              .select('*')
              .in('check_id', ids)
              .order('position', { ascending: true }),
            supabase
              .from('manager_room_check_uploads')
              .select('*')
              .in('check_id', ids)
              .neq('status', 'READY')
              .order('position', { ascending: true }),
          ]);
        if (mediaError) throw mediaError;
        if (uploadsError) throw uploadsError;
        mediaRows = (loadedMedia || []) as CheckMedia[];
        durableRows = (loadedUploads || []) as DurableUploadRow[];
      }

      const durableMediaRows = await Promise.all(
        durableRows.map(async (row): Promise<CheckMedia> => {
          let previewUrl = uploadPreviewUrlsRef.current.get(row.id) || '';
          let hasLocalFile = Boolean(previewUrl);
          if (!previewUrl) {
            try {
              const stored = await readStoredUpload(row.id);
              if (stored?.file) {
                previewUrl = URL.createObjectURL(stored.file);
                uploadPreviewUrlsRef.current.set(row.id, previewUrl);
                hasLocalFile = true;
              }
            } catch {
              hasLocalFile = false;
            }
          }
          return {
            id: `uploading-${row.id}`,
            check_id: row.check_id,
            media_url: previewUrl,
            media_path: row.storage_path,
            media_type: row.media_type,
            caption: row.caption,
            position: row.position,
            completed_at: null,
            completed_by_name: null,
            completed_by_email: null,
            created_at: row.created_at,
            upload_status: row.status === 'FAILED' || !hasLocalFile ? 'failed' : 'uploading',
            upload_error:
              row.error_message ||
              (!hasLocalFile ? 'The original file is saved on the device that created this upload.' : null),
          };
        })
      );

      setChecks((checkRows || []) as RoomCheck[]);
      setMedia([...mediaRows, ...durableMediaRows]);
      enqueueDurableIds(
        durableRows
          .filter((row) => row.status === 'PENDING' || row.status === 'UPLOADING')
          .map((row) => row.id)
      );
      await discoverOrphanedUploads();
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
    const [{ count: savedCount, error: savedError }, { count: pendingCount, error: pendingError }] =
      await Promise.all([
        supabase
          .from('manager_room_check_media')
          .select('id', { count: 'exact', head: true })
          .eq('check_id', checkId),
        supabase
          .from('manager_room_check_uploads')
          .select('id', { count: 'exact', head: true })
          .eq('check_id', checkId)
          .neq('status', 'READY'),
      ]);
    if (savedError) throw savedError;
    if (pendingError) throw pendingError;
    return (savedCount ?? 0) + (pendingCount ?? 0);
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
      const { count: pendingUploadCount, error: pendingUploadError } = await supabase
        .from('manager_room_check_uploads')
        .select('id', { count: 'exact', head: true })
        .eq('check_id', pair.duplicateId)
        .neq('status', 'READY');
      if (pendingUploadError) throw pendingUploadError;
      // Never delete a duplicate check while its files are still stored locally
      // or uploading. Deleting the check cascades to its durable queue records.
      if ((pendingUploadCount ?? 0) > 0) continue;

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

  async function discoverOrphanedUploads() {
    if (!supabase) return;
    try {
      const storedUploads = await readAllStoredUploads();
      if (!storedUploads.length) {
        setOrphanedUploads([]);
        return;
      }
      const storedIds = storedUploads.map((item) => item.id);
      const { data, error } = await supabase
        .from('manager_room_check_uploads')
        .select('id')
        .in('id', storedIds);
      if (error) throw error;
      const linkedIds = new Set((data || []).map((item) => item.id));
      setOrphanedUploads(storedUploads.filter((item) => !linkedIds.has(item.id)));
    } catch {
      // Normal room-check loading should continue even if this browser blocks IndexedDB.
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
      let file: File;
      try {
        file = isImage ? await compressImageFile(rawFile) : rawFile;
      } catch (error: any) {
        rejected.push(error?.message || `${rawFile.name} could not be prepared.`);
        continue;
      }
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
          source_page: 'MANAGER_ROOM_CHECK',
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
        .select('id, status, created_at')
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

      const checkTime = new Date(check.created_at).getTime();
      const task = [...(data || [])].sort(
        (a, b) =>
          Math.abs(new Date(a.created_at).getTime() - checkTime) -
          Math.abs(new Date(b.created_at).getTime() - checkTime)
      )[0];
      let synced = 0;
      if (task) {
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
      .select('id, created_at')
      .eq('room', check.room_number)
      .eq('department', check.department)
      .eq('task_text', taskText)
      .limit(20);

    if (error) throw error;
    if (!data?.length) return;

    const checkTime = new Date(check.created_at).getTime();
    const task = [...data].sort(
      (a, b) =>
        Math.abs(new Date(a.created_at).getTime() - checkTime) -
        Math.abs(new Date(b.created_at).getTime() - checkTime)
    )[0];
    if (!task) return;
    const token = await getAccessToken();
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

  function updateQueuedUploadProgress() {
    const stats = uploadStatsRef.current;
    const finished = stats.completed + stats.failed;
    setUploadProgressMsg(
      `Resumable media uploads ${finished}/${stats.total}. You may continue creating room checks.`
    );
  }

  function uploadFileExtension(file: File, mediaType: MediaType) {
    const fromName = file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
    if (file.type.includes('webm')) return 'webm';
    if (file.type.includes('mp4')) return 'mp4';
    return mediaType === 'video' ? 'mp4' : 'jpg';
  }

  function enqueueDurableIds(ids: string[]) {
    let added = 0;
    ids.forEach((id) => {
      if (queuedUploadIdsRef.current.has(id)) return;
      queuedUploadIdsRef.current.add(id);
      uploadQueueRef.current.push({ id });
      uploadStatsRef.current.total += 1;
      added += 1;
    });
    if (!added) return;
    updateQueuedUploadProgress();
    const workerSlots = Math.min(
      MAX_CONCURRENT_UPLOAD_JOBS - activeUploadWorkersRef.current,
      uploadQueueRef.current.length
    );
    for (let index = 0; index < workerSlots; index += 1) void runMediaUploadWorker();
  }

  async function resumeDurableUploadJobs() {
    if (!supabase || !canAccess || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    try {
      const { data, error } = await supabase
        .from('manager_room_check_uploads')
        .select('id, manager_room_checks!inner(department)')
        .in('status', ['PENDING', 'UPLOADING'])
        .eq('manager_room_checks.department', department)
        .order('created_at', { ascending: true })
        .limit(120);
      if (error) throw error;
      const resumableIds: string[] = [];
      for (const row of data || []) {
        if (await readStoredUpload(row.id)) resumableIds.push(row.id);
      }
      enqueueDurableIds(resumableIds);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Unable to resume saved uploads.');
    }
  }

  async function persistMediaUploadJobs(
    jobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }>
  ) {
    if (!supabase || !profile) return;
    for (const job of jobs) {
      let position = await getMediaCountForCheck(job.check.id);
      if (position + job.items.length > MAX_MEDIA_PER_CHECK) {
        throw new Error(`Maximum ${MAX_MEDIA_PER_CHECK} photos or videos per room check.`);
      }
      for (const item of job.items) {
        position += 1;
        const id = crypto.randomUUID();
        const storagePath = `manager-room-check-media/${job.check.id}/${id}.${uploadFileExtension(
          item.file,
          item.media_type
        )}`;
        await writeStoredUpload({
          id,
          file: item.file,
          prepared: item.media_type === 'image',
          uploadUrl: null,
          checkId: job.check.id,
          mediaType: item.media_type,
          caption: item.caption.trim() || null,
          position,
          storagePath,
        });
        const { error } = await supabase.from('manager_room_check_uploads').insert({
          id,
          check_id: job.check.id,
          media_type: item.media_type,
          caption: item.caption.trim() || null,
          position,
          storage_path: storagePath,
          file_name: item.file.name,
          file_size: item.file.size,
          content_type: normalizedMediaContentType(item.file.type, item.media_type),
          status: 'PENDING',
          created_by_user_id: profile.user_id || null,
        });
        if (error) {
          await deleteStoredUpload(id).catch(() => undefined);
          throw error;
        }
        uploadPreviewUrlsRef.current.set(id, item.previewUrl);
        const optimisticRow: CheckMedia = {
          id: `uploading-${id}`,
          check_id: job.check.id,
          media_url: item.previewUrl,
          media_path: storagePath,
          media_type: item.media_type,
          caption: item.caption.trim() || null,
          position,
          completed_at: null,
          completed_by_name: null,
          completed_by_email: null,
          created_at: new Date().toISOString(),
          upload_status: 'uploading',
          upload_error: null,
        };
        setMedia((current) => [optimisticRow, ...current]);
        enqueueDurableIds([id]);
      }
    }
  }

  async function processDurableUpload(id: string) {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase
      .from('manager_room_check_uploads')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    const row = data as DurableUploadRow;
    if (row.status === 'READY') {
      await deleteStoredUpload(id).catch(() => undefined);
      return;
    }
    let stored = await readStoredUpload(id);
    if (!stored?.file) throw new Error('The original file is no longer available on this device.');

    if (row.media_type === 'video' && !stored.prepared) {
      const compressed = await compressVideoFile(stored.file);
      stored = { ...stored, file: compressed, prepared: true, uploadUrl: null };
      await writeStoredUpload(stored);
    }
    const normalizedFile = withNormalizedFileType(stored.file, row.media_type);
    if (normalizedFile !== stored.file) {
      stored = { ...stored, file: normalizedFile, uploadUrl: null };
      await writeStoredUpload(stored);
    }

    await supabase
      .from('manager_room_check_uploads')
      .update({ status: 'UPLOADING', error_message: null, updated_at: new Date().toISOString() })
      .eq('id', id);

    await uploadFileResumably({
      file: stored.file,
      storagePath: row.storage_path,
      uploadUrl: stored.uploadUrl,
      getAccessToken,
      saveUploadUrl: async (uploadUrl) => {
        stored = { ...stored!, uploadUrl };
        await writeStoredUpload(stored);
      },
    });

    const { data: publicData } = supabase.storage.from('task-images').getPublicUrl(row.storage_path);
    const readyMedia: CheckMedia = {
      id: row.id,
      check_id: row.check_id,
      media_url: publicData.publicUrl,
      media_path: row.storage_path,
      media_type: row.media_type,
      caption: row.caption,
      position: row.position,
      completed_at: null,
      completed_by_name: null,
      completed_by_email: null,
      created_at: new Date().toISOString(),
    };
    const { error: mediaError } = await supabase
      .from('manager_room_check_media')
      .upsert(readyMedia, { onConflict: 'id' });
    if (mediaError) throw mediaError;
    const { error: readyError } = await supabase
      .from('manager_room_check_uploads')
      .update({ status: 'READY', error_message: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (readyError) throw readyError;
    await supabase
      .from('manager_room_checks')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', row.check_id);
    await deleteStoredUpload(id).catch(() => undefined);
    const previewUrl = uploadPreviewUrlsRef.current.get(id);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    uploadPreviewUrlsRef.current.delete(id);
    setMedia((current) => [readyMedia, ...current.filter((item) => item.id !== `uploading-${id}`)]);
  }

  async function retryDurableUpload(item: CheckMedia) {
    if (!supabase || !item.id.startsWith('uploading-')) return;
    const id = item.id.slice('uploading-'.length);
    let stored = await readStoredUpload(id).catch(() => null);
    if (!stored?.file) {
      setErrorMsg('Retry this upload from the same device where the photo or video was selected.');
      return;
    }
    stored = {
      ...stored,
      file: withNormalizedFileType(stored.file, item.media_type),
      uploadUrl: null,
    };
    await writeStoredUpload(stored);
    const { error } = await supabase
      .from('manager_room_check_uploads')
      .update({ status: 'PENDING', error_message: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      setErrorMsg(error.message || 'Unable to retry upload.');
      return;
    }
    setMedia((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, upload_status: 'uploading', upload_error: null } : entry
      )
    );
    enqueueDurableIds([id]);
  }

  async function retryAllFailedUploads() {
    if (!supabase || !canAccess) return;
    setErrorMsg('');
    const { data: failedRows, error: failedRowsError } = await supabase
      .from('manager_room_check_uploads')
      .select('id, media_type')
      .eq('status', 'FAILED')
      .order('created_at', { ascending: true })
      .limit(120);
    if (failedRowsError) {
      setErrorMsg(failedRowsError.message || 'Unable to find failed uploads.');
      return;
    }
    const retryIds: string[] = [];
    for (const failed of failedRows || []) {
      let stored = await readStoredUpload(failed.id).catch(() => null);
      if (!stored?.file) continue;
      stored = {
        ...stored,
        file: withNormalizedFileType(stored.file, failed.media_type as MediaType),
        uploadUrl: null,
      };
      await writeStoredUpload(stored);
      const { error } = await supabase
        .from('manager_room_check_uploads')
        .update({ status: 'PENDING', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', failed.id);
      if (!error) retryIds.push(failed.id);
    }
    if (!retryIds.length) {
      setErrorMsg('No failed files were found on this device. Re-upload them from the phone where they were selected.');
      return;
    }
    const retrySet = new Set(retryIds.map((id) => `uploading-${id}`));
    setMedia((current) =>
      current.map((item) =>
        retrySet.has(item.id) ? { ...item, upload_status: 'uploading', upload_error: null } : item
      )
    );
    setSuccessMsg(`${retryIds.length} failed upload${retryIds.length === 1 ? '' : 's'} queued again.`);
    enqueueDurableIds(retryIds);
  }

  function beginMediaComment(item: CheckMedia) {
    setCommentEditingId(item.id);
    setCommentDraft(mediaRemark(item.caption));
  }

  function cancelMediaComment() {
    setCommentEditingId(null);
    setCommentDraft('');
  }

  async function saveMediaComment(item: CheckMedia) {
    if (!supabase || item.upload_status) return;
    const comment = commentDraft.trim();
    if (comment.length > 1000) {
      setErrorMsg('Media comment must be 1,000 characters or less.');
      return;
    }
    setCommentSavingId(item.id);
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('manager_room_check_media')
        .update({ caption: comment || null })
        .eq('id', item.id);
      if (error) throw error;
      setMedia((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, caption: comment || null } : entry))
      );
      setFullMedia((current) =>
        current?.id === item.id ? { ...current, caption: comment || null } : current
      );
      cancelMediaComment();
      setSuccessMsg(comment ? 'Media comment saved.' : 'Media comment removed.');
    } catch (error: any) {
      setErrorMsg(error?.message || 'Unable to save media comment.');
    } finally {
      setCommentSavingId(null);
    }
  }

  async function recoverOrphanedUploads(check: RoomCheck) {
    if (!canManageContent || !orphanedUploads.length) return;
    const confirmed = window.confirm(
      `Recover ${orphanedUploads.length} saved file${orphanedUploads.length === 1 ? '' : 's'} into Room ${check.room_number} ${departmentLabel(check.department)}? Only continue if these files belong to this room.`
    );
    if (!confirmed) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const recoveryItems: DraftMedia[] = orphanedUploads.map((stored) => {
        const mediaType = stored.mediaType || (stored.file.type.startsWith('video/') ? 'video' : 'image');
        return {
          id: crypto.randomUUID(),
          file: withNormalizedFileType(stored.file, mediaType),
          previewUrl: URL.createObjectURL(stored.file),
          media_type: mediaType,
          caption: stored.caption || stored.file.name || '',
          assigned_department: check.department,
          marked: false,
        };
      });
      await persistMediaUploadJobs([
        { check, items: recoveryItems, label: departmentLabel(check.department) },
      ]);
      await Promise.all(orphanedUploads.map((stored) => deleteStoredUpload(stored.id).catch(() => undefined)));
      const recoveredCount = orphanedUploads.length;
      setOrphanedUploads([]);
      setSuccessMsg(
        `${recoveredCount} saved file${recoveredCount === 1 ? '' : 's'} recovered into Room ${check.room_number} and queued for upload.`
      );
    } catch (error: any) {
      setErrorMsg(error?.message || 'Unable to recover the saved files.');
    } finally {
      setSaving(false);
    }
  }

  async function runMediaUploadWorker() {
    activeUploadWorkersRef.current += 1;
    try {
      while (true) {
        const job = uploadQueueRef.current.shift();
        if (!job) break;
        try {
          await processDurableUpload(job.id);
          uploadStatsRef.current.completed += 1;
        } catch (error: any) {
          const paused =
            (typeof navigator !== 'undefined' && !navigator.onLine) ||
            /offline|network|fetch|connection|interrupted/i.test(error?.message || '');
          if (paused) uploadStatsRef.current.paused += 1;
          else uploadStatsRef.current.failed += 1;
          await supabase
            ?.from('manager_room_check_uploads')
            .update({
              status: paused ? 'PENDING' : 'FAILED',
              error_message: paused ? 'Upload paused. It will resume when this device reconnects.' : error?.message || 'Upload failed.',
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id);
          setMedia((current) =>
            current.map((item) =>
              item.id === `uploading-${job.id}`
                ? {
                    ...item,
                    upload_status: paused ? 'uploading' : 'failed',
                    upload_error: paused
                      ? 'Upload paused. It will resume when this device reconnects.'
                      : error?.message || 'Upload failed.',
                  }
                : item
            )
          );
        } finally {
          queuedUploadIdsRef.current.delete(job.id);
        }
        updateQueuedUploadProgress();
      }
    } finally {
      activeUploadWorkersRef.current -= 1;
      if (activeUploadWorkersRef.current === 0 && uploadQueueRef.current.length === 0) {
        const stats = uploadStatsRef.current;
        uploadStatsRef.current = { total: 0, completed: 0, failed: 0, paused: 0 };
        if (activeUploadWorkersRef.current === 0 && uploadQueueRef.current.length === 0) {
          setUploadProgressMsg('');
        } else {
          updateQueuedUploadProgress();
        }
        if (stats.paused) {
          setUploadProgressMsg(
            `${stats.paused} upload${stats.paused === 1 ? ' is' : 's are'} safely paused and will resume when this device reconnects or returns to this page.`
          );
        } else if (stats.failed) {
          setErrorMsg(
            `${stats.failed} media item${stats.failed === 1 ? '' : 's'} failed to upload. The failed preview remains visible so it is not mistaken for a completed upload.`
          );
        } else {
          setSuccessMsg(
            `${stats.completed} media item${stats.completed === 1 ? '' : 's'} uploaded across all queued room checks.`
          );
        }
      }
    }
  }

  async function queueMediaUploadJobs(jobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }>) {
    if (!jobs.length) return;
    await persistMediaUploadJobs(jobs);
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
    try {
      const normalizedRoomNumber = roomNumber.trim();
      const mediaToUpload = [...draftMedia];
      const groups = groupedDraftMedia(mediaToUpload);
      const createdDepartments: string[] = [];
      const uploadJobs: Array<{ check: RoomCheck; items: DraftMedia[]; label: string }> = [];
      if (mediaToUpload.length) {
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
      if (uploadJobs.length) await queueMediaUploadJobs(uploadJobs);
      setSaving(false);
      setSuccessMsg(
        uploadJobs.length
          ? `Manager room check created for ${createdDepartments.join(' and ')}. Media is uploading in background.`
          : `Manager room check created for ${createdDepartments.join(' and ')}.`
      );

      if (!uploadJobs.length) {
        await loadChecks();
      }
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to create room check.');
      if (activeUploadWorkersRef.current === 0 && uploadQueueRef.current.length === 0) {
        setUploadProgressMsg('');
      }
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

        const { error: reopenError } = await supabase
          .from('manager_room_checks')
          .update({
            status: 'OPEN',
            submitted_for_check_at: null,
            submitted_for_check_by_name: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetCheck.id)
          .neq('status', 'DONE');
        if (reopenError) throw reopenError;

        uploadJobs.push({ check: targetCheck, items, label: departmentLabel(targetDepartment) });
        touchedChecks.push(targetCheck);
      }

      await queueMediaUploadJobs(uploadJobs);
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
        const parentCheck = checks.find((check) => check.id === item.check_id) || null;
        const { error: checkError } = await supabase
          .from('manager_room_checks')
          .update({
            status: 'DONE',
            submitted_for_check_at: now,
            submitted_for_check_by_name: profile.name || null,
            checked_at: now,
            checked_by_name: profile.name || null,
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
                  status: 'DONE',
                  submitted_for_check_at: now,
                  submitted_for_check_by_name: profile.name || null,
                  checked_at: now,
                  checked_by_name: profile.name || null,
                }
              : check
          )
        );
        if (parentCheck) {
          const synced = await syncDashboardReminderStatus(parentCheck, 'DONE');
          setSuccessMsg(
            synced
              ? `Room check completed. ${synced} dashboard reminder${synced === 1 ? '' : 's'} marked done.`
              : 'Room check completed.'
          );
        } else {
          setSuccessMsg('Room check completed.');
        }
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
          checked_at: null,
          checked_by_name: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.check_id);
      const parentCheck = checks.find((check) => check.id === item.check_id) || null;
      if (parentCheck) await syncDashboardReminderStatus(parentCheck, 'OPEN');
      await loadChecks();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to reopen media item.');
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
      const nextFile = isImage ? await compressImageFile(file) : await compressVideoFile(file);
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
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
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
          <p>Upload room photos or videos, complete each item, and close the room check once the work is done.</p>
        </div>
        <div className="mrc-actions">
          <button className="mrc-secondary" type="button" disabled={loading} onClick={() => void loadChecks()}>
            {loading ? 'Refreshing...' : 'Refresh'}
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
      {media.some((item) => item.upload_status === 'failed') ? (
        <div className="mrc-alert mrc-alert-error">
          <span>
            {media.filter((item) => item.upload_status === 'failed').length} saved media upload
            {media.filter((item) => item.upload_status === 'failed').length === 1 ? '' : 's'} can be retried from this phone.
          </span>
          <button type="button" className="mrc-retry-all" onClick={() => void retryAllFailedUploads()}>
            Retry All Failed Uploads
          </button>
        </div>
      ) : null}
      {orphanedUploads.length ? (
        <div className="mrc-alert mrc-alert-warning">
          <strong>{orphanedUploads.length} unsent file{orphanedUploads.length === 1 ? '' : 's'} found on this phone.</strong>
          <span>Open the correct room below, then tap “Recover Saved Files to This Room”. Do not clear this browser’s data.</span>
        </div>
      ) : null}
      {successMsg ? <div className="mrc-alert mrc-alert-success">{successMsg}</div> : null}
      {uploadProgressMsg ? <div className="mrc-alert mrc-alert-info">{uploadProgressMsg}</div> : null}

      <section className="mrc-summary">
        {(['OPEN', 'DONE'] as CheckStatus[]).map((status) => (
          <button
            key={status}
            className={`mrc-stat ${statusFilter === status ? 'is-active' : ''}`}
            type="button"
            onClick={() => setStatusFilter(status)}
          >
            <span>{statusLabel(status)}</span>
            <strong>
              {status === 'DONE'
                ? checks.filter((check) => isDoneLikeStatus(check.status)).length
                : checks.filter((check) => check.status === status).length}
            </strong>
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
              const checkMedia = media.filter((item) => item.check_id === check.id);
              const total = checkMedia.length;
              const done = checkMedia.filter((item) => item.completed_at).length;
              const uploading = checkMedia.filter((item) => item.upload_status === 'uploading').length;
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
                      {uploading ? (
                        <small className="mrc-uploading-text">Uploading {uploading} media item{uploading === 1 ? '' : 's'}...</small>
                      ) : (
                        <small>{check.description || 'Notes optional'}</small>
                      )}
                    </span>
                    <span className={`mrc-status mrc-status-${statusClass(check.status)}`}>
                      {statusLabel(check.status)}
                    </span>
                    <span className={`mrc-progress ${uploading ? 'is-uploading' : ''}`}>
                      {uploading ? 'Uploading' : `${done}/${total} media`}
                    </span>
                    <span className={`mrc-bar ${uploading ? 'is-uploading' : ''}`}><span style={{ width: `${uploading ? 100 : progress}%` }} /></span>
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
          cancelMediaComment();
          setAddingToCheckId(null);
          setDetailOpen(false);
        }}>
          <div className="mrc-detail-head">
            <div>
              <h3>Room {selectedCheck.room_number}</h3>
              <p>{selectedCheck.description || 'No notes'}</p>
            </div>
            <div className="mrc-detail-tools">
              <button type="button" className="mrc-secondary" disabled={loading} onClick={() => void loadChecks()}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <span className={`mrc-status mrc-status-${statusClass(selectedCheck.status)}`}>
                {statusLabel(selectedCheck.status)}
              </span>
            </div>
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
              const uploadFailed = item.upload_status === 'failed';
              const hasPreview = Boolean(item.media_url);
              return (
              <div key={item.id} className={`mrc-media-card ${isUploading ? 'is-uploading' : ''} ${uploadFailed ? 'is-upload-failed' : ''}`}>
                {!hasPreview ? (
                  <div className="mrc-media-preview mrc-upload-placeholder">
                    <span>Upload saved on original device</span>
                  </div>
                ) : item.media_type === 'video' ? (
                  <button
                    type="button"
                    className="mrc-media-preview"
                    onClick={() => setFullMedia(item)}
                    aria-label={`Open video issue ${item.position}`}
                  >
                    <video src={item.media_url} preload="metadata" />
                    <span>Open Video</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mrc-media-preview"
                    onClick={() => setFullMedia(item)}
                    aria-label={`Open image issue ${item.position}`}
                  >
                    <img src={item.media_url} alt={remark || 'Room check media'} loading="lazy" decoding="async" />
                    <span>Open Image</span>
                  </button>
                )}
                <div className="mrc-media-info">
                  <strong>Issue {item.position}</strong>
                  {remark ? <p className="mrc-media-remark">{remark}</p> : null}
                  {!isUploading && !uploadFailed ? (
                    commentEditingId === item.id ? (
                      <div className="mrc-comment-editor">
                        <label htmlFor={`media-comment-${item.id}`}>Comment</label>
                        <textarea
                          id={`media-comment-${item.id}`}
                          value={commentDraft}
                          maxLength={1000}
                          rows={3}
                          autoFocus
                          placeholder="Add a comment about this media..."
                          onChange={(event) => setCommentDraft(event.target.value)}
                        />
                        <small>{commentDraft.length}/1000</small>
                        <div>
                          <button
                            type="button"
                            className="mrc-secondary"
                            disabled={commentSavingId === item.id}
                            onClick={cancelMediaComment}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="mrc-primary"
                            disabled={commentSavingId === item.id}
                            onClick={() => void saveMediaComment(item)}
                          >
                            {commentSavingId === item.id ? 'Saving...' : 'Save Comment'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="mrc-comment-button" onClick={() => beginMediaComment(item)}>
                        {remark ? 'Edit Comment' : 'Add Comment'}
                      </button>
                    )
                  ) : null}
                  <span>
                    {isUploading
                      ? 'Uploading in background...'
                      : uploadFailed
                      ? item.upload_error || 'Upload failed'
                      : item.completed_at
                      ? `Completed by ${item.completed_by_name || '-'}`
                      : 'Not completed'}
                  </span>
                  {isUploading ? <span className="mrc-upload-chip">Uploading</span> : null}
                  {uploadFailed ? <span className="mrc-upload-chip">Upload failed</span> : null}
                  {uploadFailed ? (
                    <button type="button" className="mrc-primary" onClick={() => void retryDurableUpload(item)}>
                      Re-upload Now
                    </button>
                  ) : null}
                  {canManageContent && selectedCheck.status !== 'DONE' && !isUploading && !uploadFailed ? (
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
                  {isUploading || uploadFailed ? (
                    <button type="button" className="mrc-secondary" disabled>
                      {isUploading ? 'Uploading...' : 'Upload failed'}
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
                  {canManageContent && !isUploading && !uploadFailed ? (
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
            {canManageContent && orphanedUploads.length && selectedCheck.status !== 'DONE' ? (
              <button
                type="button"
                className="mrc-primary"
                disabled={saving}
                onClick={() => void recoverOrphanedUploads(selectedCheck)}
              >
                Recover {orphanedUploads.length} Saved File{orphanedUploads.length === 1 ? '' : 's'} to This Room
              </button>
            ) : null}
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

      {fullMedia ? (
        <Modal
          title={`Issue ${fullMedia.position}`}
          onClose={() => setFullMedia(null)}
          wide
          mediaViewer
        >
          <div className="mrc-full-media">
            {fullMedia.media_type === 'video' ? (
              <video src={fullMedia.media_url} controls autoPlay preload="metadata" />
            ) : (
              <img src={fullMedia.media_url} alt={mediaRemark(fullMedia.caption) || 'Full room check image'} />
            )}
            {mediaRemark(fullMedia.caption) ? (
              <p>{mediaRemark(fullMedia.caption)}</p>
            ) : null}
          </div>
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mediaOrientations, setMediaOrientations] = useState<Record<string, 'portrait' | 'landscape'>>({});
  const swipeStartXRef = useRef<number | null>(null);
  const previousMediaCountRef = useRef(0);

  useEffect(() => {
    if (!draftMedia.length) {
      setActiveIndex(0);
      setReviewOpen(false);
      setMediaOrientations({});
      previousMediaCountRef.current = 0;
      return;
    }
    if (draftMedia.length > previousMediaCountRef.current) {
      setReviewOpen(true);
    }
    previousMediaCountRef.current = draftMedia.length;
    setActiveIndex((current) => Math.min(current, draftMedia.length - 1));
  }, [draftMedia.length]);

  const handlePick = (files: FileList | null) => {
    if (files) void addFiles(files);
    setChoiceOpen?.(false);
  };

  const activeItem = draftMedia[activeIndex] || null;

  const moveActive = (direction: -1 | 1) => {
    if (draftMedia.length < 2) return;
    setActiveIndex((current) => (
      (current + direction + draftMedia.length) % draftMedia.length
    ));
  };

  const finishSwipe = (endX: number) => {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (startX === null) return;
    const distance = endX - startX;
    if (Math.abs(distance) < 45) return;
    moveActive(distance < 0 ? 1 : -1);
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
      <div className="mrc-picker-hint">Up to 30 items. Images are optimized; videos are compressed for review and capped at 10 seconds.</div>
      {activeItem ? (
        <>
          <button type="button" className="mrc-open-review-btn" onClick={() => setReviewOpen(true)}>
            <span>Review {draftMedia.length} media item{draftMedia.length === 1 ? '' : 's'}</span>
            <small>Full-screen preview, markup and assignment</small>
          </button>
          {reviewOpen ? (
        <div className="mrc-reviewer is-fullscreen" role="dialog" aria-modal="true" aria-label="Review selected media">
          <div className="mrc-review-topbar">
            <button type="button" onClick={() => setReviewOpen(false)}>Done</button>
            <strong>Media {activeIndex + 1} of {draftMedia.length}</strong>
            <span>{activeItem.media_type === 'video' ? 'Video' : activeItem.marked ? 'Marked' : 'Photo'}</span>
          </div>
          <div
            className="mrc-review-stage"
            tabIndex={0}
            aria-label={`Reviewing media ${activeIndex + 1} of ${draftMedia.length}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') moveActive(-1);
              if (event.key === 'ArrowRight') moveActive(1);
            }}
            onTouchStart={(event) => {
              swipeStartXRef.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              finishSwipe(event.changedTouches[0]?.clientX ?? 0);
            }}
          >
            {activeItem.media_type === 'video' ? (
              <video
                key={activeItem.id}
                src={activeItem.previewUrl}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                key={activeItem.id}
                src={activeItem.previewUrl}
                className={mediaOrientations[activeItem.id] === 'landscape' ? 'is-landscape' : 'is-portrait'}
                alt={`Media preview ${activeIndex + 1} of ${draftMedia.length}`}
                onLoad={(event) => {
                  const orientation = event.currentTarget.naturalWidth >= event.currentTarget.naturalHeight
                    ? 'landscape'
                    : 'portrait';
                  setMediaOrientations((current) => (
                    current[activeItem.id] === orientation
                      ? current
                      : { ...current, [activeItem.id]: orientation }
                  ));
                }}
              />
            )}
            {activeItem.marked ? <span className="mrc-review-marked">Marked up</span> : null}
            {draftMedia.length > 1 ? (
              <>
                <button
                  type="button"
                  className="mrc-review-arrow is-prev"
                  aria-label="Previous media"
                  onClick={() => moveActive(-1)}
                >
                  &#8249;
                </button>
                <button
                  type="button"
                  className="mrc-review-arrow is-next"
                  aria-label="Next media"
                  onClick={() => moveActive(1)}
                >
                  &#8250;
                </button>
              </>
            ) : null}
          </div>

          {draftMedia.length > 1 ? (
            <div className="mrc-review-thumbnails" aria-label="Choose media">
              {draftMedia.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={`mrc-review-thumb ${index === activeIndex ? 'is-active' : ''}`}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Open media ${index + 1}`}
                  aria-current={index === activeIndex ? 'true' : undefined}
                >
                  {item.media_type === 'video' ? (
                    <video src={item.previewUrl} muted playsInline preload="metadata" />
                  ) : (
                    <img src={item.previewUrl} alt="" />
                  )}
                  <span>{index + 1}</span>
                  {item.marked ? <i aria-label="Marked up" /> : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mrc-review-compose">
            <div className={`mrc-review-compose-actions ${activeItem.media_type === 'video' ? 'is-video' : ''}`}>
              {activeItem.media_type === 'image' ? (
                <button
                  type="button"
                  className="mrc-review-markup-btn"
                  onClick={() => setMarkupIndex(activeIndex)}
                >
                  <span aria-hidden="true">&#9998;</span>
                  {activeItem.marked ? 'Edit' : 'Mark Up'}
                </button>
              ) : null}
              <div className="mrc-review-routing is-inline" aria-label="Assign active media to department">
                <span>Assign</span>
                <div>
                  <button
                    type="button"
                    className={activeItem.assigned_department === 'HK' ? 'is-selected' : ''}
                    onClick={() => updateDraftMediaDepartment(activeItem.id, 'HK')}
                    aria-label="Assign to Housekeeping"
                  >
                    HK
                  </button>
                  <button
                    type="button"
                    className={activeItem.assigned_department === 'MT' ? 'is-selected' : ''}
                    onClick={() => updateDraftMediaDepartment(activeItem.id, 'MT')}
                    aria-label="Assign to Maintenance"
                  >
                    MT
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="mrc-review-remove-btn"
                onClick={() => removeDraftMedia(activeItem.id)}
              >
                Remove
              </button>
            </div>
            <label className="mrc-review-remark is-inline">
              <span>Comment <em>(optional)</em></span>
              <textarea
                rows={1}
                value={activeItem.caption}
                onChange={(event) => updateDraftMediaCaption(activeItem.id, event.target.value)}
                placeholder={`Example: ${activeItem.media_type === 'video' ? 'Leaking sound from AC' : 'Stain on bedsheet'}`}
              />
            </label>
          </div>
        </div>
          ) : null}
        </>
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
  mediaViewer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  markup?: boolean;
  mediaViewer?: boolean;
}) {
  return (
    <div className="mrc-modal-backdrop">
      <div className={`mrc-modal ${wide ? 'is-wide' : ''} ${markup ? 'is-markup-modal' : ''} ${mediaViewer ? 'is-media-viewer' : ''}`}>
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
      .mrc-row-main .mrc-uploading-text {
        color: #1d4ed8;
        font-weight: 900;
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
      .mrc-status-done {
        background: #ecfdf5;
        color: #047857;
      }
      .mrc-progress {
        color: #334155;
        font-weight: 850;
      }
      .mrc-progress.is-uploading {
        color: #1d4ed8;
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
      .mrc-bar.is-uploading span {
        background: linear-gradient(90deg,#bfdbfe,#2563eb,#bfdbfe);
        background-size: 180% 100%;
        animation: mrcUploadShimmer 1.2s linear infinite;
      }
      @keyframes mrcUploadShimmer {
        from { background-position: 0% 50%; }
        to { background-position: 180% 50%; }
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
      .mrc-alert-warning {
        display: grid;
        gap: 6px;
        background: #fffbeb;
        border: 1px solid #fcd34d;
        color: #92400e;
      }
      .mrc-retry-all {
        display: block;
        width: 100%;
        margin-top: 10px;
        border: 0;
        border-radius: 12px;
        padding: 11px 14px;
        background: #fff;
        color: #9f1239;
        font-weight: 950;
        cursor: pointer;
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
      .mrc-modal.is-media-viewer {
        width: min(1180px, 100%);
        height: calc(100dvh - 28px);
        max-height: calc(100dvh - 28px);
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
        overscroll-behavior: none;
        background: #020617;
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
      .mrc-modal.is-media-viewer .mrc-modal-head {
        position: static;
        flex: 0 0 auto;
        margin: 0;
        padding: 12px 14px;
        background: #020617;
        border-bottom-color: rgba(255,255,255,.14);
        color: #fff;
      }
      .mrc-modal.is-markup-modal .mrc-modal-head h2 {
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: clamp(18px, 4.8vw, 24px);
        line-height: 1.12;
      }
      .mrc-modal.is-media-viewer .mrc-modal-head h2 {
        font-size: clamp(18px, 4.8vw, 24px);
        line-height: 1.12;
      }
      .mrc-modal.is-media-viewer .mrc-modal-head button {
        border-color: rgba(255,255,255,.22);
        background: rgba(255,255,255,.1);
        color: #fff;
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
      .mrc-open-review-btn {
        width: 100%;
        min-height: 58px;
        margin-top: 12px;
        border: 1px solid #93c5fd;
        border-radius: 15px;
        padding: 10px 14px;
        display: grid;
        gap: 2px;
        text-align: left;
        background: linear-gradient(135deg, #eff6ff, #dbeafe);
        color: #1d4ed8;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(37,99,235,.1);
      }
      .mrc-open-review-btn span {
        font-size: 14px;
        font-weight: 950;
      }
      .mrc-open-review-btn small {
        color: #52709f;
        font-size: 11px;
        font-weight: 750;
      }
      .mrc-reviewer {
        margin-top: 12px;
        border: 1px solid #dbe3ee;
        border-radius: 20px;
        overflow: hidden;
        background: #f8fafc;
        box-shadow: 0 14px 32px rgba(15,23,42,.08);
      }
      .mrc-reviewer.is-fullscreen {
        position: fixed;
        inset: 0;
        z-index: 190;
        width: 100vw;
        height: 100dvh;
        margin: 0;
        border: 0;
        border-radius: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: #020617;
        box-shadow: none;
      }
      .mrc-review-topbar {
        position: relative;
        z-index: 8;
        min-height: calc(48px + env(safe-area-inset-top, 0px));
        padding: calc(5px + env(safe-area-inset-top, 0px)) 10px 5px;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        color: #fff;
        background: #020617;
      }
      .mrc-review-topbar button {
        min-height: 36px;
        border: 1px solid rgba(255,255,255,.24);
        border-radius: 999px;
        padding: 0 15px;
        color: #fff;
        background: rgba(30,41,59,.82);
        font-weight: 950;
        cursor: pointer;
      }
      .mrc-review-topbar strong {
        overflow: hidden;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
      }
      .mrc-review-topbar > span {
        border-radius: 999px;
        padding: 5px 8px;
        color: #dbeafe;
        background: rgba(30,64,175,.72);
        font-size: 10px;
        font-weight: 950;
      }
      .mrc-review-stage {
        position: relative;
        width: 100%;
        height: clamp(300px, 50dvh, 560px);
        overflow: hidden;
        display: grid;
        place-items: start center;
        background:
          radial-gradient(circle at 50% 35%, rgba(51,65,85,.52), transparent 46%),
          #0b1120;
        touch-action: pan-y;
        user-select: none;
      }
      .mrc-reviewer.is-fullscreen .mrc-review-stage {
        position: relative;
        inset: auto;
        flex: 1 1 0;
        width: 100%;
        height: 0;
        min-height: 0;
        border-radius: 0;
        touch-action: none;
      }
      .mrc-reviewer.is-fullscreen .mrc-review-counter,
      .mrc-reviewer.is-fullscreen .mrc-review-marked {
        top: 12px;
      }
      .mrc-review-stage > img,
      .mrc-review-stage > video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain !important;
        object-position: center top !important;
        display: block;
        background: transparent;
      }
      .mrc-review-stage > img.is-landscape,
      .mrc-review-stage > video {
        object-position: center center !important;
      }
      .mrc-review-counter,
      .mrc-review-marked {
        position: absolute;
        top: 12px;
        z-index: 3;
        border-radius: 999px;
        padding: 6px 10px;
        color: #fff;
        background: rgba(15,23,42,.76);
        backdrop-filter: blur(8px);
        font-size: 12px;
        font-weight: 950;
        box-shadow: 0 4px 14px rgba(0,0,0,.18);
      }
      .mrc-review-counter {
        left: 12px;
        font-variant-numeric: tabular-nums;
      }
      .mrc-review-marked {
        right: 12px;
        color: #dcfce7;
        background: rgba(21,128,61,.88);
      }
      .mrc-review-arrow {
        position: absolute;
        top: 50%;
        z-index: 4;
        width: 44px;
        height: 56px;
        margin-top: -28px;
        border: 0;
        border-radius: 13px;
        padding: 0 0 5px;
        display: grid;
        place-items: center;
        color: #fff;
        background: rgba(15,23,42,.7);
        backdrop-filter: blur(6px);
        font-size: 40px;
        line-height: 1;
        cursor: pointer;
        transition: transform .14s ease, background .14s ease;
      }
      .mrc-review-arrow:hover {
        background: rgba(15,23,42,.92);
        transform: scale(1.04);
      }
      .mrc-review-arrow.is-prev {
        left: 10px;
      }
      .mrc-review-arrow.is-next {
        right: 10px;
      }
      .mrc-review-thumbnails {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 10px;
        background: #111827;
        scrollbar-width: thin;
        scroll-snap-type: x proximity;
        overscroll-behavior-x: contain;
      }
      .mrc-reviewer.is-fullscreen .mrc-review-thumbnails {
        position: relative;
        z-index: 7;
        flex: 0 0 auto;
        margin-top: 0;
        padding: 6px 8px;
        background: #020617;
      }
      .mrc-review-thumb {
        position: relative;
        flex: 0 0 54px;
        width: 54px;
        height: 46px;
        overflow: hidden;
        border: 2px solid transparent;
        border-radius: 10px;
        padding: 0;
        background: #020617;
        opacity: .62;
        cursor: pointer;
        scroll-snap-align: center;
        transition: opacity .14s ease, border-color .14s ease, transform .14s ease;
      }
      .mrc-review-thumb.is-active {
        border-color: #60a5fa;
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 0 0 2px rgba(96,165,250,.24);
      }
      .mrc-review-thumb img,
      .mrc-review-thumb video {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        pointer-events: none;
      }
      .mrc-review-thumb span {
        position: absolute;
        left: 4px;
        bottom: 4px;
        min-width: 18px;
        height: 18px;
        border-radius: 999px;
        padding: 0 4px;
        display: grid;
        place-items: center;
        background: rgba(2,6,23,.78);
        color: #fff;
        font-size: 9px;
        font-weight: 950;
      }
      .mrc-review-thumb i {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 10px;
        height: 10px;
        border: 2px solid #fff;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 2px 5px rgba(0,0,0,.28);
      }
      .mrc-review-details {
        display: grid;
        gap: 12px;
        padding: 14px;
        background: #fff;
      }
      .mrc-reviewer.is-fullscreen .mrc-review-details {
        position: relative;
        z-index: 7;
        flex: 0 0 auto;
        max-height: 38dvh;
        margin-top: 0;
        overflow-y: auto;
        padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
        border-radius: 0;
        background: rgba(255,255,255,.97);
        box-shadow: 0 -12px 34px rgba(2,6,23,.35);
        backdrop-filter: blur(12px);
      }
      .mrc-review-compose {
        position: relative;
        z-index: 7;
        flex: 0 0 auto;
        display: grid;
        gap: 7px;
        padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
        background: #fff;
        box-shadow: 0 -8px 24px rgba(2,6,23,.3);
      }
      .mrc-review-compose-actions {
        display: grid;
        grid-template-columns: auto minmax(132px, 1fr) auto;
        align-items: stretch;
        gap: 7px;
      }
      .mrc-review-compose-actions.is-video {
        grid-template-columns: minmax(132px, 1fr) auto;
      }
      .mrc-review-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .mrc-review-heading > div:first-child {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .mrc-review-heading strong {
        color: #0f172a;
        font-size: 15px;
      }
      .mrc-review-heading small {
        color: #64748b;
        font-size: 11px;
        font-weight: 750;
      }
      .mrc-review-actions {
        display: flex;
        justify-content: flex-end;
        gap: 7px;
        flex-wrap: wrap;
      }
      .mrc-review-markup-btn,
      .mrc-review-remove-btn {
        min-height: 40px;
        border-radius: 11px;
        padding: 0 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        font-weight: 950;
        cursor: pointer;
      }
      .mrc-review-markup-btn {
        border: 0;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #fff;
        box-shadow: 0 7px 16px rgba(37,99,235,.2);
      }
      .mrc-review-markup-btn span {
        font-size: 17px;
        line-height: 1;
      }
      .mrc-review-remove-btn {
        border: 1px solid #fecaca;
        background: #fff1f2;
        color: #be123c;
      }
      .mrc-review-remark {
        display: grid;
        gap: 6px;
        color: #334155;
        font-size: 12px;
        font-weight: 900;
      }
      .mrc-review-remark em {
        color: #64748b;
        font-style: normal;
        font-weight: 700;
      }
      .mrc-review-remark textarea {
        width: 100%;
        min-height: 68px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 10px 11px;
        color: #0f172a;
        background: #fbfdff;
        font: inherit;
        font-weight: 650;
        resize: vertical;
      }
      .mrc-review-remark.is-inline {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 8px;
      }
      .mrc-review-remark.is-inline > span {
        white-space: nowrap;
      }
      .mrc-review-remark.is-inline textarea {
        height: 40px;
        min-height: 40px;
        max-height: 64px;
        padding: 9px 10px;
        font-size: 16px;
        line-height: 1.25;
        resize: none;
      }
      .mrc-review-routing {
        display: grid;
        gap: 7px;
      }
      .mrc-review-routing > span {
        color: #334155;
        font-size: 12px;
        font-weight: 900;
      }
      .mrc-review-routing > div {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .mrc-review-routing button {
        min-height: 40px;
        border: 1px solid #cbd5e1;
        border-radius: 11px;
        background: #fff;
        color: #475569;
        font-weight: 900;
        cursor: pointer;
      }
      .mrc-review-routing button.is-selected {
        border-color: #2563eb;
        background: #eff6ff;
        color: #1d4ed8;
        box-shadow: inset 0 0 0 1px rgba(37,99,235,.18);
      }
      .mrc-review-routing.is-inline {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        border: 1px solid #cbd5e1;
        border-radius: 11px;
        padding: 3px;
        background: #f8fafc;
      }
      .mrc-review-routing.is-inline > span {
        padding-left: 6px;
        font-size: 10px;
      }
      .mrc-review-routing.is-inline > div {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 3px;
      }
      .mrc-review-routing.is-inline button {
        min-height: 34px;
        border: 0;
        border-radius: 8px;
        padding: 0 9px;
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
      .mrc-media-preview {
        position: relative;
        width: 100%;
        border: 0;
        padding: 0;
        background: #0f172a;
        cursor: zoom-in;
        display: block;
        text-align: inherit;
      }
      .mrc-upload-placeholder {
        min-height: 165px;
        display: grid;
        place-items: center;
        cursor: default;
        background: linear-gradient(135deg, #e2e8f0, #f8fafc);
      }
      .mrc-upload-placeholder span {
        position: static;
        max-width: 180px;
        padding: 10px 14px;
        color: #475569;
        background: #fff;
        opacity: 1;
        transform: none;
        text-align: center;
      }
      .mrc-media-preview::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(15,23,42,0) 54%, rgba(15,23,42,.5));
        opacity: 0;
        transition: opacity .16s ease;
        pointer-events: none;
      }
      .mrc-media-preview span {
        position: absolute;
        right: 10px;
        bottom: 10px;
        z-index: 1;
        border-radius: 999px;
        padding: 6px 10px;
        background: rgba(255,255,255,.92);
        color: #0f172a;
        font-size: 12px;
        font-weight: 950;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity .16s ease, transform .16s ease;
        pointer-events: none;
      }
      .mrc-media-preview:hover::after,
      .mrc-media-preview:focus-visible::after,
      .mrc-media-preview:hover span,
      .mrc-media-preview:focus-visible span {
        opacity: 1;
        transform: translateY(0);
      }
      .mrc-full-media {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        gap: 12px;
        padding: 14px;
      }
      .mrc-full-media img,
      .mrc-full-media video {
        width: 100%;
        height: 100%;
        min-height: 0;
        object-fit: contain;
        background: #020617;
        border-radius: 16px;
      }
      .mrc-full-media p {
        margin: 0;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 14px;
        padding: 10px 12px;
        color: #e2e8f0;
        background: rgba(15,23,42,.82);
        font-weight: 800;
        overflow-wrap: anywhere;
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
      .mrc-detail-tools {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }
      .mrc-detail-tools .mrc-secondary {
        min-height: 38px;
        padding: 0 14px;
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
      .mrc-comment-button {
        width: fit-content;
        border: 1px solid #bfdbfe;
        border-radius: 999px;
        padding: 7px 11px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 12px;
        font-weight: 950;
        cursor: pointer;
      }
      .mrc-comment-editor {
        display: grid;
        gap: 7px;
        padding: 10px;
        border: 1px solid #bfdbfe;
        border-radius: 12px;
        background: #f8fbff;
      }
      .mrc-comment-editor label {
        color: #334155;
        font-size: 12px;
        font-weight: 950;
      }
      .mrc-comment-editor textarea {
        box-sizing: border-box;
        width: 100%;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 10px;
        background: #fff;
        color: #0f172a;
        font: inherit;
      }
      .mrc-comment-editor small {
        color: #64748b;
        text-align: right;
        font-size: 11px;
        font-weight: 750;
      }
      .mrc-comment-editor > div {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
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
        width: auto;
        height: auto;
        max-width: 100%;
        max-height: calc(100dvh - 176px);
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
        .mrc-review-stage {
          height: min(48dvh, 430px);
          min-height: 270px;
        }
        .mrc-reviewer.is-fullscreen .mrc-review-stage {
          flex: 1 1 0;
          height: 0;
          min-height: 0;
        }
        .mrc-reviewer.is-fullscreen .mrc-review-details {
          max-height: min(42dvh, 360px);
          padding: 11px 12px calc(11px + env(safe-area-inset-bottom, 0px));
        }
        .mrc-review-compose {
          padding: 7px 8px calc(7px + env(safe-area-inset-bottom, 0px));
        }
        .mrc-review-compose-actions > button {
          min-width: 0;
          padding: 0 10px;
          white-space: nowrap;
        }
        .mrc-review-arrow {
          width: 38px;
          height: 50px;
          margin-top: -25px;
        }
      }
    `}</style>
  );
}
