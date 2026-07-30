'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Profile = {
  user_id: string;
  email: string;
  name: string;
  role: string;
  can_create_task?: boolean;
  can_update_task_status?: boolean;
  can_access_fo_checklist?: boolean;
};

type DashboardTask = {
  id: string;
  task_code: string;
  room: string;
  department: 'HK' | 'MT' | 'FO';
  task_text: string;
  status: 'OPEN' | 'DONE';
  customer_waiting?: boolean | null;
  customer_waiting_due_at?: string | null;
  customer_waiting_follow_up_count?: number | null;
  source_page?: string | null;
  created_by_email?: string | null;
  created_at: string;
  done_at?: string | null;
};

type ShiftReminder = {
  id: string;
  reminder_text: string;
  reference_text?: string | null;
  status: 'OPEN' | 'DONE';
  created_by_name?: string | null;
  created_at: string;
  completed_by_name?: string | null;
  completed_at?: string | null;
};

type TrackedItem = {
  id: string;
  item_name: string;
  notes?: string | null;
  is_active: boolean;
  current_status: 'AVAILABLE' | 'LOANED';
  loaned_to_name?: string | null;
  loaned_at?: string | null;
  updated_at: string;
};

type StatusView = 'OPEN' | 'DONE';
type ReminderAction = 'COMPLETE' | 'REOPEN';

const CUSTOMER_WAITING_LIMIT_MS = 15 * 60 * 1000;

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(new Date(value));
}

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function singleRpcRow<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('The saved record was not returned.');
  return row as T;
}

function customerWaitingTimer(task: DashboardTask, now: number) {
  if (task.status !== 'OPEN' || !task.customer_waiting) return null;
  const storedDueAt = Date.parse(String(task.customer_waiting_due_at || ''));
  const createdAt = Date.parse(task.created_at);
  const dueAt = Number.isFinite(storedDueAt)
    ? storedDueAt
    : Number.isFinite(createdAt)
      ? createdAt + CUSTOMER_WAITING_LIMIT_MS
      : Number.NaN;
  if (!Number.isFinite(dueAt)) return null;
  const remainingMs = dueAt - now;
  if (remainingMs <= 0) return { overdue: true, label: 'FOLLOW UP NOW' };
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return {
    overdue: false,
    label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  };
}

function belongsOnFoQuickActions(task: DashboardTask) {
  return (
    String(task.created_by_email || '').trim().toLowerCase() === 'fo@hotelhallmark.com'
    || task.department === 'FO'
    || String(task.source_page || '').trim().toUpperCase() === 'FO_QUICK_ACTIONS'
    || task.customer_waiting === true
  );
}

