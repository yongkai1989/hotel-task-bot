
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
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
};

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
};

type ParsedDept = 'HK' | 'MT' | 'FO';

const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const liveStatuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const;
const DEPARTMENT_KEYWORDS: Record<ParsedDept, string[]> = {
  MT: [
    'aircond',
    'air con',
    'ac',
    'tak sejuk',
    'panas',
    'guest complain panas',
    'lampu',
    'light',
    'tv',
    'remote',
    'paip',
    'pipe',
    'sink',
    'toilet',
    'tandas',
    'flush',
    'heater',
    'water heater',
    'tak panas',
    'socket',
    'plug',
    'bocor',
    'leaking',
    'tersumbat',
    'rosak',
    'pintu',
    'kunci',
    'lock',
    'jammed',
    'electric',
    'elektrik',
    'tak ada air',
    'x ada air',
    'tak ada supply',
    'supply',
    'pressure',
    'shower',
    'minibar',
    'banjir',
    'tak boleh buka',
    'tak ada channel',
    'channel',
    'trip',
    'tak ada electric',
    'tingkap',
    'tak ada lampu',
    'ceiling basah',
    'safety box',
    'safe box',
    'katil rosak',
    'kerusi rosak',
    'chair rosak',
    'patah',
    'floor trap',
    'sumbat',
    'sinki',
    'flush rosak',
    'tak boleh flush',
    'battery',
    'tak function',
    'kettle',
    'longgar',
  ],
  HK: [
    'towel',
    'bath towel',
    'bath mat',
    'bathmat',
    'bedsheet',
    'bed sheet',
    'selimut',
    'duvet',
    'blanket',
    'bantal',
    'pillow',
    'linen',
    'room not cleaned',
    'bilik kotor',
    'make up room',
    'makeup room',
    'topup',
    'sabun',
    'shampoo',
    'sampah',
    'clean',
    'housekeeping',
    'amenities',
    'tukar',
    'kotor',
    'stain',
    'tak ada shampoo',
    'bathfoam',
    'carpet kotor',
    'toilet kotor',
    'ada bau',
    'bau',
    'sejadah',
    'toilet paper',
    'extra pillow',
    'extra bed',
    'katil asing',
    'keringkan lantai',
    'guest extend',
    'make up room',
    'jagan kemas',
    'jangan kemas',
    'nak kemas',
    'lantai licin',
    'bedbug',
    'semut',
    'cicak',
    'tangkap cicak',
    'lipas',
    'nyamuk',
    'tukar bilik',
  ],
  FO: [
    'guest marah',
    'minta tukar bilik',
    'guest minta tukar bilik',
    'minta extend',
    'guest minta extend',
    'nak extend',
    'guest nak extend',
    'translate',
    'guest minta translate',
    'bilik block',
    'guest complain',
    'check in',
    'check-in',
    'check out',
    'checkout',
    'booking',
    'reservation',
    'payment',
    'deposit',
    'refund',
    'receipt',
    'resit',
    'extend stay',
    'late checkout',
    'guest complain service',
    'front office',
    'bilik release',
    'bilik boleh jual',
    'bilik ok',
    'hold dulu jangan jual',
    'hold dulu jgn jual',
  ],
};

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

