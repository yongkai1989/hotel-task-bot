'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '../../lib/supabaseBrowser';

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
  role: 'MANAGER' | 'FO' | 'HK' | 'MT';
};

type AdminUser = {
  email: string;
  name: string;
  role: 'MANAGER' | 'FO' | 'HK' | 'MT';
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

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dept, setDept] = useState<(typeof departments)[number]>('ALL');
  const [status, setStatus] = useState<(typeof liveStatuses)[number]>('ALL');
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
    if (!profile) {
      setTasks([]);
      setLoading(false);
      return;
    }

    loadTasks(true);
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

  async function loadTasks(showLoader = false) {
    try {
      if (showLoader) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const json = await fetchJson(`/api/tasks?t=${Date.now()}`, {
        method: 'GET',
      });

      setTasks(json.tasks || []);
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    if (profile.role === 'MANAGER') return true;
    if (profile.role === 'HK') return task.department === 'HK';
    if (profile.role === 'MT') return task.department === 'MT';
    return false;
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
                        <div style={styles.taskMainRow}>
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
                inputMode="numeric"
                placeholder="e.g. 1308"
                value={createRoom}
                onChange={(e) => setCreateRoom(e.target.value.replace(/[^\d]/g, ''))}
                style={styles.formInput}
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Department</label>
              <div style={styles.createDeptRow}>
                {(['HK', 'MT', 'FO'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setCreateDept(d)}
                    style={createDeptButtonStyle(d, createDept === d)}
                    disabled={createSubmitting}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Task Description</label>
              <textarea
                placeholder="e.g. extra towel / TV no signal / guest requested callback"
                value={createTaskText}
                onChange={(e) => setCreateTaskText(e.target.value)}
                style={styles.formTextarea}
                disabled={createSubmitting}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Add Photos</label>

              <label style={styles.uploadBox}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleCreatePhotoChange}
                  style={{ display: 'none' }}
                  disabled={createSubmitting}
                />
                <span style={styles.uploadBoxTitle}>
                  {createPhotos.length > 0 ? 'Add More Photos' : 'Choose Photos'}
                </span>
                <span style={styles.uploadBoxSub}>
                  You can upload multiple images
                </span>
              </label>

              {createPhotos.length > 0 ? (
                <div style={styles.photoCounterText}>
                  {createPhotos.length} photo{createPhotos.length === 1 ? '' : 's'} selected
                </div>
              ) : null}

              {createPhotos.length > 0 ? (
                <div style={styles.previewGrid}>
                  {createPhotos.map((photo) => (
                    <div key={photo.id} style={styles.previewCard}>
                      <img
                        src={photo.dataUrl}
                        alt={photo.name}
                        style={styles.previewThumb}
                      />
                      <div style={styles.previewName}>{photo.name}</div>
                      <button
                        type="button"
                        onClick={() => removeCreatePhoto(photo.id)}
                        style={styles.previewRemoveBtn}
                        disabled={createSubmitting}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={styles.createActionRow}>
              <button
                type="button"
                onClick={closeCreateModal}
                style={styles.cancelBtn}
                disabled={createSubmitting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitCreateTask}
                style={styles.submitBtn}
                disabled={createSubmitting}
              >
                {createSubmitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loginOpen ? (
        <div style={styles.createModalOverlay} onClick={() => setLoginOpen(false)}>
          <div style={styles.loginModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.createModalTop}>
              <div>
                <div style={styles.createModalTitle}>Dashboard Login</div>
                <div style={styles.createModalSubtitle}>
                  Log in to create tasks and update task status
                </div>
              </div>

              <button
                onClick={() => setLoginOpen(false)}
                style={styles.createModalCloseBtn}
                aria-label="Close login modal"
                disabled={loginBusy}
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
                style={styles.formInput}
                disabled={loginBusy}
              />
            </div>

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={styles.formInput}
                disabled={loginBusy}
              />
            </div>

            <div style={styles.createActionRow}>
              <button
                type="button"
                onClick={handleLogin}
                style={styles.submitBtn}
                disabled={loginBusy}
              >
                {loginBusy ? 'Logging in…' : 'Log In'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordModalOpen ? (
        <div style={styles.createModalOverlay} onClick={closePasswordModal}>
          <div style={styles.loginModalCard} onClick={(e) => e.stopPropagation()}>
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
            {passwordSuccess ? <div style={styles.successBox}>{passwordSuccess}</div> : null}

            <div style={styles.formBlock}>
              <label style={styles.formLabel}>Select User</label>
              <select
                value={passwordTargetEmail}
                onChange={(e) => setPasswordTargetEmail(e.target.value)}
                style={styles.formInput}
                disabled={passwordBusy}
              >
                {adminUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name} ({u.role}) - {u.email}
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
                style={styles.formInput}
                disabled={passwordBusy}
              />
            </div>

            <div style={styles.createActionRow}>
              <button
                type="button"
                onClick={handleChangePassword}
                style={styles.submitBtn}
                disabled={passwordBusy}
              >
                {passwordBusy ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
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
  return (
    <div style={summaryCardStyle(tone)}>
      <div style={styles.summaryTitle}>{title}</div>
      <div style={styles.summaryValue}>{value}</div>
    </div>
  );
}

async function compressImageToDataUrl(
  file: File,
  maxSize = 1200,
  quality = 0.72
): Promise<string> {
  const imageDataUrl = await readFileAsDataURL(file);
  const img = await loadImage(imageDataUrl);

  const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const width = Math.round(img.width * ratio);
  const height = Math.round(img.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to process image');
  }

  ctx.drawImage(img, 0, 0, width, height);

  let currentQuality = quality;
  let result = canvas.toDataURL('image/jpeg', currentQuality);

  while (result.length > 500_000 && currentQuality > 0.5) {
    currentQuality -= 0.05;
    result = canvas.toDataURL('image/jpeg', currentQuality);
  }

  return result;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read photo'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load photo'));
    img.src = src;
  });
}

function getTodayLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayLocalDateString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDateStringFromISO(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateString: string) {
  if (!dateString) return '';
  const d = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString();
}

function labelForStatus(status: string) {
  if (status === 'IN_PROGRESS') return 'DOING';
  return status;
}

function sidebarItemStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    textAlign: 'left',
    borderRadius: 16,
    padding: '14px 16px',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    border: active ? '1px solid #111827' : '1px solid #e5e7eb',
    background: active ? '#111827' : '#ffffff',
    color: active ? '#ffffff' : '#374151',
    boxShadow: active ? '0 12px 22px rgba(17,24,39,0.16)' : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    boxSizing: 'border-box',
  };
}

function departmentFilterStyle(
  dept: 'ALL' | 'HK' | 'MT' | 'FO',
  active: boolean
): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#374151',
    boxSizing: 'border-box',
  };

  if (!active) return base;

  if (dept === 'HK') {
    return {
      ...base,
      background: '#16a34a',
      color: '#ffffff',
      border: '1px solid #16a34a',
      boxShadow: '0 8px 18px rgba(22,163,74,0.22)',
    };
  }

  if (dept === 'MT') {
    return {
      ...base,
      background: '#2563eb',
      color: '#ffffff',
      border: '1px solid #2563eb',
      boxShadow: '0 8px 18px rgba(37,99,235,0.22)',
    };
  }

  if (dept === 'FO') {
    return {
      ...base,
      background: '#facc15',
      color: '#111827',
      border: '1px solid #facc15',
      boxShadow: '0 8px 18px rgba(250,204,21,0.28)',
    };
  }

  return {
    ...base,
    background: '#111827',
    color: '#ffffff',
    border: '1px solid #111827',
    boxShadow: '0 8px 18px rgba(17,24,39,0.18)',
  };
}

function statusFilterStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? '1px solid #111827' : '1px solid #d1d5db',
    background: active ? '#111827' : '#ffffff',
    color: active ? '#ffffff' : '#374151',
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: active ? '0 8px 18px rgba(17,24,39,0.18)' : 'none',
    boxSizing: 'border-box',
  };
}

function actionBtn(
  active: boolean,
  tone: 'open' | 'doing' | 'done'
): React.CSSProperties {
  const activeStyles =
    tone === 'open'
      ? { background: '#111827', color: '#fff', border: '1px solid #111827' }
      : tone === 'doing'
      ? { background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }
      : { background: '#16a34a', color: '#fff', border: '1px solid #16a34a' };

  return {
    minWidth: 92,
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box',
    ...(active
      ? activeStyles
      : {
          background: '#ffffff',
          color: '#374151',
          border: '1px solid #d1d5db',
        }),
  };
}

function statusBadgeStyle(status: Task['status']): React.CSSProperties {
  const map: Record<Task['status'], React.CSSProperties> = {
    OPEN: {
      background: '#f3f4f6',
      color: '#374151',
      border: '1px solid #e5e7eb',
    },
    IN_PROGRESS: {
      background: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    },
    DONE: {
      background: '#dcfce7',
      color: '#15803d',
      border: '1px solid #bbf7d0',
    },
  };

  return {
    borderRadius: 999,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    ...map[status],
  };
}

function deptBadgeStyle(dept: Task['department']): React.CSSProperties {
  const map: Record<Task['department'], React.CSSProperties> = {
    HK: {
      background: '#dcfce7',
      color: '#15803d',
      border: '1px solid #bbf7d0',
    },
    MT: {
      background: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    },
    FO: {
      background: '#fef9c3',
      color: '#a16207',
      border: '1px solid #fde68a',
    },
  };

  return {
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 800,
    boxSizing: 'border-box',
    ...map[dept],
  };
}

function summaryCardStyle(tone: 'open' | 'doing' | 'done'): React.CSSProperties {
  const map = {
    open: {
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      border: '1px solid #e5e7eb',
    },
    doing: {
      background: 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)',
      border: '1px solid #bfdbfe',
    },
    done: {
      background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)',
      border: '1px solid #bbf7d0',
    },
  };

  return {
    borderRadius: 20,
    padding: 18,
    boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
    boxSizing: 'border-box',
    minWidth: 0,
    ...map[tone],
  };
}