export default function FoQuickActionsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [taskView, setTaskView] = useState<StatusView>('OPEN');
  const [reminderView, setReminderView] = useState<StatusView>('OPEN');
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [reminders, setReminders] = useState<ShiftReminder[]>([]);
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());

  const [taskLocation, setTaskLocation] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDepartments, setTaskDepartments] = useState<Array<'HK' | 'MT'>>(['HK']);
  const [customerWaiting, setCustomerWaiting] = useState(false);
  const [followUpTaskId, setFollowUpTaskId] = useState<string | null>(null);
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpError, setFollowUpError] = useState('');

  const [reminderText, setReminderText] = useState('');
  const [reminderReference, setReminderReference] = useState('');
  const [reminderAction, setReminderAction] = useState<{ id: string; action: ReminderAction } | null>(null);
  const [reminderActorName, setReminderActorName] = useState('');

  const [loaningItemId, setLoaningItemId] = useState<string | null>(null);
  const [loanedToName, setLoanedToName] = useState('');
  const [showItemSetup, setShowItemSetup] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemNotes, setNewItemNotes] = useState('');

  const isSuperuser = String(profile?.role || '').toUpperCase() === 'SUPERUSER';
  const canAccess =
    isSuperuser ||
    String(profile?.role || '').toUpperCase() === 'FO' ||
    profile?.can_access_fo_checklist === true;

  const loadFoTasks = useCallback(async () => {
    const taskResponse = await fetch('/api/tasks', {
      cache: 'no-store',
      credentials: 'include',
    });
    const taskPayload = await responseJson(taskResponse);
    const foTasks = ((taskPayload?.tasks || []) as DashboardTask[])
      .filter(belongsOnFoQuickActions);
    setTasks(foTasks);
  }, []);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const [, reminderResult, itemResult] = await Promise.all([
        loadFoTasks(),
        supabase
          .from('fo_shift_reminders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80),
        supabase
          .from('fo_tracked_items')
          .select('*')
          .eq('is_active', true)
          .order('current_status', { ascending: false })
          .order('item_name', { ascending: true }),
      ]);

      if (reminderResult.error) throw reminderResult.error;
      if (itemResult.error) throw itemResult.error;

      setReminders((reminderResult.data || []) as ShiftReminder[]);
      setItems((itemResult.data || []) as TrackedItem[]);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to load FO Quick Actions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadFoTasks, supabase]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Your dashboard session has expired.');
        const response = await fetch('/api/session-profile', {
          cache: 'no-store',
          credentials: 'include',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload = await responseJson(response);
        if (!mounted) return;
        const nextProfile = payload.user as Profile;
        setProfile(nextProfile);
        setAccessToken(session.access_token);
        await loadData();
      } catch (nextError: any) {
        if (mounted) {
          setError(nextError?.message || 'Unable to verify FO access.');
          setLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [loadData, supabase]);

  useEffect(() => {
    if (!accessToken || !canAccess) return;
    const refreshTimers = new Map<string, number>();

    const removeTaskFromState = (taskId: string) => {
      setTasks((current) =>
        current.filter((task) => String(task.id) !== taskId)
      );
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

      const payload = await responseJson(response);
      const nextTask = payload?.task as DashboardTask;
      if (!nextTask || !belongsOnFoQuickActions(nextTask)) {
        removeTaskFromState(taskId);
        return;
      }

      setTasks((current) => {
        const existingIndex = current.findIndex(
          (task) => String(task.id) === taskId
        );
        const next =
          existingIndex >= 0
            ? current.map((task, index) =>
                index === existingIndex ? nextTask : task
              )
            : [nextTask, ...current];

        return next.sort(
          (a, b) =>
            Date.parse(String(b.created_at || '')) -
            Date.parse(String(a.created_at || ''))
        );
      });
    };

    let channel: any = null;

    const handleTaskChange = (payload: any) => {
      const taskId = String(payload?.new?.id || payload?.old?.id || '').trim();
      if (!taskId) {
        void loadFoTasks().catch((nextError: any) => {
          setError(nextError?.message || 'Unable to synchronize FO tasks.');
        });
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
        void refreshOneTask(taskId).catch((nextError: any) => {
          setError(nextError?.message || 'Unable to synchronize FO task.');
        });
      }, 250);
      refreshTimers.set(taskId, timer);
    };

    const startChannel = () => {
      if (channel || document.visibilityState !== 'visible') return;
      channel = supabase
        .channel(`fo-quick-actions-task-sync-${profile?.user_id || 'user'}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'tasks' },
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
        startChannel();
        void loadFoTasks().catch((nextError: any) => {
          setError(nextError?.message || 'Unable to synchronize FO tasks.');
        });
      } else {
        stopChannel();
      }
    };

    startChannel();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopChannel();
    };
  }, [accessToken, canAccess, loadFoTasks, profile?.user_id, supabase]);

  const openTasks = tasks.filter((task) => task.status === 'OPEN');
  const doneTasks = tasks.filter((task) => task.status === 'DONE');
  const visibleTasks = [...tasks]
    .filter((task) => task.status === taskView)
    .sort((a, b) => (
      Number(customerWaitingTimer(b, clockNow)?.overdue === true)
      - Number(customerWaitingTimer(a, clockNow)?.overdue === true)
      || Date.parse(b.created_at) - Date.parse(a.created_at)
    ))
    .slice(0, 16);
  const openReminders = reminders.filter((reminder) => reminder.status === 'OPEN');
  const doneReminders = reminders.filter((reminder) => reminder.status === 'DONE');
  const visibleReminders = reminders
    .filter((reminder) => reminder.status === reminderView)
    .slice(0, reminderView === 'OPEN' ? 30 : 12);
  const loanedItems = items.filter((item) => item.current_status === 'LOANED');
  const hasActiveCustomerWaiting = tasks.some((task) => task.status === 'OPEN' && task.customer_waiting);
  const overdueCustomerWaitingTasks = tasks
    .filter((task) => customerWaitingTimer(task, clockNow)?.overdue === true)
    .sort((a, b) => {
      const aDue = Date.parse(String(a.customer_waiting_due_at || a.created_at));
      const bDue = Date.parse(String(b.customer_waiting_due_at || b.created_at));
      return aDue - bDue;
    });
  const urgentCustomerWaitingTask = overdueCustomerWaitingTasks[0] || null;

  useEffect(() => {
    if (!hasActiveCustomerWaiting) return;
    setClockNow(Date.now());
    const timerId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [hasActiveCustomerWaiting]);

  useEffect(() => {
    if (urgentCustomerWaitingTask) setTaskView('OPEN');
    if (followUpTaskId && followUpTaskId !== urgentCustomerWaitingTask?.id) {
      setFollowUpTaskId(null);
      setFollowUpReason('');
      setFollowUpError('');
    }
  }, [followUpTaskId, urgentCustomerWaitingTask?.id]);

  function clearNotices() {
    setError('');
    setSuccess('');
  }

  function selectDepartments(choice: 'HK' | 'MT' | 'BOTH') {
    setTaskDepartments(choice === 'BOTH' ? ['HK', 'MT'] : [choice]);
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    clearNotices();
    if (!profile?.can_create_task && !isSuperuser) {
      setError('This FO account does not have task-creation permission.');
      return;
    }
    if (!taskLocation.trim() || !taskDescription.trim()) {
      setError('Enter the room/area and task details.');
      return;
    }
    if (!taskDepartments.length) {
      setError('Select at least one department.');
      return;
    }

    setBusyKey('create-task');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          room: taskLocation.trim(),
          departments: taskDepartments,
          task_text: taskDescription.trim(),
          customer_waiting: customerWaiting,
          source_page: 'FO_QUICK_ACTIONS',
        }),
      });
      const payload = await responseJson(response);
      const created = (payload.tasks || (payload.task ? [payload.task] : [])) as DashboardTask[];
      setTasks((current) => [...created, ...current]);
      setTaskLocation('');
      setTaskDescription('');
      setCustomerWaiting(false);
      setSuccess(`Task assigned to ${taskDepartments.join(' + ')}.`);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to create task.');
    } finally {
      setBusyKey('');
    }
  }

  async function createReminder(event: FormEvent) {
    event.preventDefault();
    clearNotices();
    if (!reminderText.trim()) {
      setError('Enter the reminder for the next shift.');
      return;
    }
    setBusyKey('create-reminder');
    try {
      const { data, error: rpcError } = await supabase.rpc('create_fo_shift_reminder', {
        p_reminder_text: reminderText.trim(),
        p_reference_text: reminderReference.trim() || null,
      });
      if (rpcError) throw rpcError;
      setReminders((current) => [singleRpcRow<ShiftReminder>(data), ...current]);
      setReminderText('');
      setReminderReference('');
      setReminderView('OPEN');
      setSuccess('Shift reminder added.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to create reminder.');
    } finally {
      setBusyKey('');
    }
  }

  async function followUpCustomerWaiting(event: FormEvent) {
    event.preventDefault();
    if (!urgentCustomerWaitingTask || followUpTaskId !== urgentCustomerWaitingTask.id) return;
    clearNotices();
    setFollowUpError('');
    if (followUpReason.trim().length < 3) {
      setFollowUpError('Enter the reason for the customer-waiting delay.');
      return;
    }

    setBusyKey(`follow-up-${urgentCustomerWaitingTask.id}`);
    try {
      const response = await fetch(
        `/api/tasks/${urgentCustomerWaitingTask.id}/customer-waiting-follow-up`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ reason: followUpReason.trim() }),
        }
      );
      const payload = await responseJson(response);
      const updatedTask = payload.task as DashboardTask;
      setTasks((current) => current.map((task) => (
        task.id === urgentCustomerWaitingTask.id ? updatedTask : task
      )));
      setFollowUpTaskId(null);
      setFollowUpReason('');
      setFollowUpError('');
      setClockNow(Date.now());
      setSuccess(`Follow-up recorded for ${urgentCustomerWaitingTask.task_code}. New 15-minute timer started.`);
    } catch (nextError: any) {
      setFollowUpError(nextError?.message || 'Unable to restart the customer-waiting timer.');
    } finally {
      setBusyKey('');
    }
  }

  async function setTaskStatus(taskId: string, nextStatus: StatusView) {
    clearNotices();
    if (!profile?.can_update_task_status && !isSuperuser) {
      setError('This FO account does not have permission to update task status.');
      return;
    }
    setBusyKey(`task-${taskId}`);
    try {
      const response = await fetch('/api/task-status', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ taskId, status: nextStatus }),
      });
      const payload = await responseJson(response);
      const updatedTask = payload.task as DashboardTask;
      setTasks((current) => current.map((task) => task.id === taskId ? updatedTask : task));
      setSuccess(nextStatus === 'DONE' ? 'Task marked as done.' : 'Task re-opened.');
    } catch (nextError: any) {
      const message = nextError?.message || 'Unable to update task status.';
      setError(message);
      if (urgentCustomerWaitingTask?.id === taskId) setFollowUpError(message);
    } finally {
      setBusyKey('');
    }
  }

  async function deleteTask(task: DashboardTask) {
    if (!isSuperuser) return;
    if (!window.confirm(`Delete task ${task.task_code} permanently? Any linked Manager Room Check will also be deleted.`)) return;
    clearNotices();
    setBusyKey(`task-${task.id}`);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      await responseJson(response);
      setTasks((current) => current.filter((row) => row.id !== task.id));
      setSuccess(`Task ${task.task_code} deleted.`);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to delete task.');
    } finally {
      setBusyKey('');
    }
  }

  async function changeReminderStatus(reminderId: string, action: ReminderAction) {
    clearNotices();
    if (!reminderActorName.trim()) {
      setError(`Enter your name before ${action === 'COMPLETE' ? 'completing' : 're-opening'} this reminder.`);
      return;
    }
    setBusyKey(`reminder-${reminderId}`);
    try {
      const rpcName = action === 'COMPLETE'
        ? 'complete_fo_shift_reminder'
        : 'reopen_fo_shift_reminder';
      const rpcArgs = action === 'COMPLETE'
        ? { p_reminder_id: reminderId, p_completed_by_name: reminderActorName.trim() }
        : { p_reminder_id: reminderId, p_reopened_by_name: reminderActorName.trim() };
      const { data, error: rpcError } = await supabase.rpc(rpcName, rpcArgs);
      if (rpcError) throw rpcError;
      const updatedReminder = singleRpcRow<ShiftReminder>(data);
      setReminders((current) => current.map((row) => row.id === reminderId ? updatedReminder : row));
      setReminderAction(null);
      setReminderActorName('');
      setSuccess(action === 'COMPLETE'
        ? 'Reminder completed and staff name recorded.'
        : 'Reminder re-opened and staff name recorded.');
    } catch (nextError: any) {
      setError(nextError?.message || `Unable to ${action === 'COMPLETE' ? 'complete' : 're-open'} reminder.`);
    } finally {
      setBusyKey('');
    }
  }

  async function deleteReminder(reminderId: string) {
    if (!isSuperuser || !window.confirm('Delete this reminder permanently?')) return;
    clearNotices();
    setBusyKey(`reminder-${reminderId}`);
    try {
      const { data, error: rpcError } = await supabase.rpc('delete_fo_shift_reminder', {
        p_reminder_id: reminderId,
      });
      if (rpcError) throw rpcError;
      if (data !== true) throw new Error('Reminder was not found or has already been deleted.');
      setReminders((current) => current.filter((row) => row.id !== reminderId));
      setSuccess('Reminder deleted.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to delete reminder.');
    } finally {
      setBusyKey('');
    }
  }

  async function loanItem(itemId: string) {
    clearNotices();
    if (!loanedToName.trim()) {
      setError('Enter who the item is being loaned to.');
      return;
    }
    setBusyKey(`item-${itemId}`);
    try {
      const { data, error: rpcError } = await supabase.rpc('loan_fo_tracked_item', {
        p_item_id: itemId,
        p_loaned_to_name: loanedToName.trim(),
      });
      if (rpcError) throw rpcError;
      const updatedItem = singleRpcRow<TrackedItem>(data);
      setItems((current) => current.map((item) => item.id === itemId ? updatedItem : item));
      setLoaningItemId(null);
      setLoanedToName('');
      setSuccess('Item marked as loaned.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to loan item.');
    } finally {
      setBusyKey('');
    }
  }

  async function returnItem(itemId: string) {
    clearNotices();
    setBusyKey(`item-${itemId}`);
    try {
      const { data, error: rpcError } = await supabase.rpc('return_fo_tracked_item', {
        p_item_id: itemId,
      });
      if (rpcError) throw rpcError;
      const updatedItem = singleRpcRow<TrackedItem>(data);
      setItems((current) => current.map((item) => item.id === itemId ? updatedItem : item));
      setSuccess('Item marked as returned.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to return item.');
    } finally {
      setBusyKey('');
    }
  }

  async function createTrackedItem(event: FormEvent) {
    event.preventDefault();
    clearNotices();
    if (!newItemName.trim()) {
      setError('Enter the item name.');
      return;
    }
    setBusyKey('create-item');
    try {
      const { data, error: rpcError } = await supabase.rpc('create_fo_tracked_item', {
        p_item_name: newItemName.trim(),
        p_notes: newItemNotes.trim() || null,
      });
      if (rpcError) throw rpcError;
      const createdItem = singleRpcRow<TrackedItem>(data);
      setItems((current) => [...current, createdItem].sort((a, b) => a.item_name.localeCompare(b.item_name)));
      setNewItemName('');
      setNewItemNotes('');
      setShowItemSetup(false);
      setSuccess('Tracked item created.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to create tracked item.');
    } finally {
      setBusyKey('');
    }
  }

  async function archiveItem(itemId: string) {
    const item = items.find((row) => row.id === itemId);
    const warning = item?.current_status === 'LOANED'
      ? `This item is currently loaned to ${item.loaned_to_name || 'someone'}. Remove it from active tracking anyway?`
      : 'Remove this item from FO tracking?';
    if (!isSuperuser || !window.confirm(warning)) return;
    clearNotices();
    setBusyKey(`item-${itemId}`);
    try {
      const { error: rpcError } = await supabase.rpc('set_fo_tracked_item_active', {
        p_item_id: itemId,
        p_is_active: false,
      });
      if (rpcError) throw rpcError;
      setItems((current) => current.filter((item) => item.id !== itemId));
      setSuccess('Tracked item archived.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to archive item.');
    } finally {
      setBusyKey('');
    }
  }

  if (loading) {
    return <main className="foq-page"><div className="foq-state">Opening FO Quick Actions...</div><Styles /></main>;
  }
  if (!profile || !canAccess) {
    return <main className="foq-page"><div className="foq-state"><h1>Access denied</h1><p>Front Office access is required.</p><Link href="/dashboard">Back to Dashboard</Link></div><Styles /></main>;
  }

  return (
    <main className="foq-page">
      {urgentCustomerWaitingTask ? (
        <div className="urgent-follow-up-overlay" role="alertdialog" aria-modal="true" aria-labelledby="urgent-follow-up-title">
          <section className="urgent-follow-up-modal">
            <div className="urgent-alarm-mark" aria-hidden="true">!</div>
            <span className="urgent-kicker">CUSTOMER WAITING</span>
            <h2 id="urgent-follow-up-title">Urgent follow-up overdue</h2>
            <p className="urgent-task-reference">
              <b>{urgentCustomerWaitingTask.task_code}</b>
              <span>{urgentCustomerWaitingTask.room}</span>
              <em>{urgentCustomerWaitingTask.department}</em>
            </p>
            <p className="urgent-task-text">{urgentCustomerWaitingTask.task_text}</p>
            <div className="urgent-overdue-banner">15-MINUTE TIMER EXPIRED</div>
            {overdueCustomerWaitingTasks.length > 1 ? (
              <p className="urgent-queue-count">
                {overdueCustomerWaitingTasks.length} customer-waiting tasks need attention
              </p>
            ) : null}
            {followUpTaskId === urgentCustomerWaitingTask.id ? (
              <form className="urgent-reason-form" onSubmit={followUpCustomerWaiting}>
                <label>
                  Reason for delay
                  <textarea
                    autoFocus
                    value={followUpReason}
                    onChange={(event) => setFollowUpReason(event.target.value)}
                    placeholder="Explain why the guest request was delayed..."
                    maxLength={500}
                    rows={3}
                  />
                </label>
                {followUpError ? <div className="urgent-inline-error">{followUpError}</div> : null}
                <div className="urgent-form-actions">
                  <button type="button" className="urgent-cancel-btn" onClick={() => { setFollowUpTaskId(null); setFollowUpReason(''); setFollowUpError(''); }}>Back</button>
                  <button type="submit" className="urgent-restart-btn" disabled={busyKey === `follow-up-${urgentCustomerWaitingTask.id}`}>
                    {busyKey === `follow-up-${urgentCustomerWaitingTask.id}` ? 'Saving...' : 'Save & Restart 15 Minutes'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="urgent-primary-actions">
                  <button type="button" className="urgent-follow-up-btn" onClick={() => { setFollowUpTaskId(urgentCustomerWaitingTask.id); setFollowUpReason(''); setFollowUpError(''); }}>
                    Follow Up
                  </button>
                  <button
                    type="button"
                    className="urgent-complete-btn"
                    disabled={busyKey === `task-${urgentCustomerWaitingTask.id}`}
                    onClick={() => {
                      setFollowUpError('');
                      void setTaskStatus(urgentCustomerWaitingTask.id, 'DONE');
                    }}
                  >
                    {busyKey === `task-${urgentCustomerWaitingTask.id}` ? 'Saving...' : 'Mark as Done'}
                  </button>
                </div>
                {followUpError ? <div className="urgent-inline-error">{followUpError}</div> : null}
              </>
            )}
          </section>
        </div>
      ) : null}
      <header className="foq-header">
        <div>
          <span className="eyebrow">FRONT OFFICE WORKSPACE</span>
          <h1>FO Quick Actions</h1>
          <p>Assign guest tasks, hand over reminders, and see where FO items are.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary" disabled={refreshing} onClick={() => void loadData(true)}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link href="/dashboard">Dashboard</Link>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}
      {success ? <div className="notice success">{success}</div> : null}

      <section className="item-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">ITEM WHEREABOUTS</span>
            <h2>FO items</h2>
          </div>
          <div className="heading-actions">
            <span className={loanedItems.length ? 'count warn' : 'count good'}>{loanedItems.length} loaned</span>
            {isSuperuser ? <button type="button" className="small secondary" onClick={() => setShowItemSetup((value) => !value)}>+ Item</button> : null}
          </div>
        </div>

        {showItemSetup ? (
          <form className="inline-create" onSubmit={createTrackedItem}>
            <input autoFocus value={newItemName} onChange={(event) => setNewItemName(event.target.value)} placeholder="Item name, e.g. Mastercard" maxLength={120} />
            <input value={newItemNotes} onChange={(event) => setNewItemNotes(event.target.value)} placeholder="Optional note" maxLength={250} />
            <button disabled={busyKey === 'create-item'}>{busyKey === 'create-item' ? 'Adding...' : 'Add item'}</button>
            <button type="button" className="secondary" onClick={() => setShowItemSetup(false)}>Cancel</button>
          </form>
        ) : null}

        <div className="item-strip">
          {items.length ? items.map((item) => (
            <article key={item.id} className={`item-card ${item.current_status.toLowerCase()}`}>
              <div className="item-top">
                <strong>{item.item_name}</strong>
                <span>{item.current_status}</span>
              </div>
              {item.current_status === 'LOANED' ? (
                <>
                  <div className="holder">With <b>{item.loaned_to_name}</b></div>
                  <small>Since {formatDateTime(item.loaned_at)}</small>
                  <button type="button" className="return-btn" disabled={busyKey === `item-${item.id}`} onClick={() => void returnItem(item.id)}>
                    {busyKey === `item-${item.id}` ? 'Saving...' : 'Mark Returned'}
                  </button>
                </>
              ) : loaningItemId === item.id ? (
                <div className="inline-action">
                  <input autoFocus value={loanedToName} onChange={(event) => setLoanedToName(event.target.value)} placeholder="Loaned to who?" maxLength={120} onKeyDown={(event) => { if (event.key === 'Enter') void loanItem(item.id); }} />
                  <button type="button" disabled={busyKey === `item-${item.id}`} onClick={() => void loanItem(item.id)}>Confirm</button>
                  <button type="button" className="secondary" onClick={() => { setLoaningItemId(null); setLoanedToName(''); }}>Cancel</button>
                </div>
              ) : (
                <>
                  <small>{item.notes || 'Ready at Front Office'}</small>
                  <button type="button" onClick={() => { setLoaningItemId(item.id); setLoanedToName(''); }}>Loan Out</button>
                </>
              )}
              {isSuperuser ? (
                <button type="button" className="archive-link" onClick={() => void archiveItem(item.id)}>Remove</button>
              ) : null}
            </article>
          )) : <div className="empty-inline">No FO items configured yet.{isSuperuser ? ' Add the first item.' : ''}</div>}
        </div>
      </section>

      <section className="command-board">
        <section className="command-column task-command">
          <div className="command-title">
            <div><span className="eyebrow">DEPARTMENT TASKS</span><h2>Assign and follow up</h2><p>FO-created tasks and every task assigned to FO.</p></div>
            <span className="command-count">{openTasks.length}<small>open</small></span>
          </div>

          <form className="quick-form task-form" onSubmit={createTask}>
            <div className="field-grid">
              <label>Room / Area<input value={taskLocation} onChange={(event) => setTaskLocation(event.target.value)} placeholder="e.g. 1205 or Lobby" maxLength={80} /></label>
              <label>Assign to<div className="choice-row department-row">
                <button type="button" className={taskDepartments.length === 1 && taskDepartments[0] === 'HK' ? 'selected hk' : ''} onClick={() => selectDepartments('HK')}>Housekeeping</button>
                <button type="button" className={taskDepartments.length === 1 && taskDepartments[0] === 'MT' ? 'selected mt' : ''} onClick={() => selectDepartments('MT')}>Maintenance</button>
                <button type="button" className={taskDepartments.length === 2 ? 'selected both' : ''} onClick={() => selectDepartments('BOTH')}>Both</button>
              </div></label>
            </div>
            <label>Task details<textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Guest request, complaint, or work needed..." maxLength={800} rows={2} /></label>
            <div className="form-footer">
              <button type="button" className={`waiting-chip ${customerWaiting ? 'active' : ''}`} aria-pressed={customerWaiting} onClick={() => setCustomerWaiting((current) => !current)}>
                <span className="waiting-chip-icon">{customerWaiting ? '!' : '15m'}</span>
                <span><b>Customer waiting</b><small>{customerWaiting ? 'Urgent timer enabled' : 'Enable 15-minute timer'}</small></span>
              </button>
              <button className="primary-action" disabled={busyKey === 'create-task'}>{busyKey === 'create-task' ? 'Assigning...' : `Assign to ${taskDepartments.join(' + ')}`}</button>
            </div>
          </form>

          <div className="list-heading reminder-list-heading">
            <div><strong>Task follow-up</strong><small>Created by FO or assigned to FO</small></div>
            <div className="mini-tabs">
              <button type="button" className={taskView === 'OPEN' ? 'active' : ''} onClick={() => setTaskView('OPEN')}>Open {openTasks.length}</button>
              <button type="button" className={taskView === 'DONE' ? 'active' : ''} onClick={() => setTaskView('DONE')}>Done {doneTasks.length}</button>
            </div>
          </div>
          <div className="compact-list command-list">
            {visibleTasks.length ? visibleTasks.map((task) => {
              const waitingTimer = customerWaitingTimer(task, clockNow);
              return (
                <article key={task.id} className={`compact-card ${task.status.toLowerCase()} ${waitingTimer ? 'customer-waiting-task' : ''} ${waitingTimer?.overdue ? 'waiting-overdue' : ''}`}>
                  <div className="card-title">
                    <div><b>{task.task_code}</b><strong>{task.room}</strong><span className={`dept ${task.department.toLowerCase()}`}>{task.department}</span></div>
                    <div className="task-state">
                      {waitingTimer ? <span className={`waiting-timer ${waitingTimer.overdue ? 'overdue' : ''}`}>{waitingTimer.label}</span> : null}
                      <em>{task.status}</em>
                    </div>
                  </div>
                  <p>{task.task_text}</p>
                  <small>{task.customer_waiting ? 'CUSTOMER WAITING - 15 MINUTE TARGET - ' : ''}{formatDateTime(task.created_at)}</small>
                  <div className="task-action-row">
                    <button
                      type="button"
                      className={`task-status-btn ${task.status === 'OPEN' ? 'mark-done' : 'reopen'}`}
                      disabled={busyKey === `task-${task.id}`}
                      onClick={() => void setTaskStatus(task.id, task.status === 'OPEN' ? 'DONE' : 'OPEN')}
                    >
                      <span className="status-action-icon" aria-hidden="true">{busyKey === `task-${task.id}` ? '…' : task.status === 'OPEN' ? '✓' : '↻'}</span>
                      <span>{busyKey === `task-${task.id}` ? 'Saving...' : task.status === 'OPEN' ? 'Mark as Done' : 'Re-open Task'}</span>
                    </button>
                    {isSuperuser ? (
                      <button type="button" className="task-delete-btn" disabled={busyKey === `task-${task.id}`} onClick={() => void deleteTask(task)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            }) : <div className="empty">{taskView === 'OPEN' ? 'No open FO tasks. Everything is followed up.' : 'No completed FO tasks yet.'}</div>}
          </div>
        </section>

        <section className="command-column reminder-command">
          <div className="command-title">
            <div><span className="eyebrow">SHIFT REMINDERS</span><h2>Handover and follow up</h2><p>Internal notes that remain visible until completed.</p></div>
            <span className="command-count reminder">{openReminders.length}<small>open</small></span>
          </div>

          <form className="quick-form reminder-form" onSubmit={createReminder}>
            <label>Reminder<textarea value={reminderText} onChange={(event) => setReminderText(event.target.value)} placeholder="What must the next shift follow up?" maxLength={1000} rows={2} /></label>
            <div className="reminder-create-row">
              <label>Room / Guest / Reference <small>(optional)</small><input value={reminderReference} onChange={(event) => setReminderReference(event.target.value)} placeholder="e.g. Room 805 - Lost & Found" maxLength={160} /></label>
              <button className="primary-action" disabled={busyKey === 'create-reminder'}>{busyKey === 'create-reminder' ? 'Adding...' : 'Add Reminder'}</button>
            </div>
          </form>

          <div className="list-heading reminder-list-heading">
            <div><strong>Reminder follow-up</strong><small>Name is required for status changes</small></div>
            <div className="mini-tabs"><button type="button" className={reminderView === 'OPEN' ? 'active' : ''} onClick={() => setReminderView('OPEN')}>Open {openReminders.length}</button><button type="button" className={reminderView === 'DONE' ? 'active' : ''} onClick={() => setReminderView('DONE')}>Done {doneReminders.length}</button></div>
          </div>
          <div className="compact-list command-list">
            {visibleReminders.length ? visibleReminders.map((reminder) => (
              <article key={reminder.id} className={`reminder-card ${reminder.status.toLowerCase()}`}>
                <div className="card-title"><strong>{reminder.reference_text || 'General handover'}</strong><em>{reminder.status}</em></div>
                <p>{reminder.reminder_text}</p>
                <small>Added by {reminder.created_by_name || 'FO'} - {formatDateTime(reminder.created_at)}</small>
                {reminder.status === 'DONE' ? <div className="completed-by">Completed by <b>{reminder.completed_by_name}</b> - {formatDateTime(reminder.completed_at)}</div> : null}
                <div className={`reminder-action-row ${reminderAction?.id === reminder.id ? 'editing' : ''}`}>
                  {reminderAction?.id === reminder.id ? (
                    <div className="completion-row">
                      <input autoFocus value={reminderActorName} onChange={(event) => setReminderActorName(event.target.value)} placeholder="Your name (required)" maxLength={120} onKeyDown={(event) => { if (event.key === 'Enter') void changeReminderStatus(reminder.id, reminderAction.action); }} />
                      <button type="button" disabled={busyKey === `reminder-${reminder.id}`} onClick={() => void changeReminderStatus(reminder.id, reminderAction.action)}>{reminderAction.action === 'COMPLETE' ? 'Confirm Done' : 'Confirm Re-open'}</button>
                      <button type="button" className="secondary" onClick={() => { setReminderAction(null); setReminderActorName(''); }}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className={`complete-btn ${reminder.status === 'DONE' ? 'reopen' : ''}`} onClick={() => { setReminderAction({ id: reminder.id, action: reminder.status === 'DONE' ? 'REOPEN' : 'COMPLETE' }); setReminderActorName(''); }}>
                      <span className="status-action-icon" aria-hidden="true">{reminder.status === 'DONE' ? '\u21bb' : '\u2713'}</span>
                      <span>{reminder.status === 'DONE' ? 'Re-open Reminder' : 'Mark as Done'}</span>
                    </button>
                  )}
                  {isSuperuser ? (
                    <button type="button" className="reminder-delete-btn" disabled={busyKey === `reminder-${reminder.id}`} onClick={() => void deleteReminder(reminder.id)}>
                      Delete Reminder
                    </button>
                  ) : null}
                </div>
              </article>
            )) : <div className="empty">{reminderView === 'OPEN' ? 'No open reminders. The next shift is clear.' : 'No completed reminders yet.'}</div>}
          </div>
        </section>
      </section>
      <Styles />
      <ProfessionalStyles />
    </main>
  );
}

function ProfessionalStyles() {
  return <style jsx global>{`
    .command-board{max-width:1450px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
    .command-column{min-width:0;overflow:hidden;border:1px solid #d7e1ec;border-radius:16px;background:#fff;box-shadow:0 12px 32px rgba(24,49,82,.08)}
    .command-column.task-command{border-top:4px solid #2462c9}
    .command-column.reminder-command{border-top:4px solid #7255b5}
    .command-title{padding:17px 18px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:14px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#fbfdff,#f4f7fb)}
    .command-title h2{margin:3px 0;font-size:19px;letter-spacing:-.02em}
    .command-title p{margin:0;color:#718197;font-size:10px}
    .command-count{flex:0 0 auto;min-width:52px;border-radius:12px;padding:7px 10px;background:#eaf2ff;color:#174f9e;text-align:center;font-size:20px;font-weight:950;line-height:1}
    .command-count.reminder{background:#f1edfb;color:#6548a3}
    .command-count small{display:block;margin-top:4px;font-size:8px;text-transform:uppercase;letter-spacing:.08em}
    .quick-form{padding:14px 16px;border-bottom:1px solid #e3e9f0;background:#fff}
    .quick-form label{display:grid;gap:5px;color:#435873;font-size:10px;font-weight:900}
    .quick-form label small{font-weight:600}
    .quick-form input,.quick-form textarea{width:100%;border:1px solid #c9d5e3;border-radius:9px;padding:9px 10px;background:#fbfcfe;color:#10223c;font:inherit;resize:vertical}
    .quick-form .field-grid{margin-bottom:9px}
    .department-row{flex-wrap:nowrap}
    .department-row button{flex:1;padding-left:7px;padding-right:7px}
    .choice-row button.both.selected{border-color:#7054b3;background:#f1edfb;color:#60449e;box-shadow:inset 0 0 0 1px #7054b3}
    .form-footer{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:8px;align-items:stretch;margin-top:9px;width:100%}
    .waiting-chip{width:100%;min-height:48px;border:1px solid #e13b3b;border-radius:10px;padding:6px 11px;background:#fff1f1;color:#a51f1f;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer;box-shadow:0 2px 7px rgba(185,28,28,.08);transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .16s ease}
    .waiting-chip:hover{border-color:#bd1f1f;background:#ffe5e5;box-shadow:0 4px 12px rgba(185,28,28,.14)}
    .waiting-chip:active{transform:translateY(1px)}
    .waiting-chip.active{border-color:#991b1b;background:linear-gradient(135deg,#d92d2d,#b91c1c);color:#fff;box-shadow:0 5px 14px rgba(185,28,28,.25)}
    .waiting-chip-icon{flex:0 0 auto;width:32px;height:32px;border-radius:9px;background:#c62828;color:#fff;display:grid;place-items:center;font-size:9px;font-weight:950;letter-spacing:-.02em}
    .waiting-chip.active .waiting-chip-icon{background:#fff;color:#b91c1c}
    .waiting-chip>span:last-child{display:grid;gap:1px}
    .waiting-chip b{font-size:10px}.waiting-chip small{font-size:8px;font-weight:750;opacity:.82}
    .form-footer .primary-action{margin:0;min-height:48px}
    .reminder-create-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:9px}
    .reminder-create-row .primary-action{width:auto;min-width:125px;margin:0;min-height:40px}
    .list-heading{padding:11px 16px 8px;display:flex;justify-content:space-between;align-items:end;gap:10px;background:#f8fafc}
    .list-heading strong{display:block;font-size:11px;color:#253c59}
    .list-heading small{display:block;margin-top:2px;color:#7a899b;font-size:8px}
    .reminder-list-heading>div:first-child{min-width:0}
    .command-list{max-height:430px;padding:8px 10px 12px;background:#f8fafc}
    .command-list .compact-card,.command-list .reminder-card{box-shadow:0 2px 7px rgba(25,48,78,.04)}
    .dept.fo{background:#f1edfb;color:#6548a3}
    .task-state{display:flex;align-items:center;gap:7px}
    .waiting-timer{min-width:92px;border-radius:999px;padding:3px 10px;background:#fff1df;color:#9f3e08;text-align:center;font-size:17px;font-weight:950;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:.035em;box-shadow:inset 0 0 0 1px #f2c28d}
    .waiting-timer.overdue{background:#b91c1c;color:#fff;min-width:132px;font-size:12px;line-height:1.5;box-shadow:none}
    .compact-card.customer-waiting-task:not(.waiting-overdue){border-left-color:#f08a24;background:#fffdf8}
    .compact-card.waiting-overdue{border-color:#dc2626;border-left:5px solid #b91c1c;animation:foWaitingFlash 1.1s step-end infinite}
    .task-action-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:stretch;margin-top:10px}
    .task-status-btn,.complete-btn{min-height:38px;border:0;border-radius:9px;padding:7px 13px;color:#fff;font-size:10px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 3px 9px rgba(22,101,62,.14);transition:filter .16s ease,transform .16s ease,box-shadow .16s ease}
    .task-status-btn:hover,.complete-btn:hover{filter:brightness(.96);box-shadow:0 5px 13px rgba(22,51,85,.2)}
    .task-status-btn:active,.complete-btn:active{transform:translateY(1px)}
    .task-status-btn.mark-done,.complete-btn:not(.reopen){background:linear-gradient(135deg,#199657,#117642)}
    .task-status-btn.reopen,.complete-btn.reopen{background:linear-gradient(135deg,#416b9f,#294b76);box-shadow:0 3px 9px rgba(41,75,118,.18)}
    .status-action-icon{width:20px;height:20px;border-radius:999px;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:12px;font-weight:950;line-height:1}
    .task-delete-btn{border:1px solid #e1a8a4;border-radius:9px;padding:7px 13px;background:#fff5f4;color:#ad332d;font-size:10px;font-weight:900;cursor:pointer}
    .reminder-action-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:stretch;margin-top:10px}
    .reminder-action-row>.complete-btn{width:100%;margin:0}
    .reminder-action-row .completion-row{margin:0}
    .reminder-delete-btn{border:1px solid #dc8f89;border-radius:9px;padding:7px 12px;background:#fff1f0;color:#a92e27;font-size:10px;font-weight:900;cursor:pointer}
    .reminder-delete-btn:hover{border-color:#c94b43;background:#ffe4e2}
    .urgent-follow-up-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:18px;background:rgba(44,4,4,.82);backdrop-filter:blur(5px)}
    .urgent-follow-up-modal{width:min(560px,100%);border:5px solid #ff3131;border-radius:22px;padding:24px;background:#fff;color:#541010;text-align:center;box-shadow:0 0 0 9px rgba(255,49,49,.25),0 28px 80px rgba(0,0,0,.55);animation:urgentModalFlash .85s step-end infinite}
    .urgent-alarm-mark{width:72px;height:72px;margin:-5px auto 10px;border-radius:999px;background:#c91414;color:#fff;display:grid;place-items:center;font-size:50px;font-weight:950;line-height:1;box-shadow:0 0 0 8px #ffdada}
    .urgent-kicker{display:block;color:#c91414;font-size:12px;font-weight:950;letter-spacing:.18em}
    .urgent-follow-up-modal h2{margin:5px 0 14px;color:#8f1111;font-size:30px;line-height:1.05;letter-spacing:-.03em}
    .urgent-task-reference{margin:0;display:flex;justify-content:center;align-items:center;gap:8px;font-style:normal}
    .urgent-task-reference b,.urgent-task-reference span,.urgent-task-reference em{border-radius:999px;padding:5px 9px;background:#f5e9e9;font-size:11px;font-style:normal;font-weight:900}
    .urgent-task-text{margin:14px auto;color:#301313;font-size:16px;font-weight:800;line-height:1.45}
    .urgent-overdue-banner{border-radius:10px;padding:11px;background:#b91c1c;color:#fff;font-size:15px;font-weight:950;letter-spacing:.06em}
    .urgent-queue-count{margin:9px 0 0;color:#9b1919;font-size:11px;font-weight:900}
    .urgent-primary-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:15px}
    .urgent-follow-up-btn,.urgent-restart-btn,.urgent-complete-btn{width:100%;min-height:54px;border:0;border-radius:12px;color:#fff;font-size:16px;font-weight:950;cursor:pointer}
    .urgent-follow-up-btn,.urgent-restart-btn{background:linear-gradient(135deg,#d91f1f,#a80f0f);box-shadow:0 8px 20px rgba(185,28,28,.3)}
    .urgent-follow-up-btn{margin:0}
    .urgent-restart-btn{margin-top:15px}
    .urgent-complete-btn{background:linear-gradient(135deg,#17864e,#0d6f3d);box-shadow:0 8px 20px rgba(13,111,61,.25)}
    .urgent-reason-form{margin-top:15px;text-align:left}
    .urgent-reason-form label{display:grid;gap:6px;color:#7d1616;font-size:11px;font-weight:950}
    .urgent-reason-form textarea{width:100%;border:2px solid #dc7777;border-radius:11px;padding:11px;background:#fffafa;color:#311;font:inherit;resize:vertical}
    .urgent-inline-error{margin-top:8px;border-radius:8px;padding:8px 10px;background:#7f1010;color:#fff;font-size:11px;font-weight:900}
    .urgent-form-actions{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;margin-top:9px}
    .urgent-form-actions button{margin:0}
    .urgent-cancel-btn{border:1px solid #cfaaaa;border-radius:11px;padding:10px 16px;background:#fff;color:#743333;font-weight:900;cursor:pointer}
    @keyframes urgentModalFlash{0%,100%{border-color:#ff2626;background:#fff;box-shadow:0 0 0 9px rgba(255,49,49,.3),0 28px 80px rgba(0,0,0,.55)}50%{border-color:#8b0000;background:#ffe1e1;box-shadow:0 0 0 16px rgba(255,25,25,.48),0 28px 90px rgba(0,0,0,.65)}}
    @keyframes foWaitingFlash{0%,100%{background:#fff1f1;box-shadow:0 0 0 2px rgba(220,38,38,.14),0 5px 15px rgba(185,28,28,.12)}50%{background:#fca5a5;box-shadow:0 0 0 4px rgba(220,38,38,.28),0 7px 20px rgba(185,28,28,.25)}}
    @media(prefers-reduced-motion:reduce){.compact-card.waiting-overdue,.urgent-follow-up-modal{animation:none}.compact-card.waiting-overdue{background:#fff1f1}}
    .task-command .primary-action{background:linear-gradient(135deg,#1e67d2,#164d9d)}
    .reminder-command .primary-action{background:linear-gradient(135deg,#7758b8,#5c4098)}
    .item-panel{border-top:4px solid #1d9a61}
    .archive-link{top:34px!important;right:9px!important;border-radius:5px!important;padding:3px 5px!important;background:#fff0ef!important;color:#ad332d!important;font-weight:850}
    @media(max-width:1100px){.command-board{grid-template-columns:1fr}.command-list{max-height:480px}}
    @media(max-width:620px){.command-board{gap:8px}.command-title{padding:14px}.quick-form{padding:12px}.form-footer,.reminder-create-row,.reminder-action-row{grid-template-columns:1fr}.reminder-create-row .primary-action{width:100%}.department-row{display:grid;grid-template-columns:1fr 1fr}.department-row button:last-child{grid-column:1/-1}.command-list{max-height:none}.list-heading{align-items:center}.urgent-follow-up-overlay{padding:10px}.urgent-follow-up-modal{padding:20px 14px;border-width:4px}.urgent-follow-up-modal h2{font-size:25px}.urgent-task-text{font-size:14px}.urgent-form-actions{grid-template-columns:1fr}.waiting-timer{min-width:84px;font-size:15px}}
  `}</style>;
}

function Styles() {
  return <style jsx global>{`
    *{box-sizing:border-box}body{margin:0;background:#eef3f9;color:#10223c;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.foq-page{min-height:100vh;padding:18px}.foq-header,.item-panel,.action-panel,.main-tabs,.foq-state{max-width:1450px;margin-left:auto;margin-right:auto;background:#fff;border:1px solid #d7e1ec;border-radius:16px;box-shadow:0 10px 28px rgba(24,49,82,.07)}.foq-header{padding:20px 22px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:18px}.foq-header h1{margin:3px 0;font-size:28px;letter-spacing:-.03em}.foq-header p{margin:0;color:#64758a;font-size:13px}.eyebrow{display:block;color:#2462d0;font-size:9px;font-weight:950;letter-spacing:.14em}.header-actions,.heading-actions{display:flex;align-items:center;gap:8px}.header-actions a,.header-actions button,.secondary{border:1px solid #c7d3e1;background:#fff;color:#21344e;border-radius:10px;padding:10px 13px;text-decoration:none;font-weight:850;cursor:pointer}.notice{max-width:1450px;margin:0 auto 10px;padding:11px 14px;border-radius:10px;font-size:12px;font-weight:800}.notice.error{background:#fff1f0;border:1px solid #f2c1bd;color:#a72d25}.notice.success{background:#edf9f2;border:1px solid #b5dfc7;color:#0d7543}.item-panel{padding:14px 16px;margin-bottom:10px}.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:13px}.section-heading.compact{align-items:center;margin-bottom:9px}.section-heading h2{font-size:18px;margin:3px 0 0}.count{border-radius:999px;padding:5px 9px;background:#eef3f9;color:#52667f;font-size:10px;font-weight:900}.count.warn{background:#fff0e8;color:#b74518}.count.good{background:#e9f8ef;color:#0b7945}.small{padding:6px 9px!important;font-size:10px}.inline-create{display:grid;grid-template-columns:1.2fr 1.5fr auto auto;gap:7px;margin:8px 0 10px}.inline-create input,.inline-create button,.inline-action input,.inline-action button,.completion-row input,.completion-row button{min-height:38px;border:1px solid #cbd6e3;border-radius:9px;padding:8px 10px;background:#fff}.inline-create button,.inline-action button,.completion-row button{background:#235fc8;color:#fff;font-weight:850;cursor:pointer}.item-strip{display:flex;gap:9px;overflow-x:auto;padding:2px 1px 7px;scrollbar-width:thin}.item-card{position:relative;flex:0 0 235px;min-height:128px;padding:12px;border:1px solid #d9e3ee;border-left:4px solid #21a366;border-radius:12px;background:#f9fcfa;display:flex;flex-direction:column;gap:7px}.item-card.loaned{border-left-color:#e4722b;background:#fff9f4}.item-top{display:flex;justify-content:space-between;gap:8px}.item-top strong{font-size:13px}.item-top span{font-size:8px;font-weight:950;color:#64758a}.item-card small{font-size:10px;color:#6c7d91}.item-card>button:not(.archive-link),.return-btn{margin-top:auto;border:0;border-radius:9px;padding:9px;background:#1e64cd;color:#fff;font-weight:900;cursor:pointer}.item-card .return-btn{background:#16824d}.holder{font-size:12px}.inline-action{display:grid;grid-template-columns:1fr 1fr;gap:5px}.inline-action input{grid-column:1/-1;min-width:0}.archive-link,.delete-link{position:absolute;top:35px;right:10px;border:0!important;background:transparent!important;color:#9a4b4b!important;font-size:9px!important;padding:2px!important;cursor:pointer}.empty-inline{padding:20px;color:#718197;font-size:12px}.main-tabs{padding:5px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:5px}.main-tabs button{min-height:66px;border:1px solid transparent;border-radius:12px;background:transparent;color:#54677f;padding:9px 14px;text-align:left;display:grid;grid-template-columns:auto 1fr;column-gap:8px;cursor:pointer}.main-tabs button span{font-size:15px;font-weight:950}.main-tabs button b{justify-self:end;border-radius:999px;padding:2px 7px;background:#e8eef6;font-size:11px}.main-tabs button small{grid-column:1/-1;font-size:10px}.main-tabs button.active{background:#153d76;color:#fff;box-shadow:0 5px 13px rgba(21,61,118,.2)}.main-tabs button.active b{background:#fff;color:#153d76}.workspace-grid{max-width:1450px;margin:0 auto;display:grid;grid-template-columns:minmax(320px,.8fr) minmax(420px,1.2fr);gap:10px;align-items:start}.action-panel{padding:17px;margin:0}.create-panel label{display:grid;gap:6px;margin-top:11px;font-size:11px;font-weight:900;color:#465b75}.create-panel label small{font-weight:600}.create-panel input,.create-panel textarea{width:100%;border:1px solid #c9d5e3;border-radius:10px;padding:11px 12px;background:#fbfcfe;color:#10223c;font:inherit;resize:vertical}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.choice-row{display:flex;flex-wrap:wrap;gap:6px}.choice-row button{border:1px solid #cbd6e3;border-radius:9px;background:#fff;color:#4a607a;padding:8px 10px;font-size:10px;font-weight:850;cursor:pointer}.choice-row button.selected{border-color:#1f60c8;background:#eaf2ff;color:#174f9e;box-shadow:inset 0 0 0 1px #1f60c8}.choice-row button.hk.selected{background:#eaf9f0;border-color:#23935b;color:#167044}.choice-row button.mt.selected{background:#edf3ff;border-color:#3d6ed2;color:#2658b2}.waiting-toggle{display:flex!important;grid-template-columns:auto 1fr!important;align-items:flex-start;gap:9px!important;padding:10px 11px;border:1px solid #e4c8b7;border-radius:10px;background:#fff9f5}.waiting-toggle input{width:auto}.waiting-toggle span{display:grid}.waiting-toggle small{color:#7f6b60}.urgent-pill{border-radius:999px;background:#fff0e8;color:#be461b;padding:5px 9px;font-size:9px;font-weight:950}.primary-action{width:100%;margin-top:13px;border:0;border-radius:11px;padding:12px 15px;background:#1764cf;color:#fff;font-weight:950;cursor:pointer}.primary-action:disabled,button:disabled{opacity:.55;cursor:not-allowed}.info-note{margin-top:11px;padding:10px;border-radius:9px;background:#eef5ff;color:#36577f;font-size:10px;line-height:1.4}.compact-list{display:grid;gap:7px;max-height:575px;overflow:auto;padding-right:2px}.compact-card,.reminder-card{position:relative;border:1px solid #dce4ee;border-left:4px solid #df862d;border-radius:11px;padding:11px 12px;background:#fff}.compact-card.done,.reminder-card.done{border-left-color:#25a165;background:#f8fcfa}.card-title,.card-title>div{display:flex;align-items:center;gap:7px}.card-title{justify-content:space-between}.card-title b{font-size:9px}.card-title strong{font-size:13px}.card-title em{font-style:normal;font-size:8px;font-weight:950;color:#6a7b90}.dept{border-radius:999px;padding:3px 6px;font-size:8px;font-weight:950}.dept.hk{background:#e8f8ef;color:#137447}.dept.mt{background:#eaf0ff;color:#2b58ae}.compact-card p,.reminder-card p{margin:7px 0;color:#2c425e;font-size:12px;line-height:1.4;white-space:pre-wrap}.compact-card small,.reminder-card small{color:#78889a;font-size:9px}.empty{padding:30px 15px;border:1px dashed #cbd6e3;border-radius:10px;text-align:center;color:#718197;font-size:12px}.mini-tabs{display:flex;border:1px solid #d5deea;border-radius:9px;padding:3px}.mini-tabs button{border:0;border-radius:6px;background:transparent;color:#63758b;padding:6px 8px;font-size:9px;font-weight:900;cursor:pointer}.mini-tabs button.active{background:#173f77;color:#fff}.complete-btn{margin-top:9px;border:0;border-radius:8px;padding:8px 10px;background:#16834e;color:#fff;font-size:10px;font-weight:900;cursor:pointer}.completion-row{display:grid;grid-template-columns:1fr auto auto;gap:5px;margin-top:9px}.completion-row input{min-width:0}.completed-by{margin-top:8px;border-radius:8px;padding:7px 9px;background:#e9f8f0;color:#176942;font-size:10px}.reminder-card .delete-link{top:auto;bottom:8px}.foq-state{margin-top:12vh;padding:35px;text-align:center}.foq-state a{color:#1e61c7}.secondary{background:#fff!important;color:#324861!important}@media(max-width:920px){.workspace-grid{grid-template-columns:1fr}.compact-list{max-height:none}.field-grid{grid-template-columns:1fr}.inline-create{grid-template-columns:1fr 1fr}.inline-create input{grid-column:span 1}}@media(max-width:620px){.foq-page{padding:8px}.foq-header{padding:15px;align-items:flex-start;display:grid}.foq-header h1{font-size:24px}.header-actions{width:100%}.header-actions>*{flex:1;text-align:center}.item-panel,.action-panel{padding:12px}.main-tabs button{padding:8px;min-height:62px}.main-tabs button span{font-size:13px}.workspace-grid{gap:8px}.inline-create{grid-template-columns:1fr}.inline-create input{grid-column:auto}.completion-row{grid-template-columns:1fr 1fr}.completion-row input{grid-column:1/-1}.item-card{flex-basis:215px}.choice-row button{flex:1}.department-row button{min-width:130px}}\n+  `}</style>;
}