function normalizeParserText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bjgn\b/g, 'jangan')
    .replace(/\bx\b/g, 'tak')
    .replace(/\bxda\b/g, 'tak ada')
    .replace(/\bblm\b/g, 'belum')
    .replace(/\bac\b/g, 'aircond')
    .replace(/\baircon\b/g, 'aircond')
    .replace(/\bair cond\b/g, 'aircond')
    .replace(/\bsinki\b/g, 'sink')
    .replace(/\bsafebox\b/g, 'safe box')
    .replace(/\bsafebox\b/g, 'safe box')
    .replace(/\bbathmat\b/g, 'bath mat')
    .replace(/[^\w\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRoomFromMessage(value: string) {
  const match = String(value || '').match(/\b\d{3,5}\b/);
  return match ? match[0] : '';
}

function inferDepartmentFromMessage(value: string): {
  department: ParsedDept | '';
  confidence: 'high' | 'medium' | 'low';
  matches: string[];
} {
  const normalized = normalizeParserText(value);
  const scores: Record<ParsedDept, number> = { HK: 0, MT: 0, FO: 0 };
  const matches: Record<ParsedDept, string[]> = { HK: [], MT: [], FO: [] };
  const weakKeywords = new Set([
    'guest complain',
    'guest marah',
    'guest extend',
    'nak extend',
    'minta extend',
  ]);

  (Object.keys(DEPARTMENT_KEYWORDS) as ParsedDept[]).forEach((dept) => {
    DEPARTMENT_KEYWORDS[dept].forEach((keyword) => {
      if (normalized.includes(keyword)) {
        const weight = weakKeywords.has(keyword)
          ? 1
          : keyword.split(' ').length >= 3
          ? 3
          : keyword.includes(' ')
          ? 2
          : 1;
        scores[dept] += weight;
        matches[dept].push(keyword);
      }
    });
  });

  const ranked = (Object.keys(scores) as ParsedDept[])
    .map((dept) => ({ dept, score: scores[dept], hits: matches[dept] }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score <= 0) {
    return { department: '', confidence: 'low', matches: [] };
  }

  const top = ranked[0];
  const runnerUp = ranked[1];
  const confidence =
    top.score >= 4 && top.score >= (runnerUp?.score || 0) + 2
      ? 'high'
      : top.score >= 2 && top.score > (runnerUp?.score || 0)
      ? 'medium'
      : 'low';

  return { department: top.dept, confidence, matches: top.hits };
}

function buildTaskDescriptionFromMessage(value: string, room: string) {
  const withoutRoom = String(value || '')
    .replace(new RegExp(`\\b${room}\\b`, 'g'), ' ')
    .replace(/\b(bilik|room)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutRoom || String(value || '').trim();
}

function parseSmartTaskMessage(value: string) {
  const raw = String(value || '').trim();
  const room = extractRoomFromMessage(raw);
  const departmentInfo = inferDepartmentFromMessage(raw);
  const taskText = buildTaskDescriptionFromMessage(raw, room);

  return {
    room,
    department: departmentInfo.department,
    taskText,
    confidence: departmentInfo.confidence,
    matches: departmentInfo.matches,
  };
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
    <article style={{ ...styles.summaryCard, boxShadow: `inset 0 3px 0 ${accent}, 0 10px 24px rgba(15, 23, 42, 0.05)` }}>
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
  const [viewportWidth, setViewportWidth] = useState(1200);

  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedTaskImages, setSelectedTaskImages] = useState<TaskImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSmartMessage, setCreateSmartMessage] = useState('');
  const [createSmartHint, setCreateSmartHint] = useState('');
  const [createRoom, setCreateRoom] = useState('');
  const [createDepts, setCreateDepts] = useState<Array<'HK' | 'MT' | 'FO'>>([]);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMobile = viewportWidth < 768;
  const isTablet = viewportWidth >= 768 && viewportWidth < 1024;
  const modalResponsive = useMemo(
    () => ({
      overlay: {
        ...styles.createModalOverlay,
        padding: isMobile ? 10 : isTablet ? 14 : 20,
        alignItems: isMobile ? 'flex-end' : 'center',
      } as React.CSSProperties,
      card: {
        ...styles.createModalCard,
        maxWidth: isMobile ? '100%' : 760,
        maxHeight: isMobile ? '94vh' : styles.createModalCard.maxHeight,
        borderRadius: isMobile ? 20 : styles.createModalCard.borderRadius,
        padding: isMobile ? 14 : isTablet ? 16 : styles.createModalCard.padding,
      } as React.CSSProperties,
      top: {
        ...styles.createModalTop,
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : styles.createModalTop.alignItems,
      } as React.CSSProperties,
      title: {
        ...styles.createModalTitle,
        fontSize: isMobile ? 20 : styles.createModalTitle.fontSize,
      } as React.CSSProperties,
      subtitle: {
        ...styles.createModalSubtitle,
        fontSize: isMobile ? 13 : styles.createModalSubtitle.fontSize,
        lineHeight: 1.45,
      } as React.CSSProperties,
      closeBtn: {
        ...styles.createModalCloseBtn,
        alignSelf: isMobile ? 'flex-end' : undefined,
      } as React.CSSProperties,
      textInput: {
        ...styles.textInput,
        fontSize: isMobile ? 16 : styles.textInput.fontSize,
      } as React.CSSProperties,
      selectInput: {
        ...styles.selectInput,
        fontSize: isMobile ? 16 : styles.selectInput.fontSize,
      } as React.CSSProperties,
      textArea: {
        ...styles.textArea,
        minHeight: isMobile ? 100 : styles.textArea.minHeight,
        fontSize: isMobile ? 16 : styles.textArea.fontSize,
      } as React.CSSProperties,
      photoPreviewGrid: {
        ...styles.photoPreviewGrid,
        gridTemplateColumns: isMobile
          ? 'repeat(2, minmax(0, 1fr))'
          : styles.photoPreviewGrid.gridTemplateColumns,
      } as React.CSSProperties,
      actions: {
        ...styles.createModalActions,
        flexDirection: isMobile ? 'column-reverse' : 'row',
        justifyContent: isMobile ? 'stretch' : styles.createModalActions.justifyContent,
      } as React.CSSProperties,
      secondaryBtn: {
        ...styles.secondaryBtn,
        width: isMobile ? '100%' : undefined,
      } as React.CSSProperties,
      primaryBtn: {
        ...styles.primaryBtn,
        width: isMobile ? '100%' : undefined,
      } as React.CSSProperties,
      smartDraftRow: {
        ...styles.smartDraftRow,
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : styles.smartDraftRow.alignItems,
      } as React.CSSProperties,
      multiDeptRow: {
        ...styles.multiDeptRow,
        flexDirection: isMobile ? 'column' : 'row',
      } as React.CSSProperties,
      multiDeptChip: {
        ...styles.multiDeptChip,
        width: isMobile ? '100%' : undefined,
        justifyContent: isMobile ? 'flex-start' : undefined,
      } as React.CSSProperties,
    }),
    [isMobile, isTablet]
  );

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
    if (typeof window === 'undefined') return;

    const syncViewFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      setSidebarView(view === 'past' ? 'PAST_TASK' : 'DASHBOARD');
    };

    syncViewFromUrl();

    const handleUrlChange = () => syncViewFromUrl();

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function (...args) {
      const result = originalPushState.apply(this, args as any);
      window.dispatchEvent(new Event('dashboard-url-change'));
      return result;
    };

    window.history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args as any);
      window.dispatchEvent(new Event('dashboard-url-change'));
      return result;
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('dashboard-url-change', handleUrlChange);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('dashboard-url-change', handleUrlChange);
    };
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
      setLoginOpen(false);
      setPasswordModalOpen(false);
      sessionStorage.removeItem('dashboard_tasks_cache');

      window.location.replace('/dashboard');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Logout failed');
    }
  }

  function canCreateTask() {
    return !!profile?.can_create_task;
  }

  function canEditTask(_task?: Task) {
    if (!profile) return false;
    return !!profile.can_edit_task;
  }

