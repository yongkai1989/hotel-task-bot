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

type TaskKind = 'Guest Request' | 'Complaint' | 'Follow-up' | 'Other';
type MainView = 'TASKS' | 'REMINDERS';
type ReminderView = 'OPEN' | 'DONE';

const TASK_KINDS: TaskKind[] = ['Guest Request', 'Complaint', 'Follow-up', 'Other'];

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

export default function FoQuickActionsPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [mainView, setMainView] = useState<MainView>('TASKS');
  const [reminderView, setReminderView] = useState<ReminderView>('OPEN');
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [reminders, setReminders] = useState<ShiftReminder[]>([]);
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [taskKind, setTaskKind] = useState<TaskKind>('Guest Request');
  const [taskLocation, setTaskLocation] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDepartments, setTaskDepartments] = useState<Array<'HK' | 'MT'>>(['HK']);
  const [customerWaiting, setCustomerWaiting] = useState(false);

  const [reminderText, setReminderText] = useState('');
  const [reminderReference, setReminderReference] = useState('');
  const [completingReminderId, setCompletingReminderId] = useState<string | null>(null);
  const [completionName, setCompletionName] = useState('');

  const [loaningItemId, setLoaningItemId] = useState<string | null>(null);
  const [loanedToName, setLoanedToName] = useState('');
  const [showItemSetup, setShowItemSetup] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemNotes, setNewItemNotes] = useState('');

  const isSuperuser = String(profile?.role || '').toUpperCase() === 'SUPERUSER';
  const normalizedEmail = String(profile?.email || '').trim().toLowerCase();
  const canAccess =
    isSuperuser ||
    String(profile?.role || '').toUpperCase() === 'FO' ||
    profile?.can_access_fo_checklist === true;

  const loadData = useCallback(async (email: string, quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const [taskResponse, reminderResult, itemResult] = await Promise.all([
        fetch('/api/tasks', { cache: 'no-store', credentials: 'include' }),
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

      const taskPayload = await responseJson(taskResponse);
      if (reminderResult.error) throw reminderResult.error;
      if (itemResult.error) throw itemResult.error;

      const ownTasks = ((taskPayload?.tasks || []) as DashboardTask[])
        .filter((task) => String(task.created_by_email || '').toLowerCase() === email)
        .slice(0, 40);
      setTasks(ownTasks);
      setReminders((reminderResult.data || []) as ShiftReminder[]);
      setItems((itemResult.data || []) as TrackedItem[]);
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to load FO Quick Actions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

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
        await loadData(String(nextProfile.email || '').trim().toLowerCase());
      } catch (nextError: any) {
        if (mounted) {
          setError(nextError?.message || 'Unable to verify FO access.');
          setLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [loadData, supabase]);

  const openTasks = tasks.filter((task) => task.status === 'OPEN');
  const visibleTasks = [...tasks]
    .sort((a, b) => Number(a.status === 'DONE') - Number(b.status === 'DONE') || Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 16);
  const openReminders = reminders.filter((reminder) => reminder.status === 'OPEN');
  const visibleReminders = reminders
    .filter((reminder) => reminder.status === reminderView)
    .slice(0, reminderView === 'OPEN' ? 30 : 12);
  const loanedItems = items.filter((item) => item.current_status === 'LOANED');

  function clearNotices() {
    setError('');
    setSuccess('');
  }

  function toggleDepartment(department: 'HK' | 'MT') {
    setTaskDepartments((current) => {
      if (current.includes(department)) {
        return current.length === 1 ? current : current.filter((value) => value !== department);
      }
      return [...current, department];
    });
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
      const taskText = taskKind === 'Other'
        ? taskDescription.trim()
        : `[${taskKind}] ${taskDescription.trim()}`;
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
          task_text: taskText,
          customer_waiting: customerWaiting,
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

  async function completeReminder(reminderId: string) {
    clearNotices();
    if (!completionName.trim()) {
      setError('Enter your name before marking the reminder complete.');
      return;
    }
    setBusyKey(`reminder-${reminderId}`);
    try {
      const { data, error: rpcError } = await supabase.rpc('complete_fo_shift_reminder', {
        p_reminder_id: reminderId,
        p_completed_by_name: completionName.trim(),
      });
      if (rpcError) throw rpcError;
      const updatedReminder = singleRpcRow<ShiftReminder>(data);
      setReminders((current) => current.map((row) => row.id === reminderId ? updatedReminder : row));
      setCompletingReminderId(null);
      setCompletionName('');
      setSuccess('Reminder completed and staff name recorded.');
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to complete reminder.');
    } finally {
      setBusyKey('');
    }
  }

  async function deleteReminder(reminderId: string) {
    if (!isSuperuser || !window.confirm('Delete this reminder permanently?')) return;
    clearNotices();
    setBusyKey(`reminder-${reminderId}`);
    try {
      const { error: rpcError } = await supabase.rpc('delete_fo_shift_reminder', {
        p_reminder_id: reminderId,
      });
      if (rpcError) throw rpcError;
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
    if (!isSuperuser || !window.confirm('Remove this item from FO tracking?')) return;
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
      <header className="foq-header">
        <div>
          <span className="eyebrow">FRONT OFFICE WORKSPACE</span>
          <h1>FO Quick Actions</h1>
          <p>Assign guest tasks, hand over reminders, and see where FO items are.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary" disabled={refreshing} onClick={() => void loadData(normalizedEmail, true)}>
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
              {isSuperuser && item.current_status === 'AVAILABLE' ? (
                <button type="button" className="archive-link" onClick={() => void archiveItem(item.id)}>Remove</button>
              ) : null}
            </article>
          )) : <div className="empty-inline">No FO items configured yet.{isSuperuser ? ' Add the first item.' : ''}</div>}
        </div>
      </section>

      <nav className="main-tabs" aria-label="FO Quick Action category">
        <button type="button" className={mainView === 'TASKS' ? 'active' : ''} onClick={() => setMainView('TASKS')}>
          <span>Tasks</span><b>{openTasks.length}</b><small>Assign to departments</small>
        </button>
        <button type="button" className={mainView === 'REMINDERS' ? 'active' : ''} onClick={() => setMainView('REMINDERS')}>
          <span>Reminders</span><b>{openReminders.length}</b><small>Next-shift follow-up</small>
        </button>
      </nav>

      {mainView === 'TASKS' ? (
        <section className="workspace-grid">
          <form className="action-panel create-panel" onSubmit={createTask}>
            <div className="section-heading">
              <div><span className="eyebrow">QUICK ASSIGN</span><h2>Create department task</h2></div>
              {customerWaiting ? <span className="urgent-pill">Customer waiting</span> : null}
            </div>

            <label>Type</label>
            <div className="choice-row">
              {TASK_KINDS.map((kind) => <button type="button" key={kind} className={taskKind === kind ? 'selected' : ''} onClick={() => setTaskKind(kind)}>{kind}</button>)}
            </div>

            <div className="field-grid">
              <label>Room / Area<input value={taskLocation} onChange={(event) => setTaskLocation(event.target.value)} placeholder="e.g. 1205 or Lobby" maxLength={80} /></label>
              <label>Assign to<div className="choice-row department-row"><button type="button" className={taskDepartments.includes('HK') ? 'selected hk' : ''} onClick={() => toggleDepartment('HK')}>Housekeeping</button><button type="button" className={taskDepartments.includes('MT') ? 'selected mt' : ''} onClick={() => toggleDepartment('MT')}>Maintenance</button></div></label>
            </div>

            <label>What is needed?<textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="Type the guest request, complaint, or work needed..." maxLength={800} rows={3} /></label>
            <label className="waiting-toggle"><input type="checkbox" checked={customerWaiting} onChange={(event) => setCustomerWaiting(event.target.checked)} /><span><b>Customer is waiting</b><small>Keep the existing urgent reminder active for this task.</small></span></label>
            <button className="primary-action" disabled={busyKey === 'create-task'}>{busyKey === 'create-task' ? 'Assigning...' : `Assign to ${taskDepartments.join(' + ')}`}</button>
          </form>

          <section className="action-panel list-panel">
            <div className="section-heading"><div><span className="eyebrow">FOLLOW-UP</span><h2>Tasks created by FO</h2></div><span className="count">{openTasks.length} open</span></div>
            <div className="compact-list">
              {visibleTasks.length ? visibleTasks.map((task) => (
                <article key={task.id} className={`compact-card ${task.status.toLowerCase()}`}>
                  <div className="card-title"><div><b>{task.task_code}</b><strong>{task.room}</strong><span className={`dept ${task.department.toLowerCase()}`}>{task.department}</span></div><em>{task.status}</em></div>
                  <p>{task.task_text}</p>
                  <small>{task.customer_waiting ? 'CUSTOMER WAITING - ' : ''}{formatDateTime(task.created_at)}</small>
                </article>
              )) : <div className="empty">No FO-created tasks found.</div>}
            </div>
          </section>
        </section>
      ) : (
        <section className="workspace-grid">
          <form className="action-panel create-panel" onSubmit={createReminder}>
            <div className="section-heading"><div><span className="eyebrow">SHIFT HANDOVER</span><h2>Add internal reminder</h2></div></div>
            <label>Reminder<textarea value={reminderText} onChange={(event) => setReminderText(event.target.value)} placeholder="What must the next shift follow up?" maxLength={1000} rows={4} /></label>
            <label>Room / Guest / Reference <small>(optional)</small><input value={reminderReference} onChange={(event) => setReminderReference(event.target.value)} placeholder="e.g. Room 805 - Lost & Found" maxLength={160} /></label>
            <div className="info-note">Completion always requires the staff member&apos;s name, even though FO shares one login.</div>
            <button className="primary-action" disabled={busyKey === 'create-reminder'}>{busyKey === 'create-reminder' ? 'Adding...' : 'Add Reminder'}</button>
          </form>

          <section className="action-panel list-panel">
            <div className="section-heading">
              <div><span className="eyebrow">FOLLOW-UP</span><h2>Shift reminders</h2></div>
              <div className="mini-tabs"><button type="button" className={reminderView === 'OPEN' ? 'active' : ''} onClick={() => setReminderView('OPEN')}>Open {openReminders.length}</button><button type="button" className={reminderView === 'DONE' ? 'active' : ''} onClick={() => setReminderView('DONE')}>Completed</button></div>
            </div>
            <div className="compact-list">
              {visibleReminders.length ? visibleReminders.map((reminder) => (
                <article key={reminder.id} className={`reminder-card ${reminder.status.toLowerCase()}`}>
                  <div className="card-title"><strong>{reminder.reference_text || 'General handover'}</strong><em>{reminder.status}</em></div>
                  <p>{reminder.reminder_text}</p>
                  <small>Added by {reminder.created_by_name || 'FO'} - {formatDateTime(reminder.created_at)}</small>
                  {reminder.status === 'DONE' ? (
                    <div className="completed-by">Completed by <b>{reminder.completed_by_name}</b> - {formatDateTime(reminder.completed_at)}</div>
                  ) : completingReminderId === reminder.id ? (
                    <div className="completion-row">
                      <input autoFocus value={completionName} onChange={(event) => setCompletionName(event.target.value)} placeholder="Your name (required)" maxLength={120} onKeyDown={(event) => { if (event.key === 'Enter') void completeReminder(reminder.id); }} />
                      <button type="button" disabled={busyKey === `reminder-${reminder.id}`} onClick={() => void completeReminder(reminder.id)}>Confirm Done</button>
                      <button type="button" className="secondary" onClick={() => { setCompletingReminderId(null); setCompletionName(''); }}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="complete-btn" onClick={() => { setCompletingReminderId(reminder.id); setCompletionName(''); }}>Mark Complete</button>
                  )}
                  {isSuperuser ? <button type="button" className="delete-link" disabled={busyKey === `reminder-${reminder.id}`} onClick={() => void deleteReminder(reminder.id)}>Delete</button> : null}
                </article>
              )) : <div className="empty">{reminderView === 'OPEN' ? 'No open reminders. The next shift is clear.' : 'No completed reminders yet.'}</div>}
            </div>
          </section>
        </section>
      )}
      <Styles />
    </main>
  );
}

function Styles() {
  return <style jsx global>{`
    *{box-sizing:border-box}body{margin:0;background:#eef3f9;color:#10223c;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.foq-page{min-height:100vh;padding:18px}.foq-header,.item-panel,.action-panel,.main-tabs,.foq-state{max-width:1450px;margin-left:auto;margin-right:auto;background:#fff;border:1px solid #d7e1ec;border-radius:16px;box-shadow:0 10px 28px rgba(24,49,82,.07)}.foq-header{padding:20px 22px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:18px}.foq-header h1{margin:3px 0;font-size:28px;letter-spacing:-.03em}.foq-header p{margin:0;color:#64758a;font-size:13px}.eyebrow{display:block;color:#2462d0;font-size:9px;font-weight:950;letter-spacing:.14em}.header-actions,.heading-actions{display:flex;align-items:center;gap:8px}.header-actions a,.header-actions button,.secondary{border:1px solid #c7d3e1;background:#fff;color:#21344e;border-radius:10px;padding:10px 13px;text-decoration:none;font-weight:850;cursor:pointer}.notice{max-width:1450px;margin:0 auto 10px;padding:11px 14px;border-radius:10px;font-size:12px;font-weight:800}.notice.error{background:#fff1f0;border:1px solid #f2c1bd;color:#a72d25}.notice.success{background:#edf9f2;border:1px solid #b5dfc7;color:#0d7543}.item-panel{padding:14px 16px;margin-bottom:10px}.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:13px}.section-heading.compact{align-items:center;margin-bottom:9px}.section-heading h2{font-size:18px;margin:3px 0 0}.count{border-radius:999px;padding:5px 9px;background:#eef3f9;color:#52667f;font-size:10px;font-weight:900}.count.warn{background:#fff0e8;color:#b74518}.count.good{background:#e9f8ef;color:#0b7945}.small{padding:6px 9px!important;font-size:10px}.inline-create{display:grid;grid-template-columns:1.2fr 1.5fr auto auto;gap:7px;margin:8px 0 10px}.inline-create input,.inline-create button,.inline-action input,.inline-action button,.completion-row input,.completion-row button{min-height:38px;border:1px solid #cbd6e3;border-radius:9px;padding:8px 10px;background:#fff}.inline-create button,.inline-action button,.completion-row button{background:#235fc8;color:#fff;font-weight:850;cursor:pointer}.item-strip{display:flex;gap:9px;overflow-x:auto;padding:2px 1px 7px;scrollbar-width:thin}.item-card{position:relative;flex:0 0 235px;min-height:128px;padding:12px;border:1px solid #d9e3ee;border-left:4px solid #21a366;border-radius:12px;background:#f9fcfa;display:flex;flex-direction:column;gap:7px}.item-card.loaned{border-left-color:#e4722b;background:#fff9f4}.item-top{display:flex;justify-content:space-between;gap:8px}.item-top strong{font-size:13px}.item-top span{font-size:8px;font-weight:950;color:#64758a}.item-card small{font-size:10px;color:#6c7d91}.item-card>button:not(.archive-link),.return-btn{margin-top:auto;border:0;border-radius:9px;padding:9px;background:#1e64cd;color:#fff;font-weight:900;cursor:pointer}.item-card .return-btn{background:#16824d}.holder{font-size:12px}.inline-action{display:grid;grid-template-columns:1fr 1fr;gap:5px}.inline-action input{grid-column:1/-1;min-width:0}.archive-link,.delete-link{position:absolute;top:35px;right:10px;border:0!important;background:transparent!important;color:#9a4b4b!important;font-size:9px!important;padding:2px!important;cursor:pointer}.empty-inline{padding:20px;color:#718197;font-size:12px}.main-tabs{padding:5px;margin-bottom:10px;display:grid;grid-template-columns:1fr 1fr;gap:5px}.main-tabs button{min-height:66px;border:1px solid transparent;border-radius:12px;background:transparent;color:#54677f;padding:9px 14px;text-align:left;display:grid;grid-template-columns:auto 1fr;column-gap:8px;cursor:pointer}.main-tabs button span{font-size:15px;font-weight:950}.main-tabs button b{justify-self:end;border-radius:999px;padding:2px 7px;background:#e8eef6;font-size:11px}.main-tabs button small{grid-column:1/-1;font-size:10px}.main-tabs button.active{background:#153d76;color:#fff;box-shadow:0 5px 13px rgba(21,61,118,.2)}.main-tabs button.active b{background:#fff;color:#153d76}.workspace-grid{max-width:1450px;margin:0 auto;display:grid;grid-template-columns:minmax(320px,.8fr) minmax(420px,1.2fr);gap:10px;align-items:start}.action-panel{padding:17px;margin:0}.create-panel label{display:grid;gap:6px;margin-top:11px;font-size:11px;font-weight:900;color:#465b75}.create-panel label small{font-weight:600}.create-panel input,.create-panel textarea{width:100%;border:1px solid #c9d5e3;border-radius:10px;padding:11px 12px;background:#fbfcfe;color:#10223c;font:inherit;resize:vertical}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.choice-row{display:flex;flex-wrap:wrap;gap:6px}.choice-row button{border:1px solid #cbd6e3;border-radius:9px;background:#fff;color:#4a607a;padding:8px 10px;font-size:10px;font-weight:850;cursor:pointer}.choice-row button.selected{border-color:#1f60c8;background:#eaf2ff;color:#174f9e;box-shadow:inset 0 0 0 1px #1f60c8}.choice-row button.hk.selected{background:#eaf9f0;border-color:#23935b;color:#167044}.choice-row button.mt.selected{background:#edf3ff;border-color:#3d6ed2;color:#2658b2}.waiting-toggle{display:flex!important;grid-template-columns:auto 1fr!important;align-items:flex-start;gap:9px!important;padding:10px 11px;border:1px solid #e4c8b7;border-radius:10px;background:#fff9f5}.waiting-toggle input{width:auto}.waiting-toggle span{display:grid}.waiting-toggle small{color:#7f6b60}.urgent-pill{border-radius:999px;background:#fff0e8;color:#be461b;padding:5px 9px;font-size:9px;font-weight:950}.primary-action{width:100%;margin-top:13px;border:0;border-radius:11px;padding:12px 15px;background:#1764cf;color:#fff;font-weight:950;cursor:pointer}.primary-action:disabled,button:disabled{opacity:.55;cursor:not-allowed}.info-note{margin-top:11px;padding:10px;border-radius:9px;background:#eef5ff;color:#36577f;font-size:10px;line-height:1.4}.compact-list{display:grid;gap:7px;max-height:575px;overflow:auto;padding-right:2px}.compact-card,.reminder-card{position:relative;border:1px solid #dce4ee;border-left:4px solid #df862d;border-radius:11px;padding:11px 12px;background:#fff}.compact-card.done,.reminder-card.done{border-left-color:#25a165;background:#f8fcfa}.card-title,.card-title>div{display:flex;align-items:center;gap:7px}.card-title{justify-content:space-between}.card-title b{font-size:9px}.card-title strong{font-size:13px}.card-title em{font-style:normal;font-size:8px;font-weight:950;color:#6a7b90}.dept{border-radius:999px;padding:3px 6px;font-size:8px;font-weight:950}.dept.hk{background:#e8f8ef;color:#137447}.dept.mt{background:#eaf0ff;color:#2b58ae}.compact-card p,.reminder-card p{margin:7px 0;color:#2c425e;font-size:12px;line-height:1.4;white-space:pre-wrap}.compact-card small,.reminder-card small{color:#78889a;font-size:9px}.empty{padding:30px 15px;border:1px dashed #cbd6e3;border-radius:10px;text-align:center;color:#718197;font-size:12px}.mini-tabs{display:flex;border:1px solid #d5deea;border-radius:9px;padding:3px}.mini-tabs button{border:0;border-radius:6px;background:transparent;color:#63758b;padding:6px 8px;font-size:9px;font-weight:900;cursor:pointer}.mini-tabs button.active{background:#173f77;color:#fff}.complete-btn{margin-top:9px;border:0;border-radius:8px;padding:8px 10px;background:#16834e;color:#fff;font-size:10px;font-weight:900;cursor:pointer}.completion-row{display:grid;grid-template-columns:1fr auto auto;gap:5px;margin-top:9px}.completion-row input{min-width:0}.completed-by{margin-top:8px;border-radius:8px;padding:7px 9px;background:#e9f8f0;color:#176942;font-size:10px}.reminder-card .delete-link{top:auto;bottom:8px}.foq-state{margin-top:12vh;padding:35px;text-align:center}.foq-state a{color:#1e61c7}.secondary{background:#fff!important;color:#324861!important}@media(max-width:920px){.workspace-grid{grid-template-columns:1fr}.compact-list{max-height:none}.field-grid{grid-template-columns:1fr}.inline-create{grid-template-columns:1fr 1fr}.inline-create input{grid-column:span 1}}@media(max-width:620px){.foq-page{padding:8px}.foq-header{padding:15px;align-items:flex-start;display:grid}.foq-header h1{font-size:24px}.header-actions{width:100%}.header-actions>*{flex:1;text-align:center}.item-panel,.action-panel{padding:12px}.main-tabs button{padding:8px;min-height:62px}.main-tabs button span{font-size:13px}.workspace-grid{gap:8px}.inline-create{grid-template-columns:1fr}.inline-create input{grid-column:auto}.completion-row{grid-template-columns:1fr 1fr}.completion-row input{grid-column:1/-1}.item-card{flex-basis:215px}.choice-row button{flex:1}.department-row button{min-width:130px}}\n+  `}</style>;
}
