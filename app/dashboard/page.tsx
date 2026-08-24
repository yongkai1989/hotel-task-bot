
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';
import {
  readTaskBroadcastPayload,
  TASK_BROADCAST_CHANNEL,
  TASK_BROADCAST_EVENT,
} from '../../lib/taskRealtime';
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
  status: 'OPEN' | 'DONE';
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
  customer_waiting?: boolean | null;
  customer_waiting_reminder_sent_at?: string | null;
  urgent?: boolean | null;
  urgent_due_at?: string | null;
  alert_cycle?: number | null;
  acknowledgements?: Array<{
    user_name: string;
    acknowledged_at: string;
    alert_cycle: number;
  }>;
};

type SidebarView = 'DASHBOARD' | 'PAST_TASK';

type CreatePhotoItem = {
  id: string;
  name: string;
  previewUrl: string;
  file: Blob;
  mediaType: 'image' | 'video';
  marked?: boolean;
};

type DashboardUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
  can_create_task?: boolean;
  can_update_task_status?: boolean;
  can_edit_task?: boolean;
  can_delete_task?: boolean;
};

type DashboardInsights = {
  roomPendingSave: number;
  specialProjectCompletion: number;
  specialProjectDoneRooms: number;
  overduePm: number;
  foChecklistSubmitted: number;
  foChecklistHasNoAnswer: boolean;
  supervisorChecklistSubmitted: number;
  paChecklistSubmitted: number;
  fnbChecklistSubmitted: number;
  managerRoomCheck: {
    HK: { completed: number; total: number };
    MT: { completed: number; total: number };
  };
  laundryReceivedSaved: boolean;
  laundryReceivedBlocks: number;
};

const DASHBOARD_TASKS_CACHE_KEY = 'dashboard_tasks_cache';
const DASHBOARD_INSIGHTS_CACHE_KEY = 'dashboard_insights_cache';
const DASHBOARD_PROFILE_CACHE_KEY = 'dashboard-session-profile';
const DASHBOARD_PROFILE_CACHE_TS_KEY = 'dashboard-session-profile-ts';
const SILENT_TASK_REFRESH_MIN_MS = 300000;
const MANUAL_TASK_REFRESH_MIN_MS = 45000;
const INSIGHTS_REFRESH_MIN_MS = 600000;
const PROFILE_REFRESH_MIN_MS = 1800000;
const MAX_RENDERED_TASK_CARDS = 60;
const MAX_RENDERED_TASK_CARDS_MOBILE = 30;
const MAX_RENDERED_TASK_THUMBNAILS = 20;
const MAX_DASHBOARD_TASK_MEDIA = 30;
const URGENT_TASK_LIMIT_MS = 5 * 60 * 1000;
const HOUSEKEEPING_SUPERVISOR_EMAILS = [
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
];
const PA_CHECKLIST_SUBMITTER_EMAILS = ['pa@hotelhallmark.com'];
const FNB_CHECKLIST_SUBMITTER_EMAILS = ['fnb@hotelhallmark.com'];

function managerRoomCheckHref(task: Task) {
  if (!/^Urgent Manager Room Check for room\s+/i.test(String(task.task_text || '').trim())) return null;
  const route =
    task.department === 'HK'
      ? '/dashboard/hk-manager-room-check'
      : task.department === 'MT'
      ? '/dashboard/maintenance-manager-room-check'
      : null;
  return route ? `${route}?room=${encodeURIComponent(task.room)}` : null;
}

type AdminUser = {
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';
};

type DashboardIconName =
  | 'clipboard'
  | 'loader'
  | 'check'
  | 'door'
  | 'progress'
  | 'alert'
  | 'housekeeping'
  | 'maintenance'
  | 'laundry'
  | 'refresh'
  | 'plus'
  | 'camera'
  | 'upload'
  | 'pen'
  | 'activity';

const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const liveStatuses = ['ALL', 'OPEN', 'DONE'] as const;

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

