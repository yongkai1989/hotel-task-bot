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
};

const departments = ['ALL', 'HK', 'MT', 'FO'] as const;
const statuses = ['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const;

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dept, setDept] = useState<(typeof departments)[number]>('ALL');
  const [status, setStatus] = useState<(typeof statuses)[number]>('ALL');
  const [loading, setLoading] = useState(true);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  async function loadTasks() {
    const res = await fetch(`/api/tasks?t=${Date.now()}`, { cache: 'no-store' });
    const json = await res.json();
    setTasks(json.tasks || []);
    setLoading(false);
  }

  async function setTaskStatus(taskId: string, nextStatus: Task['status']) {
    setBusyTaskId(taskId);

    await fetch('/api/task-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, status: nextStatus })
    });

    await loadTasks();
    setBusyTaskId(null);
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
    <main style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1>Hotel Task Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Card title="Open" value={summary.open} />
        <Card title="Doing" value={summary.doing} />
        <Card title="Done" value={summary.done} />
      </div>

      <div style={{ marginTop: 12 }}>
        {statuses.map((s) => (
          <button key={s} onClick={() => setStatus(s)} style={pill(status === s)}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        {departments.map((d) => (
          <button key={d} onClick={() => setDept(d)} style={pill(dept === d)}>
            {d}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        filtered.map((task) => (
          <div key={task.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{task.task_code}</strong>
              <span>{task.status}</span>
            </div>

            <div>
              Room <b>{task.room}</b> · {task.department}
            </div>

            <div>{task.task_text}</div>

            <div style={{ fontSize: 12 }}>
              Created: {new Date(task.created_at).toLocaleString()}
            </div>

            {task.status === 'DONE' && task.done_at && (
              <div style={{ fontSize: 12 }}>
                Completed: {new Date(task.done_at).toLocaleString()}
              </div>
            )}

            {task.status === 'DONE' && task.done_by_name && (
              <div style={{ fontSize: 12 }}>
                Done by: {task.done_by_name}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <button onClick={() => setTaskStatus(task.id, 'OPEN')}>
                Open
              </button>
              <button onClick={() => setTaskStatus(task.id, 'IN_PROGRESS')}>
                Doing
              </button>
              <button onClick={() => setTaskStatus(task.id, 'DONE')}>
                Done
              </button>
            </div>
          </div>
        ))
      )}
    </main>
  );
}

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ border: '1px solid #ddd', padding: 10 }}>
      {title}: {value}
    </div>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    marginRight: 6,
    padding: 6,
    background: active ? 'black' : 'white',
    color: active ? 'white' : 'black'
  };
}

const card: React.CSSProperties = {
  border: '1px solid #ddd',
  marginTop: 10,
  padding: 10
};
