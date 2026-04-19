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
  repeat_every_days: number;
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
  telegram_sent_at: string | null;
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

function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function dayInputOnChange(
  next: string,
  setter: React.Dispatch<React.SetStateAction<string>>
) {
  if (next === '') {
    setter('');
    return;
  }
  if (/^\d+$/.test(next)) {
    setter(next);
  }
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
  const [newRepeatEveryDaysInput, setNewRepeatEveryDaysInput] = useState('30');
  const [newDueInDaysInput, setNewDueInDaysInput] = useState('7');
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
          role: (profileRow?.role || 'MT') as DashboardUser['role'],
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
    return (
      profile.role === 'SUPERUSER' ||
      profile.role === 'MANAGER' ||
      (profile.role === 'SUPERVISOR' && isHkSupervisorByEmail)
    );
  }, [profile, isHkSupervisorByEmail]);

  const canDelete = useMemo(() => {
    if (!profile) return false;
    return profile.role === 'SUPERUSER' || profile.role === 'MANAGER';
  }, [profile]);

  async function noopTelegramNotifications(_supabase: any) {
    return;
  }

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
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      return diffMs <= sevenDaysMs;
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

  function openCreateModal() {
    if (!canCreate) return;
    setErrorMsg('');
    setSuccessMsg('');
    setNewTitle('');
    setNewDescription('');
    setNewRepeatEveryDaysInput('30');
    setNewDueInDaysInput('7');
    setNewHasRoomChecklist(false);
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    if (creatingTask) return;
    setShowCreateModal(false);
  }

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

    const parsedRepeatEveryDays = parseWholeNumber(newRepeatEveryDaysInput);
    if (parsedRepeatEveryDays === null) {
      setErrorMsg('Please enter Repeat Every days.');
      return;
    }
    if (parsedRepeatEveryDays <= 0) {
      setErrorMsg('Repeat every days must be more than 0.');
      return;
    }

    const parsedDueInDays = parseWholeNumber(newDueInDaysInput);
    if (parsedDueInDays === null) {
      setErrorMsg('Please enter Due In days.');
      return;
    }
    if (parsedDueInDays < 0) {
      setErrorMsg('Due in days cannot be negative.');
      return;
    }

    try {
      setCreatingTask(true);
      setErrorMsg('');
      setSuccessMsg('');

      const today = getTodayLocalDateString();
      const dueDate = addDaysToDate(today, parsedDueInDays);

      const { data: insertedTask, error: taskError } = await supabase
        .from('hk_special_project_tasks')
        .insert([
          {
            title,
            description: newDescription.trim() || null,
            repeat_every_days: parsedRepeatEveryDays,
            due_in_days: parsedDueInDays,
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
      setNewRepeatEveryDaysInput('30');
      setNewDueInDaysInput('7');
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

    if (!profile) {
      setErrorMsg('User not found.');
      return;
    }

    if (!(profile.role === 'SUPERUSER' || profile.role === 'MANAGER')) {
      setErrorMsg('You do not have permission to delete routine tasks.');
      return;
    }

    const confirmed = window.confirm(
      `Delete routine task "${taskTitle}" and all related runs? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setBusyDeleteTaskId(taskId);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('hk_special_project_tasks')
        .update({ is_active: false })
        .eq('id', taskId);

      if (error) throw error;

      setSuccessMsg(`Task "${taskTitle}" deleted.`);
      if (selectedRun && selectedRun.task.id === taskId) {
        setSelectedRunId(null);
      }
      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete routine task');
    } finally {
      setBusyDeleteTaskId(null);
    }
  }

  async function handleToggleRoom(roomId: string, checked: boolean) {
    const supabase = getSupabaseSafe();
    if (!supabase || !profile?.user_id) return;

    try {
      setBusyRoomId(roomId);
      setErrorMsg('');
      setSuccessMsg('');

      const payload = checked
        ? {
            is_done: true,
            done_at: new Date().toISOString(),
            done_by_user_id: profile.user_id,
            done_by_name: profile.name || profile.email,
          }
        : {
            is_done: false,
            done_at: null,
            done_by_user_id: null,
            done_by_name: null,
          };

      const { error } = await supabase
        .from('hk_special_project_task_run_rooms')
        .update(payload)
        .eq('id', roomId);

      if (error) throw error;

      await loadAllData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update room status');
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
        <div style={styles.taskTopRow}>
          <div>
            <div style={styles.taskTitle}>{card.task.title}</div>
            {card.task.description ? (
              <div style={styles.taskDescription}>{card.task.description}</div>
            ) : null}
          </div>

          <div style={{
            ...styles.statusBadge,
            ...(card.run.status === 'DONE'
              ? styles.statusDone
              : card.run.status === 'OVERDUE'
              ? styles.statusOverdue
              : styles.statusOpen),
          }}>
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
            <div style={styles.metaLabel}>Rooms</div>
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

        {card.run.reopened_at ? (
          <div style={styles.auditText}>
            Reopened: {formatDateTime(card.run.reopened_at)}
            {card.run.reopened_by_name ? ` · ${card.run.reopened_by_name}` : ''}
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
          <p style={styles.centerText}>You do not have permission to access HK Special Project.</p>
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
            <div style={styles.pageTitle}>HK Special Project</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) · Mobile friendly maintenance routine tracker
            </div>
          </div>

          <div style={styles.topBarActions}>
            {canCreate ? (
              <button type="button" onClick={openCreateModal} style={styles.primaryHeaderBtn}>
                Add Routine Task
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
                <div style={styles.emptyState}>No open routine tasks.</div>
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

      {showCreateModal ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
            <div style={styles.modalTop}>
              <div style={styles.modalTitle}>Create Routine Task</div>
              <button type="button" onClick={closeCreateModal} style={styles.closeBtn} disabled={creatingTask}>
                ×
              </button>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Task Title</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={styles.input}
                placeholder="Example: Water Heater Check"
                disabled={creatingTask}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                style={styles.textarea}
                placeholder="Optional notes or SOP"
                disabled={creatingTask}
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Repeat Every (Days)</label>
                <input
                  type="number"
                  value={newRepeatEveryDaysInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setNewRepeatEveryDaysInput('');
                      return;
                    }
                    if (!Number.isNaN(Number(val))) {
                      setNewRepeatEveryDaysInput(val);
                    }
                  }}
                  style={styles.input}
                  placeholder="30"
                  disabled={creatingTask}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Due In (Days)</label>
                <input
                  type="number"
                  value={newDueInDaysInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setNewDueInDaysInput('');
                      return;
                    }
                    if (!Number.isNaN(Number(val))) {
                      setNewDueInDaysInput(val);
                    }
                  }}
                  style={styles.input}
                  placeholder="7"
                  disabled={creatingTask}
                />
              </div>
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={newHasRoomChecklist}
                onChange={(e) => setNewHasRoomChecklist(e.target.checked)}
                disabled={creatingTask}
              />
              <span>Attach full room checklist ({allRooms.length} active rooms)</span>
            </label>

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeCreateModal}
                style={styles.secondaryBtn}
                disabled={creatingTask}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleCreateTask()}
                style={styles.primaryBtn}
                disabled={creatingTask}
              >
                {creatingTask ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedRun ? (
        <div style={styles.modalOverlay} onClick={closeRoomChecklist}>
          <div style={styles.roomModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTop}>
              <div>
                <div style={styles.modalTitle}>Room Checklist</div>
                <div style={styles.modalSubTitle}>
                  {selectedRun.task.title} · Due {formatDate(selectedRun.run.due_date)}
                </div>
              </div>

              <button type="button" onClick={closeRoomChecklist} style={styles.closeBtn}>
                ×
              </button>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Search Room</label>
              <input
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                style={styles.input}
                placeholder="Type room number"
              />
            </div>

            <div style={styles.roomList}>
              {filteredSelectedRooms.length === 0 ? (
                <div style={styles.emptyState}>No rooms found.</div>
              ) : (
                filteredSelectedRooms.map((room) => (
                  <label key={room.id} style={styles.roomRow}>
                    <div>
                      <div style={styles.roomNumber}>{room.room_number}</div>
                      <div style={styles.roomAudit}>
                        {room.done_at ? `Done: ${formatDateTime(room.done_at)}` : 'Pending'}
                        {room.done_by_name ? ` · ${room.done_by_name}` : ''}
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      checked={room.is_done}
                      onChange={(e) => void handleToggleRoom(room.id, e.target.checked)}
                      disabled={busyRoomId === room.id}
                    />
                  </label>
                ))
              )}
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
  helperText: {
    marginTop: '10px',
    color: '#b45309',
    fontSize: '13px',
    fontWeight: 600,
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
    userSelect: 'none',
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
    userSelect: 'text',
    maxWidth: '640px',
    background: '#fff',
    borderRadius: '22px',
    padding: '20px',
    boxShadow: '0 20px 50px rgba(15,23,42,0.28)',
  },
  roomModalCard: {
    width: '100%',
    maxWidth: '760px',
    maxHeight: '85vh',
    overflowY: 'auto',
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
  modalSubTitle: {
    fontSize: '14px',
    color: '#64748b',
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
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '6px',
    marginBottom: '16px',
    color: '#334155',
    fontWeight: 600,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
  },
  roomList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '10px',
  },
  roomRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '12px 14px',
    background: '#fff',
  },
  roomNumber: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
  },
  roomAudit: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
  },
};
