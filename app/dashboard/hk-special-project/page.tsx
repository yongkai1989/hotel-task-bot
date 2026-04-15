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

type RoomRow = {
  room_number: string;
  block_no: number;
  floor_no: number;
  room_type: string;
  is_active?: boolean;
};

type HkTask = {
  id: string;
  title: string;
  description: string | null;
  repeat_every_days: number | null;
  due_in_days: number;
  has_room_checklist: boolean;
  is_active: boolean;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type HkTaskRun = {
  id: string;
  hk_special_project_task_id: string;
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

type HkTaskRunRoom = {
  id: string;
  hk_special_project_task_run_id: string;
  room_number: string;
  is_done: boolean;
  done_at: string | null;
  done_by_user_id: string | null;
  done_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type TaskCardData = {
  task: HkTask;
  run: HkTaskRun;
  rooms: HkTaskRunRoom[];
  totalRooms: number;
  doneRooms: number;
};

const HK_SUPERVISOR_EMAILS = [
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
];

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

export default function HkSpecialProjectPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [allRooms, setAllRooms] = useState<RoomRow[]>([]);
  const [tasks, setTasks] = useState<HkTask[]>([]);
  const [runs, setRuns] = useState<HkTaskRun[]>([]);
  const [runRooms, setRunRooms] = useState<HkTaskRunRoom[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsRecurring, setNewIsRecurring] = useState(true);
  const [newRepeatEveryDays, setNewRepeatEveryDays] = useState(30);
  const [newDueInDays, setNewDueInDays] = useState(7);
  const [newHasRoomChecklist, setNewHasRoomChecklist] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [roomSearch, setRoomSearch] = useState('');
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [busyDeleteTaskId, setBusyDeleteTaskId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');

        setAuthLoading(true);
        setErrorMsg('');

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
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
          role: (profileRow?.role || 'HK') as DashboardUser['role'],
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

  const isHkSupervisorByEmail = useMemo(() => {
    const email = profile?.email?.toLowerCase() || '';
    return HK_SUPERVISOR_EMAILS.includes(email);
  }, [profile]);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'SUPERUSER' || profile.role === 'MANAGER') return true;
    if (profile.role === 'SUPERVISOR' && isHkSupervisorByEmail) return true;
    return false;
  }, [profile, isHkSupervisorByEmail]);

  const canCreate = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER';
  }, [profile]);

  const canDelete = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER';
  }, [profile]);

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

      const { error: recurrenceError } = await supabase.rpc('run_hk_special_project_recurrence');
      if (recurrenceError) {
        console.error('run_hk_special_project_recurrence error:', recurrenceError);
      }

      const [roomRes, taskRes, runRes, roomChecklistRes] = await Promise.all([
        supabase
          .from('room_master')
          .select('room_number, block_no, floor_no, room_type, is_active')
          .eq('is_active', true)
          .order('room_number', { ascending: true }),
        supabase
          .from('hk_special_project_tasks')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('hk_special_project_task_runs')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('hk_special_project_task_run_rooms')
          .select('*')
          .order('room_number', { ascending: true }),
      ]);

      if (roomRes.error) throw roomRes.error;
      if (taskRes.error) throw taskRes.error;
      if (runRes.error) throw runRes.error;
      if (roomChecklistRes.error) throw roomChecklistRes.error;

      setAllRooms((roomRes.data || []) as RoomRow[]);
      setTasks((taskRes.data || []) as HkTask[]);
      setRuns((runRes.data || []) as HkTaskRun[]);
      setRunRooms((roomChecklistRes.data || []) as HkTaskRunRoom[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load HK Special Project data');
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    void loadAllData();
  }, [profile, canAccess]);

  const taskCards = useMemo(() => {
    const taskMap = new Map<string, HkTask>();
    tasks.forEach((task) => taskMap.set(task.id, task));

    const roomsByRunId = new Map<string, HkTaskRunRoom[]>();
    runRooms.forEach((row) => {
      const list = roomsByRunId.get(row.hk_special_project_task_run_id) || [];
      list.push(row);
      roomsByRunId.set(row.hk_special_project_task_run_id, list);
    });

    return runs
      .map((run) => {
        const task = taskMap.get(run.hk_special_project_task_id);
        if (!task) return null;
        const attachedRooms = roomsByRunId.get(run.id) || [];
        const doneRooms = attachedRooms.filter((r) => r.is_done).length;

        return {
          task,
          run,
          rooms: attachedRooms,
          totalRooms: attachedRooms.length,
          doneRooms,
        } as TaskCardData;
      })
      .filter(Boolean) as TaskCardData[];
  }, [tasks, runs, runRooms]);

  const taskCardMap = useMemo(() => {
    const map = new Map<string, TaskCardData>();
    taskCards.forEach((card) => map.set(card.run.id, card));
    return map;
  }, [taskCards]);

  const selectedRun = useMemo(() => {
    if (!selectedRunId) return null;
    return taskCardMap.get(selectedRunId) || null;
  }, [selectedRunId, taskCardMap]);

  const visibleDoneCards = useMemo(() => {
    return taskCards.filter((card) => {
      if (card.run.status !== 'DONE') return false;
      if (!card.run.completed_at) return false;

      const completedAt = new Date(card.run.completed_at);
      if (Number.isNaN(completedAt.getTime())) return true;

      const now = new Date();
      const diffMs = now.getTime() - completedAt.getTime();
      const retentionMs = 30 * 24 * 60 * 60 * 1000;

      return diffMs <= retentionMs;
    });
  }, [taskCards]);

  const openCards = useMemo(() => taskCards.filter((card) => card.run.status === 'OPEN'), [taskCards]);
  const overdueCards = useMemo(() => taskCards.filter((card) => card.run.status === 'OVERDUE'), [taskCards]);

  const filteredSelectedRooms = useMemo(() => {
    if (!selectedRun) return [];
    const keyword = roomSearch.trim();
    if (!keyword) return selectedRun.rooms;
    return selectedRun.rooms.filter((room) => room.room_number.includes(keyword));
  }, [selectedRun, roomSearch]);

  async function handleCreateTask() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const title = newTitle.trim();
    if (!title) {
      setErrorMsg('Please enter a task title.');
      return;
    }

    if (newIsRecurring && newRepeatEveryDays <= 0) {
      setErrorMsg('Repeat every days must be more than 0.');
      return;
    }

    if (newDueInDays < 0) {
      setErrorMsg('Due in days cannot be negative.');
      return;
    }

    try {
      setCreatingTask(true);
      setErrorMsg('');
      setSuccessMsg('');

      const today = getTodayLocalDateString();
      const dueDate = addDaysToDate(today, newDueInDays);

      const { data: insertedTask, error: taskError } = await supabase
        .from('hk_special_project_tasks')
        .insert([
          {
            title,
            description: newDescription.trim() || null,
            repeat_every_days: newIsRecurring ? newRepeatEveryDays : null,
            due_in_days: newDueInDays,
            has_room_checklist: newHasRoomChecklist,
            is_active: true,
            created_by_user_id: profile.user_id,
            created_by_name: profile.name || profile.email,
          },
        ])
        .select('*')
        .single();

      if (taskError) throw taskError;

      const { data: insertedRun, error: runError } = await supabase
        .from('hk_special_project_task_runs')
        .insert([
          {
            hk_special_project_task_id: insertedTask.id,
            run_start_date: today,
            due_date: dueDate,
            status: 'OPEN',
          },
        ])
        .select('*')
        .single();

      if (runError) throw runError;

      if (newHasRoomChecklist) {
        const roomRows = allRooms.map((room) => ({
          hk_special_project_task_run_id: insertedRun.id,
          room_number: room.room_number,
          is_done: false,
        }));

        if (roomRows.length > 0) {
          const { error: checklistError } = await supabase
            .from('hk_special_project_task_run_rooms')
            .insert(roomRows);

          if (checklistError) throw checklistError;
        }
      }

      setNewTitle('');
      setNewDescription('');
      setNewIsRecurring(true);
      setNewRepeatEveryDays(30);
      setNewDueInDays(7);
      setNewHasRoomChecklist(false);
      setShowCreateModal(false);
      setSuccessMsg('HK Special Project task created successfully.');

      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create HK Special Project task');
    } finally {
      setCreatingTask(false);
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

    if (card.task.has_room_checklist && card.doneRooms !== card.totalRooms) {
      setErrorMsg('Complete all rooms first before marking this task as done.');
      return;
    }

    try {
      setBusyRunId(card.run.id);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('hk_special_project_task_runs')
        .update({
          status: 'DONE',
          completed_at: new Date().toISOString(),
          completed_by_user_id: profile.user_id,
          completed_by_name: profile.name || profile.email,
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
        .from('hk_special_project_task_runs')
        .update({
          status: nextStatus,
          completed_at: null,
          completed_by_user_id: null,
          completed_by_name: null,
          reopened_at: new Date().toISOString(),
          reopened_by_user_id: profile.user_id,
          reopened_by_name: profile.name || profile.email,
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

    if (!profile || !(profile.role === 'SUPERUSER' || profile.role === 'MANAGER')) {
      setErrorMsg('You do not have permission to delete routine tasks.');
      return;
    }

    const confirmed = window.confirm(
      `Delete HK Special Project "${taskTitle}" and all related runs? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setBusyDeleteTaskId(taskId);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('hk_special_project_tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;

      if (selectedRun?.task.id === taskId) {
        setSelectedRunId(null);
        setRoomSearch('');
      }

      setSuccessMsg(`HK Special Project "${taskTitle}" deleted successfully.`);
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete HK Special Project');
    } finally {
      setBusyDeleteTaskId(null);
    }
  }

  async function handleToggleRoom(room: HkTaskRunRoom) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!profile?.user_id) {
      setErrorMsg('User not found.');
      return;
    }

    const previous = room.is_done;
    const nextDone = !previous;
    const nextDoneAt = nextDone ? new Date().toISOString() : null;
    const nextDoneByUserId = nextDone ? profile.user_id || null : null;
    const nextDoneByName = nextDone ? (profile.name || profile.email) : null;

    setBusyRoomId(room.id);
    setRunRooms((prev) =>
      prev.map((r) =>
        r.id === room.id
          ? {
              ...r,
              is_done: nextDone,
              done_at: nextDoneAt,
              done_by_user_id: nextDoneByUserId,
              done_by_name: nextDoneByName,
            }
          : r
      )
    );

    try {
      const { error } = await supabase
        .from('hk_special_project_task_run_rooms')
        .update({
          is_done: nextDone,
          done_at: nextDoneAt,
          done_by_user_id: nextDoneByUserId,
          done_by_name: nextDoneByName,
        })
        .eq('id', room.id);

      if (error) throw error;
    } catch (err: any) {
      setRunRooms((prev) =>
        prev.map((r) =>
          r.id === room.id
            ? {
                ...r,
                is_done: previous,
                done_at: room.done_at,
                done_by_user_id: room.done_by_user_id,
                done_by_name: room.done_by_name,
              }
            : r
        )
      );
      setErrorMsg(err?.message || 'Failed to update room checklist');
    } finally {
      setBusyRoomId(null);
    }
  }

  function openRoomChecklist(card: TaskCardData) {
    setSelectedRunId(card.run.id);
    setRoomSearch('');
  }

  function closeRoomChecklist() {
    setSelectedRunId(null);
    setRoomSearch('');
  }

  function renderTaskCard(card: TaskCardData, section: 'OPEN' | 'OVERDUE' | 'DONE') {
    const doneDisabled =
      busyRunId === card.run.id ||
      (card.task.has_room_checklist && card.doneRooms !== card.totalRooms);

    return (
      <div key={card.run.id} style={styles.taskCard}>
        <div style={styles.taskCardHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.taskTitle}>{card.task.title}</div>
            {card.task.description ? (
              <div style={styles.taskDescription}>{card.task.description}</div>
            ) : null}
          </div>

          <div
            style={{
              ...styles.statusPill,
              ...(section === 'OPEN'
                ? styles.statusOpen
                : section === 'OVERDUE'
                ? styles.statusOverdue
                : styles.statusDone),
            }}
          >
            {section}
          </div>
        </div>

        <div style={styles.metaGrid}>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Recurrence</div>
            <div style={styles.metaValue}>
              {card.task.repeat_every_days ? `Every ${card.task.repeat_every_days} day(s)` : 'Does not recur'}
            </div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Start</div>
            <div style={styles.metaValue}>{formatDate(card.run.run_start_date)}</div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Due</div>
            <div style={styles.metaValue}>{formatDate(card.run.due_date)}</div>
          </div>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Checklist</div>
            <div style={styles.metaValue}>
              {card.task.has_room_checklist ? `${card.doneRooms}/${card.totalRooms} rooms` : 'No room list'}
            </div>
          </div>
        </div>

        {card.run.completed_at ? (
          <div style={styles.auditText}>
            Completed: {formatDateTime(card.run.completed_at)}
            {card.run.completed_by_name ? ` · ${card.run.completed_by_name}` : ''}
          </div>
        ) : null}

        {card.run.status === 'OVERDUE' ? (
          <div style={styles.overdueRemark}>
            Overdue. This task will not be reissued again until this cycle is resolved.
          </div>
        ) : null}

        <div style={styles.cardActions}>
          {card.task.has_room_checklist ? (
            <button
              type="button"
              onClick={() => openRoomChecklist(card)}
              style={styles.secondaryActionBtn}
            >
              View Rooms
            </button>
          ) : null}

          {section !== 'DONE' ? (
            <button
              type="button"
              onClick={() => void handleMarkDone(card)}
              disabled={doneDisabled}
              style={{
                ...styles.primaryActionBtn,
                opacity: doneDisabled ? 0.5 : 1,
                cursor: doneDisabled ? 'not-allowed' : 'pointer',
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

          {canDelete ? (
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
          ) : null}
        </div>

        {card.task.has_room_checklist && section !== 'DONE' && card.doneRooms !== card.totalRooms ? (
          <div style={styles.helperText}>Done button unlocks only when all rooms are completed.</div>
        ) : null}
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
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>You do not have permission to access HK Special Project.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>HK Special Project</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) · Housekeeping special project tracker
            </div>
          </div>

          <div style={styles.topBarActions}>
            {canCreate ? (
              <button type="button" onClick={() => setShowCreateModal(true)} style={styles.primaryHeaderBtn}>
                Add Task
              </button>
            ) : null}

            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
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
            <div style={styles.summaryLabel}>Done (30 days)</div>
            <div style={{ ...styles.summaryValue, color: '#166534' }}>{visibleDoneCards.length}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Active Rooms</div>
            <div style={styles.summaryValue}>{allRooms.length}</div>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        {pageLoading ? (
          <div style={styles.panel}>
            <div style={styles.emptyState}>Loading HK Special Project tasks...</div>
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
                <div style={styles.emptyState}>No completed tasks in the last 30 days.</div>
              ) : (
                <div style={styles.cardsWrap}>
                  {visibleDoneCards.map((card) => renderTaskCard(card, 'DONE'))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {showCreateModal ? (
        <div style={styles.modalOverlay} onClick={() => !creatingTask && setShowCreateModal(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Create Task</div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Task Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={styles.input}
                placeholder="Example: Deep Clean Project"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                style={styles.textarea}
                placeholder="Optional notes or SOP"
              />
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={newIsRecurring}
                onChange={(e) => setNewIsRecurring(e.target.checked)}
              />
              <span>This task recurs</span>
            </label>

            {newIsRecurring ? (
              <div style={styles.formGroup}>
                <label style={styles.label}>Repeat Every (Days)</label>
                <input
                  type="number"
                  min={1}
                  value={newRepeatEveryDays}
                  onChange={(e) => setNewRepeatEveryDays(Math.max(1, Number(e.target.value || 1)))}
                  style={styles.input}
                />
              </div>
            ) : (
              <div style={styles.helperText}>This task will only run once and will not be issued again after completion.</div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.label}>Due In (Days)</label>
              <input
                type="number"
                min={0}
                value={newDueInDays}
                onChange={(e) => setNewDueInDays(Math.max(0, Number(e.target.value || 0)))}
                style={styles.input}
              />
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={newHasRoomChecklist}
                onChange={(e) => setNewHasRoomChecklist(e.target.checked)}
              />
              <span>Attach full room checklist ({allRooms.length} active rooms)</span>
            </label>

            <div style={styles.modalActions}>
              <button type="button" onClick={() => setShowCreateModal(false)} disabled={creatingTask} style={styles.modalCancelBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateTask()}
                disabled={creatingTask}
                style={{ ...styles.modalCreateBtn, opacity: creatingTask ? 0.6 : 1 }}
              >
                {creatingTask ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedRun ? (
        <div style={styles.modalOverlay} onClick={closeRoomChecklist}>
          <div style={styles.largeModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.roomModalHeader}>
              <div>
                <div style={styles.modalTitle}>{selectedRun.task.title}</div>
                <div style={styles.pageSubTitle}>
                  {selectedRun.doneRooms} / {selectedRun.totalRooms} rooms completed · Due {formatDate(selectedRun.run.due_date)}
                </div>
              </div>
              <button type="button" onClick={closeRoomChecklist} style={styles.modalCloseBtn}>Close</button>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Search Room</label>
              <input
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Enter room number"
                style={styles.input}
              />
            </div>

            {filteredSelectedRooms.length === 0 ? (
              <div style={styles.emptyState}>No room found.</div>
            ) : (
              <div style={styles.roomGrid}>
                {filteredSelectedRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => void handleToggleRoom(room)}
                    disabled={busyRoomId === room.id}
                    style={{
                      ...styles.roomToggleBtn,
                      ...(room.is_done ? styles.roomToggleDone : {}),
                      opacity: busyRoomId === room.id ? 0.6 : 1,
                    }}
                  >
                    <div style={styles.roomToggleNo}>{room.room_number}</div>
                    <div style={styles.roomToggleStatus}>
                      {busyRoomId === room.id ? 'Saving...' : room.is_done ? 'Completed' : 'Pending'}
                    </div>
                  </button>
                ))}
              </div>
            )}
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
    padding: '20px',
    overflowX: 'hidden',
  },
  shell: {
    width: '100%',
    maxWidth: '1180px',
    margin: '0 auto',
    paddingInline: '4px',
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
  primaryHeaderBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
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
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  summaryCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '14px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '8px',
  },
  summaryValue: {
    fontSize: '30px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1,
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '20px',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
    gap: '14px',
  },
  taskCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
  },
  taskCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '14px',
  },
  taskTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  taskDescription: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '6px',
    lineHeight: 1.5,
  },
  statusPill: {
    borderRadius: '999px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  statusOpen: {
    background: '#dbeafe',
    color: '#1d4ed8',
  },
  statusOverdue: {
    background: '#fee2e2',
    color: '#b91c1c',
  },
  statusDone: {
    background: '#dcfce7',
    color: '#166534',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginBottom: '12px',
  },
  metaItem: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '10px',
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
    lineHeight: 1.3,
  },
  auditText: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '10px',
  },
  overdueRemark: {
    marginBottom: '10px',
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #fdba74',
    borderRadius: '12px',
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 700,
    lineHeight: 1.5,
  },
  cardActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginTop: '10px',
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
  primaryActionBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 800,
  },
  reopenBtn: {
    border: 'none',
    background: '#166534',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: 'none',
    background: '#b91c1c',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  helperText: {
    marginTop: '10px',
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
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
    background: 'rgba(15,23,42,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    zIndex: 1000,
  },
  modalCard: {
    width: '100%',
    maxWidth: '560px',
    background: '#ffffff',
    borderRadius: '18px',
    padding: '18px',
    boxShadow: '0 20px 40px rgba(15,23,42,0.25)',
  },
  largeModalCard: {
    width: '100%',
    maxWidth: '880px',
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#ffffff',
    borderRadius: '18px',
    padding: '18px',
    boxShadow: '0 20px 40px rgba(15,23,42,0.25)',
  },
  roomModalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '14px',
    flexWrap: 'wrap',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '14px',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '12px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
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
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    minHeight: '100px',
    resize: 'vertical',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontWeight: 700,
    color: '#334155',
    marginBottom: '16px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
  },
  modalCancelBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  modalCreateBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  modalCloseBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  roomGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
    gap: '10px',
  },
  roomToggleBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '14px 10px',
    cursor: 'pointer',
  },
  roomToggleDone: {
    background: '#dcfce7',
    borderColor: '#86efac',
    color: '#166534',
  },
  roomToggleNo: {
    fontSize: '18px',
    fontWeight: 800,
    marginBottom: '6px',
  },
  roomToggleStatus: {
    fontSize: '12px',
    fontWeight: 700,
  },
};
