'use client';

import { useEffect, useMemo, useState } from 'react';

type Task = {
  id: string;
  task_code: string;
  room: string;
  department: 'HK' | 'MT' | 'FO';
  task_text: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'DONE';
  created_at: string;

  done_by_name?: string | null;
  last_updated_by_name?: string | null;
  done_at?: string | null;
};
const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const statuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'PENDING', 'DONE'] as const;

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

      // Optimistic update
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

      // Refresh from DB after success, bypassing cache
      setTimeout(() => {
        loadTasks();
      }, 300);
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
      pending: tasks.filter((t) => t.status === 'PENDING').length,
      done: tasks.filter((t) => t.status === 'DONE').length
    };
  }, [tasks]);

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Hotel Task Dashboard</h1>
      <p style={{ color: '#666', marginTop: 0 }}>Mobile-friendly live task board</p>

      {errorMsg ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 12,
            border: '1px solid #f0b3b3',
            background: '#fff5f5',
            color: '#a33'
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
        <Card title="Open" value={summary.open} />
        <Card title="Doing" value={summary.doing} />
        <Card title="Pending" value={summary.pending} />
        <Card title="Done" value={summary.done} />
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
        {departments.map((d) => (
          <button key={d} onClick={() => setDept(d)} style={pillStyle(dept === d)}>
            {d}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
        {statuses.map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={pillStyle(status === s)}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : filtered.length === 0 ? (
        <p>No tasks found.</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map((task) => (
            <div
              key={task.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: 16,
                padding: 14,
                background: '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{task.task_code}</strong>
                <span style={{ fontSize: 12, color: '#666' }}>{task.status}</span>
              </div>

              <div style={{ marginTop: 8, fontSize: 16 }}>
                Room <strong>{task.room}</strong> · {task.department}
              </div>

              <div style={{ marginTop: 8, fontSize: 15 }}>{task.task_text}</div>

              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                {new Date(task.created_at).toLocaleString()}
              </div>
              {task.status === 'DONE' && task.done_by_name ? (
  <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
    Done by: {task.done_by_name}
  </div>
) : null}

{task.last_updated_by_name ? (
  <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
    Last updated by: {task.last_updated_by_name}
  </div>
) : null}

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  style={actionBtn(task.status === 'OPEN')}
                  disabled={busyTaskId === task.id}
                  onClick={() => setTaskStatus(task.id, 'OPEN')}
                >
                  Open
                </button>
                <button
                  style={actionBtn(task.status === 'IN_PROGRESS')}
                  disabled={busyTaskId === task.id}
                  onClick={() => setTaskStatus(task.id, 'IN_PROGRESS')}
                >
                  Doing
                </button>
                <button
                  style={actionBtn(task.status === 'PENDING')}
                  disabled={busyTaskId === task.id}
                  onClick={() => setTaskStatus(task.id, 'PENDING')}
                >
                  Pending
                </button>
                <button
                  style={actionBtn(task.status === 'DONE')}
                  disabled={busyTaskId === task.id}
                  onClick={() => setTaskStatus(task.id, 'DONE')}
                >
                  Done
                </button>
              </div>

              {busyTaskId === task.id ? (
                <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>Updating...</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div
      style={{
        border: '1px solid #ddd',
        borderRadius: 16,
        padding: 14,
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }}
    >
      <div style={{ fontSize: 13, color: '#666' }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    border: '1px solid #ccc',
    borderRadius: 999,
    padding: '8px 14px',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    whiteSpace: 'nowrap',
    cursor: 'pointer'
  };
}

function actionBtn(active: boolean): React.CSSProperties {
  return {
    border: '1px solid #ccc',
    borderRadius: 10,
    padding: '8px 12px',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    cursor: 'pointer',
    opacity: 1
  };
}
