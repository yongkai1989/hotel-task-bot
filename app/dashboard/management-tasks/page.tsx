'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
};

type ManagementTask = {
  id: string;
  title: string;
  description: string | null;
  repeat_every_days: number;
  due_in_days: number;
  is_active: boolean;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type ManagementTaskRun = {
  id: string;
  management_task_id: string;
  run_start_date: string;
  due_date: string;
  status: 'OPEN' | 'DONE' | 'OVERDUE';
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_name: string | null;
  reopened_at: string | null;
  reopened_by_user_id: string | null;
  reopened_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type TaskCardData = {
  task: ManagementTask;
  run: ManagementTaskRun;
};

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

export default function ManagementTasksPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [tasks, setTasks] = useState<ManagementTask[]>([]);
  const [runs, setRuns] = useState<ManagementTaskRun[]>([]);

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<'CREATE' | 'EDIT'>('CREATE');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [savingTask, setSavingTask] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [repeatEveryDaysInput, setRepeatEveryDaysInput] = useState('30');
  const [dueInDaysInput, setDueInDaysInput] = useState('7');

  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [busyDeleteTaskId, setBusyDeleteTaskId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) {
          throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        }

        setAuthLoading(true);
        setErrorMsg('');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          return;
        }

        const userId = session.user.id;
        const email = session.user.email || '';

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', userId)
          .maybeSingle();

        if (profileError) throw profileError;

        if (!mounted) return;
        setProfile({
          user_id: userId,
          email: profileRow?.email || email,
          name: profileRow?.name || email || 'User',
          role: (profileRow?.role || 'FO') as DashboardUser['role'],
        });
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER';
  }, [profile]);

  const isSuperuser = useMemo(() => profile?.role === 'SUPERUSER', [profile]);

  async function loadAllData() {
    if (!profile || !canAccess) {
      setPageLoading(false);
      return;
    }

    try {
      setPageLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const supabase = getSupabaseSafe();
      if (!supabase) throw new Error('Supabase is not configured.');

      const { error: recurrenceError } = await supabase.rpc('run_management_task_recurrence');
      if (recurrenceError) {
        console.error('run_management_task_recurrence error:', recurrenceError);
      }

      const [taskRes, runRes] = await Promise.all([
        supabase
          .from('management_tasks')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('management_task_runs')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (taskRes.error) throw taskRes.error;
      if (runRes.error) throw runRes.error;

      setTasks((taskRes.data || []) as ManagementTask[]);
      setRuns((runRes.data || []) as ManagementTaskRun[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load management tasks');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    void loadAllData();
  }, [profile, canAccess]);

  const taskCards = useMemo(() => {
    const taskMap = new Map<string, ManagementTask>();
    tasks.forEach((task) => taskMap.set(task.id, task));

    return runs
      .map((run) => {
        const task = taskMap.get(run.management_task_id);
        if (!task) return null;
        return { task, run } as TaskCardData;
      })
      .filter(Boolean) as TaskCardData[];
  }, [tasks, runs]);

  const openCards = useMemo(() => taskCards.filter((card) => card.run.status === 'OPEN'), [taskCards]);
  const overdueCards = useMemo(() => taskCards.filter((card) => card.run.status === 'OVERDUE'), [taskCards]);
  const visibleDoneCards = useMemo(() => {
    return taskCards.filter((card) => {
      if (card.run.status !== 'DONE') return false;
      if (!card.run.completed_at) return false;

      const completedAt = new Date(card.run.completed_at);
      if (Number.isNaN(completedAt.getTime())) return true;

      const now = new Date();
      const diffMs = now.getTime() - completedAt.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      return diffMs <= sevenDaysMs;
    });
  }, [taskCards]);

  function resetTaskModalFields() {
    setTaskTitle('');
    setTaskDescription('');
    setRepeatEveryDaysInput('30');
    setDueInDaysInput('7');
    setEditingTaskId(null);
  }

  function openCreateModal() {
    if (!isSuperuser) return;
    setTaskModalMode('CREATE');
    resetTaskModalFields();
    setShowTaskModal(true);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function openEditModal(card: TaskCardData) {
    if (!isSuperuser) return;
    setTaskModalMode('EDIT');
    setEditingTaskId(card.task.id);
    setTaskTitle(card.task.title);
    setTaskDescription(card.task.description || '');
    setRepeatEveryDaysInput(String(card.task.repeat_every_days));
    setDueInDaysInput(String(card.task.due_in_days));
    setShowTaskModal(true);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeTaskModal() {
    if (savingTask) return;
    setShowTaskModal(false);
  }

  async function handleSaveTask() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    if (!isSuperuser) {
      setErrorMsg('Only superuser can manage recurring tasks.');
      return;
    }

    const title = taskTitle.trim();
    if (!title) {
      setErrorMsg('Please enter a task title.');
      return;
    }

    const parsedRepeatEveryDays = parseWholeNumber(repeatEveryDaysInput);
    if (parsedRepeatEveryDays === null) {
      setErrorMsg('Please enter Repeat Every days.');
      return;
    }
    if (parsedRepeatEveryDays <= 0) {
      setErrorMsg('Repeat Every days must be more than 0.');
      return;
    }

    const parsedDueInDays = parseWholeNumber(dueInDaysInput);
    if (parsedDueInDays === null) {
      setErrorMsg('Please enter Due In days.');
      return;
    }
    if (parsedDueInDays < 0) {
      setErrorMsg('Due In days cannot be negative.');
      return;
    }

    try {
      setSavingTask(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (taskModalMode === 'CREATE') {
        const today = getTodayLocalDateString();
        const dueDate = addDaysToDate(today, parsedDueInDays);

        const { data: insertedTask, error: taskError } = await supabase
          .from('management_tasks')
          .insert([
            {
              title,
              description: taskDescription.trim() || null,
              repeat_every_days: parsedRepeatEveryDays,
              due_in_days: parsedDueInDays,
              is_active: true,
              created_by_user_id: profile.user_id,
              created_by_name: profile.name || profile.email,
            },
          ])
          .select('*')
          .single();

        if (taskError) throw taskError;

        const { error: runError } = await supabase
          .from('management_task_runs')
          .insert([
            {
              management_task_id: insertedTask.id,
              run_start_date: today,
              due_date: dueDate,
              status: 'OPEN',
            },
          ]);

        if (runError) throw runError;

        setSuccessMsg('Management task created successfully.');
      } else {
        if (!editingTaskId) throw new Error('No task selected for editing.');

        const { error: updateError } = await supabase
          .from('management_tasks')
          .update({
            title,
            description: taskDescription.trim() || null,
            repeat_every_days: parsedRepeatEveryDays,
            due_in_days: parsedDueInDays,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingTaskId);

        if (updateError) throw updateError;

        setSuccessMsg('Management task updated successfully.');
      }

      setShowTaskModal(false);
      resetTaskModalFields();
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save management task');
    } finally {
      setSavingTask(false);
    }
  }

  async function handleMarkDone(card: TaskCardData) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    try {
      setBusyRunId(card.run.id);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('management_task_runs')
        .update({
          status: 'DONE',
          completed_at: new Date().toISOString(),
          completed_by_user_id: profile.user_id,
          completed_by_name: profile.name || profile.email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', card.run.id);

      if (error) throw error;

      setSuccessMsg(`Task "${card.task.title}" marked as done.`);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mark task as done');
    } finally {
      setBusyRunId(null);
    }
  }

  async function handleReopen(card: TaskCardData) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    try {
      setBusyRunId(card.run.id);
      setErrorMsg('');
      setSuccessMsg('');

      const today = getTodayLocalDateString();
      const nextStatus = card.run.due_date < today ? 'OVERDUE' : 'OPEN';

      const { error } = await supabase
        .from('management_task_runs')
        .update({
          status: nextStatus,
          completed_at: null,
          completed_by_user_id: null,
          completed_by_name: null,
          reopened_at: new Date().toISOString(),
          reopened_by_user_id: profile.user_id,
          reopened_by_name: profile.name || profile.email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', card.run.id);

      if (error) throw error;

      setSuccessMsg(`Task "${card.task.title}" reopened.`);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to reopen task');
    } finally {
      setBusyRunId(null);
    }
  }

  async function handleDeleteTask(taskId: string, taskTitle: string) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!isSuperuser) {
      setErrorMsg('Only superuser can delete tasks.');
      return;
    }

    const confirmed = window.confirm(
      `Delete recurring task "${taskTitle}"? Existing history stays, but the task will be hidden from active use.`
    );
    if (!confirmed) return;

    try {
      setBusyDeleteTaskId(taskId);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('management_tasks')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;

      setSuccessMsg(`Task "${taskTitle}" deleted.`);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete task');
    } finally {
      setBusyDeleteTaskId(null);
    }
  }

  function renderTaskCard(card: TaskCardData, section: 'OPEN' | 'OVERDUE' | 'DONE') {
    const statusStyles =
      card.run.status === 'DONE'
        ? styles.statusDone
        : card.run.status === 'OVERDUE'
        ? styles.statusOverdue
        : styles.statusOpen;

    return (
      <div key={card.run.id} style={styles.taskCard}>
        <div style={styles.taskTopRow}>
          <div>
            <div style={styles.taskTitle}>{card.task.title}</div>
            {card.task.description ? (
              <div style={styles.taskDescription}>{card.task.description}</div>
            ) : null}
          </div>

          <div style={{ ...styles.statusBadge, ...statusStyles }}>
            {card.run.status}
          </div>
        </div>

        <div style={styles.metaGrid}>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Start</div>
            <div style={styles.metaValue}>{formatDate(card.run.run_start_date)}</div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Due</div>
            <div style={styles.metaValue}>{formatDate(card.run.due_date)}</div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Repeat</div>
            <div style={styles.metaValue}>{card.task.repeat_every_days} days</div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Due In</div>
            <div style={styles.metaValue}>{card.task.due_in_days} days</div>
          </div>
        </div>

        {card.run.completed_at ? (
          <div style={styles.auditText}>
            Completed: {formatDateTime(card.run.completed_at)}
            {card.run.completed_by_name ? ` · ${card.run.completed_by_name}` : ''}
          </div>
        ) : null}

        {card.run.reopened_at ? (
          <div style={styles.auditText}>
            Reopened: {formatDateTime(card.run.reopened_at)}
            {card.run.reopened_by_name ? ` · ${card.run.reopened_by_name}` : ''}
          </div>
        ) : null}

        {card.run.status === 'OVERDUE' ? (
          <div style={styles.overdueRemark}>
            Overdue. This task will not reissue again until this cycle is resolved.
          </div>
        ) : null}

        <div style={styles.cardActions}>
          {section !== 'DONE' ? (
            <button
              type="button"
              onClick={() => void handleMarkDone(card)}
              disabled={busyRunId === card.run.id}
              style={{
                ...styles.primaryActionBtn,
                opacity: busyRunId === card.run.id ? 0.5 : 1,
              }}
            >
              {busyRunId === card.run.id ? 'Saving...' : 'Done'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleReopen(card)}
              disabled={busyRunId === card.run.id}
              style={{
                ...styles.reopenBtn,
                opacity: busyRunId === card.run.id ? 0.5 : 1,
              }}
            >
              {busyRunId === card.run.id ? 'Saving...' : 'Reopen'}
            </button>
          )}

          {isSuperuser ? (
            <>
              <button
                type="button"
                onClick={() => openEditModal(card)}
                style={styles.secondaryActionBtn}
              >
                Edit
              </button>

              <button
                type="button"
                onClick={() => void handleDeleteTask(card.task.id, card.task.title)}
                disabled={busyDeleteTaskId === card.task.id}
                style={{
                  ...styles.deleteBtn,
                  opacity: busyDeleteTaskId === card.task.id ? 0.5 : 1,
                }}
              >
                {busyDeleteTaskId === card.task.id ? 'Deleting...' : 'Delete'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>Only managers and superusers can access Management Tasks.</p>
          <Link href="/dashboard" style={styles.linkBtn}>
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Management Tasks</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) · Recurring management task tracker
            </div>
          </div>

          <div style={styles.topBarActions}>
            {isSuperuser ? (
              <button type="button" onClick={openCreateModal} style={styles.primaryHeaderBtn}>
                Create Task
              </button>
            ) : null}

            <Link href="/dashboard" style={styles.secondaryBtn}>
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Open</div>
            <div style={styles.summaryValue}>{openCards.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Overdue</div>
            <div style={{ ...styles.summaryValue, color: '#b91c1c' }}>{overdueCards.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Done (7 days)</div>
            <div style={{ ...styles.summaryValue, color: '#166534' }}>{visibleDoneCards.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Recurring Tasks</div>
            <div style={styles.summaryValue}>{tasks.length}</div>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        {pageLoading ? (
          <div style={styles.panel}>
            <div style={styles.emptyState}>Loading management tasks...</div>
          </div>
        ) : (
          <>
            <section style={styles.panel}>
              <div style={styles.sectionTitle}>Open</div>
              {openCards.length === 0 ? (
                <div style={styles.emptyState}>No open tasks.</div>
              ) : (
                <div style={styles.cardsWrap}>
                  {openCards.map((card) => renderTaskCard(card, 'OPEN'))}
                </div>
              )}
            </section>

            <section style={styles.panel}>
              <div style={styles.sectionTitle}>Overdue</div>
              {overdueCards.length === 0 ? (
                <div style={styles.emptyState}>No overdue tasks.</div>
              ) : (
                <div style={styles.cardsWrap}>
                  {overdueCards.map((card) => renderTaskCard(card, 'OVERDUE'))}
                </div>
              )}
            </section>

            <section style={styles.panel}>
              <div style={styles.sectionTitle}>Done</div>
              {visibleDoneCards.length === 0 ? (
                <div style={styles.emptyState}>No completed tasks in the last 7 days.</div>
              ) : (
                <div style={styles.cardsWrap}>
                  {visibleDoneCards.map((card) => renderTaskCard(card, 'DONE'))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {showTaskModal ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTop}>
              <div style={styles.modalTitle}>
                {taskModalMode === 'CREATE' ? 'Create Task' : 'Edit Task'}
              </div>
              <button type="button" onClick={closeTaskModal} style={styles.closeBtn} disabled={savingTask}>
                ×
              </button>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Task Title</label>
              <input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                style={styles.input}
                placeholder="Example: Weekly KPI Review"
                disabled={savingTask}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                style={styles.textarea}
                placeholder="Optional notes or SOP"
                disabled={savingTask}
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Repeat Every (Days)</label>
                <input
                  type="number"
                  value={repeatEveryDaysInput}
                  onChange={(e) => setRepeatEveryDaysInput(e.target.value)}
                  style={styles.input}
                  placeholder="30"
                  disabled={savingTask}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Due In (Days)</label>
                <input
                  type="number"
                  value={dueInDaysInput}
                  onChange={(e) => setDueInDaysInput(e.target.value)}
                  style={styles.input}
                  placeholder="7"
                  disabled={savingTask}
                />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeTaskModal}
                style={styles.secondaryBtn}
                disabled={savingTask}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleSaveTask()}
                style={styles.primaryBtn}
                disabled={savingTask}
              >
                {savingTask ? 'Saving...' : taskModalMode === 'CREATE' ? 'Create Task' : 'Save Changes'}
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
    background: '#f8fafc',
    padding: '20px 16px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '22px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '12px',
  },
  cardsWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '12px',
  },
  taskCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    padding: '14px',
  },
  taskTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
  },
  taskTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  taskDescription: {
    fontSize: '14px',
    color: '#475569',
    marginTop: '6px',
    whiteSpace: 'pre-wrap',
  },
  statusBadge: {
    borderRadius: '999px',
    padding: '8px 12px',
    fontWeight: 800,
    fontSize: '12px',
  },
  statusOpen: {
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  statusDone: {
    background: '#ecfdf5',
    color: '#166534',
  },
  statusOverdue: {
    background: '#fef2f2',
    color: '#b91c1c',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginTop: '14px',
  },
  metaItem: {
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '10px',
    background: '#f8fafc',
  },
  metaLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '4px',
  },
  metaValue: {
    fontSize: '14px',
    color: '#0f172a',
    fontWeight: 800,
  },
  auditText: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#475569',
  },
  overdueRemark: {
    marginTop: '12px',
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #fdba74',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '13px',
  },
  cardActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '14px',
  },
  primaryActionBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryActionBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  reopenBtn: {
    border: '1px solid #0f766e',
    background: '#f0fdfa',
    color: '#0f766e',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: '1px solid #ef4444',
    background: '#fff',
    color: '#ef4444',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryHeaderBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#fff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 600,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  centerText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modalCard: {
    width: '100%',
    maxWidth: '640px',
    background: '#fff',
    borderRadius: '22px',
    padding: '20px',
    boxShadow: '0 20px 50px rgba(15,23,42,0.28)',
  },
  modalTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '4px',
  },
  closeBtn: {
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#0f172a',
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    fontSize: '20px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  formGroup: {
    marginBottom: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: '1 1 240px',
    minWidth: 0,
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: '14px',
    color: '#334155',
    fontWeight: 700,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '110px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
  },
};
