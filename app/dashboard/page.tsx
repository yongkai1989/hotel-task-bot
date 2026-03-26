'use client';

import { useEffect, useMemo, useState } from 'react';

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
};

const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const statuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const;

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dept, setDept] = useState<(typeof departments)[number]>('ALL');
  const [status, setStatus] = useState<(typeof statuses)[number]>('ALL');
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function loadTasks() {
    try {
      const res = await fetch(`/api/tasks?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store'
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
        body: JSON.stringify({ taskId, status: nextStatus })
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

  useEffect(() => {
    loadTasks();
    const timer = setInterval(loadTasks, 5000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const deptOk = dept === 'ALL' || t.department === dept;
      const statusOk = status === 'ALL' || t.status === status;
      return deptOk && statusOk;
    });
  }, [tasks, dept, status]);

  const summary = useMemo(() => {
    return {
      open: tasks.filter((t) => t.status === 'OPEN').length,
      doing: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      done: tasks.filter((t) => t.status === 'DONE').length
    };
  }, [tasks]);

  return (
    <main style={styles.page}>
      <div style={styles.headerWrap}>
        <div>
          <div style={styles.eyebrow}>Hallmark Task System</div>
          <h1 style={styles.title}>Operations Dashboard</h1>
          <p style={styles.subtitle}>
            Live mobile task board for housekeeping, maintenance, and front office
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div style={styles.errorBox}>
          {errorMsg}
        </div>
      ) : null}

      <section style={styles.summaryGrid}>
        <SummaryCard title="Open" value={summary.open} tone="open" />
        <SummaryCard title="Doing" value={summary.doing} tone="doing" />
        <SummaryCard title="Done" value={summary.done} tone="done" />
      </section>

      <section style={styles.filterPanel}>
        <div style={styles.filterGroup}>
          <div style={styles.filterLabel}>Department</div>
          <div style={styles.pillRow}>
            {departments.map((d) => (
              <button
                key={d}
                onClick={() => setDept(d)}
                style={pillStyle(dept === d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.filterGroup}>
          <div style={styles.filterLabel}>Status</div>
          <div style={styles.pillRow}>
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                style={pillStyle(status === s)}
              >
                {labelForStatus(s)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={styles.resultBar}>
        <div style={styles.resultText}>
          {loading ? 'Loading tasks…' : `${filtered.length} task${filtered.length === 1 ? '' : 's'} shown`}
        </div>
      </section>

      {loading ? (
        <div style={styles.emptyState}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyState}>No tasks found for this filter.</div>
      ) : (
        <div style={styles.cardList}>
          {filtered.map((task) => (
            <article key={task.id} style={styles.taskCard}>
              <div style={styles.cardTopRow}>
                <div>
                  <div style={styles.taskCode}>{task.task_code}</div>
                  <div style={styles.roomLine}>
                    Room <span style={styles.roomNo}>{task.room}</span>
                    <span style={styles.dot}>•</span>
                    <span style={deptBadgeStyle(task.department)}>{task.department}</span>
                  </div>
                </div>

                <div style={statusBadgeStyle(task.status)}>
                  {labelForStatus(task.status)}
                </div>
              </div>

              <div style={styles.taskText}>{task.task_text}</div>

              <div style={styles.metaWrap}>
                <div style={styles.metaRow}>
                  <span style={styles.metaLabel}>Created</span>
                  <span style={styles.metaValue}>{new Date(task.created_at).toLocaleString()}</span>
                </div>

                {task.status === 'DONE' && task.done_at ? (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Completed</span>
                    <span style={styles.metaValue}>{new Date(task.done_at).toLocaleString()}</span>
                  </div>
                ) : null}

                {task.status === 'DONE' && task.done_by_name ? (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Done by</span>
                    <span style={styles.metaValueStrong}>{task.done_by_name}</span>
                  </div>
                ) : null}

                {task.status !== 'DONE' && task.last_updated_by_name ? (
                  <div style={styles.metaRow}>
                    <span style={styles.metaLabel}>Last updated by</span>
                    <span style={styles.metaValue}>{task.last_updated_by_name}</span>
                  </div>
                ) : null}
              </div>

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
                  Doing
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
            </article>
          ))}
        </div>
      )}
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

function labelForStatus(status: string) {
  if (status === 'IN_PROGRESS') return 'Doing';
  return status;
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? '1px solid #111827' : '1px solid #d1d5db',
    background: active ? '#111827' : '#ffffff',
    color: active ? '#ffffff' : '#374151',
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: active ? '0 8px 20px rgba(17,24,39,0.18)' : 'none'
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
      ? { background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8' }
      : { background: '#059669', color: '#fff', border: '1px solid #059669' };

  return {
    minWidth: 84,
    borderRadius: 12,
    padding: '10px 14px',
    fontSize: 14,
    fontWeight: 600,
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
      background: '#d1fae5',
      color: '#047857',
      border: '1px solid #a7f3d0',
    },
  };

  return {
    borderRadius: 999,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap',
    ...map[status],
  };
}

function deptBadgeStyle(dept: Task['department']): React.CSSProperties {
  const map: Record<Task['department'], React.CSSProperties> = {
    HK: {
      background: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
    },
    MT: {
      background: '#e0e7ff',
      color: '#4338ca',
      border: '1px solid #c7d2fe',
    },
    FO: {
      background: '#fce7f3',
      color: '#be185d',
      border: '1px solid #fbcfe8',
    },
  };

  return {
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
    ...map[dept],
  };
}

function summaryCardStyle(tone: 'open' | 'doing' | 'done'): React.CSSProperties {
  const map = {
    open: {
      background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)',
      border: '1px solid #e5e7eb',
    },
    doing: {
      background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
      border: '1px solid #bfdbfe',
    },
    done: {
      background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
      border: '1px solid #a7f3d0',
    },
  };

  return {
    borderRadius: 20,
    padding: 18,
    boxShadow: '0 10px 24px rgba(15,23,42,0.06)',
    ...map[tone],
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: 16,
    maxWidth: 860,
    margin: '0 auto',
    background:
      'linear-gradient(180deg, #f8fafc 0%, #f3f4f6 100%)',
  },
  headerWrap: {
    marginBottom: 18,
    paddingTop: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.1,
    color: '#111827',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 0,
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 1.5,
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
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: 800,
    color: '#111827',
    marginTop: 8,
  },
  filterPanel: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    background: 'rgba(248,250,252,0.92)',
    backdropFilter: 'blur(12px)',
    border: '1px solid #e5e7eb',
    borderRadius: 20,
    padding: 14,
    marginBottom: 14,
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  filterGroup: {
    marginBottom: 10,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 700,
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
  resultBar: {
    marginBottom: 10,
    paddingLeft: 4,
  },
  resultText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 600,
  },
  cardList: {
    display: 'grid',
    gap: 14,
  },
  taskCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 22,
    padding: 18,
    background: '#ffffff',
    boxShadow: '0 14px 30px rgba(15,23,42,0.06)',
  },
  cardTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  taskCode: {
    fontSize: 28,
    fontWeight: 800,
    color: '#111827',
    letterSpacing: -0.4,
  },
  roomLine: {
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    color: '#4b5563',
    fontSize: 16,
  },
  roomNo: {
    fontWeight: 800,
    color: '#111827',
  },
  dot: {
    color: '#9ca3af',
  },
  taskText: {
    marginTop: 14,
    fontSize: 21,
    lineHeight: 1.35,
    color: '#111827',
    fontWeight: 500,
  },
  metaWrap: {
    marginTop: 16,
    display: 'grid',
    gap: 6,
    padding: 12,
    borderRadius: 16,
    background: '#f9fafb',
    border: '1px solid #f3f4f6',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  metaLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: 700,
    minWidth: 88,
  },
  metaValue: {
    fontSize: 13,
    color: '#374151',
    textAlign: 'right',
  },
  metaValueStrong: {
    fontSize: 13,
    color: '#111827',
    textAlign: 'right',
    fontWeight: 700,
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
    color: '#6b7280',
    fontWeight: 600,
  },
  emptyState: {
    marginTop: 20,
    padding: 24,
    borderRadius: 18,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    textAlign: 'center',
    color: '#6b7280',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
};
