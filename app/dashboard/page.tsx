'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

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

const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const liveStatuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const;

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dept, setDept] = useState<(typeof departments)[number]>('ALL');
  const [status, setStatus] = useState<(typeof liveStatuses)[number]>('ALL');
  const [sidebarView, setSidebarView] = useState<SidebarView>('DASHBOARD');
  const [pastTaskDate, setPastTaskDate] = useState(getYesterdayLocalDateString());

  const [loading, setLoading] = useState(true);
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

  async function loadTasks() {
    try {
      const res = await fetch(`/api/tasks?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || 'Failed to load tasks');
      }

      setTasks(json.tasks || []);
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  async function setTaskStatus(taskId: string, nextStatus: Task['status']) {
    const oldTasks = tasks;

    try {
      setBusyTaskId(taskId);
      setErrorMsg('');

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, status: nextStatus } : task
        )
      );

      const res = await fetch('/api/task-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ taskId, status: nextStatus }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || 'Failed to update task');
      }

      setTimeout(() => {
        loadTasks();
      }, 250);
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

      const processed = await Promise.all(
        files.map(async (file, index) => {
          const compressed = await compressImageToDataUrl(file, 1600, 0.82);
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
      setCreateError('');

      const room = createRoom.trim();
      const taskText = createTaskText.trim();

      if (!room) {
        throw new Error('Room Number is required');
      }

      if (!/^\d{3,5}$/.test(room)) {
        throw new Error('Room Number must be 3 to 5 digits');
      }

      if (!createDept) {
        throw new Error('Please choose a department');
      }

      if (!taskText) {
        throw new Error('Task Description is required');
      }

      setCreateSubmitting(true);

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          room,
          department: createDept,
          task_text: taskText,
          created_by_name: 'Dashboard',
          image_urls: createPhotos.map((photo) => photo.dataUrl),
          image_captions: createPhotos.map((photo) => photo.name),
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json?.error || 'Failed to create task');
      }

      closeCreateModal();
      setLoading(true);
      await loadTasks();
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create task');
    } finally {
      setCreateSubmitting(false);
    }
  }

  useEffect(() => {
    loadTasks();
    const timer = setInterval(loadTasks, 5000);
    return () => clearInterval(timer);
  }, []);

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

  const contentStyle: React.CSSProperties = isMobile
    ? { ...styles.content, marginLeft: 0 }
    : { ...styles.content, marginLeft: 0 };

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

          <div style={styles.sidebarMiniStats}>
            <div style={styles.sidebarMiniCard}>
              <div style={styles.sidebarMiniLabel}>Open</div>
              <div style={styles.sidebarMiniValue}>{summary.open}</div>
            </div>

            <div style={styles.sidebarMiniCard}>
              <div style={styles.sidebarMiniLabel}>DOING</div>
              <div style={styles.sidebarMiniValue}>{summary.doing}</div>
            </div>

            <div style={styles.sidebarMiniCard}>
              <div style={styles.sidebarMiniLabel}>Done Today</div>
              <div style={styles.sidebarMiniValue}>{summary.doneToday}</div>
            </div>
          </div>
        </aside>

        <section style={contentStyle}>
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

          {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}

          {sidebarView === 'DASHBOARD' ? (
            <section style={styles.summaryGrid}>
              <SummaryCard title="Open" value={summary.open} tone="open" />
              <SummaryCard title="DOING" value={summary.doing} tone="doing" />
              <SummaryCard title="DONE TODAY" value={summary.doneToday} tone="done" />
            </section>
          ) : null}

          <section style={styles.filterPanel}>
            <div style={styles.filterHeader}>
              <div>
                <div style={styles.filterPanelTitle}>
                  {sidebarView === 'DASHBOARD' ? 'Live Task Filters' : 'Archive Filters'}
                </div>
                <div style={styles.filterPanelSubtitle}>
                  {sidebarView === 'DASHBOARD'
                    ? 'Filter active and today-completed tasks'
                    : 'Search older completed tasks by department and date'}
                </div>
              </div>

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
                                disabled={busyTaskId === task.id}
                                onClick={() => setTaskStatus(task.id, 'OPEN')}
                              >
                                Open
                              </button>

                              <button
                                style={actionBtn(task.status === 'IN_PROGRESS', 'doing')}
                                disabled={busyTaskId === task.id}
                                onClick={() => setTaskStatus(task.id, 'IN_PROGRESS')}
                              >
                                DOING
                              </button>

                              <button
                                style={actionBtn(task.status === 'DONE', 'done')}
                                disabled={busyTaskId === task.id}
                                onClick={() => setTaskStatus(task.id, 'DONE')}
                              >
                                Done
                              </button>
                            </div>

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

  // 🔥 SMART compression loop
  let currentQuality = quality;
  let result = canvas.toDataURL('image/jpeg', currentQuality);

  // target max ~500KB
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
  },
  layout: {
    display: 'flex',
    minHeight: '100vh',
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
  sidebarMiniStats: {
    display: 'grid',
    gap: 10,
  },
  sidebarMiniCard: {
    borderRadius: 16,
    border: '1px solid #e7edf5',
    background: '#f8fafc',
    padding: 14,
  },
  sidebarMiniLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 700,
  },
  sidebarMiniValue: {
    marginTop: 6,
    fontSize: 22,
    color: '#111827',
    fontWeight: 800,
  },
  sidebarCount: {
    fontSize: 11,
    fontWeight: 800,
    padding: '4px 8px',
    borderRadius: 999,
    background: '#f3f4f6',
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  sidebarCountActive: {
    fontSize: 11,
    fontWeight: 800,
    padding: '4px 8px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.14)',
    color: '#ffffff',
    whiteSpace: 'nowrap',
  },
  content: {
    flex: 1,
    minWidth: 0,
    padding: 20,
    maxWidth: 1200,
    width: '100%',
  },
  mobileTopBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  mobileTopBarTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111827',
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
  },
  headerTop: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap',
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
  },
  title: {
    margin: 0,
    fontSize: 32,
    lineHeight: 1.08,
    color: '#111827',
    fontWeight: 800,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 0,
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 1.55,
  },
  errorBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontSize: 14,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16,
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
  },
  filterPanel: {
    marginBottom: 16,
    border: '1px solid #e7edf5',
    borderRadius: 22,
    padding: 16,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
  },
  filterHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  filterPanelTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: '#111827',
  },
  filterPanelSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
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
  },
  dateFilterRow: {
    display: 'grid',
    gap: 8,
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
  },
  dateHint: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: 600,
  },
  resultBar: {
    marginBottom: 12,
    paddingLeft: 2,
  },
  resultText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 700,
  },
  cardList: {
    display: 'grid',
    gap: 14,
  },
  taskCard: {
    border: '1px solid #e7edf5',
    borderRadius: 24,
    padding: 18,
    background: '#ffffff',
    boxShadow: '0 14px 28px rgba(15,23,42,0.05)',
  },
  taskMainRow: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-start',
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
  },
  taskCode: {
    fontSize: 26,
    fontWeight: 800,
    color: '#111827',
    letterSpacing: -0.4,
  },
  roomLine: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    color: '#4b5563',
    fontSize: 15,
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
  },
  metaCard: {
    borderRadius: 16,
    border: '1px solid #edf2f7',
    background: '#f8fafc',
    padding: 12,
    minWidth: 0,
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
  },
  createModalSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
    lineHeight: 1.45,
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
  },
  createErrorBox: {
    padding: 12,
    borderRadius: 14,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#b91c1c',
    fontSize: 14,
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
  },
  uploadBoxTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#111827',
  },
  uploadBoxSub: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 600,
  },
  photoCounterText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: 700,
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: 12,
  },
  previewCard: {
    borderRadius: 16,
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    overflow: 'hidden',
    display: 'grid',
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
  },
};
