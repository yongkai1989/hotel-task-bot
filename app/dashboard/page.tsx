
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';
import Link from 'next/link';

type TaskImage = {
  id: string | number;
  image_url: string;
  caption?: string | null;
  created_at?: string;
};

type Task = {
  id: string;
  task_code: string;
  room: string;
  department: 'HK' | 'MT' | 'FO';
  task_text: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  created_at: string;
  done_at?: string | null;
  done_by_name?: string | null;
  last_updated_by_name?: string | null;
  image_url?: string | null;
  task_images?: TaskImage[];
  created_by_email?: string | null;
  created_by_name?: string | null;
  edited_at?: string | null;
  edited_by_email?: string | null;
  edited_by_name?: string | null;
};

type SidebarView = 'DASHBOARD' | 'PAST_TASK';

type CreatePhotoItem = {
  id: string;
  name: string;
  dataUrl: string;
};

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'FO' | 'HK' | 'MT';
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'FO' | 'HK' | 'MT';
};
const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const liveStatuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const;

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

async function fetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 15000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!isJson) {
      const text = await res.text();
      const shortText = text.slice(0, 300);
      throw new Error(
        shortText.includes('<!DOCTYPE')
          ? `Server returned HTML instead of JSON (${res.status})`
          : shortText || `Request failed (${res.status})`
      );
    }

    const json = await res.json();

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `Request failed (${res.status})`);
    }

    return json;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayLocalDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDateStringFromISO(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function labelForStatus(status: string) {
  if (status === 'IN_PROGRESS') return 'DOING';
  return status;
}

async function compressImageToDataUrl(
  file: File,
  maxDimension = 1200,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        let { width, height } = img;

        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height >= width && height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not supported'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };

    reader.readAsDataURL(file);
  });
}

function sidebarItemStyle(active: boolean): React.CSSProperties {
  return {
    ...styles.sidebarItem,
    background: active ? '#0f172a' : '#ffffff',
    color: active ? '#ffffff' : '#0f172a',
    borderColor: active ? '#0f172a' : '#e5e7eb',
  };
}

function departmentFilterStyle(label: string, active: boolean): React.CSSProperties {
  const base =
    label === 'HK'
      ? '#16a34a'
      : label === 'MT'
      ? '#2563eb'
      : label === 'FO'
      ? '#eab308'
      : '#64748b';

  return {
    ...styles.filterPill,
    background: active ? base : '#ffffff',
    color: active ? '#ffffff' : '#334155',
    borderColor: active ? base : '#dbe3ee',
  };
}

function statusFilterStyle(active: boolean): React.CSSProperties {
  return {
    ...styles.filterPill,
    background: active ? '#0f172a' : '#ffffff',
    color: active ? '#ffffff' : '#334155',
    borderColor: active ? '#0f172a' : '#dbe3ee',
  };
}

function statusBadgeStyle(status: Task['status']): React.CSSProperties {
  if (status === 'OPEN') {
    return { ...styles.statusBadge, background: '#fff7ed', color: '#c2410c' };
  }
  if (status === 'IN_PROGRESS') {
    return { ...styles.statusBadge, background: '#eff6ff', color: '#1d4ed8' };
  }
  return { ...styles.statusBadge, background: '#ecfdf5', color: '#15803d' };
}

function deptBadgeStyle(dept: Task['department']): React.CSSProperties {
  if (dept === 'HK') {
    return { ...styles.deptBadge, background: '#dcfce7', color: '#166534' };
  }
  if (dept === 'MT') {
    return { ...styles.deptBadge, background: '#dbeafe', color: '#1d4ed8' };
  }
  return { ...styles.deptBadge, background: '#fef3c7', color: '#a16207' };
}

function actionBtn(active: boolean, tone: 'open' | 'doing' | 'done'): React.CSSProperties {
  const toneMap = {
    open: '#c2410c',
    doing: '#1d4ed8',
    done: '#15803d',
  } as const;

  const color = toneMap[tone];
  return {
    ...styles.actionButton,
    background: active ? color : '#ffffff',
    color: active ? '#ffffff' : color,
    borderColor: color,
  };
}

function SummaryCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: 'open' | 'doing' | 'done';
}) {
  const accent =
    tone === 'open' ? '#c2410c' : tone === 'doing' ? '#1d4ed8' : '#15803d';

  return (
    <article style={{ ...styles.summaryCard, borderTop: `4px solid ${accent}` }}>
      <div style={styles.summaryTitle}>{title}</div>
      <div style={{ ...styles.summaryValue, color: accent }}>{value}</div>
    </article>
  );
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dept, setDept] = useState<(typeof departments)[number]>('ALL');
  const [status, setStatus] = useState<(typeof liveStatuses)[number]>('OPEN');
  const [sidebarView, setSidebarView] = useState<SidebarView>('DASHBOARD');
  const [pastTaskDate, setPastTaskDate] = useState(getYesterdayLocalDateString());

  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedTaskImages, setSelectedTaskImages] = useState<TaskImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createRoom, setCreateRoom] = useState('');
  const [createDept, setCreateDept] = useState<'HK' | 'MT' | 'FO' | ''>('');
  const [createTaskText, setCreateTaskText] = useState('');
  const [createPhotos, setCreatePhotos] = useState<CreatePhotoItem[]>([]);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [editDept, setEditDept] = useState<'HK' | 'MT' | 'FO' | ''>('');
  const [editTaskText, setEditTaskText] = useState('');
  const [editExistingImages, setEditExistingImages] = useState<TaskImage[]>([]);
  const [editRemovedImageIds, setEditRemovedImageIds] = useState<(string | number)[]>([]);
  const [editNewPhotos, setEditNewPhotos] = useState<CreatePhotoItem[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [profile, setProfile] = useState<DashboardUser | null>(null);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [passwordTargetEmail, setPasswordTargetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [envError, setEnvError] = useState('');

  const lastTasksFingerprintRef = useRef('');
  const hasHydratedFromCacheRef = useRef(false);
  const lastVisibilityCheckRef = useRef(0);

  function buildTasksFingerprint(taskList: Task[]) {
    return JSON.stringify(
      (taskList || []).map((task) => ({
        id: task.id,
        task_code: task.task_code,
        room: task.room,
        department: task.department,
        task_text: task.task_text,
        status: task.status,
        created_at: task.created_at,
        done_at: task.done_at || null,
        done_by_name: task.done_by_name || null,
        last_updated_by_name: task.last_updated_by_name || null,
        image_url: task.image_url || null,
        created_by_name: task.created_by_name || null,
        edited_at: task.edited_at || null,
        edited_by_name: task.edited_by_name || null,
        image_count: Array.isArray(task.task_images) ? task.task_images.length : 0,
        image_keys: Array.isArray(task.task_images)
          ? task.task_images.map((img) => `${img.id}-${img.image_url}-${img.caption || ''}`)
          : [],
      }))
    );
  }

  function saveTasksToCache(taskList: Task[]) {
    if (typeof window === 'undefined') return;

    try {
      const payload = {
        tasks: taskList,
        fingerprint: buildTasksFingerprint(taskList),
        savedAt: Date.now(),
      };

      sessionStorage.setItem('dashboard_tasks_cache', JSON.stringify(payload));
    } catch {
      // ignore cache write failure
    }
  }

  function readTasksFromCache(): Task[] | null {
    if (typeof window === 'undefined') return null;

    try {
      const raw = sessionStorage.getItem('dashboard_tasks_cache');
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed?.tasks || !Array.isArray(parsed.tasks)) return null;

      lastTasksFingerprintRef.current =
        parsed.fingerprint || buildTasksFingerprint(parsed.tasks);

      return parsed.tasks as Task[];
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('__next');

    const prevHtmlOverflowX = html.style.overflowX;
    const prevHtmlWidth = html.style.width;
    const prevHtmlMaxWidth = html.style.maxWidth;
    const prevBodyOverflowX = body.style.overflowX;
    const prevBodyWidth = body.style.width;
    const prevBodyMaxWidth = body.style.maxWidth;
    const prevBodyPosition = body.style.position;
    const prevRootOverflowX = root?.style.overflowX || '';
    const prevRootWidth = root?.style.width || '';
    const prevRootMaxWidth = root?.style.maxWidth || '';

    html.style.overflowX = 'hidden';
    html.style.width = '100%';
    html.style.maxWidth = '100vw';
    body.style.overflowX = 'hidden';
    body.style.width = '100%';
    body.style.maxWidth = '100vw';
    body.style.position = 'relative';

    if (root) {
      root.style.overflowX = 'hidden';
      root.style.width = '100%';
      root.style.maxWidth = '100vw';
    }

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-dashboard-lock', 'true');
    styleEl.innerHTML = `
      html, body, #__next {
        overflow-x: hidden !important;
        max-width: 100vw !important;
      }
      * {
        box-sizing: border-box;
      }
      img, video, canvas, svg, input, textarea, select, button {
        max-width: 100%;
      }
    `;
    document.head.appendChild(styleEl);

    return () => {
      html.style.overflowX = prevHtmlOverflowX;
      html.style.width = prevHtmlWidth;
      html.style.maxWidth = prevHtmlMaxWidth;
      body.style.overflowX = prevBodyOverflowX;
      body.style.width = prevBodyWidth;
      body.style.maxWidth = prevBodyMaxWidth;
      body.style.position = prevBodyPosition;

      if (root) {
        root.style.overflowX = prevRootOverflowX;
        root.style.width = prevRootWidth;
        root.style.maxWidth = prevRootMaxWidth;
      }

      styleEl.remove();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 920;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseSafe();

    if (!supabase) {
      setEnvError(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel environment variables.'
      );
      setAuthLoading(false);
      return;
    }

    async function bootstrapAuth() {
      try {
        setEnvError('');
        setAuthLoading(true);

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.access_token) {
          await loadProfile(session.access_token);
        } else {
          setProfile(null);
        }
      } catch {
        if (mounted) {
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, sessionNow) => {
      if (!mounted) return;

      try {
        if (sessionNow?.access_token) {
          await loadProfile(sessionNow.access_token);
        } else {
          setProfile(null);
          setTasks([]);
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (hasHydratedFromCacheRef.current) return;

    const cachedTasks = readTasksFromCache();
    if (cachedTasks && cachedTasks.length > 0) {
      setTasks(cachedTasks);
      setLoading(false);
    }

    hasHydratedFromCacheRef.current = true;
  }, []);

  useEffect(() => {
    if (!profile) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const cachedTasks = readTasksFromCache();

    if (cachedTasks && cachedTasks.length > 0) {
      setTasks((prev) => (prev.length > 0 ? prev : cachedTasks));
      void loadTasks(false, { silent: true, onlyIfChanged: true });
      setLoading(false);
      return;
    }

    void loadTasks(true);
  }, [profile]);

  useEffect(() => {
    if (!profile) return;

    let checking = false;

    const checkForChangesWhenVisible = async () => {
      const now = Date.now();

      if (checking) return;
      if (now - lastVisibilityCheckRef.current < 1500) return;

      lastVisibilityCheckRef.current = now;
      checking = true;

      try {
        await loadTasks(false, { silent: true, onlyIfChanged: true });
      } finally {
        checking = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForChangesWhenVisible();
      }
    };

    const handleFocus = () => {
      void checkForChangesWhenVisible();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [profile]);

  async function getAccessToken() {
    const supabase = getSupabaseSafe();
    if (!supabase) return '';

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  }

  async function loadProfile(token: string) {
    const json = await fetchJson('/api/session-profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    setProfile(json.user);
  }

  async function loadTasks(
    showLoader = false,
    options?: { silent?: boolean; onlyIfChanged?: boolean }
  ) {
    const silent = options?.silent ?? false;
    const onlyIfChanged = options?.onlyIfChanged ?? false;

    try {
      if (!silent) {
        if (showLoader) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
      }

      const json = await fetchJson(`/api/tasks?t=${Date.now()}`, {
        method: 'GET',
      });

      const nextTasks: Task[] = json.tasks || [];
      const nextFingerprint = buildTasksFingerprint(nextTasks);

      if (onlyIfChanged && lastTasksFingerprintRef.current === nextFingerprint) {
        return false;
      }

      setTasks(nextTasks);
      lastTasksFingerprintRef.current = nextFingerprint;
      saveTasksToCache(nextTasks);
      setErrorMsg('');
      return true;
    } catch (err: any) {
      if (!silent) {
        setErrorMsg(err?.message || 'Failed to load tasks');
      }
      return false;
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function handleLogin() {
    try {
      const supabase = getSupabaseSafe();

      if (!supabase) {
        throw new Error(
          'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
        );
      }

      setLoginBusy(true);
      setLoginError('');

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) {
        throw new Error(error.message);
      }

      const token = await getAccessToken();
      if (token) {
        await loadProfile(token);
      }

      setLoginOpen(false);
      setLoginEmail('');
      setLoginPassword('');
      await loadTasks(true);
    } catch (err: any) {
      setLoginError(err?.message || 'Login failed');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    try {
      const supabase = getSupabaseSafe();
      if (!supabase) return;

      await supabase.auth.signOut();

      setProfile(null);
      setTasks([]);
      setSidebarOpen(false);
      setLoginOpen(false);
      setPasswordModalOpen(false);
      sessionStorage.removeItem('dashboard_tasks_cache');

      window.location.replace('/dashboard');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Logout failed');
    }
  }

  function canCreateTask() {
    return !!profile;
  }

  function canEditTask(task: Task) {
    if (!profile) return false;
      if (profile.role === 'SUPERUSER' || profile.role === 'MANAGER') return true;
    if (profile.role === 'HK') return task.department === 'HK';
    if (profile.role === 'MT') return task.department === 'MT';
    return false;
  }

function canEditTaskDetails(task: Task) {
  if (!profile) return false;

  // SUPERUSER override (but still OPEN only)
  if (profile.role === 'SUPERUSER') {
    return task.status === 'OPEN';
  }

  if (!task.created_by_email) return false;

  if (task.status !== 'OPEN') return false;

  return (
    profile.email.trim().toLowerCase() ===
    task.created_by_email.trim().toLowerCase()
  );
}
  async function setTaskStatus(taskId: string, nextStatus: Task['status']) {
    if (!profile) {
      setLoginOpen(true);
      return;
    }

    const oldTasks = tasks;

    try {
      setBusyTaskId(taskId);
      setErrorMsg('');

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, status: nextStatus } : task
        )
      );

      const token = await getAccessToken();

      await fetchJson(
        '/api/task-status',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ taskId, status: nextStatus }),
        },
        15000
      );

      await loadTasks(false);
    } catch (err: any) {
      setTasks(oldTasks);
      setErrorMsg(err?.message || 'Failed to update task');
      alert(err?.message || 'Failed to update task');
    } finally {
      setBusyTaskId(null);
    }
  }

  function openImageModal(task: Task) {
    const images = Array.isArray(task.task_images) ? task.task_images : [];
    const fallbackImages =
      !images.length && task.image_url
        ? [
            {
              id: `fallback-${task.id}`,
              image_url: task.image_url,
              caption: null,
              created_at: task.created_at,
            },
          ]
        : [];

    const finalImages = images.length ? images : fallbackImages;

    if (!finalImages.length) return;

    setSelectedTaskImages(finalImages);
    setSelectedImageIndex(0);
    setImageModalOpen(true);
  }

  function closeImageModal() {
    setImageModalOpen(false);
    setSelectedTaskImages([]);
    setSelectedImageIndex(0);
  }

  function showPrevImage() {
    setSelectedImageIndex((prev) =>
      prev === 0 ? selectedTaskImages.length - 1 : prev - 1
    );
  }

  function showNextImage() {
    setSelectedImageIndex((prev) =>
      prev === selectedTaskImages.length - 1 ? 0 : prev + 1
    );
  }

  function openCreateModal() {
    if (!canCreateTask()) {
      setLoginOpen(true);
      return;
    }

    setCreateModalOpen(true);
    setCreateError('');
  }

  function closeCreateModal() {
    if (createSubmitting) return;
    setCreateModalOpen(false);
    setCreateRoom('');
    setCreateDept('');
    setCreateTaskText('');
    setCreatePhotos([]);
    setCreateError('');
  }

  function openEditModal(task: Task) {
    if (!canEditTaskDetails(task)) {
      alert('Only the task creator can edit this task.');
      return;
    }

    setEditTaskId(task.id);
    setEditRoom(task.room || '');
    setEditDept(task.department || '');
    setEditTaskText(task.task_text || '');
    setEditExistingImages(Array.isArray(task.task_images) ? task.task_images : []);
    setEditRemovedImageIds([]);
    setEditNewPhotos([]);
    setEditError('');
    setEditModalOpen(true);
  }

  function closeEditModal() {
    if (editSubmitting) return;

    setEditModalOpen(false);
    setEditTaskId('');
    setEditRoom('');
    setEditDept('');
    setEditTaskText('');
    setEditExistingImages([]);
    setEditRemovedImageIds([]);
    setEditNewPhotos([]);
    setEditError('');
  }

  async function handleCreatePhotoChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(e.target.files || []);

    if (!files.length) {
      return;
    }

    try {
      setCreateError('');

      if (createPhotos.length + files.length > 5) {
        throw new Error('Maximum 5 photos per task');
      }

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          throw new Error('Only image files are allowed');
        }
      }

      const processed = await Promise.all(
        files.map(async (file, index) => {
          const compressed = await compressImageToDataUrl(file, 1200, 0.72);

          return {
            id: `${Date.now()}-${index}-${file.name}`,
            name: file.name,
            dataUrl: compressed,
          } as CreatePhotoItem;
        })
      );

      setCreatePhotos((prev) => [...prev, ...processed]);
      e.target.value = '';
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to process photo(s)');
    }
  }

  function removeCreatePhoto(id: string) {
    setCreatePhotos((prev) => prev.filter((item) => item.id !== id));
  }
async function handleDeleteTask(taskId: string) {
  try {
    if (!profile || profile.role !== 'SUPERUSER') {
      alert('Unauthorized');
      return;
    }

    const confirmDelete = confirm('Delete this task permanently?');
    if (!confirmDelete) return;

    setBusyTaskId(taskId);

    const token = await getAccessToken();

    await fetchJson(`/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    await loadTasks(false);
  } catch (err: any) {
    alert(err?.message || 'Failed to delete task');
  } finally {
    setBusyTaskId(null);
  }
}

  async function handleEditPhotoChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const files = Array.from(e.target.files || []);

    if (!files.length) {
      return;
    }

    try {
      setEditError('');

      const remainingExisting = editExistingImages.filter(
        (img) => !editRemovedImageIds.includes(img.id)
      );

      if (remainingExisting.length + editNewPhotos.length + files.length > 5) {
        throw new Error('Maximum 5 photos per task');
      }

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          throw new Error('Only image files are allowed');
        }
      }

      const processed = await Promise.all(
        files.map(async (file, index) => {
          const compressed = await compressImageToDataUrl(file, 1200, 0.72);

          return {
            id: `${Date.now()}-${index}-${file.name}`,
            name: file.name,
            dataUrl: compressed,
          } as CreatePhotoItem;
        })
      );

      setEditNewPhotos((prev) => [...prev, ...processed]);
      e.target.value = '';
    } catch (err: any) {
      setEditError(err?.message || 'Failed to process photo(s)');
    }
  }

  function removeEditExistingImage(id: string | number) {
    setEditRemovedImageIds((prev) => [...prev, id]);
  }

  function undoRemoveEditExistingImage(id: string | number) {
    setEditRemovedImageIds((prev) => prev.filter((x) => x !== id));
  }

  function removeEditNewPhoto(id: string) {
    setEditNewPhotos((prev) => prev.filter((item) => item.id !== id));
  }

  async function submitCreateTask() {
    try {
      if (!profile) {
        setLoginOpen(true);
        return;
      }

      setCreateError('');

      const room = createRoom.trim();
      const taskText = createTaskText.trim();

      if (!room) throw new Error('Room Number is required');
      if (!/^\d{3,5}$/.test(room)) throw new Error('Invalid room number');
      if (!createDept) throw new Error('Select department');
      if (!taskText) throw new Error('Task description required');

      setCreateSubmitting(true);

      let uploadedUrls: string[] = [];

      if (createPhotos.length > 0) {
        const uploadJson = await fetchJson(
          '/api/upload',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: createPhotos.map((p) => p.dataUrl),
            }),
          },
          30000
        );

        uploadedUrls = uploadJson.urls || [];
      }

      const token = await getAccessToken();

      await fetchJson(
        '/api/tasks',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            room,
            department: createDept,
            task_text: taskText,
            image_urls: uploadedUrls,
            image_captions: createPhotos.map((p) => p.name),
          }),
        },
        30000
      );

      closeCreateModal();
      await loadTasks(false);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create task');
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function submitEditTask() {
    try {
      if (!profile) {
        setLoginOpen(true);
        return;
      }

      setEditError('');

      const room = editRoom.trim();
      const taskText = editTaskText.trim();

      if (!editTaskId) throw new Error('Invalid task');
      if (!room) throw new Error('Room Number is required');
      if (!/^\d{3,5}$/.test(room)) throw new Error('Invalid room number');
      if (!editDept) throw new Error('Select department');
      if (!taskText) throw new Error('Task description required');

      setEditSubmitting(true);

      let uploadedUrls: string[] = [];

      if (editNewPhotos.length > 0) {
        const uploadJson = await fetchJson(
          '/api/upload',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: editNewPhotos.map((p) => p.dataUrl),
            }),
          },
          30000
        );

        uploadedUrls = uploadJson.urls || [];
      }

      const token = await getAccessToken();

      await fetchJson(
        `/api/tasks/${editTaskId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            room,
            department: editDept,
            task_text: taskText,
            keep_image_ids: editExistingImages
              .filter((img) => !editRemovedImageIds.includes(img.id))
              .map((img) => img.id),
            new_image_urls: uploadedUrls,
            new_image_captions: editNewPhotos.map((p) => p.name),
          }),
        },
        30000
      );

      closeEditModal();
      await loadTasks(false);
    } catch (err: any) {
      setEditError(err?.message || 'Failed to edit task');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function openPasswordModal() {
    if (!profile || profile.role !== 'MANAGER') return;

    try {
      setPasswordModalOpen(true);
      setPasswordError('');
      setPasswordSuccess('');

      const token = await getAccessToken();

      const json = await fetchJson('/api/admin/users', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setAdminUsers(json.users || []);
      setPasswordTargetEmail((json.users || [])[0]?.email || '');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to load users');
    }
  }

  function closePasswordModal() {
    if (passwordBusy) return;
    setPasswordModalOpen(false);
    setPasswordTargetEmail('');
    setNewPassword('');
    setPasswordError('');
    setPasswordSuccess('');
  }

  async function handleChangePassword() {
    try {
      setPasswordBusy(true);
      setPasswordError('');
      setPasswordSuccess('');

      if (!passwordTargetEmail) {
        throw new Error('Please select a user');
      }

      if (newPassword.trim().length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const token = await getAccessToken();

      await fetchJson('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetEmail: passwordTargetEmail,
          newPassword,
        }),
      });

      setPasswordSuccess('Password updated successfully');
      setNewPassword('');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to change password');
    } finally {
      setPasswordBusy(false);
    }
  }

  const todayLocal = getTodayLocalDateString();

  const liveTasks = useMemo(() => {
    return tasks.filter((task) => {
      const deptOk = dept === 'ALL' || task.department === dept;
      const statusOk = status === 'ALL' || task.status === status;

      const doneToday =
        task.status === 'DONE' && task.done_at
          ? getLocalDateStringFromISO(task.done_at) === todayLocal
          : false;

      const keepInLive =
        task.status === 'OPEN' ||
        task.status === 'IN_PROGRESS' ||
        doneToday;

      return deptOk && statusOk && keepInLive;
    });
  }, [tasks, dept, status, todayLocal]);

  const pastTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.status !== 'DONE' || !task.done_at) return false;

      const doneDate = getLocalDateStringFromISO(task.done_at);
      if (!doneDate) return false;

      const isPastTask = doneDate < todayLocal;
      const matchesSelectedDate = doneDate === pastTaskDate;
      const deptOk = dept === 'ALL' || task.department === dept;

      return isPastTask && matchesSelectedDate && deptOk;
    });
  }, [tasks, dept, pastTaskDate, todayLocal]);

  const filtered = sidebarView === 'DASHBOARD' ? liveTasks : pastTasks;

  const summary = useMemo(() => {
    return {
      open: tasks.filter((t) => t.status === 'OPEN').length,
      doing: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      doneToday: tasks.filter(
        (t) =>
          t.status === 'DONE' &&
          !!t.done_at &&
          getLocalDateStringFromISO(t.done_at) === todayLocal
      ).length,
      pastDone: tasks.filter(
        (t) =>
          t.status === 'DONE' &&
          !!t.done_at &&
          getLocalDateStringFromISO(t.done_at) < todayLocal
      ).length,
    };
  }, [tasks, todayLocal]);

  const pageTitle =
    sidebarView === 'DASHBOARD' ? 'Operations Dashboard' : 'Past Task Archive';

  const pageSubtitle =
    sidebarView === 'DASHBOARD'
      ? 'Live task board for housekeeping, maintenance, and front office'
      : 'Browse previously completed tasks by completed date';

  const sidebarStyle: React.CSSProperties = isMobile
    ? {
        ...styles.sidebar,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 1002,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.24s ease',
        width: 270,
        minWidth: 270,
      }
    : {
        ...styles.sidebar,
        position: 'sticky',
        top: 0,
        height: '100vh',
      };

  const taskMainRowStyle: React.CSSProperties = isMobile
    ? {
        ...styles.taskMainRow,
        flexDirection: 'column',
        width: '100%',
        minWidth: 0,
      }
    : styles.taskMainRow;

  return (
    <main style={styles.page}>
      {isMobile && sidebarOpen ? (
        <div style={styles.mobileOverlay} onClick={() => setSidebarOpen(false)} />
      ) : null}

      <div style={styles.layout}>
        <aside style={sidebarStyle}>
          <div style={styles.sidebarTop}>
            <div style={styles.sidebarBrand}>
              <div style={styles.sidebarLogoWrap}>
                <Image
                  src="/logo.png"
                  alt="Hallmark Crown Hotel logo"
                  width={42}
                  height={42}
                  style={styles.logo as React.CSSProperties}
                />
              </div>

              <div style={styles.sidebarBrandText}>
                <div style={styles.sidebarHotel}>Hallmark Crown Hotel</div>
                <div style={styles.sidebarHotelSub}>Operations PMS</div>
              </div>
            </div>

            {isMobile ? (
              <button
                onClick={() => setSidebarOpen(false)}
                style={styles.sidebarCloseBtn}
                aria-label="Close sidebar"
              >
                ×
              </button>
            ) : null}
          </div>

          <div style={styles.sidebarSectionTitle}>Navigation</div>

         <div style={styles.sidebarMenu}>
  <button
    onClick={() => {
      setSidebarView('DASHBOARD');
      setSidebarOpen(false);
    }}
    style={sidebarItemStyle(sidebarView === 'DASHBOARD')}
  >
    <span>Dashboard</span>
  </button>

  <button
    onClick={() => {
      setSidebarView('PAST_TASK');
      setSidebarOpen(false);
    }}
    style={sidebarItemStyle(sidebarView === 'PAST_TASK')}
  >
    <span>Past Task</span>
    {summary.pastDone > 0 ? (
      <span
        style={
          sidebarView === 'PAST_TASK'
            ? styles.sidebarCountActive
            : styles.sidebarCount
        }
      >
        {summary.pastDone}
      </span>
    ) : null}
  </button>

  {(profile?.role === 'SUPERUSER' ||
  profile?.role === 'MANAGER') ? (
      
    <Link
      href="/dashboard/supervisor-update"
      onClick={() => setSidebarOpen(false)}
      style={sidebarItemStyle(false)}
    >
      <span>Supervisor Update</span>
    </Link>
  ) : null}
</div>
          <div style={styles.sidebarDivider} />

          <div style={styles.userPanel}>
            {!profile ? (
              <button
                onClick={() => setLoginOpen(true)}
                style={styles.loginSidebarBtn}
              >
                Log In
              </button>
            ) : (
              <>
                <div style={styles.userCard}>
                  <div style={styles.userName}>{profile.name}</div>
                  <div style={styles.userRole}>{profile.role}</div>
                  <div style={styles.userEmail}>{profile.email}</div>
                </div>

                {profile.role === 'MANAGER' ? (
                  <button onClick={openPasswordModal} style={styles.managerBtn}>
                    Change User Password
                  </button>
                ) : null}

                <button onClick={handleLogout} style={styles.logoutSidebarBtn}>
                  Log Out
                </button>
              </>
            )}
          </div>
        </aside>

        <section style={styles.content}>
          {isMobile ? (
            <div style={styles.mobileTopBar}>
              <button
                onClick={() => setSidebarOpen(true)}
                style={styles.menuButton}
                aria-label="Open sidebar"
              >
                ☰
              </button>

              <div style={styles.mobileTopBarTitle}>Hallmark PMS</div>
            </div>
          ) : null}

          <div style={styles.headerCard}>
            <div style={styles.headerTop}>
              <div style={styles.logoWrap}>
                <Image
                  src="/logo.png"
                  alt="Hallmark Crown Hotel logo"
                  width={56}
                  height={56}
                  style={styles.logo as React.CSSProperties}
                />
              </div>

              <div style={styles.headerTextWrap}>
                <div style={styles.eyebrow}>Hallmark Crown Hotel</div>
                <h1 style={styles.title}>{pageTitle}</h1>
                <p style={styles.subtitle}>{pageSubtitle}</p>
              </div>
            </div>
          </div>

          {envError ? <div style={styles.errorBox}>{envError}</div> : null}
          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

          {authLoading ? (
            <div style={styles.emptyState}>Checking login...</div>
          ) : !profile ? (
            <div style={styles.emptyState}>
              Please log in from the sidebar to use the dashboard.
            </div>
          ) : (
            <>
              {sidebarView === 'DASHBOARD' ? (
                <section style={styles.summaryGrid}>
                  <SummaryCard title="Open" value={summary.open} tone="open" />
                  <SummaryCard title="DOING" value={summary.doing} tone="doing" />
                  <SummaryCard title="DONE TODAY" value={summary.doneToday} tone="done" />
                </section>
              ) : null}

              <section style={styles.filterPanel}>
                <div style={styles.filterHeader}>
                  <div style={styles.filterHeaderText}>
                    <div style={styles.filterPanelTitle}>
                      {sidebarView === 'DASHBOARD' ? 'Live Task Filters' : 'Archive Filters'}
                    </div>
                    <div style={styles.filterPanelSubtitle}>
                      {sidebarView === 'DASHBOARD'
                        ? 'Filter active and today-completed tasks'
                        : 'Search older completed tasks by department and date'}
                    </div>
                  </div>

                  <div style={styles.filterHeaderButtons}>
                    <button
                      onClick={() => loadTasks(false)}
                      style={styles.refreshBtn}
                      disabled={refreshing || loading}
                      title="Refresh tasks"
                    >
                      ↻
                    </button>

                    {sidebarView === 'DASHBOARD' ? (
                      <button
                        onClick={openCreateModal}
                        style={styles.addTaskBtn}
                        aria-label="Add task"
                        title="Add new task"
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                </div>

                <div style={styles.filterBlock}>
                  <div style={styles.filterLabel}>Department</div>
                  <div style={styles.pillRow}>
                    {departments.map((d) => (
                      <button
                        key={d}
                        onClick={() => setDept(d)}
                        style={departmentFilterStyle(d, dept === d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                {sidebarView === 'DASHBOARD' ? (
                  <div style={styles.filterBlock}>
                    <div style={styles.filterLabel}>Status</div>
                    <div style={styles.pillRow}>
                      {liveStatuses.map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(s)}
                          style={statusFilterStyle(status === s)}
                        >
                          {labelForStatus(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={styles.filterBlock}>
                    <div style={styles.filterLabel}>Completed Date</div>
                    <div style={styles.dateFilterRow}>
                      <input
                        type="date"
                        value={pastTaskDate}
                        max={getYesterdayLocalDateString()}
                        onChange={(e) => setPastTaskDate(e.target.value)}
                        style={styles.dateInput}
                      />
                      <div style={styles.dateHint}>
                        Tasks here are filtered using completion date
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section style={styles.resultBar}>
                <div style={styles.resultText}>
                  {loading
                    ? 'Loading tasks…'
                    : sidebarView === 'DASHBOARD'
                    ? `${filtered.length} live task${filtered.length === 1 ? '' : 's'} shown`
                    : `${filtered.length} past task${filtered.length === 1 ? '' : 's'} shown for ${formatDateLabel(
                        pastTaskDate
                      )}`}
                </div>
                {refreshing ? <div style={styles.updatingText}>Refreshing…</div> : null}
              </section>

              {loading ? (
                <div style={styles.emptyState}>Loading...</div>
              ) : filtered.length === 0 ? (
                <div style={styles.emptyState}>
                  {sidebarView === 'DASHBOARD'
                    ? 'No tasks found for this filter.'
                    : `No past tasks found for ${formatDateLabel(pastTaskDate)}.`}
                </div>
              ) : (
                <div style={styles.cardList}>
                  {filtered.map((task) => {
                    const images = Array.isArray(task.task_images) ? task.task_images : [];
                    const thumb =
                      images.length > 0
                        ? images[images.length - 1].image_url
                        : task.image_url || null;

                    return (
                      <article key={task.id} style={styles.taskCard}>
                        <div style={taskMainRowStyle}>
                          <div style={styles.taskMainContent}>
                            <div style={styles.cardTopRow}>
                              <div style={styles.cardTopLeft}>
                                <div style={styles.taskCodeRow}>
                                  <div style={styles.taskCode}>{task.task_code}</div>
                                  <div style={statusBadgeStyle(task.status)}>
                                    {labelForStatus(task.status)}
                                  </div>
                                </div>

                                <div style={styles.roomLine}>
                                  <span style={styles.roomText}>Room</span>
                                  <span style={styles.roomNo}>{task.room}</span>
                                  <span style={styles.dot}>•</span>
                                  <span style={deptBadgeStyle(task.department)}>
                                    {task.department}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div style={styles.taskText}>{task.task_text}</div>

                            <div style={styles.metaGrid}>
                              <div style={styles.metaCard}>
                                <div style={styles.metaCardLabel}>Created</div>
                                <div style={styles.metaCardValue}>
                                  {new Date(task.created_at).toLocaleString()}
                                </div>
                              </div>

                              <div style={styles.metaCard}>
                                <div style={styles.metaCardLabel}>Created by</div>
                                <div style={styles.metaCardValueStrong}>
                                  {task.created_by_name || 'Unknown'}
                                </div>
                              </div>

                              {task.status === 'DONE' && task.done_at ? (
                                <div style={styles.metaCard}>
                                  <div style={styles.metaCardLabel}>Completed</div>
                                  <div style={styles.metaCardValue}>
                                    {new Date(task.done_at).toLocaleString()}
                                  </div>
                                </div>
                              ) : null}

                              {task.status === 'DONE' && task.done_by_name ? (
                                <div style={styles.metaCard}>
                                  <div style={styles.metaCardLabel}>Done by</div>
                                  <div style={styles.metaCardValueStrong}>
                                    {task.done_by_name}
                                  </div>
                                </div>
                              ) : null}

                              {task.status !== 'DONE' && task.last_updated_by_name ? (
                                <div style={styles.metaCard}>
                                  <div style={styles.metaCardLabel}>Last updated by</div>
                                  <div style={styles.metaCardValue}>
                                    {task.last_updated_by_name}
                                  </div>
                                </div>
                              ) : null}

                              {task.edited_at ? (
                                <div style={styles.metaCard}>
                                  <div style={styles.metaCardLabel}>Edited</div>
                                  <div style={styles.metaCardValue}>
                                    {new Date(task.edited_at).toLocaleString()}
                                  </div>
                                </div>
                              ) : null}

                              {task.edited_at && task.edited_by_name ? (
                                <div style={styles.metaCard}>
                                  <div style={styles.metaCardLabel}>Edited by</div>
                                  <div style={styles.metaCardValue}>
                                    {task.edited_by_name}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            {sidebarView === 'DASHBOARD' ? (
                              <>
                                <div style={styles.buttonRow}>
                                  <button
                                    style={actionBtn(task.status === 'OPEN', 'open')}
                                    disabled={busyTaskId === task.id || !canEditTask(task)}
                                    onClick={() => setTaskStatus(task.id, 'OPEN')}
                                  >
                                    Open
                                  </button>

                                  <button
                                    style={actionBtn(task.status === 'IN_PROGRESS', 'doing')}
                                    disabled={busyTaskId === task.id || !canEditTask(task)}
                                    onClick={() => setTaskStatus(task.id, 'IN_PROGRESS')}
                                  >
                                    DOING
                                  </button>

                                  <button
                                    style={actionBtn(task.status === 'DONE', 'done')}
                                    disabled={busyTaskId === task.id || !canEditTask(task)}
                                    onClick={() => setTaskStatus(task.id, 'DONE')}
                                  >
                                    Done
                                  </button>

                                  {task.status === 'OPEN' && canEditTaskDetails(task) ? (
  <button
    style={styles.editTaskBtn}
    disabled={busyTaskId === task.id}
    onClick={() => openEditModal(task)}
  >
    Edit
  </button>
) : null}
{profile?.role === 'SUPERUSER' ? (
  <button
    style={styles.deleteTaskBtn}
    onClick={() => handleDeleteTask(task.id)}
  >
    Delete
  </button>
) : null}
                                </div>

                                {!canEditTask(task) ? (
                                  <div style={styles.permissionText}>
                                    You do not have permission to edit this department’s task
                                  </div>
                                ) : null}

                                {busyTaskId === task.id ? (
                                  <div style={styles.updatingText}>Updating…</div>
                                ) : null}
                              </>
                            ) : (
                              <div style={styles.pastTaskNote}>
                                Archived record based on completion date
                              </div>
                            )}
                          </div>

                          {thumb ? (
                            <div style={styles.thumbWrap}>
                              <button
                                onClick={() => openImageModal(task)}
                                style={styles.thumbButton}
                                title="Open task images"
                              >
                                <img
                                  src={thumb}
                                  alt="Task thumbnail"
                                  style={styles.thumbImage}
                                />
                              </button>

                              <div style={styles.imageCountBadge}>
                                {images.length > 0 ? `${images.length} img` : '1 img'}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {imageModalOpen && selectedTaskImages.length > 0 ? (
        <div style={styles.modalOverlay} onClick={closeImageModal}>
          <div style={styles.modalInner} onClick={(e) => e.stopPropagation()}>
            <button
              style={styles.modalCloseBtn}
              onClick={closeImageModal}
              aria-label="Close image viewer"
            >
              ×
            </button>

            {selectedTaskImages.length > 1 ? (
              <button
                style={styles.modalNavLeft}
                onClick={showPrevImage}
                aria-label="Previous image"
              >
                ‹
              </button>
            ) : null}

            <div style={styles.modalImageWrap}>
              <img
                src={selectedTaskImages[selectedImageIndex].image_url}
                alt={`Task image ${selectedImageIndex + 1}`}
                style={styles.modalImage}
              />

              <div style={styles.modalFooter}>
                <div style={styles.modalCounter}>
                  {selectedImageIndex + 1} / {selectedTaskImages.length}
                </div>

                {selectedTaskImages[selectedImageIndex].caption ? (
                  <div style={styles.modalCaption}>
                    {selectedTaskImages[selectedImageIndex].caption}
                  </div>
                ) : null}
              </div>
            </div>

            {selectedTaskImages.length > 1 ? (
              <button
                style={styles.modalNavRight}
                onClick={showNextImage}
                aria-label="Next image"
              >
                ›
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {createModalOpen ? (
        <div style={styles.createModalOverlay} onClick={closeCreateModal}>
          <div style={styles.createModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Create New Task</div>
                <div style={styles.createModalSubtitle}>
                  Add a task from dashboard and push it to Telegram
                </div>
              </div>

              <button
                onClick={closeCreateModal}
                style={styles.createModalCloseBtn}
                aria-label="Close create task modal"
                disabled={createSubmitting}
              >
                ×
              </button>
            </div>

            {createError ? <div style={styles.createErrorBox}>{createError}</div> : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Room Number</label>
              <input
                type="text"
                value={createRoom}
                onChange={(e) => setCreateRoom(e.target.value)}
                style={styles.textInput}
                placeholder="e.g. 1308"
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Department</label>
              <select
                value={createDept}
                onChange={(e) => setCreateDept(e.target.value as 'HK' | 'MT' | 'FO' | '')}
                style={styles.selectInput}
                disabled={createSubmitting}
              >
                <option value="">Select department</option>
                <option value="HK">HK</option>
                <option value="MT">MT</option>
                <option value="FO">FO</option>
              </select>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Task Description</label>
              <textarea
                value={createTaskText}
                onChange={(e) => setCreateTaskText(e.target.value)}
                style={styles.textArea}
                placeholder="Enter task details"
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Photos</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleCreatePhotoChange}
                disabled={createSubmitting}
              />
              <div style={styles.photoPreviewGrid}>
                {createPhotos.map((photo) => (
                  <div key={photo.id} style={styles.photoPreviewItem}>
                    <img src={photo.dataUrl} alt={photo.name} style={styles.photoPreviewImg} />
                    <div style={styles.photoPreviewName}>{photo.name}</div>
                    <button
                      type="button"
                      style={styles.removePhotoBtn}
                      onClick={() => removeCreatePhoto(photo.id)}
                      disabled={createSubmitting}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {createPhotos.length === 0 ? (
                  <div style={styles.uploadHint}>Upload up to 5 images</div>
                ) : null}
              </div>
            </div>

            <div style={styles.createModalActions}>
              <button
                type="button"
                onClick={closeCreateModal}
                style={styles.secondaryBtn}
                disabled={createSubmitting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitCreateTask}
                style={styles.primaryBtn}
                disabled={createSubmitting}
              >
                {createSubmitting ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editModalOpen ? (
        <div style={styles.createModalOverlay} onClick={closeEditModal}>
          <div style={styles.createModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Edit Task</div>
                <div style={styles.createModalSubtitle}>
                  Only the creator of this task can edit it
                </div>
              </div>

              <button
                onClick={closeEditModal}
                style={styles.createModalCloseBtn}
                aria-label="Close edit task modal"
                disabled={editSubmitting}
              >
                ×
              </button>
            </div>

            {editError ? <div style={styles.createErrorBox}>{editError}</div> : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Room Number</label>
              <input
                type="text"
                value={editRoom}
                onChange={(e) => setEditRoom(e.target.value)}
                style={styles.textInput}
                placeholder="e.g. 1308"
                disabled={editSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Department</label>
              <select
                value={editDept}
                onChange={(e) => setEditDept(e.target.value as 'HK' | 'MT' | 'FO' | '')}
                style={styles.selectInput}
                disabled={editSubmitting}
              >
                <option value="">Select department</option>
                <option value="HK">HK</option>
                <option value="MT">MT</option>
                <option value="FO">FO</option>
              </select>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Task Description</label>
              <textarea
                value={editTaskText}
                onChange={(e) => setEditTaskText(e.target.value)}
                style={styles.textArea}
                placeholder="Enter task details"
                disabled={editSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Existing Images</label>
              <div style={styles.photoPreviewGrid}>
                {editExistingImages.length === 0 ? (
                  <div style={styles.uploadHint}>No existing images</div>
                ) : (
                  editExistingImages.map((img) => {
                    const removed = editRemovedImageIds.includes(img.id);

                    return (
                      <div
                        key={String(img.id)}
                        style={{
                          ...styles.photoPreviewItem,
                          opacity: removed ? 0.45 : 1,
                        }}
                      >
                        <img
                          src={img.image_url}
                          alt="Existing task image"
                          style={styles.photoPreviewImg}
                        />

                        <div style={styles.photoPreviewName}>
                          {img.caption || 'Existing image'}
                        </div>

                        {removed ? (
                          <button
                            type="button"
                            style={styles.removePhotoBtn}
                            onClick={() => undoRemoveEditExistingImage(img.id)}
                            disabled={editSubmitting}
                          >
                            Undo Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={styles.removePhotoBtn}
                            onClick={() => removeEditExistingImage(img.id)}
                            disabled={editSubmitting}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Add New Images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleEditPhotoChange}
                disabled={editSubmitting}
              />

              <div style={styles.photoPreviewGrid}>
                {editNewPhotos.map((photo) => (
                  <div key={photo.id} style={styles.photoPreviewItem}>
                    <img
                      src={photo.dataUrl}
                      alt={photo.name}
                      style={styles.photoPreviewImg}
                    />
                    <div style={styles.photoPreviewName}>{photo.name}</div>
                    <button
                      type="button"
                      style={styles.removePhotoBtn}
                      onClick={() => removeEditNewPhoto(photo.id)}
                      disabled={editSubmitting}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.createModalActions}>
              <button
                type="button"
                onClick={closeEditModal}
                style={styles.secondaryBtn}
                disabled={editSubmitting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitEditTask}
                style={styles.primaryBtn}
                disabled={editSubmitting}
              >
                {editSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loginOpen ? (
        <div style={styles.modalOverlay} onClick={() => setLoginOpen(false)}>
          <div style={styles.authCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Log In</div>
                <div style={styles.createModalSubtitle}>
                  Sign in to manage dashboard tasks
                </div>
              </div>
              <button
                onClick={() => setLoginOpen(false)}
                style={styles.createModalCloseBtn}
                aria-label="Close login modal"
              >
                ×
              </button>
            </div>

            {loginError ? <div style={styles.createErrorBox}>{loginError}</div> : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                style={styles.textInput}
                disabled={loginBusy}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={styles.textInput}
                disabled={loginBusy}
              />
            </div>

            <div style={styles.createModalActions}>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                style={styles.secondaryBtn}
                disabled={loginBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogin}
                style={styles.primaryBtn}
                disabled={loginBusy}
              >
                {loginBusy ? 'Logging in...' : 'Log In'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div style={styles.modalOverlay} onClick={closePasswordModal}>
          <div style={styles.authCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Change User Password</div>
                <div style={styles.createModalSubtitle}>
                  Manager access only
                </div>
              </div>
              <button
                onClick={closePasswordModal}
                style={styles.createModalCloseBtn}
                aria-label="Close password modal"
                disabled={passwordBusy}
              >
                ×
              </button>
            </div>

            {passwordError ? <div style={styles.createErrorBox}>{passwordError}</div> : null}
            {passwordSuccess ? (
              <div style={styles.successBox}>{passwordSuccess}</div>
            ) : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>User</label>
              <select
                value={passwordTargetEmail}
                onChange={(e) => setPasswordTargetEmail(e.target.value)}
                style={styles.selectInput}
                disabled={passwordBusy}
              >
                {adminUsers.map((user) => (
                  <option key={user.email} value={user.email}>
                    {user.name} ({user.role}) — {user.email}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={styles.textInput}
                disabled={passwordBusy}
              />
            </div>

            <div style={styles.createModalActions}>
              <button
                type="button"
                onClick={closePasswordModal}
                style={styles.secondaryBtn}
                disabled={passwordBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleChangePassword}
                style={styles.primaryBtn}
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    width: '100%',
    maxWidth: '100vw',
    overflowX: 'hidden',
    background: '#f6f8fb',
  },
  layout: {
    display: 'flex',
    width: '100%',
    maxWidth: '100vw',
    overflowX: 'hidden',
    alignItems: 'stretch',
  },
  sidebar: {
    width: 270,
    minWidth: 270,
    background: '#ffffff',
    borderRight: '1px solid #e5e7eb',
    padding: 18,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  sidebarTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sidebarBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  sidebarLogoWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  logo: {
    objectFit: 'contain',
    display: 'block',
  },
  sidebarBrandText: {
    minWidth: 0,
  },
  sidebarHotel: {
    fontSize: 15,
    fontWeight: 800,
    color: '#0f172a',
    wordBreak: 'break-word',
  },
  sidebarHotelSub: {
    fontSize: 12,
    color: '#64748b',
  },
  sidebarCloseBtn: {
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#334155',
    borderRadius: 10,
    width: 34,
    height: 34,
    cursor: 'pointer',
    flexShrink: 0,
  },
  sidebarSectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sidebarMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sidebarItem: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    fontWeight: 700,
  },
  sidebarCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 999,
    background: '#f1f5f9',
    color: '#0f172a',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  sidebarCountActive: {
    minWidth: 26,
    height: 26,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.16)',
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  sidebarDivider: {
    height: 1,
    background: '#e5e7eb',
    width: '100%',
  },
  userPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  loginSidebarBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: 12,
    padding: '12px 16px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  logoutSidebarBtn: {
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: 12,
    padding: '12px 16px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  managerBtn: {
    border: '1px solid #dbe3ee',
    background: '#f8fafc',
    color: '#0f172a',
    borderRadius: 12,
    padding: '12px 16px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  userCard: {
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    borderRadius: 14,
    padding: 14,
  },
  userName: {
    fontSize: 15,
    fontWeight: 800,
    color: '#0f172a',
  },
  userRole: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    fontWeight: 700,
  },
  userEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  content: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    overflowX: 'hidden',
    padding: 20,
    boxSizing: 'border-box',
  },
  mobileTopBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
    flexShrink: 0,
  },
  mobileTopBarTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
    minWidth: 0,
  },
  headerCard: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    overflow: 'hidden',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    background: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  headerTextWrap: {
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  title: {
    fontSize: 28,
    lineHeight: 1.15,
    margin: '6px 0 0',
    color: '#0f172a',
    wordBreak: 'break-word',
  },
  subtitle: {
    margin: '8px 0 0',
    color: '#64748b',
    fontSize: 14,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
    marginBottom: 18,
  },
  summaryCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 16,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 30,
    fontWeight: 800,
    marginTop: 10,
  },
  filterPanel: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    overflow: 'hidden',
  },
  filterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  filterHeaderText: {
    minWidth: 0,
  },
  filterPanelTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
  },
  filterPanelSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748b',
  },
  filterHeaderButtons: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  addTaskBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: 24,
    lineHeight: 1,
  },
  filterBlock: {
    marginTop: 12,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  pillRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterPill: {
    border: '1px solid #dbe3ee',
    borderRadius: 999,
    padding: '10px 14px',
    background: '#ffffff',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
  },
  dateFilterRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  dateInput: {
    width: '100%',
    maxWidth: 240,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    boxSizing: 'border-box',
  },
  dateHint: {
    fontSize: 12,
    color: '#64748b',
  },
  resultBar: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  resultText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: 700,
  },
  updatingText: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: 700,
  },
  cardList: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflowX: 'hidden',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  taskCard: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: 16,
  },
  taskMainRow: {
    display: 'flex',
    gap: 14,
    alignItems: 'stretch',
    width: '100%',
    minWidth: 0,
  },
  taskMainContent: {
    flex: 1,
    minWidth: 0,
  },
  cardTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  cardTopLeft: {
    minWidth: 0,
    width: '100%',
  },
  taskCodeRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  taskCode: {
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  statusBadge: {
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  roomLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  roomText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  roomNo: {
    fontSize: 16,
    fontWeight: 800,
    color: '#0f172a',
  },
  dot: {
    color: '#94a3b8',
  },
  deptBadge: {
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 800,
  },
  taskText: {
    marginTop: 14,
    color: '#334155',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
    marginTop: 14,
  },
  metaCard: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 12,
    minWidth: 0,
  },
  metaCardLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  metaCardValue: {
    fontSize: 13,
    color: '#334155',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  metaCardValueStrong: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: 800,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    width: '100%',
    marginTop: 14,
  },
  actionButton: {
    border: '1px solid',
    background: '#ffffff',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  editTaskBtn: {
    border: '1px solid #d6dae1',
    background: '#ffffff',
    color: '#1f2937',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
deleteTaskBtn: {
  border: '1px solid #ef4444',
  background: '#fff',
  color: '#ef4444',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer',
},
  permissionText: {
    marginTop: 10,
    fontSize: 12,
    color: '#b45309',
    fontWeight: 700,
  },
  pastTaskNote: {
    marginTop: 12,
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
  },
  thumbWrap: {
    flexShrink: 0,
    width: 96,
    maxWidth: 96,
    position: 'relative',
  },
  thumbButton: {
    display: 'block',
    width: '100%',
    border: 'none',
    padding: 0,
    background: 'transparent',
    cursor: 'pointer',
  },
  thumbImage: {
    display: 'block',
    width: '100%',
    height: 96,
    objectFit: 'cover',
    borderRadius: 14,
    border: '1px solid #e5e7eb',
  },
  imageCountBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    background: 'rgba(15,23,42,0.78)',
    color: '#ffffff',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 700,
  },
  mobileOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.28)',
    zIndex: 1001,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.56)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1100,
  },
  modalInner: {
    position: 'relative',
    width: '100%',
    maxWidth: 980,
    background: '#0f172a',
    borderRadius: 20,
    padding: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  modalCloseBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 38,
    height: 38,
    borderRadius: 999,
    border: 'none',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    cursor: 'pointer',
    zIndex: 2,
  },
  modalNavLeft: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: 'none',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  modalNavRight: {
    width: 42,
    height: 42,
    borderRadius: 999,
    border: 'none',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  modalImageWrap: {
    width: '100%',
    minWidth: 0,
  },
  modalImage: {
    display: 'block',
    width: '100%',
    maxHeight: '70vh',
    objectFit: 'contain',
    borderRadius: 16,
  },
  modalFooter: {
    marginTop: 12,
    color: '#ffffff',
  },
  modalCounter: {
    fontSize: 12,
    fontWeight: 700,
  },
  modalCaption: {
    fontSize: 13,
    color: '#cbd5e1',
    marginTop: 6,
    wordBreak: 'break-word',
  },
  createModalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.56)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1100,
  },
  createModalCard: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '88vh',
    overflowY: 'auto',
    background: '#ffffff',
    borderRadius: 20,
    padding: 20,
    boxSizing: 'border-box',
  },
  authCard: {
    width: '100%',
    maxWidth: 520,
    background: '#ffffff',
    borderRadius: 20,
    padding: 20,
    boxSizing: 'border-box',
  },
  createModalTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  createModalTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: '#0f172a',
  },
  createModalSubtitle: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 13,
  },
  createModalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    flexShrink: 0,
  },
  createErrorBox: {
    borderRadius: 12,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    padding: '12px 14px',
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 700,
  },
  successBox: {
    borderRadius: 12,
    background: '#ecfdf5',
    border: '1px solid #bbf7d0',
    color: '#166534',
    padding: '12px 14px',
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 700,
  },
  formBlock: {
    marginTop: 14,
  },
  formLabel: {
    display: 'block',
    marginBottom: 8,
    fontSize: 13,
    fontWeight: 700,
    color: '#334155',
  },
  textInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #d6dae1',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  },
  selectInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #d6dae1',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
    boxSizing: 'border-box',
  },
  textArea: {
    width: '100%',
    minHeight: 110,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #d6dae1',
    fontSize: 14,
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  photoPreviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 12,
    marginTop: 12,
  },
  photoPreviewItem: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 8,
    background: '#fff',
    minWidth: 0,
  },
  photoPreviewImg: {
    width: '100%',
    height: 100,
    objectFit: 'cover',
    borderRadius: 8,
    display: 'block',
  },
  photoPreviewName: {
    fontSize: 12,
    marginTop: 8,
    color: '#475467',
    wordBreak: 'break-word',
  },
  removePhotoBtn: {
    marginTop: 8,
    width: '100%',
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    color: '#344054',
    borderRadius: 8,
    padding: '8px 10px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  createModalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
    flexWrap: 'wrap',
  },
  secondaryBtn: {
    border: '1px solid #d6dae1',
    background: '#fff',
    color: '#344054',
    borderRadius: 10,
    padding: '10px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#fff',
    borderRadius: 10,
    padding: '10px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  uploadHint: {
    color: '#667085',
    fontSize: 13,
  },
  errorBox: {
    borderRadius: 14,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    padding: '12px 14px',
    marginBottom: 14,
    fontSize: 13,
    fontWeight: 700,
  },
  emptyState: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 18,
    padding: '28px 20px',
    color: '#64748b',
    textAlign: 'center',
    fontWeight: 700,
  },
};