function getFoChecklistServiceDateString() {
  const d = new Date();
  if (d.getHours() < 12) {
    d.setDate(d.getDate() - 1);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSupervisorChecklistServiceDateString() {
  return getFoChecklistServiceDateString();
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

function formatDurationFromMs(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return '-';

  const totalMinutes = Math.round(value / (1000 * 60));
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatWaitingDuration(createdAt: string | null | undefined, nowMs: number) {
  if (!createdAt) return '-';
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return '-';
  return formatDurationFromMs(Math.max(60 * 1000, nowMs - createdMs));
}

function urgentTaskDueAtMs(task: Task) {
  const storedDueAt = new Date(String(task.urgent_due_at || '')).getTime();
  if (Number.isFinite(storedDueAt)) return storedDueAt;

  const createdAt = new Date(task.created_at || '').getTime();
  return Number.isFinite(createdAt) ? createdAt + URGENT_TASK_LIMIT_MS : Number.NaN;
}

function labelForStatus(status: string) {
  if (status === 'ALL') return 'ALL';
  if (status === 'DONE') return 'DONE';
  return 'OPEN';
}

function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const binary = atob(payload || '');
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function isVideoUrl(url?: string | null) {
  if (!url) return false;
  const cleanUrl = url.split('?')[0].toLowerCase();
  return /\.(mp4|mov|m4v|webm|ogg)$/.test(cleanUrl);
}

function revokePreviewUrl(url?: string | null) {
  if (typeof window === 'undefined') return;
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
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

async function prepareDashboardMediaItems(files: File[]) {
  return Promise.all(
    files.map(async (file, index) => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        throw new Error('Only image and video files are allowed');
      }

      if (isImage) {
        const compressed = await compressImageToDataUrl(file, 1200, 0.72);
        return {
          id: `${Date.now()}-${index}-${file.name}`,
          name: file.name,
          previewUrl: compressed,
          file: dataUrlToBlob(compressed),
          mediaType: 'image' as const,
        };
      }

      return {
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        file,
        mediaType: 'video' as const,
      };
    })
  );
}


function departmentFilterStyle(label: string, active: boolean): React.CSSProperties {
  const base =
    label === 'HK'
      ? '#059669'
      : label === 'MT'
      ? '#2563eb'
      : label === 'FO'
      ? '#d97706'
      : '#1d4ed8';

  return {
    ...styles.filterPill,
    background: active ? base : 'transparent',
    color: active ? '#ffffff' : '#34455f',
    borderColor: active ? base : 'transparent',
    boxShadow: active
      ? `0 10px 20px ${base}24, inset 0 1px 0 rgba(255,255,255,0.22)`
      : 'none',
  };
}

function statusFilterStyle(active: boolean): React.CSSProperties {
  return {
    ...styles.filterPill,
    background: active ? '#0f172a' : 'transparent',
    color: active ? '#ffffff' : '#34455f',
    borderColor: active ? '#0f172a' : 'transparent',
    boxShadow: active ? '0 10px 20px rgba(15, 23, 42, 0.16), inset 0 1px 0 rgba(255,255,255,0.12)' : 'none',
  };
}

function statusBadgeStyle(status: Task['status']): React.CSSProperties {
  if (status === 'OPEN') {
    return { ...styles.statusBadge, background: '#fff7ed', color: '#c2410c' };
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

function SummaryCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: 'open' | 'progress' | 'done';
}) {
  const accent =
    tone === 'open' ? '#c2410c' : tone === 'progress' ? '#1d4ed8' : '#15803d';

  return (
    <article style={{ ...styles.summaryCard, boxShadow: `inset 0 3px 0 ${accent}, 0 10px 24px rgba(15, 23, 42, 0.05)` }}>
      <div style={styles.summaryTitle}>{title}</div>
      <div style={{ ...styles.summaryValue, color: accent }}>{value}</div>
    </article>
  );
}

function DashboardIcon({
  name,
  size = 18,
}: {
  name: DashboardIconName;
  size?: number;
}) {
  const common: React.SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };

  if (name === 'clipboard') {
    return (
      <svg {...common}>
        <path d="M9 5h6" />
        <path d="M9 3h6a2 2 0 0 1 2 2v1H7V5a2 2 0 0 1 2-2Z" />
        <path d="M7 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }

  if (name === 'loader') {
    return (
      <svg {...common}>
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="m4.9 4.9 2.1 2.1" />
        <path d="m17 17 2.1 2.1" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m4.9 19.1 2.1-2.1" />
        <path d="M17 7l2.1-2.1" />
      </svg>
    );
  }

  if (name === 'check') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12.3 2.3 2.3 4.9-5.2" />
      </svg>
    );
  }

  if (name === 'door') {
    return (
      <svg {...common}>
        <path d="M7 21V4.8A1.8 1.8 0 0 1 8.8 3h7.4A1.8 1.8 0 0 1 18 4.8V21" />
        <path d="M4.5 21h15" />
        <path d="M14.5 12h.01" />
      </svg>
    );
  }

  if (name === 'progress') {
    return (
      <svg {...common}>
        <path d="M4 13a8 8 0 1 0 2.35-5.65" />
        <path d="M4 5v5h5" />
        <path d="m9.2 12.4 2.2 2.2 4.4-5" />
      </svg>
    );
  }

  if (name === 'alert') {
    return (
      <svg {...common}>
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
        <path d="M10.4 3.8 2.7 17.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.6 3.8a1.85 1.85 0 0 0-3.2 0Z" />
      </svg>
    );
  }

  if (name === 'housekeeping') {
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <path d="M7 20v-7.5a5 5 0 0 1 10 0V20" />
        <path d="M9.5 13.5h5" />
        <path d="M12 3v4" />
        <path d="M9.5 5.5h5" />
        <path d="M6 9l-2-2" />
        <path d="M18 9l2-2" />
      </svg>
    );
  }

  if (name === 'maintenance') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a4 4 0 0 0-5 5L4.4 16.6a2 2 0 1 0 3 3l5.3-5.3a4 4 0 0 0 5-5l-2.8 2.8-2.2-2.2 2.8-2.8Z" />
        <path d="M15 15l4.5 4.5" />
        <path d="M17.5 17.5 16 19" />
      </svg>
    );
  }

  if (name === 'laundry') {
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M8 7h.01" />
        <path d="M11 7h5" />
        <circle cx="12" cy="14" r="4.2" />
        <path d="M8.5 14.5c1.3-1 2.4-1 3.5 0s2.2 1 3.5 0" />
      </svg>
    );
  }

  if (name === 'refresh') {
    return (
      <svg {...common}>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M18.2 9A7 7 0 0 0 6.4 6.9L4 9" />
        <path d="M5.8 15A7 7 0 0 0 17.6 17.1L20 15" />
      </svg>
    );
  }

  if (name === 'plus') {
    return (
      <svg {...common}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (name === 'camera') {
    return (
      <svg {...common}>
        <path d="M8.5 7 10 5h4l1.5 2H18a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3h2.5Z" />
        <circle cx="12" cy="13.5" r="3.25" />
        <path d="M17.5 10h.01" />
      </svg>
    );
  }

  if (name === 'upload') {
    return (
      <svg {...common}>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" />
      </svg>
    );
  }

  if (name === 'pen') {
    return (
      <svg {...common}>
        <path d="m16.9 3.7 3.4 3.4" />
        <path d="M19 9 8.2 19.8 4 20l.2-4.2L15 5" />
        <path d="M12 20h8" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M5 12h3l2-6 4 12 2-6h3" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function OverviewMetricCard({
  title,
  value,
  note,
  tone,
  icon,
  alert,
  href,
}: {
  title: string;
  value: string | number;
  note?: string;
  tone: 'open' | 'progress' | 'done' | 'violet' | 'danger';
  icon: DashboardIconName;
  alert?: boolean;
  href?: string;
}) {
  const theme =
    tone === 'open'
      ? { bg: '#eff6ff', fg: '#2563eb' }
      : tone === 'progress'
      ? { bg: '#fff7ed', fg: '#d97706' }
      : tone === 'done'
      ? { bg: '#ecfdf5', fg: '#16a34a' }
      : tone === 'violet'
      ? { bg: '#f5f3ff', fg: '#7c3aed' }
      : { bg: '#fef2f2', fg: '#dc2626' };

  const content = (
    <>
      <div style={{ ...styles.overviewIcon, background: theme.bg, color: theme.fg }}>
        <DashboardIcon name={icon} size={15} />
        {alert ? <span style={styles.overviewAlertBadge}>!</span> : null}
      </div>
      <div style={styles.overviewContent}>
        <div style={styles.overviewLabel}>{title}</div>
        <div style={styles.overviewValue}>{value}</div>
        {note ? <div style={styles.overviewNote}>{note}</div> : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} style={{ ...styles.overviewCard, ...styles.overviewCardLink }}>
        {content}
      </Link>
    );
  }

  return (
    <article style={styles.overviewCard}>
      {content}
    </article>
  );
}

function DashboardBootLoader() {
  return (
    <div style={styles.bootLoader} role="status" aria-live="polite">
      <style>
        {`
          @keyframes dashboardBootBar {
            0% { transform: translateX(-80%); }
            100% { transform: translateX(220%); }
          }
          @keyframes dashboardBootPulse {
            0%, 100% { opacity: 0.48; }
            50% { opacity: 1; }
          }
        `}
      </style>
      <div style={styles.bootLoaderCard}>
        <div style={styles.bootLoaderIcon}>
          <DashboardIcon name="clipboard" size={22} />
        </div>
        <div style={styles.bootLoaderEyebrow}>Hallmark Crown Hotel</div>
        <div style={styles.bootLoaderTitle}>Preparing dashboard</div>
        <div style={styles.bootLoaderText}>
          Checking access and loading the latest task data.
        </div>
        <div style={styles.bootLoaderTrack}>
          <div style={styles.bootLoaderBar} />
        </div>
        <div style={styles.bootSkeletonGrid}>
          <div style={styles.bootSkeletonTile} />
          <div style={styles.bootSkeletonTile} />
          <div style={styles.bootSkeletonTile} />
        </div>
      </div>
    </div>
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
  const [insights, setInsights] = useState<DashboardInsights>({
    roomPendingSave: 0,
    specialProjectCompletion: 0,
    specialProjectDoneRooms: 0,
    overduePm: 0,
    foChecklistSubmitted: 0,
    foChecklistHasNoAnswer: false,
    supervisorChecklistSubmitted: 0,
    paChecklistSubmitted: 0,
    fnbChecklistSubmitted: 0,
    managerRoomCheck: {
      HK: { completed: 0, total: 0 },
      MT: { completed: 0, total: 0 },
    },
    laundryReceivedSaved: false,
    laundryReceivedBlocks: 0,
  });

  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedTaskImages, setSelectedTaskImages] = useState<TaskImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createRoom, setCreateRoom] = useState('');
  const [createDepts, setCreateDepts] = useState<Array<'HK' | 'MT' | 'FO'>>([]);
  const [createTaskText, setCreateTaskText] = useState('');
  const [createPhotos, setCreatePhotos] = useState<CreatePhotoItem[]>([]);
  const [createCustomerWaiting, setCreateCustomerWaiting] = useState(false);
  const [createUrgent, setCreateUrgent] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [mediaUploadNotice, setMediaUploadNotice] = useState<{
    status: 'uploading' | 'done' | 'error';
    count: number;
    message: string;
  } | null>(null);
  const dashboardCameraInputRef = useRef<HTMLInputElement | null>(null);
  const createCameraInputRef = useRef<HTMLInputElement | null>(null);
  const createLibraryInputRef = useRef<HTMLInputElement | null>(null);
  const editCameraInputRef = useRef<HTMLInputElement | null>(null);
  const editLibraryInputRef = useRef<HTMLInputElement | null>(null);
  const markupCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markupDrawingRef = useRef(false);
  const markupLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [markupTarget, setMarkupTarget] = useState<{
    mode: 'create' | 'edit';
    id: string;
  } | null>(null);

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
  const [timerNow, setTimerNow] = useState(Date.now());

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

    let frame = 0;
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewportWidth((prev) => (prev === window.innerWidth ? prev : window.innerWidth));
      });
    };
    onResize();
    window.addEventListener('resize', onResize);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const now = Date.now();
    const nextUrgentDueAt = tasks
      .filter((task) => task.urgent === true && task.status !== 'DONE')
      .map(urgentTaskDueAtMs)
      .filter((dueAt) => Number.isFinite(dueAt) && dueAt > now)
      .sort((a, b) => a - b)[0];

    if (!Number.isFinite(nextUrgentDueAt)) return;
    const timer = window.setTimeout(
      () => setTimerNow(Date.now()),
      Math.min(Math.max(0, nextUrgentDueAt - now) + 100, 2_147_000_000)
    );
    return () => window.clearTimeout(timer);
  }, [tasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mediaUploadNotice?.status !== 'uploading') return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [mediaUploadNotice?.status]);

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

  useEffect(() => {
    if (!markupTarget) return;

    const item =
      markupTarget.mode === 'create'
        ? createPhotos.find((entry) => entry.id === markupTarget.id)
        : editNewPhotos.find((entry) => entry.id === markupTarget.id);

    if (!item || item.mediaType !== 'image') return;

    let cancelled = false;
    const img = new window.Image();

    img.onload = () => {
      if (cancelled) return;

      const canvas = markupCanvasRef.current;
      if (!canvas) return;

      const maxWidth = isMobile ? 720 : 1100;
      const maxHeight = isMobile ? 760 : 900;
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };

    img.onerror = () => {
      if (!cancelled) {
        const message = 'Failed to open image markup';
        if (markupTarget.mode === 'create') setCreateError(message);
        else setEditError(message);
        setMarkupTarget(null);
      }
    };

    img.src = item.previewUrl;

    return () => {
      cancelled = true;
    };
  }, [createPhotos, editNewPhotos, isMobile, markupTarget]);

  const lastTasksFingerprintRef = useRef('');
  const hasHydratedFromCacheRef = useRef(false);
  const lastTasksRequestAtRef = useRef(0);
  const tasksRequestInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastInsightsRequestAtRef = useRef(0);
  const insightsRequestInFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadedProfileKeyRef = useRef('');
  const profileKey = profile?.email?.toLowerCase() || '';

  function buildTasksFingerprint(taskList: Task[]) {
    return JSON.stringify(
      (taskList || []).map((task) => ({
        id: task.id,
        status: task.status,
        done_at: task.done_at || null,
        edited_at: task.edited_at || null,
        image_count: Array.isArray(task.task_images) ? task.task_images.length : 0,
      }))
    );
  }

  function saveTasksToCache(taskList: Task[]) {
    if (typeof window === 'undefined') return;

    try {
      lastTasksFingerprintRef.current = buildTasksFingerprint(taskList);
      sessionStorage.removeItem(DASHBOARD_TASKS_CACHE_KEY);
    } catch {
      // ignore cache write failure
    }
  }

  function readTasksFromCache(): Task[] | null {
    return null;
  }

  function saveInsightsToCache(_nextInsights: DashboardInsights) {
    if (typeof window === 'undefined') return;

    try {
      sessionStorage.removeItem(DASHBOARD_INSIGHTS_CACHE_KEY);
    } catch {
      // ignore cache write failure
    }
  }

  function readInsightsFromCache(_maxAgeMs = INSIGHTS_REFRESH_MIN_MS): DashboardInsights | null {
    return null;
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
      const statusParam = (params.get('status') || '').toUpperCase();
      setSidebarView(view === 'past' ? 'PAST_TASK' : 'DASHBOARD');
      if (statusParam === 'OPEN' || statusParam === 'DONE' || statusParam === 'ALL') {
        setStatus(statusParam);
      }
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
    let hydratedCachedProfile = false;

    if (!supabase) {
      setEnvError(
        'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel environment variables.'
      );
      setAuthLoading(false);
      return;
    }

    if (typeof window !== 'undefined') {
      const cachedRaw = window.sessionStorage.getItem(DASHBOARD_PROFILE_CACHE_KEY);
      const cachedAt = Number(window.sessionStorage.getItem(DASHBOARD_PROFILE_CACHE_TS_KEY) || '0');

      if (cachedRaw && cachedAt && Date.now() - cachedAt < PROFILE_REFRESH_MIN_MS) {
        try {
          setProfile(JSON.parse(cachedRaw));
          setAuthLoading(false);
          hydratedCachedProfile = true;
        } catch {}
      }
    }

    async function bootstrapAuth() {
      try {
        setEnvError('');
        if (!hydratedCachedProfile) {
          setAuthLoading(true);
        }

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
    if (!profileKey) {
      lastLoadedProfileKeyRef.current = '';
      setTasks([]);
      setLoading(false);
      return;
    }

    if (lastLoadedProfileKeyRef.current === profileKey) {
      void loadDashboardInsights();
      return;
    }

    lastLoadedProfileKeyRef.current = profileKey;
    void loadDashboardInsights();

    const cachedTasks = readTasksFromCache();

    if (cachedTasks && cachedTasks.length > 0) {
      setTasks((prev) => (prev.length > 0 ? prev : cachedTasks));
      void loadTasks(false, { silent: true, onlyIfChanged: true });
      setLoading(false);
      return;
    }

    void loadTasks(tasks.length === 0, { force: tasks.length === 0 });
  }, [profileKey]);

  useEffect(() => {
    if (!profileKey) return;
    const supabase = getSupabaseSafe();
    if (!supabase) return;
    const refreshTimers = new Map<string, number>();

    const removeTaskFromState = (taskId: string) => {
      setTasks((current) => {
        const next = current.filter((task) => String(task.id) !== taskId);
        saveTasksToCache(next);
        return next;
      });
    };

    const refreshOneTask = async (taskId: string) => {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        cache: 'no-store',
        credentials: 'include',
      });

      if (response.status === 404) {
        removeTaskFromState(taskId);
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.task) {
        throw new Error(payload?.error || 'Unable to synchronize task');
      }

      setTasks((current) => {
        const taskIndex = current.findIndex((task) => String(task.id) === taskId);
        const next =
          taskIndex >= 0
            ? current.map((task, index) => (index === taskIndex ? payload.task : task))
            : [payload.task, ...current];

        next.sort(
          (a, b) =>
            Date.parse(String(b.created_at || '')) -
            Date.parse(String(a.created_at || ''))
        );
        saveTasksToCache(next);
        return next;
      });
    };

    let channel: any = null;

    const handleTaskChange = (message: any) => {
      const payload = readTaskBroadcastPayload(message?.payload);
      const taskId = payload?.id || '';
      if (!taskId) {
        void loadTasks(false, { silent: true, onlyIfChanged: true, force: true });
        return;
      }

      const existingTimer = refreshTimers.get(taskId);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);

      if (payload?.eventType === 'DELETE') {
        refreshTimers.delete(taskId);
        removeTaskFromState(taskId);
        return;
      }

      const timer = window.setTimeout(() => {
        refreshTimers.delete(taskId);
        void refreshOneTask(taskId).catch(() => {
          // A manual refresh remains available if a transient sync request fails.
        });
      }, 250);
      refreshTimers.set(taskId, timer);
    };

    const startChannel = async () => {
      if (channel || document.visibilityState !== 'visible') return;
      await supabase.realtime.setAuth();
      channel = supabase
        .channel(TASK_BROADCAST_CHANNEL, { config: { private: true } })
        .on(
          'broadcast',
          { event: TASK_BROADCAST_EVENT },
          handleTaskChange
        )
        .subscribe();
    };

    const stopChannel = () => {
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
      refreshTimers.clear();
      if (!channel) return;
      const activeChannel = channel;
      channel = null;
      void supabase.removeChannel(activeChannel);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void startChannel();
        void loadTasks(false, { silent: true, onlyIfChanged: true, force: true });
      } else {
        stopChannel();
      }
    };

    void startChannel();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopChannel();
    };
  }, [profileKey]);

  async function getAccessToken() {
    const supabase = getSupabaseSafe();
    if (!supabase) return '';

    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  }

  async function loadProfile(token: string) {
    if (typeof window !== 'undefined') {
      const runtime = window as typeof window & {
        __dashboardProfilePromise?: Promise<any> | null;
      };
      const cachedRaw = window.sessionStorage.getItem(DASHBOARD_PROFILE_CACHE_KEY);
      const cachedAt = Number(window.sessionStorage.getItem(DASHBOARD_PROFILE_CACHE_TS_KEY) || '0');

      if (cachedRaw && cachedAt && Date.now() - cachedAt < PROFILE_REFRESH_MIN_MS) {
        try {
          setProfile(JSON.parse(cachedRaw));
          return;
        } catch {}
      }

      if (runtime.__dashboardProfilePromise) {
        const json = await runtime.__dashboardProfilePromise;
        if (json?.user) setProfile(json.user);
        return;
      }

      runtime.__dashboardProfilePromise = fetchJson('/api/session-profile', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).finally(() => {
        runtime.__dashboardProfilePromise = null;
      });

      const json = await runtime.__dashboardProfilePromise;

      setProfile(json.user);

      if (json.user) {
        window.sessionStorage.setItem(DASHBOARD_PROFILE_CACHE_KEY, JSON.stringify(json.user));
        window.sessionStorage.setItem(DASHBOARD_PROFILE_CACHE_TS_KEY, String(Date.now()));
      }

      return;
    }

    const json = await fetchJson('/api/session-profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    setProfile(json.user);
  }

  async function loadDashboardInsights() {
    const supabase = getSupabaseSafe();
    if (!supabase) return;

    const now = Date.now();

    if (insightsRequestInFlightRef.current) {
      return insightsRequestInFlightRef.current;
    }

    const cachedInsights = readInsightsFromCache();
    if (cachedInsights) {
      setInsights(cachedInsights);
    }

    if (now - lastInsightsRequestAtRef.current < INSIGHTS_REFRESH_MIN_MS) {
      return;
    }

    const requestPromise = (async () => {
      try {
      lastInsightsRequestAtRef.current = now;
      const today = getTodayLocalDateString();

      const [
        { data: statusRows, error: statusError },
        { data: pmRuns, error: pmRunsError },
        { data: hkRuns, error: hkRunsError },
        managerChecksRes,
        laundryReceivedRes,
      ] =
        await Promise.all([
          supabase
            .from('linen_room_status')
            .select('room_number')
            .eq('service_date', today)
            .in('status', ['CHECKOUT', 'STAYOVER']),
          supabase
            .from('pm_task_runs')
            .select('due_date, status, pm_tasks!inner(id, is_active)')
            .eq('pm_tasks.is_active', true)
            .neq('status', 'DONE'),
          supabase
            .from('hk_special_project_task_runs')
            .select('id, status, created_at')
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('manager_room_checks')
            .select('department, status'),
          supabase
            .from('linen_laundry_received')
            .select('block_no, updated_at')
            .eq('service_date', getYesterdayLocalDateString()),
        ]);

      if (statusError) throw statusError;
      if (pmRunsError) throw pmRunsError;
      if (hkRunsError) throw hkRunsError;

      const roomNumbers = Array.from(
        new Set(((statusRows || []) as Array<{ room_number: string }>).map((row) => row.room_number).filter(Boolean))
      );

      let savedRoomCount = 0;
      if (roomNumbers.length > 0) {
        const { data: entryRows, error: entryError } = await supabase
          .from('linen_room_entry')
          .select('room_number')
          .eq('service_date', today)
          .in('room_number', roomNumbers);

        if (entryError) throw entryError;

        savedRoomCount = new Set(
          ((entryRows || []) as Array<{ room_number: string }>).map((row) => row.room_number).filter(Boolean)
        ).size;
      }

      const roomPendingSave = Math.max(0, roomNumbers.length - savedRoomCount);

      const pickedRun =
        ((hkRuns || []) as Array<{ id: string; status: string; created_at?: string | null }>).find(
          (run) => run.status === 'OPEN' || run.status === 'OVERDUE'
        ) || ((hkRuns || []) as Array<{ id: string; status: string; created_at?: string | null }>)[0] || null;

      let specialProjectDoneRooms = 0;
      if (pickedRun?.id) {
        const { data: projectRows, error: projectRowsError } = await supabase
          .from('hk_special_project_task_run_rooms')
          .select('is_done')
          .eq('hk_special_project_task_run_id', pickedRun.id);

        if (projectRowsError) throw projectRowsError;

        specialProjectDoneRooms = ((projectRows || []) as Array<{ is_done: boolean }>).filter((row) => row.is_done).length;
      }

      const specialProjectCompletion = Math.max(
        0,
        Math.min(100, Math.round((specialProjectDoneRooms / 156) * 100))
      );

      const overduePm = ((pmRuns || []) as Array<{ due_date: string; status: string }>).filter((row) => {
        if (!row?.due_date) return false;
        return row.due_date < today && row.status !== 'DONE';
      }).length;

      let foChecklistSubmitted = 0;
      let foChecklistHasNoAnswer = false;
      let supervisorChecklistSubmitted = 0;
      let paChecklistSubmitted = 0;
      let fnbChecklistSubmitted = 0;
      const foChecklistDate = getFoChecklistServiceDateString();
      const { data: foTemplates, error: foTemplatesError } = await supabase
        .from('fo_checklist_templates')
        .select('id, title')
        .eq('is_active', true)
        .in('title', ['Morning Shift', 'Afternoon Shift', 'Night Shift']);

      if (!foTemplatesError) {
        const foTemplateIds = ((foTemplates || []) as Array<{ id: string; title: string }>)
          .map((template) => template.id)
          .filter(Boolean);

        if (foTemplateIds.length > 0) {
          const { data: foSubmissions, error: foSubmissionsError } = await supabase
            .from('fo_checklist_submissions')
            .select('id, template_id')
            .eq('submission_date', foChecklistDate)
            .in('template_id', foTemplateIds);

          if (!foSubmissionsError) {
            foChecklistSubmitted = new Set(
              ((foSubmissions || []) as Array<{ id: string; template_id: string }>)
                .map((submission) => submission.template_id)
                .filter(Boolean)
            ).size;

            const foSubmissionIds = ((foSubmissions || []) as Array<{ id: string; template_id: string }>)
              .map((submission) => submission.id)
              .filter(Boolean);

            if (foSubmissionIds.length > 0) {
              const { data: foNoAnswers, error: foNoAnswersError } = await supabase
                .from('fo_checklist_answers')
                .select('id')
                .in('submission_id', foSubmissionIds)
                .eq('answer_yes_no', false)
                .limit(1);

              if (!foNoAnswersError) {
                foChecklistHasNoAnswer = (foNoAnswers || []).length > 0;
              }
            }
          }
        }
      }

      const supervisorChecklistDate = getSupervisorChecklistServiceDateString();
      const { data: supervisorTemplates, error: supervisorTemplatesError } = await supabase
        .from('supervisor_checklist_templates')
        .select('id')
        .eq('is_active', true);

      if (!supervisorTemplatesError) {
        const supervisorTemplateIds = ((supervisorTemplates || []) as Array<{ id: string }>)
          .map((template) => template.id)
          .filter(Boolean);

        if (supervisorTemplateIds.length > 0) {
          const { data: supervisorSubmissions, error: supervisorSubmissionsError } = await supabase
            .from('supervisor_checklist_submissions')
            .select('submitted_by_email, template_id')
            .eq('submission_date', supervisorChecklistDate)
            .in('template_id', supervisorTemplateIds);

          if (!supervisorSubmissionsError) {
            supervisorChecklistSubmitted = new Set(
              ((supervisorSubmissions || []) as Array<{ submitted_by_email?: string | null }>)
                .map((submission) => String(submission.submitted_by_email || '').trim().toLowerCase())
                .filter((email) => HOUSEKEEPING_SUPERVISOR_EMAILS.includes(email))
            ).size;
          }
        }
      }

      const paChecklistDate = getSupervisorChecklistServiceDateString();
      const { data: paTemplates, error: paTemplatesError } = await supabase
        .from('pa_checklist_templates')
        .select('id')
        .eq('is_active', true);

      if (!paTemplatesError) {
        const paTemplateIds = ((paTemplates || []) as Array<{ id: string }>)
          .map((template) => template.id)
          .filter(Boolean);

        if (paTemplateIds.length > 0) {
          const { data: paSubmissions, error: paSubmissionsError } = await supabase
            .from('pa_checklist_submissions')
            .select('submitted_by_email, template_id')
            .eq('submission_date', paChecklistDate)
            .in('template_id', paTemplateIds);

          if (!paSubmissionsError) {
            const submittedEmails = new Set(
              ((paSubmissions || []) as Array<{ submitted_by_email?: string | null }>)
                .map((submission) => String(submission.submitted_by_email || '').trim().toLowerCase())
                .filter((email) => PA_CHECKLIST_SUBMITTER_EMAILS.includes(email))
            );
            paChecklistSubmitted = submittedEmails.size > 0 ? 1 : 0;
          }
        }
      }

      const fnbChecklistDate = getSupervisorChecklistServiceDateString();
      const { data: fnbTemplates, error: fnbTemplatesError } = await supabase
        .from('fnb_checklist_templates')
        .select('id')
        .eq('is_active', true);

      if (!fnbTemplatesError) {
        const fnbTemplateIds = ((fnbTemplates || []) as Array<{ id: string }>)
          .map((template) => template.id)
          .filter(Boolean);

        if (fnbTemplateIds.length > 0) {
          const { data: fnbSubmissions, error: fnbSubmissionsError } = await supabase
            .from('fnb_checklist_submissions')
            .select('submitted_by_email, template_id')
            .eq('submission_date', fnbChecklistDate)
            .in('template_id', fnbTemplateIds);

          if (!fnbSubmissionsError) {
            const submittedEmails = new Set(
              ((fnbSubmissions || []) as Array<{ submitted_by_email?: string | null }>)
                .map((submission) => String(submission.submitted_by_email || '').trim().toLowerCase())
                .filter((email) => FNB_CHECKLIST_SUBMITTER_EMAILS.includes(email))
            );
            fnbChecklistSubmitted = submittedEmails.size > 0 ? 1 : 0;
          }
        }
      }

      const managerRoomCheck = {
        HK: { completed: 0, total: 0 },
        MT: { completed: 0, total: 0 },
      };

      if (!managerChecksRes.error) {
        ((managerChecksRes.data || []) as Array<{ department: 'HK' | 'MT'; status: string }>).forEach((row) => {
          if (row.department !== 'HK' && row.department !== 'MT') return;
          managerRoomCheck[row.department].total += 1;
          if (row.status === 'DONE') {
            managerRoomCheck[row.department].completed += 1;
          }
        });
      }

      const laundryReceivedBlocks = laundryReceivedRes.error
        ? 0
        : new Set(
            ((laundryReceivedRes.data || []) as Array<{ block_no: number }>)
              .map((row) => row.block_no)
              .filter((blockNo) => blockNo === 1 || blockNo === 2)
          ).size;

      const nextInsights = {
        roomPendingSave,
        specialProjectCompletion,
        specialProjectDoneRooms,
        overduePm,
        foChecklistSubmitted: Math.max(0, Math.min(3, foChecklistSubmitted)),
        foChecklistHasNoAnswer,
        supervisorChecklistSubmitted: Math.max(0, Math.min(3, supervisorChecklistSubmitted)),
        paChecklistSubmitted: Math.max(0, Math.min(1, paChecklistSubmitted)),
        fnbChecklistSubmitted: Math.max(0, Math.min(1, fnbChecklistSubmitted)),
        managerRoomCheck,
        laundryReceivedBlocks,
        laundryReceivedSaved: laundryReceivedBlocks >= 2,
      };

      setInsights(nextInsights);
      saveInsightsToCache(nextInsights);
    } catch {
      // keep the current cards stable if an auxiliary metric fails
      } finally {
        insightsRequestInFlightRef.current = null;
      }
    })();

    insightsRequestInFlightRef.current = requestPromise;
    return requestPromise;
  }

  async function loadTasks(
    showLoader = false,
    options?: { silent?: boolean; onlyIfChanged?: boolean; force?: boolean }
  ) {
    const silent = options?.silent ?? false;
    const onlyIfChanged = options?.onlyIfChanged ?? false;
    const force = options?.force ?? false;
    const now = Date.now();

    if (tasksRequestInFlightRef.current) {
      return tasksRequestInFlightRef.current;
    }

    const minRefreshMs = silent ? SILENT_TASK_REFRESH_MIN_MS : MANUAL_TASK_REFRESH_MIN_MS;
    if (!force && now - lastTasksRequestAtRef.current < minRefreshMs) {
      return false;
    }

    const requestPromise = (async () => {
      try {
        lastTasksRequestAtRef.current = now;

      if (!silent) {
        if (showLoader) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
      }

      const json = await fetchJson('/api/tasks', {
        method: 'GET',
      }, 30000);

      const nextTasks: Task[] = (json.tasks || []).map((task: any) => ({
        ...task,
        status: task.status === 'DONE' ? 'DONE' : 'OPEN',
      }));
      const nextFingerprint = buildTasksFingerprint(nextTasks);

      if (onlyIfChanged && lastTasksFingerprintRef.current === nextFingerprint) {
        return false;
      }

      setTasks(nextTasks);
      lastTasksFingerprintRef.current = nextFingerprint;
      saveTasksToCache(nextTasks);
      setErrorMsg('');
      if (profile && now - lastInsightsRequestAtRef.current >= INSIGHTS_REFRESH_MIN_MS) {
        void loadDashboardInsights();
      }
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
        tasksRequestInFlightRef.current = null;
      }
    })();

    tasksRequestInFlightRef.current = requestPromise;
    return requestPromise;
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
      await loadTasks(true, { force: true });
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
      sessionStorage.removeItem(DASHBOARD_TASKS_CACHE_KEY);
      sessionStorage.removeItem(DASHBOARD_INSIGHTS_CACHE_KEY);

      window.location.replace('/dashboard');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Logout failed');
    }
  }

  function canCreateTask() {
    return !!profile?.can_create_task;
  }

  function canUpdateTaskStatus(_task?: Task) {
    if (!profile) return false;
    return !!profile.can_update_task_status;
  }