function createDeptButtonStyle(
  dept: 'HK' | 'MT' | 'FO',
  active: boolean
): React.CSSProperties {
  return {
    ...departmentFilterStyle(dept, active),
    minWidth: 88,
    justifyContent: 'center',
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f6fb',
    overflowX: 'hidden',
    width: '100%',
  },
  layout: {
    display: 'flex',
    minHeight: '100vh',
    width: '100%',
    overflowX: 'hidden',
  },
  sidebar: {
    width: 280,
    minWidth: 280,
    background: '#ffffff',
    borderRight: '1px solid #e7edf5',
    padding: 18,
    boxShadow: '0 10px 30px rgba(15,23,42,0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  sidebarTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sidebarBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    flex: 1,
  },
  sidebarLogoWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #ede9e3',
    boxShadow: '0 8px 18px rgba(15,23,42,0.06)',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  sidebarBrandText: {
    minWidth: 0,
    flex: 1,
  },
  sidebarHotel: {
    fontSize: 15,
    fontWeight: 800,
    color: '#111827',
    lineHeight: 1.2,
    wordBreak: 'break-word',
  },
  sidebarHotelSub: {
    marginTop: 4,
    fontSize: 12,
    color: '#6b7280',
    fontWeight: 700,
  },
  sidebarCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#111827',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  sidebarSectionTitle: {
    fontSize: 11,
    fontWeight: 800,
    color: '#94a3b8',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sidebarMenu: {
    display: 'grid',
    gap: 10,
  },
  sidebarDivider: {
    height: 1,
    background: '#edf2f7',
    margin: '4px 0',
  },
  userPanel: {
    display: 'grid',
    gap: 10,
  },
  loginSidebarBtn: {
    borderRadius: 14,
    padding: '12px 14px',
    border: '1px solid #111827',
    background: '#111827',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxSizing: 'border-box',
    width: '100%',
  },
  logoutSidebarBtn: {
    borderRadius: 14,
    padding: '12px 14px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#374151',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxSizing: 'border-box',
    width: '100%',
  },
  managerBtn: {
    borderRadius: 14,
    padding: '12px 14px',
    border: '1px solid #2563eb',
    background: '#2563eb',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    boxSizing: 'border-box',
    width: '100%',
  },
  userCard: {
    borderRadius: 16,
    border: '1px solid #e7edf5',
    background: '#f8fafc',
    padding: 14,
    display: 'grid',
    gap: 4,
    boxSizing: 'border-box',
    minWidth: 0,
  },
  userName: {
    fontSize: 15,
    fontWeight: 800,
    color: '#111827',
    wordBreak: 'break-word',
  },
  userRole: {
    fontSize: 12,
    fontWeight: 800,
    color: '#2563eb',
  },
  userEmail: {
    fontSize: 12,
    color: '#64748b',
    wordBreak: 'break-word',
  },
  sidebarCount: {
    fontSize: 11,
    fontWeight: 800,
    padding: '4px 8px',
    borderRadius: 999,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  },
  sidebarCountActive: {
    fontSize: 11,
    fontWeight: 800,
    padding: '4px 8px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.14)',
    color: '#ffffff',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  },
  content: {
    flex: 1,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    padding: 20,
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  mobileTopBar: {
    position: 'sticky',
    top: 0,
    zIndex: 900,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingBottom: 10,
    background: '#f3f6fb',
  },
  mobileTopBarTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111827',
    minWidth: 0,
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    border: '1px solid #dbe3ee',
    background: '#ffffff',
    color: '#111827',
    fontSize: 20,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 6px 16px rgba(15,23,42,0.06)',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  mobileOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.38)',
    zIndex: 1001,
  },
  headerCard: {
    marginBottom: 18,
    padding: 20,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)',
    border: '1px solid #e7edf5',
    boxShadow: '0 16px 34px rgba(15,23,42,0.06)',
    boxSizing: 'border-box',
    width: '100%',
    overflow: 'hidden',
  },
  headerTop: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  logoWrap: {
    width: 66,
    height: 66,
    borderRadius: 18,
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #ede9e3',
    boxShadow: '0 8px 18px rgba(15,23,42,0.06)',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  logo: {
    objectFit: 'contain',
  },
  headerTextWrap: {
    minWidth: 0,
    flex: 1,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1,
    color: '#8b5e34',
    textTransform: 'uppercase',
    marginBottom: 6,
    wordBreak: 'break-word',
  },
  title: {
    margin: 0,
    fontSize: 32,
    lineHeight: 1.08,
    color: '#111827',
    fontWeight: 800,
    wordBreak: 'break-word',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 0,
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 1.55,
    wordBreak: 'break-word',
  },
  errorBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontSize: 14,
    wordBreak: 'break-word',
    boxSizing: 'border-box',
    width: '100%',
  },
  successBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    border: '1px solid #bbf7d0',
    background: '#f0fdf4',
    color: '#15803d',
    fontSize: 14,
    boxSizing: 'border-box',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16,
    width: '100%',
  },
  summaryTitle: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 700,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: 800,
    color: '#111827',
    marginTop: 8,
    wordBreak: 'break-word',
  },
  filterPanel: {
    marginBottom: 16,
    border: '1px solid #e7edf5',
    borderRadius: 22,
    padding: 16,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
    boxSizing: 'border-box',
    width: '100%',
    overflow: 'hidden',
  },
  filterHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  filterHeaderText: {
    minWidth: 0,
    flex: 1,
  },
  filterHeaderButtons: {
    display: 'flex',
    gap: 10,
    flexShrink: 0,
  },
  filterPanelTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111827',
    wordBreak: 'break-word',
  },
  filterPanelSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
    wordBreak: 'break-word',
  },
  addTaskBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    border: '1px solid #111827',
    background: '#111827',
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 1,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 12px 22px rgba(17,24,39,0.18)',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  filterBlock: {
    marginTop: 14,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pillRow: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    paddingBottom: 4,
    width: '100%',
  },
  dateFilterRow: {
    display: 'grid',
    gap: 8,
    width: '100%',
  },
  dateInput: {
    width: '100%',
    maxWidth: 240,
    borderRadius: 12,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    padding: '12px 14px',
    fontSize: 14,
    fontWeight: 600,
    outline: 'none',
    boxSizing: 'border-box',
  },
  dateHint: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: 600,
    wordBreak: 'break-word',
  },
  resultBar: {
    marginBottom: 12,
    paddingLeft: 2,
    width: '100%',
    boxSizing: 'border-box',
  },
  resultText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 700,
    wordBreak: 'break-word',
  },
  cardList: {
    display: 'grid',
    gap: 14,
    width: '100%',
  },
  taskCard: {
    border: '1px solid #e7edf5',
    borderRadius: 24,
    padding: 18,
    background: '#ffffff',
    boxShadow: '0 14px 28px rgba(15,23,42,0.05)',
    boxSizing: 'border-box',
    width: '100%',
    overflow: 'hidden',
  },
  taskMainRow: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
    minWidth: 0,
    width: '100%',
  },
  taskMainContent: {
    minWidth: 0,
    flex: 1,
  },
  cardTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  cardTopLeft: {
    minWidth: 0,
    flex: 1,
  },
  taskCodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  taskCode: {
    fontSize: 26,
    fontWeight: 800,
    color: '#111827',
    letterSpacing: -0.4,
    wordBreak: 'break-word',
  },
  roomLine: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    color: '#4b5563',
    fontSize: 15,
    minWidth: 0,
  },
  roomText: {
    color: '#64748b',
    fontWeight: 700,
  },
  roomNo: {
    fontWeight: 800,
    color: '#111827',
  },
  dot: {
    color: '#9ca3af',
  },
  taskText: {
    marginTop: 16,
    fontSize: 20,
    lineHeight: 1.4,
    color: '#0f172a',
    fontWeight: 600,
    wordBreak: 'break-word',
  },
  metaGrid: {
    marginTop: 16,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
    width: '100%',
  },
  metaCard: {
    borderRadius: 16,
    border: '1px solid #edf2f7',
    background: '#f8fafc',
    padding: 12,
    minWidth: 0,
    boxSizing: 'border-box',
  },
  metaCardLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  metaCardValue: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  metaCardValueStrong: {
    fontSize: 13,
    color: '#0f172a',
    lineHeight: 1.45,
    fontWeight: 800,
    wordBreak: 'break-word',
  },
  buttonRow: {
    display: 'flex',
    gap: 10,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  permissionText: {
    marginTop: 10,
    fontSize: 12,
    color: '#b45309',
    fontWeight: 700,
    wordBreak: 'break-word',
  },
  updatingText: {
    marginTop: 10,
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
  },
  pastTaskNote: {
    marginTop: 16,
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
    padding: '10px 12px',
    borderRadius: 12,
    background: '#f8fafc',
    border: '1px solid #edf2f7',
    boxSizing: 'border-box',
    wordBreak: 'break-word',
  },
  emptyState: {
    marginTop: 20,
    padding: 26,
    borderRadius: 20,
    background: '#ffffff',
    border: '1px solid #e7edf5',
    textAlign: 'center',
    color: '#64748b',
    boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
    fontWeight: 600,
    boxSizing: 'border-box',
    width: '100%',
  },
  thumbWrap: {
    width: 86,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  thumbButton: {
    width: 86,
    height: 86,
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid #e7edf5',
    background: '#f8fafc',
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 10px 22px rgba(15,23,42,0.08)',
    boxSizing: 'border-box',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  imageCountBadge: {
    fontSize: 11,
    fontWeight: 800,
    color: '#374151',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: 999,
    padding: '4px 8px',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1100,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    boxSizing: 'border-box',
  },
  modalInner: {
    position: 'relative',
    width: '100%',
    maxWidth: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  modalCloseBtn: {
    position: 'absolute',
    top: -8,
    right: 0,
    width: 42,
    height: 42,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 1,
    cursor: 'pointer',
    zIndex: 2,
    boxSizing: 'border-box',
  },
  modalNavLeft: {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    width: 48,
    height: 48,
    borderRadius: 999,
    fontSize: 34,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  modalNavRight: {
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.12)',
    color: '#ffffff',
    width: 48,
    height: 48,
    borderRadius: 999,
    fontSize: 34,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  modalImageWrap: {
    width: '100%',
    maxWidth: 920,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  modalImage: {
    width: '100%',
    maxHeight: '80vh',
    objectFit: 'contain',
    borderRadius: 18,
    background: '#111827',
  },
  modalFooter: {
    width: '100%',
    display: 'grid',
    gap: 8,
    justifyItems: 'center',
  },
  modalCounter: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 800,
  },
  modalCaption: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 1.5,
    textAlign: 'center',
    maxWidth: 780,
    wordBreak: 'break-word',
  },
  createModalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1200,
    background: 'rgba(15,23,42,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    boxSizing: 'border-box',
  },
  createModalCard: {
    width: '100%',
    maxWidth: 640,
    borderRadius: 24,
    background: '#ffffff',
    border: '1px solid #e7edf5',
    boxShadow: '0 24px 48px rgba(15,23,42,0.18)',
    padding: 18,
    display: 'grid',
    gap: 16,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  loginModalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 24,
    background: '#ffffff',
    border: '1px solid #e7edf5',
    boxShadow: '0 24px 48px rgba(15,23,42,0.18)',
    padding: 18,
    display: 'grid',
    gap: 16,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  createModalTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  createModalTitle: {
    fontSize: 22,
    fontWeight: 800,
    color: '#111827',
    wordBreak: 'break-word',
  },
  createModalSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  createModalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    color: '#111827',
    fontSize: 24,
    lineHeight: 1,
    cursor: 'pointer',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  createErrorBox: {
    padding: 12,
    borderRadius: 14,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontSize: 14,
    boxSizing: 'border-box',
    wordBreak: 'break-word',
  },
  formBlock: {
    display: 'grid',
    gap: 8,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  formInput: {
    width: '100%',
    borderRadius: 14,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    padding: '14px 16px',
    fontSize: 15,
    fontWeight: 600,
    outline: 'none',
    boxSizing: 'border-box',
  },
  formTextarea: {
    width: '100%',
    minHeight: 110,
    borderRadius: 14,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    padding: '14px 16px',
    fontSize: 15,
    fontWeight: 600,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  createDeptRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  uploadBox: {
    display: 'grid',
    gap: 4,
    border: '1px dashed #cbd5e1',
    borderRadius: 16,
    padding: 16,
    background: '#f8fafc',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  uploadBoxTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#111827',
    wordBreak: 'break-word',
  },
  uploadBoxSub: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 600,
    wordBreak: 'break-word',
  },
  photoCounterText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: 700,
    wordBreak: 'break-word',
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 12,
    width: '100%',
  },
  previewCard: {
    borderRadius: 16,
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    overflow: 'hidden',
    display: 'grid',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  previewThumb: {
    width: '100%',
    height: 110,
    objectFit: 'cover',
    display: 'block',
  },
  previewName: {
    fontSize: 11,
    color: '#334155',
    fontWeight: 700,
    padding: '8px 10px 0 10px',
    wordBreak: 'break-word',
  },
  previewRemoveBtn: {
    margin: 10,
    borderRadius: 10,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 800,
    padding: '8px 10px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  createActionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  cancelBtn: {
    minWidth: 110,
    borderRadius: 14,
    padding: '12px 16px',
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#374151',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  submitBtn: {
    minWidth: 130,
    borderRadius: 14,
    padding: '12px 18px',
    border: '1px solid #111827',
    background: '#111827',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 12px 22px rgba(17,24,39,0.18)',
    boxSizing: 'border-box',
  },
};