function canEditTaskDetails(task: Task) {
  if (!profile) return false;

  if (task.status !== 'OPEN') return false;
  return !!profile.can_edit_task;
}

function canDeleteTask() {
  return !!profile?.can_delete_task;
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
      setErrorMsg(err?.message || 'Failed to  task');
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
    setCreateSmartMessage('');
    setCreateSmartHint('');
    setCreateRoom('');
    setCreateDepts([]);
    setCreateTaskText('');
    setCreatePhotos([]);
    setCreateError('');
  }

  function applySmartCreateDraft() {
    const parsed = parseSmartTaskMessage(createSmartMessage);

    if (!parsed.room && !parsed.department && !parsed.taskText) {
      setCreateSmartHint('Type a room number and issue first, for example: 1208 aircond tak sejuk');
      return;
    }

    if (parsed.room) {
      setCreateRoom(parsed.room);
    }

    if (parsed.department) {
      setCreateDepts((prev) => (prev.includes(parsed.department as 'HK' | 'MT' | 'FO') ? prev : [...prev, parsed.department as 'HK' | 'MT' | 'FO']));
    }

    if (parsed.taskText) {
      setCreateTaskText(parsed.taskText);
    }

    if (!parsed.room) {
      setCreateSmartHint('Room number not detected. Add something like 1208 or 2612.');
      return;
    }

    if (!parsed.department) {
      setCreateSmartHint('Room found, but department is unclear. Please choose HK, MT, or FO manually.');
      return;
    }

    const label =
      parsed.department === 'HK' ? 'Housekeeping' : parsed.department === 'MT' ? 'Maintenance' : 'Front Office';

    setCreateSmartHint(
      `${label} suggested (${parsed.confidence} confidence)${
        parsed.matches.length ? ` from: ${parsed.matches.slice(0, 3).join(', ')}` : ''
      }`
    );
  }

  function toggleCreateDept(dept: 'HK' | 'MT' | 'FO') {
    setCreateDepts((prev) =>
      prev.includes(dept) ? prev.filter((value) => value !== dept) : [...prev, dept]
    );
  }

  function openEditModal(task: Task) {
    if (!canEditTaskDetails(task)) {
      alert('You are not allowed to edit this task.');
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
    if (!profile || !profile.can_delete_task) {
      alert('Unauthorized');
      return;
    }

    const confirmDelete = confirm('Delete this task permanently?');
    if (!confirmDelete) return;

    setBusyTaskId(taskId);

    const token = await getAccessToken();

    await fetchJson(
      `/api/tasks/${taskId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      45000
    );

    setTasks((prev) => {
      const next = prev.filter((task) => task.id !== taskId);
      saveTasksToCache(next);
      lastTasksFingerprintRef.current = buildTasksFingerprint(next);
      return next;
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

      const parsed = parseSmartTaskMessage(createSmartMessage);
      const room = (createRoom.trim() || parsed.room).trim();
      const taskText = (createTaskText.trim() || parsed.taskText).trim();
      const departments = createDepts.length
        ? createDepts
        : parsed.department
          ? [parsed.department as 'HK' | 'MT' | 'FO']
          : [];

      if (!room) throw new Error('Room Number is required');
      if (!/^\d{3,5}$/.test(room)) throw new Error('Invalid room number');
      if (!departments.length) throw new Error('Select at least one department');
      if (!taskText) throw new Error('Task description required');

      if (room !== createRoom) setCreateRoom(room);
      if (departments.length !== createDepts.length || departments.some((dept) => !createDepts.includes(dept))) {
        setCreateDepts(departments);
      }
      if (taskText !== createTaskText) setCreateTaskText(taskText);

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
            department: departments[0],
            departments,
            task_text: taskText,
            source_message: createSmartMessage.trim() || null,
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

  const recentActivity = useMemo(() => {
    return [...tasks]
      .map((task) => {
        const activityAt = task.done_at || task.edited_at || task.created_at;
        const actor =
          task.done_by_name ||
          task.edited_by_name ||
          task.last_updated_by_name ||
          task.created_by_name ||
          'Unknown';
        const verb =
          task.status === 'DONE'
            ? 'completed task'
            : task.status === 'IN_PROGRESS'
            ? 'updated task status'
            : 'created task';

        return {
          id: task.id,
          actor,
          verb,
          label: `${task.task_text} (${task.room})`,
          at: activityAt,
        };
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5);
  }, [tasks]);

  const dashboardAlerts = useMemo(() => {
    const openTasks = tasks.filter((task) => task.status === 'OPEN');
    const doingTasks = tasks.filter((task) => task.status === 'IN_PROGRESS');
    const overdueTasks = openTasks
      .filter((task) => {
        const ageHours = (Date.now() - new Date(task.created_at).getTime()) / (1000 * 60 * 60);
        return ageHours >= 6;
      })
      .slice(0, 3);

    const items = [
      openTasks.length > 0
        ? {
            id: 'open',
            title: `${openTasks.length} open tasks require attention`,
            subtitle: 'Operations dashboard',
          }
        : null,
      doingTasks.length > 0
        ? {
            id: 'doing',
            title: `${doingTasks.length} tasks are in progress`,
            subtitle: 'Department teams',
          }
        : null,
      overdueTasks.length > 0
        ? {
            id: 'overdue',
            title: `${overdueTasks.length} older tasks may be overdue`,
            subtitle: 'Review oldest open tasks',
          }
        : null,
    ].filter(Boolean) as Array<{ id: string; title: string; subtitle: string }>;

    return items.slice(0, 4);
  }, [tasks]);

  const pageTitle =
    sidebarView === 'DASHBOARD' ? 'Operations Dashboard' : 'Past Task Archive';

  const pageSubtitle =
    sidebarView === 'DASHBOARD'
      ? 'Live task board for housekeeping, maintenance, and front office'
      : 'Browse previously completed tasks by completed date';

  const taskMainRowStyle: React.CSSProperties = styles.taskMainRow;

  return (
    <main style={styles.page}>
      <section style={styles.content}>
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
            <div style={styles.headerActionRow}>
              <button
                onClick={() => loadTasks(false)}
                style={styles.headerGhostBtn}
                disabled={refreshing || loading}
                title="Refresh tasks"
              >
                Refresh
              </button>

              {sidebarView === 'DASHBOARD' ? (
                <button
                  onClick={openCreateModal}
                  style={styles.addTaskBtn}
                  aria-label="Create task"
                  title="Create new task"
                >
                  <span style={styles.addTaskBtnIcon}>+</span>
                  <span style={styles.addTaskBtnTextWrap}>
                    <span style={styles.addTaskBtnEyebrow}>Quick action</span>
                    <span style={styles.addTaskBtnText}>Create Task</span>
                  </span>
                </button>
              ) : null}
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
              {sidebarView === 'DASHBOARD' ? null : null}

              <section style={styles.filterPanel}>
                <div style={styles.filterHeader}>
                  <div style={styles.filterHeaderText}>
                    <div style={styles.filterPanelTitle}>
                      {sidebarView === 'DASHBOARD' ? 'Task Workspace' : 'Archive Workspace'}
                    </div>
                    <div style={styles.filterPanelSubtitle}>
                      {sidebarView === 'DASHBOARD'
                        ? 'Filter active and today-completed tasks across departments'
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
                        aria-label="Create task"
                        title="Create new task"
                      >
                        <span style={styles.addTaskBtnIcon}>✦</span>
                        <span style={styles.addTaskBtnTextWrap}>
                          <span style={styles.addTaskBtnEyebrow}>Quick action</span>
                          <span style={styles.addTaskBtnText}>Create Task</span>
                        </span>
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

              <div
                style={{
                  ...styles.workspaceLayout,
                  gridTemplateColumns: isMobile || isTablet ? 'minmax(0, 1fr)' : styles.workspaceLayout.gridTemplateColumns,
                }}
              >
                <div style={styles.workspacePrimary}>
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
{canDeleteTask() ? (
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
                </div>

              {sidebarView === 'DASHBOARD' ? (
                <div style={styles.workspaceRail}>
                <div style={styles.sideInfoGrid}>
                  <section style={styles.sidePanel}>
                    <div style={styles.sidePanelHeader}>
                      <div style={styles.sidePanelTitle}>Alerts & Notifications</div>
                      <div style={styles.sidePanelCount}>{dashboardAlerts.length}</div>
                    </div>

                    {dashboardAlerts.length === 0 ? (
                      <div style={styles.sideEmpty}>No active alerts right now.</div>
                    ) : (
                      <div style={styles.sideList}>
                        {dashboardAlerts.map((item) => (
                          <div key={item.id} style={styles.sideListItem}>
                            <div style={styles.sideListIcon}>!</div>
                            <div style={styles.sideListBody}>
                              <div style={styles.sideListTitle}>{item.title}</div>
                              <div style={styles.sideListSubtitle}>{item.subtitle}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section style={styles.sidePanel}>
                    <div style={styles.sidePanelHeader}>
                      <div style={styles.sidePanelTitle}>Recent Activity</div>
                    </div>

                    {recentActivity.length === 0 ? (
                      <div style={styles.sideEmpty}>No activity yet.</div>
                    ) : (
                      <div style={styles.sideList}>
                        {recentActivity.map((item) => (
                          <div key={item.id} style={styles.sideListItem}>
                            <div style={styles.sideListIcon}>o</div>
                            <div style={styles.sideListBody}>
                              <div style={styles.sideListTitle}>
                                {item.actor} {item.verb}
                              </div>
                              <div style={styles.sideListSubtitle}>{item.label}</div>
                            </div>
                            <div style={styles.sideListTime}>
                              {new Date(item.at).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
                </div>
              ) : null}
              </div>
            </>
          )}
        </section>
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
        <div style={modalResponsive.overlay} onClick={closeCreateModal}>
          <div style={modalResponsive.card} onClick={(e) => e.stopPropagation()}>
            <div style={modalResponsive.top}>
              <div>
                <div style={modalResponsive.title}>Create New Task</div>
                <div style={modalResponsive.subtitle}>
                  Add a task from dashboard and push it to Telegram
                </div>
              </div>

              <button
                onClick={closeCreateModal}
                style={modalResponsive.closeBtn}
                aria-label="Close create task modal"
                disabled={createSubmitting}
              >
                ×
              </button>
            </div>

            {createError ? <div style={styles.createErrorBox}>{createError}</div> : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Quick Staff Message</label>
              <textarea
                value={createSmartMessage}
                onChange={(e) => {
                  setCreateSmartMessage(e.target.value);
                  if (createSmartHint) setCreateSmartHint('');
                }}
                style={modalResponsive.textArea}
                placeholder="e.g. 1208 aircond tak sejuk"
                disabled={createSubmitting}
              />
              <div style={modalResponsive.smartDraftRow}>
                <button
                  type="button"
                  onClick={applySmartCreateDraft}
                  style={modalResponsive.secondaryBtn}
                  disabled={createSubmitting || !createSmartMessage.trim()}
                >
                  Auto Fill
                </button>
                {createSmartHint ? <div style={styles.smartDraftHint}>{createSmartHint}</div> : null}
              </div>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Room Number</label>
              <input
                type="text"
                value={createRoom}
                onChange={(e) => setCreateRoom(e.target.value)}
                style={modalResponsive.textInput}
                placeholder="e.g. 1308"
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Department</label>
              <div style={modalResponsive.multiDeptRow}>
                {(['HK', 'MT', 'FO'] as const).map((dept) => (
                  <label
                    key={dept}
                    style={{
                      ...modalResponsive.multiDeptChip,
                      ...(createDepts.includes(dept) ? styles.multiDeptChipActive : {}),
                      opacity: createSubmitting ? 0.65 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={createDepts.includes(dept)}
                      onChange={() => toggleCreateDept(dept)}
                      disabled={createSubmitting}
                      style={styles.multiDeptCheckbox}
                    />
                    {dept}
                  </label>
                ))}
              </div>
              <div style={styles.multiDeptHint}>
                Select one or more departments. Multiple selections will create separate tasks for each department.
              </div>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Task Description</label>
              <textarea
                value={createTaskText}
                onChange={(e) => setCreateTaskText(e.target.value)}
                style={modalResponsive.textArea}
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
              <div style={modalResponsive.photoPreviewGrid}>
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

            <div style={modalResponsive.actions}>
              <button
                type="button"
                onClick={closeCreateModal}
                style={modalResponsive.secondaryBtn}
                disabled={createSubmitting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitCreateTask}
                style={modalResponsive.primaryBtn}
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
                  Users with edit access can update OPEN tasks
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
    background: 'linear-gradient(180deg, #f4f7fb 0%, #eef3f8 100%)',

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
    padding: 12,
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
    background: 'linear-gradient(135deg, #ffffff 0%, #f6faff 38%, #edf4ff 100%)',
    border: '1px solid #dbe7f5',
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
    boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',

  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,

  },
  logoWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    background: 'linear-gradient(180deg, #ffffff 0%, #eef4ff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    border: '1px solid #dbe7f5',

  },
  headerTextWrap: {
    minWidth: 0,
  },
  headerActionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid rgba(37, 99, 235, 0.12)',
  },
  headerGhostBtn: {
    border: '1px solid #d7e3f2',
    background: 'rgba(255,255,255,0.92)',
    color: '#1e3a8a',
    borderRadius: 14,
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 0.8,

  },
  title: {
    fontSize: 24,
    lineHeight: 1.12,
    margin: '4px 0 0',
    color: '#0f172a',
    fontWeight: 800,
    wordBreak: 'break-word',

  },
  subtitle: {
    margin: '6px 0 0',
    color: '#5b6b82',
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: 'break-word',

  },
  summaryGrid: {
    display: 'none',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 14,

  },
  summaryCard: {
    background: '#ffffff',
    border: '1px solid #e7edf5',
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',

  },
  summaryTitle: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 800,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,

  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 900,
    lineHeight: 1,

  },
  filterPanel: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.88)',
    border: '1px solid #dbe7f5',
    borderRadius: 24,
    padding: 18,
    marginBottom: 12,
    overflow: 'hidden',
    boxShadow: '0 16px 34px rgba(15, 23, 42, 0.06)',

  },
  filterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',

  },
  filterHeaderText: {
    minWidth: 0,
  },
  filterPanelTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#1e3a8a',
  },
  filterPanelSubtitle: {
    fontSize: 22,
    lineHeight: 1.18,
    margin: '4px 0 0',
    color: '#0f172a',
    fontWeight: 800,
    wordBreak: 'break-word',

  },
  filterHeaderButtons: {
    display: 'none',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',

  },
  workspaceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '10px 14px',
    background: '#eff6ff',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
    fontSize: 12,
    fontWeight: 800,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    border: '1px solid #d7e3f2',
    background: 'rgba(255,255,255,0.92)',
    color: '#1e3a8a',
    cursor: 'pointer',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.05)',

  },
  addTaskBtn: {
    minHeight: 56,
    borderRadius: 18,
    border: '1px solid rgba(37, 99, 235, 0.16)',
    background: 'linear-gradient(135deg, #173fb8 0%, #2563eb 52%, #60a5fa 100%)',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 800,
    lineHeight: 1,
    boxShadow: '0 18px 32px rgba(37, 99, 235, 0.26)',
    padding: '10px 16px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  addTaskBtnIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.18)',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 900,
    flexShrink: 0,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
  },
  addTaskBtnTextWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    minWidth: 0,
  },
  addTaskBtnEyebrow: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 1,
  },
  addTaskBtnText: {
    fontSize: 15,
    fontWeight: 900,
    color: '#ffffff',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  filterBlock: {
    marginTop: 10,

  },
  filterLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,

  },
  pillRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    background: '#f6f9fe',
    padding: 6,
    borderRadius: 14,
    border: '1px solid #e4edf8',

  },
  filterPill: {
    border: '1px solid #dbe3ee',
    borderRadius: 10,
    padding: '9px 12px',
    background: '#ffffff',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: 12,
    boxShadow: '0 1px 2px rgba(15,23,42,0.02)',

  },
  dateFilterRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,

  },
  dateInput: {
    width: '100%',
    maxWidth: 260,
    padding: '11px 14px',
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    boxSizing: 'border-box',
    fontWeight: 700,

  },
  dateHint: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 600,

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
    background: '#ffffff',
    border: '1px solid #dbe7f5',
    borderRadius: 18,
    padding: '12px 14px',
    boxShadow: '0 10px 22px rgba(15, 23, 42, 0.04)',

  },
  workspaceLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 0.9fr)',
    gap: 16,
    alignItems: 'start',
  },
  workspacePrimary: {
    minWidth: 0,
  },
  workspaceRail: {
    minWidth: 0,
  },
  resultText: {
    fontSize: 12,
    color: '#33507a',
    fontWeight: 800,
    letterSpacing: 0.2,

  },
  updatingText: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: 800,

  },
  cardList: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflowX: 'hidden',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,

  },
  taskCard: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid #dfe9f5',
    borderRadius: 22,
    padding: 14,
    boxShadow: '0 16px 32px rgba(15, 23, 42, 0.06)',

  },
  sideInfoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 14,
    marginTop: 16,
  },
  sidePanel: {
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid #dfe9f5',
    borderRadius: 22,
    padding: 18,
    boxShadow: '0 16px 32px rgba(15, 23, 42, 0.06)',
  },
  sidePanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sidePanelTitle: {
    fontSize: 18,
    fontWeight: 800,
    color: '#0f172a',
  },
  sidePanelCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    background: '#fee2e2',
    color: '#dc2626',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 12,
  },
  sideEmpty: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 700,
  },
  sideList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sideListItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  sideListIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    background: '#eff6ff',
    color: '#2563eb',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    flexShrink: 0,
  },
  sideListBody: {
    flex: 1,
    minWidth: 0,
  },
  sideListTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.35,
  },
  sideListSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    lineHeight: 1.4,
  },
  sideListTime: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  taskMainRow: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
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
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',

  },
  taskCode: {
    fontSize: 12,
    fontWeight: 900,
    color: '#0f172a',
    letterSpacing: 0.4,

  },
  statusBadge: {
    borderRadius: 999,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 0.3,

  },
  roomLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
    flexWrap: 'wrap',

  },
  roomText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,

  },
  roomNo: {
    fontSize: 20,
    color: '#0f172a',
    fontWeight: 900,
    letterSpacing: 0.2,

  },
  dot: {
    color: '#94a3b8',
    fontWeight: 900,

  },
  deptBadge: {
    borderRadius: 999,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 900,

  },
  taskText: {
    marginTop: 12,
    color: '#334155',
    lineHeight: 1.55,
    fontSize: 15,
    fontWeight: 600,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    marginTop: 12,

  },
  metaCard: {
    background: '#f8fafc',
    border: '1px solid #eef2f7',
    borderRadius: 12,
    padding: 10,
    minWidth: 0,

  },
  metaCardLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,

  },
  metaCardValue: {
    fontSize: 12,
    color: '#334155',
    fontWeight: 700,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  metaCardValueStrong: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: 900,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    width: '100%',
    marginTop: 12,

  },
  actionButton: {
    border: '1px solid',
    background: '#ffffff',
    borderRadius: 12,
    padding: '11px 14px',
    fontWeight: 900,
    fontSize: 12,
    cursor: 'pointer',
    flex: 1,
    minWidth: 90,

  },
  editTaskBtn: {
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#1f2937',
    borderRadius: 12,
    padding: '11px 14px',
    fontWeight: 800,
    fontSize: 12,
    cursor: 'pointer',
    flex: 1,
    minWidth: 90,

  },
deleteTaskBtn: {
    border: '1px solid #ef4444',
    background: '#fff',
    color: '#ef4444',
    borderRadius: 12,
    padding: '11px 14px',
    fontWeight: 800,
    fontSize: 12,
    cursor: 'pointer',
    flex: 1,
    minWidth: 90,

  },
  permissionText: {
    marginTop: 10,
    fontSize: 11,
    color: '#64748b',
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
    width: 88,
    maxWidth: 88,
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
    height: 88,
    objectFit: 'cover',
    borderRadius: 14,
    border: '1px solid #e7edf5',
    boxShadow: '0 6px 18px rgba(15,23,42,0.05)',

  },
  imageCountBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    background: 'rgba(15,23,42,0.82)',
    color: '#ffffff',
    borderRadius: 999,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 800,

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
    borderRadius: 24,
    padding: 18,
    boxSizing: 'border-box',
    boxShadow: '0 26px 60px rgba(15,23,42,0.22)',

  },
  authCard: {
    width: '100%',
    maxWidth: 520,
    background: '#ffffff',
    borderRadius: 24,
    padding: 18,
    boxSizing: 'border-box',
    boxShadow: '0 26px 60px rgba(15,23,42,0.22)',

  },
  createModalTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  createModalTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: '#0f172a',

  },
  createModalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    fontWeight: 600,

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
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    background: '#ffffff',

  },
  selectInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    fontSize: 14,
    outline: 'none',
    background: '#fff',
    boxSizing: 'border-box',

  },
  textArea: {
    width: '100%',
    minHeight: 110,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    fontSize: 14,
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
    background: '#ffffff',

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
  smartDraftRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  smartDraftHint: {
    fontSize: 12,
    color: '#475467',
    fontWeight: 700,
    lineHeight: 1.45,
  },
  multiDeptRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  multiDeptChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#334155',
    borderRadius: 999,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  multiDeptChipActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  multiDeptCheckbox: {
    margin: 0,
  },
  multiDeptHint: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
    lineHeight: 1.45,
    marginTop: 8,
  },
  secondaryBtn: {
    border: '1px solid #dbe3ee',
    background: '#fff',
    color: '#344054',
    borderRadius: 12,
    padding: '11px 16px',
    fontWeight: 800,
    cursor: 'pointer',

  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#fff',
    borderRadius: 12,
    padding: '11px 16px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(15,23,42,0.16)',

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
    border: '1px solid #e7edf5',
    borderRadius: 20,
    padding: '24px 18px',
    color: '#64748b',
    textAlign: 'center',
    fontWeight: 700,
    boxShadow: '0 10px 24px rgba(15,23,42,0.04)',

  },
};