function canEditTaskDetails(task: Task) {
  if (!profile) return false;

  if (task.status !== 'OPEN') return false;
  return !!profile.can_edit_task;
}

function canDeleteTask() {
  return profile?.role === 'SUPERUSER';
}

  async function setTaskStatus(taskId: string, nextStatus: Task['status']) {
    if (!profile) {
      setLoginOpen(true);
      return;
    }

    const currentTask = tasks.find((task) => task.id === taskId);
    if (currentTask?.status === nextStatus) {
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

      await loadTasks(false, { force: true });
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

  function openDashboardCameraShortcut() {
    if (!canCreateTask()) {
      setLoginOpen(true);
      return;
    }

    dashboardCameraInputRef.current?.click();
  }

  async function handleDashboardCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    if (!files.length) return;

    try {
      setErrorMsg('');
      setCreateError('');

      const processed = await prepareDashboardMediaItems(files.slice(0, 1));

      createPhotos.forEach((item) => revokePreviewUrl(item.previewUrl));
      setCreateRoom('');
      setCreateDepts([]);
      setCreateTaskText('');
      setCreateCustomerWaiting(false);
      setCreateUrgent(false);
      setCreatePhotos(processed);
      setCreateModalOpen(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to open camera capture');
    }
  }

  function closeCreateModal() {
    if (createSubmitting) return;
    createPhotos.forEach((item) => revokePreviewUrl(item.previewUrl));
    setCreateModalOpen(false);
    setCreateRoom('');
    setCreateDepts([]);
    setCreateTaskText('');
    setCreatePhotos([]);
    setCreateCustomerWaiting(false);
    setCreateUrgent(false);
    setCreateError('');
  }

  function toggleCreateDept(dept: 'HK' | 'MT' | 'FO') {
    setCreateDepts((prev) =>
      prev.includes(dept) ? prev.filter((value) => value !== dept) : [...prev, dept]
    );
  }

  function openCreateCameraPicker() {
    if (createSubmitting) return;
    createCameraInputRef.current?.click();
  }

  function openCreateLibraryPicker() {
    if (createSubmitting) return;
    createLibraryInputRef.current?.click();
  }

  function openEditCameraPicker() {
    if (editSubmitting) return;
    editCameraInputRef.current?.click();
  }

  function openEditLibraryPicker() {
    if (editSubmitting) return;
    editLibraryInputRef.current?.click();
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

    editNewPhotos.forEach((item) => revokePreviewUrl(item.previewUrl));
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

      if (createPhotos.length + files.length > MAX_DASHBOARD_TASK_MEDIA) {
        throw new Error(`Maximum ${MAX_DASHBOARD_TASK_MEDIA} photos or videos per task`);
      }

      const processed = await prepareDashboardMediaItems(files);

      setCreatePhotos((prev) => [...prev, ...processed]);
      e.target.value = '';
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to process media');
    }
  }

  function removeCreatePhoto(id: string) {
    setCreatePhotos((prev) => {
      const removed = prev.find((item) => item.id === id);
      revokePreviewUrl(removed?.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }

  function openMediaMarkup(mode: 'create' | 'edit', id: string) {
    const item =
      mode === 'create'
        ? createPhotos.find((entry) => entry.id === id)
        : editNewPhotos.find((entry) => entry.id === id);

    if (!item || item.mediaType !== 'image') return;
    setMarkupTarget({ mode, id });
  }

  function closeMediaMarkup() {
    setMarkupTarget(null);
    markupDrawingRef.current = false;
    markupLastPointRef.current = null;
  }

  function markupPointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = markupCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startMarkupDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = markupPointerPosition(event);
    if (!point) return;
    markupDrawingRef.current = true;
    markupLastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drawMarkup(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!markupDrawingRef.current) return;

    const canvas = markupCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = markupPointerPosition(event);
    const last = markupLastPointRef.current;

    if (!canvas || !ctx || !point || !last) return;

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(4, canvas.width / 160);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    markupLastPointRef.current = point;
  }

  function stopMarkupDrawing() {
    markupDrawingRef.current = false;
    markupLastPointRef.current = null;
  }

  async function saveMediaMarkup() {
    if (!markupTarget) return;

    const canvas = markupCanvasRef.current;
    if (!canvas) return;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    );
    if (!blob) return;

    const item =
      markupTarget.mode === 'create'
        ? createPhotos.find((entry) => entry.id === markupTarget.id)
        : editNewPhotos.find((entry) => entry.id === markupTarget.id);

    if (!item) return;

    const file = new File([blob], item.name.replace(/\.[^.]+$/, '.jpg') || 'marked-up-image.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(file);

    if (markupTarget.mode === 'create') {
      setCreatePhotos((prev) =>
        prev.map((entry) => {
          if (entry.id !== markupTarget.id) return entry;
          revokePreviewUrl(entry.previewUrl);
          return {
            ...entry,
            name: file.name,
            previewUrl,
            file,
            mediaType: 'image',
            marked: true,
          };
        })
      );
    } else {
      setEditNewPhotos((prev) =>
        prev.map((entry) => {
          if (entry.id !== markupTarget.id) return entry;
          revokePreviewUrl(entry.previewUrl);
          return {
            ...entry,
            name: file.name,
            previewUrl,
            file,
            mediaType: 'image',
            marked: true,
          };
        })
      );
    }

    closeMediaMarkup();
  }

  function getMarkupTargetItem() {
    if (!markupTarget) return null;
    return markupTarget.mode === 'create'
      ? createPhotos.find((entry) => entry.id === markupTarget.id) || null
      : editNewPhotos.find((entry) => entry.id === markupTarget.id) || null;
  }

  async function uploadMediaItems(items: CreatePhotoItem[]) {
    if (!items.length) return { urls: [] as string[], captions: [] as (string | null)[] };

    const token = await getAccessToken();
    const form = new FormData();

    items.forEach((item) => {
      const fileName = item.name || 'task-image.jpg';
      form.append('media', item.file, fileName);
    });

    const uploadJson = await fetchJson(
      '/api/upload',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      },
      90000
    );

    const uploaded = uploadJson.items || [];

    return {
      urls: uploaded.map((item: any) => item.url),
      captions: uploaded.map(() => null),
    };
  }

  async function createTaskInBackground(params: {
    room: string;
    departments: Array<'HK' | 'MT' | 'FO'>;
    taskText: string;
    customerWaiting: boolean;
    urgent: boolean;
    mediaItems: CreatePhotoItem[];
    shouldRefreshAfterMedia: boolean;
  }) {
    try {
      setErrorMsg('');
      const token = await getAccessToken();

      if (params.mediaItems.length > 0) {
        setMediaUploadNotice({
          status: 'uploading',
          count: params.mediaItems.length,
          message: `Uploading ${params.mediaItems.length} media item${params.mediaItems.length === 1 ? '' : 's'}... keep this page open.`,
        });

        const form = new FormData();
        form.set('room', params.room);
        form.set('department', params.departments[0]);
        form.set('departments_json', JSON.stringify(params.departments));
        form.set('task_text', params.taskText);
        form.set('source_message', '');
        form.set('customer_waiting', params.customerWaiting ? 'true' : 'false');
        form.set('urgent', params.urgent ? 'true' : 'false');

        params.mediaItems.forEach((item) => {
          form.append('media', item.file, item.name || 'task-media');
        });

        await fetchJson(
          '/api/tasks',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: form,
          },
          120000
        );

        setMediaUploadNotice({
          status: 'done',
          count: params.mediaItems.length,
          message: `Upload completed. ${params.mediaItems.length} media item${params.mediaItems.length === 1 ? '' : 's'} saved.`,
        });

        setTimeout(() => {
          setMediaUploadNotice((current) =>
            current?.status === 'done' ? null : current
          );
        }, 1800);
      } else {
        await fetchJson(
          '/api/tasks',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              room: params.room,
              department: params.departments[0],
              departments: params.departments,
              task_text: params.taskText,
              source_message: null,
              image_urls: [],
              image_captions: [],
              customer_waiting: params.customerWaiting,
              urgent: params.urgent,
            }),
          },
          30000
        );
      }

      await loadTasks(false, { force: true });
    } catch (err: any) {
      if (params.mediaItems.length > 0) {
        setMediaUploadNotice({
          status: 'error',
          count: params.mediaItems.length,
          message: err?.message || 'Media upload failed. Please keep the page open and try again.',
        });
      }
      setErrorMsg(err?.message || 'Task creation or media upload failed');
    }
  }
async function handleDeleteTask(task: Task) {
  try {
    if (!profile || profile.role !== 'SUPERUSER') {
      alert('Unauthorized');
      return;
    }

    const confirmDelete = confirm(
      managerRoomCheckHref(task)
        ? 'Delete this task and its linked Manager Room Check permanently?'
        : 'Delete this task permanently?'
    );
    if (!confirmDelete) return;

    setBusyTaskId(task.id);

    const token = await getAccessToken();

    await fetchJson(
      `/api/tasks/${task.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      45000
    );

    setTasks((prev) => {
      const next = prev.filter((item) => item.id !== task.id);
      saveTasksToCache(next);
      lastTasksFingerprintRef.current = buildTasksFingerprint(next);
      return next;
    });

    await loadTasks(false, { force: true });
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

      if (remainingExisting.length + editNewPhotos.length + files.length > MAX_DASHBOARD_TASK_MEDIA) {
        throw new Error(`Maximum ${MAX_DASHBOARD_TASK_MEDIA} photos or videos per task`);
      }

      const processed = await prepareDashboardMediaItems(files);

      setEditNewPhotos((prev) => [...prev, ...processed]);
      e.target.value = '';
    } catch (err: any) {
      setEditError(err?.message || 'Failed to process media');
    }
  }

  function removeEditExistingImage(id: string | number) {
    setEditRemovedImageIds((prev) => [...prev, id]);
  }

  function undoRemoveEditExistingImage(id: string | number) {
    setEditRemovedImageIds((prev) => prev.filter((x) => x !== id));
  }

  function removeEditNewPhoto(id: string) {
    setEditNewPhotos((prev) => {
      const removed = prev.find((item) => item.id === id);
      revokePreviewUrl(removed?.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
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
      const departments = createDepts;

      if (!room) throw new Error('Room/area and description is required');
      if (room.length > 80) throw new Error('Room/area and description must be 80 characters or less');
      if (!departments.length) throw new Error('Select at least one department');

      if (room !== createRoom) setCreateRoom(room);

      const mediaToUpload = createPhotos.map((item) => ({ ...item }));
      const shouldRefreshAfterMedia = mediaToUpload.length > 0;

      setCreateSubmitting(true);

      createPhotos.forEach((item) => revokePreviewUrl(item.previewUrl));
      setCreateModalOpen(false);
      setCreateRoom('');
      setCreateDepts([]);
      setCreateTaskText('');
      setCreatePhotos([]);
      setCreateCustomerWaiting(false);
      setCreateUrgent(false);
      setCreateError('');
      setCreateSubmitting(false);

      void createTaskInBackground({
        room,
        departments,
        taskText: taskText || room,
        customerWaiting: createCustomerWaiting,
        urgent: createUrgent,
        mediaItems: mediaToUpload,
        shouldRefreshAfterMedia,
      });
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
      if (!room) throw new Error('Room/area and description is required');
      if (room.length > 80) throw new Error('Room/area and description must be 80 characters or less');
      if (!editDept) throw new Error('Select department');

      setEditSubmitting(true);

      let uploadedUrls: string[] = [];
      let uploadedCaptions: (string | null)[] = [];

      if (editNewPhotos.length > 0) {
        setMediaUploadNotice({
          status: 'uploading',
          count: editNewPhotos.length,
          message: `Uploading ${editNewPhotos.length} new media item${editNewPhotos.length === 1 ? '' : 's'}... keep this page open.`,
        });

        const uploaded = await uploadMediaItems(editNewPhotos);
        uploadedUrls = uploaded.urls;
        uploadedCaptions = uploaded.captions;

        setMediaUploadNotice({
          status: 'done',
          count: editNewPhotos.length,
          message: `Upload completed. ${editNewPhotos.length} new media item${editNewPhotos.length === 1 ? '' : 's'} saved.`,
        });

        setTimeout(() => {
          setMediaUploadNotice((current) =>
            current?.status === 'done' ? null : current
          );
        }, 1800);
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
            task_text: taskText || room,
            keep_image_ids: editExistingImages
              .filter((img) => !editRemovedImageIds.includes(img.id))
              .map((img) => img.id),
            new_image_urls: uploadedUrls,
            new_image_captions: uploadedCaptions,
          }),
        },
        45000
      );

      closeEditModal();
      await loadTasks(false, { force: true });
    } catch (err: any) {
      if (editNewPhotos.length > 0) {
        setMediaUploadNotice({
          status: 'error',
          count: editNewPhotos.length,
          message: err?.message || 'Media upload failed. Please keep the page open and try again.',
        });
      }
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
  const taskRenderLimit = isMobile ? MAX_RENDERED_TASK_CARDS_MOBILE : MAX_RENDERED_TASK_CARDS;
  const visibleTasks = filtered.slice(0, taskRenderLimit);
  const hiddenTaskCount = Math.max(0, filtered.length - visibleTasks.length);

  const summary = useMemo(() => {
    return {
      open: tasks.filter((t) => t.status === 'OPEN').length,
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

  const guestWaitingTasks = useMemo(() => {
    return tasks
      .filter((task) => task.customer_waiting === true && task.status !== 'DONE')
      .sort((a, b) => {
        const aTime = new Date(a.created_at || '').getTime();
        const bTime = new Date(b.created_at || '').getTime();
        return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
      });
  }, [tasks]);

  const overdueUrgentTasks = useMemo(() => {
    return tasks
      .filter((task) => (
        task.urgent === true
        && task.status !== 'DONE'
        && urgentTaskDueAtMs(task) <= timerNow
      ))
      .sort((a, b) => urgentTaskDueAtMs(a) - urgentTaskDueAtMs(b));
  }, [tasks, timerNow]);

  const laundryReceivedNote = insights.laundryReceivedSaved
    ? 'Saved for both blocks'
    : `${insights.laundryReceivedBlocks}/2 blocks saved`;

  const pageTitle =
    sidebarView === 'DASHBOARD' ? 'Operations Dashboard' : 'Past Task Archive';

  const pageSubtitle =
    sidebarView === 'DASHBOARD'
      ? ''
      : 'Browse previously completed tasks by completed date';

  const taskMainRowStyle: React.CSSProperties = styles.taskMainRow;
  const showInitialDashboardLoader =
    (authLoading && !profile) ||
    (!!profile && sidebarView === 'DASHBOARD' && loading && tasks.length === 0);

  return (
    <main style={styles.page}>
      <style>{`
        @keyframes dashboardUrgentAttentionFlash {
          0%, 100% { border-color: #ef4444; background: #fff7f7; box-shadow: 0 12px 30px rgba(185, 28, 28, 0.14); }
          50% { border-color: #991b1b; background: #fecaca; box-shadow: 0 14px 36px rgba(185, 28, 28, 0.30), 0 0 0 4px rgba(239, 68, 68, 0.16); }
        }
        .dashboard-overdue-urgent-panel { animation: dashboardUrgentAttentionFlash 0.9s step-end infinite; }
        @media (prefers-reduced-motion: reduce) {
          .dashboard-overdue-urgent-panel { animation: none; background: #fee2e2 !important; }
        }
      `}</style>
      <section style={styles.content}>
          <div style={styles.headerCard}>
            <div
              style={{
                ...styles.brandBand,
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'stretch' : styles.brandBand.alignItems,
              }}
            >
              <div
                style={{
                  ...styles.brandCenter,
                  justifyContent: isMobile ? 'flex-start' : 'center',
                }}
              >
                <div
                  style={{
                    ...styles.logoWrap,
                    width: isMobile ? 46 : styles.logoWrap.width,
                    height: isMobile ? 46 : styles.logoWrap.height,
                  }}
                >
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
                </div>
              </div>
              <div
                style={{
                  ...styles.brandActions,
                  width: isMobile ? '100%' : undefined,
                  ...(isMobile
                    ? {
                        display: 'grid',
                        gridTemplateColumns:
                          sidebarView === 'DASHBOARD' ? '44px 44px minmax(0, 1fr)' : 'minmax(0, 1fr)',
                        gap: 8,
                      }
                    : { justifyContent: 'flex-end' }),
                }}
              >
                <button
                  onClick={() => loadTasks(false, { force: true })}
                  style={{
                    ...styles.headerGhostBtn,
                    ...(isMobile ? styles.mobileHeaderIconBtn : {}),
                  }}
                  disabled={refreshing || loading}
                  title="Refresh tasks"
                  aria-label="Refresh tasks"
                >
                  <span style={styles.headerGhostIcon}>
                    <DashboardIcon name="refresh" size={17} />
                  </span>
                  <span style={{ ...styles.headerGhostLabel, display: isMobile ? 'none' : 'inline' }}>Refresh</span>
                </button>
                {sidebarView === 'DASHBOARD' ? (
                  <>
                    <input
                      ref={dashboardCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleDashboardCameraCapture}
                      style={styles.hiddenFileInput}
                      aria-hidden="true"
                      tabIndex={-1}
                    />
                    <button
                      onClick={openDashboardCameraShortcut}
                      style={{
                        ...styles.headerGhostBtn,
                        ...(isMobile ? styles.mobileHeaderIconBtn : {}),
                      }}
                      aria-label="Take photo and create task"
                      title="Take photo and create task"
                    >
                      <span style={styles.headerGhostIcon}>
                        <DashboardIcon name="camera" size={17} />
                      </span>
                      <span style={{ ...styles.headerGhostLabel, display: isMobile ? 'none' : 'inline' }}>Camera</span>
                    </button>
                    <button
                      onClick={openCreateModal}
                      style={{
                        ...styles.addTaskBtn,
                        ...(isMobile ? styles.mobileHeaderPrimaryBtn : {}),
                      }}
                      aria-label="Create task"
                      title="Create new task"
                    >
                      <span style={styles.addTaskBtnIcon}>
                        <DashboardIcon name="plus" size={17} />
                      </span>
                      <span style={styles.addTaskBtnText}>Create Task</span>
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {envError ? <div style={styles.errorBox}>{envError}</div> : null}
          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

          {mediaUploadNotice ? (
            <div
              style={{
                ...styles.mediaUploadNotice,
                ...(mediaUploadNotice.status === 'done' ? styles.mediaUploadNoticeDone : {}),
                ...(mediaUploadNotice.status === 'error' ? styles.mediaUploadNoticeError : {}),
              }}
              role={mediaUploadNotice.status === 'error' ? 'alert' : 'status'}
            >
              <div
                style={{
                  ...styles.mediaUploadPulse,
                  ...(mediaUploadNotice.status === 'done' ? styles.mediaUploadPulseDone : {}),
                  ...(mediaUploadNotice.status === 'error' ? styles.mediaUploadPulseError : {}),
                }}
              >
                {mediaUploadNotice.status === 'done' ? (
                  <DashboardIcon name="check" size={17} />
                ) : mediaUploadNotice.status === 'error' ? (
                  <DashboardIcon name="alert" size={17} />
                ) : (
                  <DashboardIcon name="upload" size={17} />
                )}
              </div>
              <div style={styles.mediaUploadNoticeText}>
                <div style={styles.mediaUploadNoticeTitle}>
                  {mediaUploadNotice.status === 'uploading'
                    ? 'Media upload in progress'
                    : mediaUploadNotice.status === 'done'
                      ? 'Media upload complete'
                      : 'Media upload failed'}
                </div>
                <div style={styles.mediaUploadNoticeMessage}>
                  {mediaUploadNotice.message}
                </div>
              </div>
            </div>
          ) : null}

          {showInitialDashboardLoader ? (
            <DashboardBootLoader />
          ) : !profile ? (
            <div style={styles.emptyState}>
              Please log in from the sidebar to use the dashboard.
            </div>
          ) : (
            <>
              {sidebarView === 'DASHBOARD' && overdueUrgentTasks.length > 0 ? (
                <section
                  className="dashboard-overdue-urgent-panel"
                  style={styles.urgentAttentionPanel}
                  aria-live="assertive"
                >
                  <div style={styles.urgentAttentionHeader}>
                    <div>
                      <div style={styles.urgentAttentionEyebrow}>Urgent · Target time passed</div>
                      <div style={styles.urgentAttentionTitle}>Immediate follow-up required</div>
                    </div>
                    <div style={styles.urgentAttentionCount}>{overdueUrgentTasks.length}</div>
                  </div>
                  <div style={styles.urgentAttentionList}>
                    {overdueUrgentTasks.slice(0, isMobile ? 3 : 6).map((task) => {
                      const overdueBy = Math.max(60 * 1000, timerNow - urgentTaskDueAtMs(task));
                      return (
                        <article key={`urgent-attention-${task.id}`} style={styles.urgentAttentionItem}>
                          <div style={styles.urgentAttentionTopRow}>
                            <span style={styles.urgentAttentionRoom}>{task.room || '-'}</span>
                            <span style={styles.urgentAttentionDepartment}>{task.department}</span>
                            <strong style={styles.urgentAttentionTimer}>
                              Overdue {formatDurationFromMs(overdueBy)}
                            </strong>
                          </div>
                          <div style={styles.urgentAttentionTask}>{task.task_text}</div>
                          <div style={styles.urgentAttentionFooter}>
                            <span>{task.task_code}</span>
                            {(profile.role === 'SUPERUSER' || profile.can_update_task_status) ? (
                              <button
                                type="button"
                                style={styles.urgentAttentionDoneButton}
                                disabled={busyTaskId === task.id}
                                onClick={() => void setTaskStatus(task.id, 'DONE')}
                              >
                                {busyTaskId === task.id ? 'Saving…' : 'Mark as Done'}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {sidebarView === 'DASHBOARD' ? (
                <section style={styles.guestWaitingPanel}>
                  <div style={styles.guestWaitingHeader}>
                    <div>
                      <div style={styles.guestWaitingEyebrow}>Guest Waiting</div>
                      <div style={styles.guestWaitingTitle}>Needs attention now</div>
                    </div>
                    <div style={styles.guestWaitingCount}>{guestWaitingTasks.length}</div>
                  </div>

                  {guestWaitingTasks.length === 0 ? (
                    <div style={styles.guestWaitingEmpty}>
                      No guest-waiting tasks right now.
                    </div>
                  ) : (
                    <div style={styles.guestWaitingList}>
                      {guestWaitingTasks.slice(0, isMobile ? 4 : 6).map((task) => (
                        <article key={`waiting-${task.id}`} style={styles.guestWaitingItem}>
                          <div style={styles.guestWaitingRoom}>{task.room || '-'}</div>
                          <div style={styles.guestWaitingBody}>
                            <div style={styles.guestWaitingTask}>{task.task_text}</div>
                            <div style={styles.guestWaitingMeta}>
                              <span style={deptBadgeStyle(task.department)}>{task.department}</span>
                              <span>{task.created_by_name || task.created_by_email || 'Created task'}</span>
                            </div>
                          </div>
                          <div style={styles.guestWaitingTimer}>
                            {formatWaitingDuration(task.created_at, timerNow)}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {sidebarView === 'DASHBOARD' ? (
                <section style={styles.overviewSectionStack}>
                  <div style={styles.overviewBand}>
                    <div style={styles.overviewBandHeader}>
                      <div>
                        <div style={styles.overviewBandEyebrow}>Front Office</div>
                        <div style={styles.overviewBandTitle}>FO Daily Control</div>
                      </div>
                    </div>
                    <div
                      style={{
                        ...styles.overviewBandGrid,
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      }}
                    >
                      <OverviewMetricCard href="/dashboard?status=open" title="Open Tasks" value={summary.open} note="Needs attention" tone="open" icon="clipboard" />
                      <OverviewMetricCard href="/dashboard?status=done" title="Done Today" value={summary.doneToday} note="Completed today" tone="done" icon="check" />
                      <OverviewMetricCard
                        href="/dashboard/fo-checklist"
                        title="FO Checklist"
                        value={`${insights.foChecklistSubmitted}/3`}
                        note="Morning, Afternoon, Night submitted"
                        tone="violet"
                        icon="clipboard"
                        alert={insights.foChecklistHasNoAnswer}
                      />
                    </div>
                  </div>

                  <div style={styles.overviewBand}>
                    <div style={styles.overviewBandHeader}>
                      <div>
                        <div style={styles.overviewBandEyebrow}>Housekeeping</div>
                        <div style={styles.overviewBandTitle}>Room Operations</div>
                      </div>
                    </div>
                    <div
                      style={{
                        ...styles.overviewBandGrid,
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      }}
                    >
                      <OverviewMetricCard
                        href="/dashboard/chambermaid-entry"
                        title="Room Pending Save"
                        value={insights.roomPendingSave}
                        note="Chambermaid entries not saved"
                        tone="violet"
                        icon="door"
                      />
                      <OverviewMetricCard
                        href="/dashboard/hk-special-project"
                        title="Special Project Completion"
                        value={`${insights.specialProjectCompletion}%`}
                        note={`${insights.specialProjectDoneRooms}/156 rooms completed`}
                        tone="progress"
                        icon="progress"
                      />
                      <OverviewMetricCard
                        href="/dashboard/hk-manager-room-check"
                        title="Housekeeping Room Check"
                        value={`${insights.managerRoomCheck.HK.completed}/${insights.managerRoomCheck.HK.total}`}
                        note={`${Math.max(0, insights.managerRoomCheck.HK.total - insights.managerRoomCheck.HK.completed)} open`}
                        tone={insights.managerRoomCheck.HK.total > 0 && insights.managerRoomCheck.HK.completed >= insights.managerRoomCheck.HK.total ? 'done' : 'violet'}
                        icon="housekeeping"
                      />
                    </div>
                  </div>

                  <div style={styles.overviewBand}>
                    <div style={styles.overviewBandHeader}>
                      <div>
                        <div style={styles.overviewBandEyebrow}>Housekeeping</div>
                        <div style={styles.overviewBandTitle}>Supervisor, PA & Linen</div>
                      </div>
                    </div>
                    <div
                      style={{
                        ...styles.overviewBandGrid,
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      }}
                    >
                      <OverviewMetricCard
                        href="/dashboard/supervisor-checklist"
                        title="Supervisor Checklist"
                        value={`${insights.supervisorChecklistSubmitted}/3`}
                        note="Housekeeping supervisors submitted"
                        tone={insights.supervisorChecklistSubmitted >= 3 ? 'done' : 'violet'}
                        icon="housekeeping"
                        alert={insights.supervisorChecklistSubmitted < 3}
                      />
                      <OverviewMetricCard
                        href="/dashboard/pa-checklist"
                        title="PA Checklist"
                        value={`${insights.paChecklistSubmitted}/1`}
                        note="Public Area submitted"
                        tone={insights.paChecklistSubmitted >= 1 ? 'done' : 'violet'}
                        icon="clipboard"
                        alert={insights.paChecklistSubmitted < 1}
                      />
                      <OverviewMetricCard
                        href="/dashboard/laundry-count"
                        title="Laundry Received"
                        value={insights.laundryReceivedSaved ? 'Saved' : 'Not saved'}
                        note={laundryReceivedNote}
                        tone={insights.laundryReceivedSaved ? 'done' : 'progress'}
                        icon={insights.laundryReceivedSaved ? 'laundry' : 'alert'}
                        alert={!insights.laundryReceivedSaved}
                      />
                    </div>
                  </div>

                  <div style={styles.overviewBand}>
                    <div style={styles.overviewBandHeader}>
                      <div>
                        <div style={styles.overviewBandEyebrow}>Others</div>
                        <div style={styles.overviewBandTitle}>Maintenance & F&B</div>
                      </div>
                    </div>
                    <div
                      style={{
                        ...styles.overviewBandGrid,
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      }}
                    >
                      <OverviewMetricCard
                        href="/dashboard/maintenance-manager-room-check"
                        title="Maintenance Room Check"
                        value={`${insights.managerRoomCheck.MT.completed}/${insights.managerRoomCheck.MT.total}`}
                        note={`${Math.max(0, insights.managerRoomCheck.MT.total - insights.managerRoomCheck.MT.completed)} open`}
                        tone={insights.managerRoomCheck.MT.total > 0 && insights.managerRoomCheck.MT.completed >= insights.managerRoomCheck.MT.total ? 'done' : 'open'}
                        icon="maintenance"
                      />
                      <OverviewMetricCard
                        href="/dashboard/preventive-maintenance"
                        title="Overdue PM"
                        value={insights.overduePm}
                        note="Preventive maintenance overdue"
                        tone="danger"
                        icon="alert"
                      />
                      <OverviewMetricCard
                        href="/dashboard/fnb-checklist"
                        title="F&B Checklist"
                        value={`${insights.fnbChecklistSubmitted}/1`}
                        note="F&B submitted"
                        tone={insights.fnbChecklistSubmitted >= 1 ? 'done' : 'violet'}
                        icon="clipboard"
                        alert={insights.fnbChecklistSubmitted < 1}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              <section style={styles.filterPanel}>
                <div style={styles.filterHeader}>
                  <div style={styles.filterHeaderText}>
                    <div style={styles.filterPanelTitle}>
                      {sidebarView === 'DASHBOARD' ? 'Task Filters' : 'Archive Filters'}
                    </div>
                    <div style={styles.filterPanelSubtitle}>
                      {sidebarView === 'DASHBOARD'
                        ? 'Filter the task list below'
                        : 'Search older completed tasks by department and date'}
                    </div>
                  </div>

                  <div style={styles.filterHeaderButtons}>
                    <button
                      onClick={() => loadTasks(false, { force: true })}
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

                <div style={styles.filterControlsGrid}>
                  <div style={styles.filterBlock}>
                    <div style={styles.filterLabelRow}>
                      <div style={styles.filterLabel}>Department</div>
                      <div style={styles.filterHint}>{dept === 'ALL' ? 'All teams' : `${dept} only`}</div>
                    </div>
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
                      <div style={styles.filterLabelRow}>
                        <div style={styles.filterLabel}>Status</div>
                        <div style={styles.filterHint}>{labelForStatus(status)}</div>
                      </div>
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
                      <div style={styles.filterLabelRow}>
                        <div style={styles.filterLabel}>Completed Date</div>
                        <div style={styles.filterHint}>Archive</div>
                      </div>
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
                </div>
              </section>

              <div
                style={{
                  ...styles.workspaceLayout,
                  gridTemplateColumns: 'minmax(0, 1fr)',
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
                  {visibleTasks.map((task, taskIndex) => {
                    const mediaItems = Array.isArray(task.task_images) ? task.task_images : [];
                    const roomCheckHref = managerRoomCheckHref(task);
                    const thumb =
                      mediaItems.length > 0
                        ? mediaItems[mediaItems.length - 1].image_url
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
                                  {task.customer_waiting ? (
                                    <div style={styles.customerWaitingBadge}>
                                      Customer waiting
                                    </div>
                                  ) : null}
                                  {task.urgent ? (
                                    <div style={styles.urgentTaskBadge}>
                                      Urgent
                                    </div>
                                  ) : null}
                                  {!roomCheckHref && canEditTaskDetails(task) ? (
                                    <button
                                      type="button"
                                      style={styles.cardEditTaskBtn}
                                      disabled={busyTaskId === task.id}
                                      onClick={() => openEditModal(task)}
                                    >
                                      Edit details
                                    </button>
                                  ) : null}
                                </div>

                                <div style={styles.roomLine}>
                                  <span style={styles.roomText}>Location</span>
                                  <span style={styles.roomNo}>{task.room}</span>
                                  <span style={styles.dot}>•</span>
                                  <span style={deptBadgeStyle(task.department)}>
                                    {task.department}
                                  </span>
                                  {roomCheckHref ? (
                                    <Link href={roomCheckHref} style={styles.roomCheckLink}>
                                      View Room Check
                                    </Link>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div style={styles.taskText}>{task.task_text}</div>

                            {(task.urgent || task.customer_waiting) ? (
                              <div style={styles.taskAcknowledgementBox}>
                                <b>Acknowledgements</b>
                                {(task.acknowledgements || []).filter((row) => (
                                  Number(row.alert_cycle || 1) === Number(task.alert_cycle || 1)
                                )).length ? (
                                  <div style={styles.taskAcknowledgementList}>
                                    {(task.acknowledgements || []).filter((row) => (
                                      Number(row.alert_cycle || 1) === Number(task.alert_cycle || 1)
                                    )).map((row) => (
                                      <span key={`${row.user_name}-${row.acknowledged_at}`}>
                                        {row.user_name} · {new Date(row.acknowledged_at).toLocaleString()}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span style={styles.taskAcknowledgementPending}>Waiting for acknowledgement</span>}
                              </div>
                            ) : null}

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
                                {task.status === 'OPEN' || canDeleteTask() ? (
                                  <div style={styles.buttonRow}>
                                    {task.status === 'OPEN' ? (
                                    <button
                                      style={styles.markDoneBtn}
                                      disabled={busyTaskId === task.id || !canUpdateTaskStatus(task)}
                                      onClick={() => setTaskStatus(task.id, 'DONE')}
                                    >
                                      Mark As Done
                                    </button>
                                    ) : null}
                                    {canDeleteTask() ? (
                                      <button
                                        style={styles.deleteTaskBtn}
                                        disabled={busyTaskId === task.id}
                                        onClick={() => handleDeleteTask(task)}
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}

                                {task.status === 'OPEN' && !canUpdateTaskStatus(task) ? (
                                  <div style={styles.permissionText}>
                                    You do not have permission to update this task status.
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

                          {thumb && taskIndex < MAX_RENDERED_TASK_THUMBNAILS ? (
                            <div style={styles.thumbWrap}>
                              <button
                                onClick={() => openImageModal(task)}
                                style={styles.thumbButton}
                                title="Open task media"
                              >
                                {isVideoUrl(thumb) ? (
                                  <video
                                    src={thumb}
                                    muted
                                    playsInline
                                    preload="metadata"
                                    style={styles.thumbImage}
                                  />
                                ) : (
                                  <img
                                    src={thumb}
                                    alt="Task thumbnail"
                                    loading="lazy"
                                    decoding="async"
                                    style={styles.thumbImage}
                                  />
                                )}
                              </button>

                              <div style={styles.imageCountBadge}>
                                {mediaItems.length > 0 ? `${mediaItems.length} media` : '1 media'}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                  {hiddenTaskCount > 0 ? (
                    <div style={styles.renderLimitNotice}>
                      Showing first {taskRenderLimit} tasks. Use filters to narrow the list.
                    </div>
                  ) : null}
                </div>
              )}
                </div>
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
              {isVideoUrl(selectedTaskImages[selectedImageIndex].image_url) ? (
                <video
                  src={selectedTaskImages[selectedImageIndex].image_url}
                  controls
                  playsInline
                  style={styles.modalImage}
                />
              ) : (
                <img
                  src={selectedTaskImages[selectedImageIndex].image_url}
                  alt={`Task media ${selectedImageIndex + 1}`}
                  decoding="async"
                  style={styles.modalImage}
                />
              )}

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

      {markupTarget && getMarkupTargetItem() ? (
        <div style={styles.markupModalOverlay} onClick={closeMediaMarkup}>
          <div style={styles.markupCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Mark Up Image</div>
                <div style={styles.createModalSubtitle}>
                  Draw directly on the image, then save it back to this task.
                </div>
              </div>
              <button
                type="button"
                onClick={closeMediaMarkup}
                style={styles.createModalCloseBtn}
                aria-label="Close markup"
              >
                x
              </button>
            </div>

            <div style={styles.markupCanvasWrap}>
              <canvas
                ref={markupCanvasRef}
                style={styles.markupCanvas}
                onPointerDown={startMarkupDrawing}
                onPointerMove={drawMarkup}
                onPointerUp={stopMarkupDrawing}
                onPointerLeave={stopMarkupDrawing}
              />
            </div>

            <div style={styles.createModalActions}>
              <button
                type="button"
                onClick={closeMediaMarkup}
                style={styles.secondaryBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveMediaMarkup()}
                style={styles.primaryBtn}
              >
                Save Markup
              </button>
            </div>
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
              <label style={styles.formLabel}>Room/Area & Description</label>
              <input
                type="text"
                value={createRoom}
                onChange={(e) => setCreateRoom(e.target.value)}
                style={modalResponsive.textInput}
                placeholder="e.g. 1308 AC leaking, Corridor lights, Carpark"
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
              <label style={styles.formLabel}>Additional Task Caption/Description</label>
              <textarea
                value={createTaskText}
                onChange={(e) => setCreateTaskText(e.target.value)}
                style={modalResponsive.textArea}
                placeholder="Optional extra details for dashboard and Telegram"
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Response priority</label>
              <div style={styles.priorityChoiceGrid}>
                <button
                  type="button"
                  disabled={createSubmitting}
                  aria-pressed={createCustomerWaiting}
                  onClick={() => {
                    const next = !createCustomerWaiting;
                    setCreateCustomerWaiting(next);
                    if (next) setCreateUrgent(false);
                  }}
                  style={{
                    ...styles.priorityChoiceButton,
                    ...(createCustomerWaiting ? styles.customerWaitingChoiceActive : {}),
                  }}
                >
                  <strong>10m</strong>
                  <span><b>Customer waiting</b><small>Show an immediate popup to the assigned team</small></span>
                </button>
                <button
                  type="button"
                  disabled={createSubmitting}
                  aria-pressed={createUrgent}
                  onClick={() => {
                    const next = !createUrgent;
                    setCreateUrgent(next);
                    if (next) setCreateCustomerWaiting(false);
                  }}
                  style={{
                    ...styles.priorityChoiceButton,
                    ...styles.urgentChoiceButton,
                    ...(createUrgent ? styles.urgentChoiceActive : {}),
                  }}
                >
                  <strong>5m</strong>
                  <span><b>Urgent</b><small>Require immediate acknowledgement</small></span>
                </button>
              </div>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Photos / Videos</label>
              <input
                ref={createCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCreatePhotoChange}
                disabled={createSubmitting}
                style={styles.hiddenFileInput}
                aria-hidden="true"
                tabIndex={-1}
              />
              <input
                ref={createLibraryInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleCreatePhotoChange}
                disabled={createSubmitting}
                style={styles.hiddenFileInput}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div style={styles.createMediaPickerPanel}>
                <button
                  type="button"
                  onClick={openCreateCameraPicker}
                  disabled={createSubmitting}
                  style={styles.createMediaPickerPrimary}
                >
                  <span style={styles.createMediaPickerIcon}>
                    <DashboardIcon name="camera" size={18} />
                  </span>
                  <span>
                    <span style={styles.createMediaPickerTitle}>Take Photo</span>
                    <span style={styles.createMediaPickerText}>Snap another room photo</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openCreateLibraryPicker}
                  disabled={createSubmitting}
                  style={styles.createMediaPickerSecondary}
                >
                  <span style={styles.createMediaPickerIcon}>
                    <DashboardIcon name="upload" size={18} />
                  </span>
                  <span>
                    <span style={styles.createMediaPickerTitle}>Choose Library</span>
                    <span style={styles.createMediaPickerText}>Photos or short videos</span>
                  </span>
                </button>
              </div>
              <div style={styles.createMediaCount}>
                {createPhotos.length}/30 media selected
              </div>
              <div style={modalResponsive.photoPreviewGrid}>
                {createPhotos.map((photo) => (
                  <div key={photo.id} style={styles.photoPreviewItem}>
                    {photo.mediaType === 'video' ? (
                      <video
                        src={photo.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        style={styles.photoPreviewImg}
                      />
                    ) : (
                      <img
                        src={photo.previewUrl}
                        alt={photo.name}
                        loading="lazy"
                        decoding="async"
                        style={styles.photoPreviewImg}
                      />
                    )}
                    <div style={styles.mediaCardActions}>
                      {photo.mediaType === 'image' ? (
                        <button
                          type="button"
                          style={styles.markupPhotoBtn}
                          onClick={() => openMediaMarkup('create', photo.id)}
                          disabled={createSubmitting}
                          aria-label={photo.marked ? 'Edit image markup' : 'Mark up image'}
                          title={photo.marked ? 'Edit image markup' : 'Mark up image'}
                        >
                          <DashboardIcon name="pen" size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        style={styles.removePhotoBtn}
                        onClick={() => removeCreatePhoto(photo.id)}
                        disabled={createSubmitting}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {createPhotos.length === 0 ? (
                  <div style={styles.uploadHint}>Upload up to 30 photos or videos</div>
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
              <label style={styles.formLabel}>Room/Area & Description</label>
              <input
                type="text"
                value={editRoom}
                onChange={(e) => setEditRoom(e.target.value)}
                style={styles.textInput}
                placeholder="e.g. 1308, Corridor lights, Carpark"
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
              <label style={styles.formLabel}>Additional Task Caption/Description</label>
              <textarea
                value={editTaskText}
                onChange={(e) => setEditTaskText(e.target.value)}
                style={styles.textArea}
                placeholder="Enter task details"
                disabled={editSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Existing Media</label>
              <div style={styles.photoPreviewGrid}>
                {editExistingImages.length === 0 ? (
                  <div style={styles.uploadHint}>No existing media</div>
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
                        {isVideoUrl(img.image_url) ? (
                          <video
                            src={img.image_url}
                            controls
                            playsInline
                            preload="metadata"
                            style={styles.photoPreviewImg}
                          />
                        ) : (
                          <img
                            src={img.image_url}
                            alt="Existing task media"
                            loading="lazy"
                            decoding="async"
                            style={styles.photoPreviewImg}
                          />
                        )}

                        <div style={styles.photoPreviewName}>
                          {img.caption || 'Existing media'}
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
              <label style={styles.formLabel}>Add New Photos / Videos</label>
              <input
                ref={editCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleEditPhotoChange}
                disabled={editSubmitting}
                style={styles.hiddenFileInput}
                aria-hidden="true"
                tabIndex={-1}
              />
              <input
                ref={editLibraryInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleEditPhotoChange}
                disabled={editSubmitting}
                style={styles.hiddenFileInput}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div style={styles.createMediaPickerPanel}>
                <button
                  type="button"
                  onClick={openEditCameraPicker}
                  disabled={editSubmitting}
                  style={styles.createMediaPickerPrimary}
                >
                  <span style={styles.createMediaPickerIcon}>
                    <DashboardIcon name="camera" size={18} />
                  </span>
                  <span>
                    <span style={styles.createMediaPickerTitle}>Take Photo</span>
                    <span style={styles.createMediaPickerText}>Add another photo</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openEditLibraryPicker}
                  disabled={editSubmitting}
                  style={styles.createMediaPickerSecondary}
                >
                  <span style={styles.createMediaPickerIcon}>
                    <DashboardIcon name="upload" size={18} />
                  </span>
                  <span>
                    <span style={styles.createMediaPickerTitle}>Choose Library</span>
                    <span style={styles.createMediaPickerText}>Photos or short videos</span>
                  </span>
                </button>
              </div>
              <div style={styles.createMediaCount}>
                {editNewPhotos.length} new media selected
              </div>

              <div style={styles.photoPreviewGrid}>
                {editNewPhotos.map((photo) => (
                  <div key={photo.id} style={styles.photoPreviewItem}>
                    {photo.mediaType === 'video' ? (
                      <video
                        src={photo.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        style={styles.photoPreviewImg}
                      />
                    ) : (
                      <img
                        src={photo.previewUrl}
                        alt={photo.name}
                        loading="lazy"
                        decoding="async"
                        style={styles.photoPreviewImg}
                      />
                    )}
                    <div style={styles.mediaCardActions}>
                      {photo.mediaType === 'image' ? (
                        <button
                          type="button"
                          style={styles.markupPhotoBtn}
                          onClick={() => openMediaMarkup('edit', photo.id)}
                          disabled={editSubmitting}
                          aria-label={photo.marked ? 'Edit image markup' : 'Mark up image'}
                          title={photo.marked ? 'Edit image markup' : 'Mark up image'}
                        >
                          <DashboardIcon name="pen" size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        style={styles.removePhotoBtn}
                        onClick={() => removeEditNewPhoto(photo.id)}
                        disabled={editSubmitting}
                      >
                        Remove
                      </button>
                    </div>
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
    background:
      'radial-gradient(circle at 18% 0%, rgba(59, 130, 246, 0.10), transparent 34%), linear-gradient(180deg, #f6f9fd 0%, #eef4fb 100%)',

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
    padding: 16,
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
    background:
      'linear-gradient(135deg, rgba(255, 253, 248, 0.98) 0%, rgba(255, 255, 255, 0.96) 48%, rgba(239, 246, 255, 0.98) 100%)',
    border: '1px solid rgba(198, 213, 232, 0.86)',
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.92)',
  },
  brandBand: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  brandCenter: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logoWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.76)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    border: '1px solid rgba(234, 223, 206, 0.96)',
    boxShadow: '0 10px 22px rgba(124, 88, 46, 0.10)',
  },
  headerTextWrap: {
    minWidth: 0,
    textAlign: 'left',
  },
  brandActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  headerGhostBtn: {
    height: 44,
    border: '1px solid #cfe0f5',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    color: '#173b83',
    borderRadius: 14,
    padding: '0 14px',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.07), inset 0 1px 0 rgba(255,255,255,0.96)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexShrink: 0,
  },
  headerGhostIcon: {
    width: 24,
    height: 24,
    borderRadius: 9,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#eff6ff',
    color: '#2563eb',
    flexShrink: 0,
  },
  headerGhostLabel: {
    fontSize: 13,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  mobileHeaderIconBtn: {
    width: 44,
    minWidth: 44,
    height: 44,
    padding: 0,
    borderRadius: 15,
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.96)',
  },
  mobileHeaderPrimaryBtn: {
    width: '100%',
    minWidth: 0,
    justifyContent: 'center',
    padding: '0 12px',
    borderRadius: 15,
  },
  hiddenFileInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
  },
  overviewGrid: {
    display: 'grid',
    gap: 10,
    marginBottom: 12,
  },
  overviewSectionStack: {
    display: 'grid',
    gap: 10,
    marginBottom: 10,
  },
  overviewBand: {
    border: '1px solid rgba(203, 216, 235, 0.9)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(247,250,255,0.88) 100%)',
    borderRadius: 16,
    padding: 8,
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.96)',
  },
  overviewBandHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: '1px 4px 7px',
  },
  overviewBandEyebrow: {
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#2563eb',
  },
  overviewBandTitle: {
    marginTop: 4,
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 1.15,
    fontWeight: 950,
  },
  overviewBandGrid: {
    display: 'grid',
    gap: 7,
  },
  overviewCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(252,254,255,0.98) 100%)',
    border: '1px solid rgba(218, 229, 243, 0.92)',
    borderRadius: 14,
    padding: 8,
    minWidth: 0,
    minHeight: 86,
    overflow: 'hidden',
    boxShadow: '0 10px 22px rgba(15, 23, 42, 0.048), inset 0 1px 0 rgba(255,255,255,0.92)',
  },
  overviewCardLink: {
    textDecoration: 'none',
    color: '#0f172a',
    cursor: 'pointer',
    transition: 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
  },
  overviewContent: {
    minWidth: 0,
    flex: 1,
    maxWidth: '100%',
  },
  overviewLabel: {
    fontSize: 8,
    lineHeight: 1.1,
    fontWeight: 900,
    color: '#64748b',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  overviewValue: {
    fontSize: 21,
    lineHeight: 1,
    fontWeight: 950,
    color: '#0f172a',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  overviewNote: {
    marginTop: 5,
    fontSize: 8,
    lineHeight: 1.2,
    color: '#64748b',
    fontWeight: 700,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  overviewIcon: {
    position: 'relative',
    width: 28,
    height: 28,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    flexShrink: 0,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
  },
  overviewAlertBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 999,
    background: '#ef4444',
    color: '#ffffff',
    border: '1.5px solid #ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 900,
    boxShadow: '0 8px 16px rgba(239,68,68,0.28)',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: '#8a6a43',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 24,
    lineHeight: 1.12,
    margin: '4px 0 0',
    color: '#0f172a',
    fontWeight: 900,
    wordBreak: 'break-word',
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#5b6b82',
    fontSize: 12,
    lineHeight: 1.4,
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
    background: 'linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(248,251,255,0.95) 100%)',
    border: '1px solid rgba(205, 220, 239, 0.98)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    overflow: 'hidden',
    boxShadow: '0 16px 34px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.95)',

  },
  filterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',

  },
  filterHeaderText: {
    minWidth: 0,
  },
  filterPanelTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    borderRadius: 999,
    padding: '5px 9px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    fontSize: 10,
    fontWeight: 900,
    color: '#1d4ed8',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  filterPanelSubtitle: {
    fontSize: 15,
    lineHeight: 1.25,
    margin: '7px 0 0',
    color: '#0f172a',
    fontWeight: 900,
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
    padding: '8px 12px',
    background: '#eff6ff',
    color: '#1d4ed8',
    border: '1px solid #bfdbfe',
    fontSize: 11,
    fontWeight: 800,
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: '1px solid #cfe0f5',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    color: '#2563eb',
    cursor: 'pointer',
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.07), inset 0 1px 0 rgba(255,255,255,0.96)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',

  },
  addTaskBtn: {
    height: 44,
    minHeight: 44,
    borderRadius: 14,
    border: '1px solid rgba(82, 139, 255, 0.48)',
    background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 48%, #3b82f6 100%)',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 800,
    lineHeight: 1,
    boxShadow: '0 16px 30px rgba(37, 99, 235, 0.26), inset 0 1px 0 rgba(255,255,255,0.22)',
    padding: '0 16px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  addTaskBtnIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.18)',
    color: '#ffffff',
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
    fontSize: 13,
    fontWeight: 900,
    color: '#ffffff',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  filterControlsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    alignItems: 'stretch',
  },
  filterBlock: {
    minWidth: 0,
    borderRadius: 14,
    border: '1px solid #dce8f6',
    background: 'rgba(255,255,255,0.78)',
    padding: 8,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.92)',

  },
  filterLabelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 7,
    padding: '0 2px',
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: 900,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.7,

  },
  filterHint: {
    fontSize: 10,
    fontWeight: 800,
    color: '#94a3b8',
    whiteSpace: 'nowrap',
  },
  pillRow: {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
    background: '#f3f7fd',
    padding: 4,
    borderRadius: 11,
    border: '1px solid #e1eaf6',
    boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.035)',

  },
  filterPill: {
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '7px 11px',
    background: '#ffffff',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 11,
    minHeight: 32,
    transition: 'background 160ms ease, color 160ms ease, box-shadow 160ms ease, border-color 160ms ease',

  },
  dateFilterRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,

  },
  dateInput: {
    width: '100%',
    maxWidth: '100%',
    padding: '9px 11px',
    borderRadius: 10,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    boxSizing: 'border-box',
    fontWeight: 700,

  },
  dateHint: {
    fontSize: 11,
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
    gap: 8,
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    background: '#ffffff',
    border: '1px solid #dbe7f5',
    borderRadius: 14,
    padding: '9px 12px',
    boxShadow: '0 10px 22px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255,255,255,0.9)',

  },
  workspaceLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 0.9fr)',
    gap: 12,
    alignItems: 'start',
  },
  workspacePrimary: {
    minWidth: 0,
  },
  workspaceRail: {
    minWidth: 0,
  },
  urgentAttentionPanel: {
    border: '2px solid #ef4444',
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
  },
  urgentAttentionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  urgentAttentionEyebrow: {
    fontSize: 10,
    fontWeight: 950,
    color: '#b91c1c',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  urgentAttentionTitle: {
    marginTop: 3,
    fontSize: 18,
    fontWeight: 950,
    color: '#7f1d1d',
  },
  urgentAttentionCount: {
    minWidth: 38,
    height: 38,
    borderRadius: 12,
    background: '#b91c1c',
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 950,
    boxShadow: '0 6px 15px rgba(185, 28, 28, 0.24)',
  },
  urgentAttentionList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 8,
  },
  urgentAttentionItem: {
    display: 'grid',
    gap: 9,
    border: '1px solid #fca5a5',
    borderRadius: 14,
    background: '#ffffff',
    padding: 11,
    boxShadow: '0 9px 20px rgba(127, 29, 29, 0.10)',
  },
  urgentAttentionTopRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  urgentAttentionRoom: {
    borderRadius: 9,
    background: '#7f1d1d',
    color: '#ffffff',
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 950,
  },
  urgentAttentionDepartment: {
    borderRadius: 999,
    background: '#fee2e2',
    color: '#991b1b',
    padding: '5px 8px',
    fontSize: 9,
    fontWeight: 950,
  },
  urgentAttentionTimer: {
    marginLeft: 'auto',
    borderRadius: 9,
    background: '#dc2626',
    color: '#ffffff',
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 950,
    whiteSpace: 'nowrap',
  },
  urgentAttentionTask: {
    color: '#450a0a',
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.4,
  },
  urgentAttentionFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    color: '#9f1239',
    fontSize: 9,
    fontWeight: 900,
  },
  urgentAttentionDoneButton: {
    minHeight: 34,
    border: 0,
    borderRadius: 9,
    padding: '7px 11px',
    background: '#166534',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 950,
    cursor: 'pointer',
  },
  guestWaitingPanel: {
    border: '1px solid rgba(191, 219, 254, 0.95)',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    boxShadow: '0 16px 34px rgba(15, 23, 42, 0.07), inset 0 1px 0 rgba(255,255,255,0.94)',
  },
  guestWaitingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  guestWaitingEyebrow: {
    fontSize: 10,
    fontWeight: 900,
    color: '#2563eb',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  guestWaitingTitle: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: 900,
    color: '#0f172a',
  },
  guestWaitingCount: {
    minWidth: 34,
    height: 34,
    borderRadius: 12,
    background: '#eff6ff',
    color: '#1d4ed8',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
  },
  guestWaitingEmpty: {
    border: '1px dashed #dbe7f5',
    background: '#f8fafc',
    borderRadius: 14,
    padding: '14px 12px',
    color: '#64748b',
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'center',
  },
  guestWaitingList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
  },
  guestWaitingItem: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 10,
    alignItems: 'center',
    border: '1px solid #dbeafe',
    borderRadius: 14,
    background: '#ffffff',
    padding: 10,
    boxShadow: '0 10px 22px rgba(15,23,42,0.045)',
  },
  guestWaitingRoom: {
    borderRadius: 11,
    background: '#fff1f2',
    color: '#be123c',
    padding: '8px 9px',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  guestWaitingBody: {
    minWidth: 0,
  },
  guestWaitingTask: {
    fontSize: 12,
    fontWeight: 900,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  guestWaitingMeta: {
    marginTop: 5,
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: 10,
    color: '#64748b',
    fontWeight: 800,
  },
  guestWaitingTimer: {
    borderRadius: 11,
    background: '#0f172a',
    color: '#ffffff',
    padding: '8px 9px',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  operationTrackerGrid: {
    display: 'grid',
    gap: 10,
    marginBottom: 12,
  },
  operationTrackerCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    textDecoration: 'none',
    color: '#0f172a',
    border: '1px solid rgba(218,229,243,0.95)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(252,254,255,0.98) 100%)',
    borderRadius: 16,
    padding: 12,
    minHeight: 82,
    boxSizing: 'border-box',
    boxShadow: '0 14px 30px rgba(15,23,42,0.055), inset 0 1px 0 rgba(255,255,255,0.9)',
  },
  operationTrackerIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#eff6ff',
    color: '#2563eb',
    flexShrink: 0,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
  },
  operationTrackerContent: {
    minWidth: 0,
    flex: 1,
  },
  operationTrackerLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
    overflowWrap: 'anywhere',
  },
  operationTrackerValue: {
    fontSize: 28,
    lineHeight: 1,
    fontWeight: 900,
    color: '#0f172a',
  },
  operationTrackerNote: {
    marginTop: 7,
    fontSize: 11,
    lineHeight: 1.35,
    color: '#64748b',
    fontWeight: 600,
  },
  resultText: {
    fontSize: 11,
    color: '#33507a',
    fontWeight: 800,
    letterSpacing: 0.2,

  },
  updatingText: {
    fontSize: 11,
    color: '#1d4ed8',
    fontWeight: 800,

  },
  mediaSubtaskPanel: {
    marginTop: 10,
    border: '1px solid #dbeafe',
    background: '#f8fbff',
    borderRadius: 14,
    padding: 10,
  },
  mediaSubtaskHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  mediaSubtaskTitle: {
    fontSize: 12,
    fontWeight: 900,
    color: '#0f172a',
  },
  mediaSubtaskProgress: {
    fontSize: 11,
    fontWeight: 900,
    color: '#2563eb',
  },
  mediaSubtaskList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  mediaSubtaskItem: {
    display: 'grid',
    gridTemplateColumns: '48px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 9,
    border: '1px solid #e4edf8',
    borderRadius: 12,
    background: '#ffffff',
    padding: 7,
  },
  mediaSubtaskThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    overflow: 'hidden',
    padding: 0,
    cursor: 'pointer',
  },
  mediaSubtaskImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  mediaSubtaskVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  mediaSubtaskBody: {
    minWidth: 0,
  },
  mediaSubtaskName: {
    fontSize: 12,
    fontWeight: 900,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  mediaSubtaskMeta: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
  },
  mediaSubtaskCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 900,
    color: '#0f172a',
    whiteSpace: 'nowrap',
  },
  cardList: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflowX: 'hidden',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,

  },
  renderLimitNotice: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 14,
    padding: '12px 14px',
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'center',
  },
  taskCard: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.94)',
    border: '1px solid #dfe9f5',
    borderRadius: 16,
    padding: 10,
    boxShadow: '0 16px 32px rgba(15, 23, 42, 0.06)',
    contentVisibility: 'auto',
    containIntrinsicSize: '320px',
    contain: 'layout style paint',
  },
  taskMainRow: {
    display: 'flex',
    gap: 10,
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
    fontSize: 11,
    fontWeight: 900,
    color: '#0f172a',
    letterSpacing: 0.4,

  },
  cardEditTaskBtn: {
    marginLeft: 'auto',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#475569',
    borderRadius: 8,
    padding: '5px 9px',
    fontSize: 10,
    fontWeight: 800,
    cursor: 'pointer',
  },
  statusBadge: {
    borderRadius: 999,
    padding: '5px 8px',
    fontSize: 10,
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
    fontSize: 11,
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,

  },
  roomNo: {
    fontSize: 16,
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
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 900,

  },
  roomCheckLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#1e3a8a',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 10,
    fontWeight: 900,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  taskText: {
    marginTop: 8,
    color: '#334155',
    lineHeight: 1.45,
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 6,
    marginTop: 8,

  },
  metaCard: {
    background: '#f8fafc',
    border: '1px solid #eef2f7',
    borderRadius: 10,
    padding: 8,
    minWidth: 0,

  },
  metaCardLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,

  },
  metaCardValue: {
    fontSize: 11,
    color: '#334155',
    fontWeight: 700,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  metaCardValueStrong: {
    fontSize: 11,
    color: '#0f172a',
    fontWeight: 900,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',

  },
  buttonRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    width: '100%',
    marginTop: 8,

  },
  markDoneBtn: {
    border: '1px solid #15803d',
    background: '#15803d',
    color: '#ffffff',
    borderRadius: 10,
    padding: '10px 12px',
    fontWeight: 900,
    fontSize: 11,
    cursor: 'pointer',
    flex: 1,
    minWidth: 150,
  },
  deleteTaskBtn: {
    border: '1px solid #ef4444',
    background: '#fff',
    color: '#ef4444',
    borderRadius: 10,
    padding: '9px 10px',
    fontWeight: 800,
    fontSize: 11,
    cursor: 'pointer',
    flex: 1,
    minWidth: 90,

  },
  permissionText: {
    marginTop: 8,
    fontSize: 10,
    color: '#64748b',
    fontWeight: 700,

  },
  pastTaskNote: {
    marginTop: 8,
    fontSize: 11,
    color: '#64748b',
    fontWeight: 700,
  },
  thumbWrap: {
    flexShrink: 0,
    width: 72,
    maxWidth: 72,
    position: 'relative',
    contain: 'layout paint',
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
    height: 72,
    objectFit: 'cover',
    borderRadius: 14,
    border: '1px solid #e7edf5',
    boxShadow: '0 6px 18px rgba(15,23,42,0.05)',
    background: '#e2e8f0',
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
  markupModalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.62)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1300,
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
  createMediaPickerPanel: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
    marginTop: 8,
  },
  createMediaPickerPrimary: {
    border: '1px solid #bfdbfe',
    background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)',
    color: '#1d4ed8',
    borderRadius: 16,
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: '0 10px 24px rgba(37,99,235,0.08)',
    minWidth: 0,
  },
  createMediaPickerSecondary: {
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: 16,
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    minWidth: 0,
  },
  createMediaPickerIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#dbeafe',
    color: '#2563eb',
    flexShrink: 0,
  },
  createMediaPickerTitle: {
    display: 'block',
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
  },
  createMediaPickerText: {
    display: 'block',
    marginTop: 3,
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    lineHeight: 1.25,
  },
  createMediaCount: {
    marginTop: 8,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    padding: '5px 9px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    color: '#475569',
    fontSize: 11,
    fontWeight: 900,
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
  mediaCardActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
    gap: 8,
    alignItems: 'center',
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
  markupPhotoBtn: {
    marginTop: 8,
    width: '100%',
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: 8,
    padding: '8px 10px',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markupCard: {
    width: 'min(96vw, 920px)',
    maxHeight: '92vh',
    overflow: 'auto',
    background: '#ffffff',
    borderRadius: 20,
    border: '1px solid #dbe3ee',
    padding: 16,
    boxShadow: '0 22px 60px rgba(15,23,42,0.22)',
  },
  markupCanvasWrap: {
    width: '100%',
    maxHeight: '68vh',
    overflow: 'auto',
    border: '1px solid #dbeafe',
    borderRadius: 16,
    background: '#f8fafc',
    display: 'flex',
    justifyContent: 'center',
    padding: 8,
    touchAction: 'none',
  },
  markupCanvas: {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: 12,
    background: '#ffffff',
    cursor: 'crosshair',
    touchAction: 'none',
  },
  createModalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
    flexWrap: 'wrap',
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
  customerWaitingOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    border: '1px solid #fecaca',
    background: '#fff7f7',
    color: '#7f1d1d',
    borderRadius: 14,
    padding: '12px 14px',
    cursor: 'pointer',
  },
  customerWaitingCheckbox: {
    marginTop: 3,
  },
  customerWaitingTitle: {
    display: 'block',
    fontSize: 13,
    fontWeight: 900,
    color: '#991b1b',
  },
  customerWaitingText: {
    display: 'block',
    marginTop: 3,
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 700,
    color: '#b91c1c',
  },
  customerWaitingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    background: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    whiteSpace: 'nowrap',
  },
  urgentTaskBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '5px 8px',
    background: '#b91c1c',
    color: '#ffffff',
    border: '1px solid #991b1b',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
    whiteSpace: 'nowrap',
  },
  priorityChoiceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  priorityChoiceButton: {
    minHeight: 64,
    border: '1px solid #f2b8b8',
    borderRadius: 14,
    padding: '10px 12px',
    background: '#fff8f8',
    color: '#7f1d1d',
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    cursor: 'pointer',
  },
  customerWaitingChoiceActive: {
    background: '#c2410c',
    borderColor: '#9a3412',
    color: '#ffffff',
    boxShadow: '0 8px 20px rgba(194, 65, 12, 0.22)',
  },
  urgentChoiceButton: {
    borderColor: '#ef9a9a',
    background: '#fff2f2',
  },
  urgentChoiceActive: {
    background: '#b91c1c',
    borderColor: '#991b1b',
    color: '#ffffff',
    boxShadow: '0 8px 22px rgba(185, 28, 28, 0.28)',
  },
  taskAcknowledgementBox: {
    marginTop: 10,
    border: '1px solid #dbe4ef',
    borderRadius: 10,
    padding: '8px 10px',
    background: '#f8fafc',
    color: '#34465f',
    fontSize: 10,
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 7,
  },
  taskAcknowledgementList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  taskAcknowledgementPending: {
    color: '#b45309',
    fontWeight: 800,
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
  mediaUploadNotice: {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(18px + env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    zIndex: 1400,
    width: 'min(92vw, 520px)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    border: '1px solid #bfdbfe',
    background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)',
    color: '#0f172a',
    padding: '12px 14px',
    boxShadow: '0 22px 50px rgba(15,23,42,0.22)',
    boxSizing: 'border-box',
  },
  mediaUploadNoticeDone: {
    borderColor: '#bbf7d0',
    background: 'linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%)',
  },
  mediaUploadNoticeError: {
    borderColor: '#fecaca',
    background: 'linear-gradient(135deg, #fef2f2 0%, #ffffff 100%)',
  },
  mediaUploadPulse: {
    width: 42,
    height: 42,
    borderRadius: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    background: '#dbeafe',
    color: '#2563eb',
    boxShadow: 'inset 0 0 0 1px rgba(37,99,235,0.12)',
  },
  mediaUploadPulseDone: {
    background: '#dcfce7',
    color: '#16a34a',
  },
  mediaUploadPulseError: {
    background: '#fee2e2',
    color: '#dc2626',
  },
  mediaUploadNoticeText: {
    minWidth: 0,
  },
  mediaUploadNoticeTitle: {
    fontSize: 13,
    fontWeight: 900,
    color: '#0f172a',
    lineHeight: 1.25,
  },
  mediaUploadNoticeMessage: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: 700,
    color: '#475569',
    lineHeight: 1.35,
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
  bootLoader: {
    minHeight: 360,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px 0 28px',
  },
  bootLoaderCard: {
    width: 'min(560px, 100%)',
    borderRadius: 26,
    border: '1px solid rgba(191, 219, 254, 0.95)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,251,255,0.96) 100%)',
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.09), inset 0 1px 0 rgba(255,255,255,0.98)',
    padding: 28,
    textAlign: 'center',
    overflow: 'hidden',
  },
  bootLoaderIcon: {
    width: 58,
    height: 58,
    borderRadius: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#eff6ff',
    color: '#2563eb',
    boxShadow: 'inset 0 0 0 1px rgba(37,99,235,0.1)',
    animation: 'dashboardBootPulse 1.3s ease-in-out infinite',
  },
  bootLoaderEyebrow: {
    marginTop: 16,
    color: '#2563eb',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  bootLoaderTitle: {
    marginTop: 8,
    color: '#0f172a',
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 950,
  },
  bootLoaderText: {
    margin: '10px auto 0',
    maxWidth: 360,
    color: '#64748b',
    fontSize: 14,
    lineHeight: 1.45,
    fontWeight: 700,
  },
  bootLoaderTrack: {
    position: 'relative',
    height: 7,
    margin: '22px auto 0',
    borderRadius: 999,
    overflow: 'hidden',
    background: '#e8f0fb',
  },
  bootLoaderBar: {
    position: 'absolute',
    inset: 0,
    width: '42%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, rgba(37,99,235,0) 0%, #2563eb 50%, rgba(37,99,235,0) 100%)',
    animation: 'dashboardBootBar 1.2s ease-in-out infinite',
  },
  bootSkeletonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
    marginTop: 20,
  },
  bootSkeletonTile: {
    height: 64,
    borderRadius: 16,
    background: 'linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)',
    border: '1px solid #e3edf9',
    animation: 'dashboardBootPulse 1.4s ease-in-out infinite',
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


