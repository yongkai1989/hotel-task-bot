'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';
import { subscribeToTaskBroadcast } from '../lib/taskRealtimeClient';

type AlertTask = {
  id: string;
  task_code: string;
  room: string;
  department: string;
  task_text: string;
  alert_kind: 'URGENT' | 'CUSTOMER_WAITING' | 'CHAMBERMAID_DEFECT' | 'FOLLOW_UP_DEPARTMENT' | 'FOLLOW_UP_FO';
  urgent?: boolean | null;
  customer_waiting?: boolean | null;
  due_at?: string | null;
  escalation_count?: number;
  alert_cycle?: number;
  completion_follow_up_sent_at?: string | null;
  created_at: string;
};

type Props = {
  userId?: string;
};

const ALERT_POLL_INTERVAL_MS = 60_000;
const ALERT_POLL_LEASE_MS = 75_000;

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function fetchTaskAlerts(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function TaskAlertOverlay({ userId }: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [alerts, setAlerts] = useState<AlertTask[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alertsRef = useRef<AlertTask[]>([]);
  const alertRequestRef = useRef<Promise<void> | null>(null);
  const pollOwnerRef = useRef(`task-alert-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const dismissedKey = useCallback((alert: AlertTask) => {
    const followUpOccurrence = alert.alert_kind.startsWith('FOLLOW_UP_')
      ? String(alert.completion_follow_up_sent_at || '')
      : String(Number(alert.escalation_count || 0));
    return `dismissed-task-alert:${alert.id}:${Number(alert.alert_cycle || 1)}:${alert.alert_kind}:${followUpOccurrence}`;
  }, []);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const loadAlerts = useCallback(async (token: string) => {
    if (!token || !userId) return;
    if (alertRequestRef.current) return alertRequestRef.current;
    const request = (async () => {
      const response = await fetchTaskAlerts('/api/task-alerts', {
        cache: 'no-store',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await responseJson(response);
      const received = Array.isArray(payload?.alerts) ? payload.alerts as AlertTask[] : [];
      setAlerts(received.filter((alert) => {
        if (alert.alert_kind === 'CHAMBERMAID_DEFECT') return true;
        return window.sessionStorage.getItem(dismissedKey(alert)) !== '1';
      }));
    })().finally(() => {
      if (alertRequestRef.current === request) alertRequestRef.current = null;
    });
    alertRequestRef.current = request;
    return request;
  }, [dismissedKey, userId]);

  useEffect(() => {
    let mounted = true;
    const useSession = async (token: string) => {
      if (!mounted || !token) return;
      setAccessToken(token);
      try {
        await loadAlerts(token);
        if (mounted) setError('');
      } catch (nextError: any) {
        if (mounted) setError(nextError?.message || 'Unable to load urgent task alerts.');
      }
    };
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) void useSession(session.access_token);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token || '';
      if (!mounted) return;
      setAccessToken(token);
      if (token) void useSession(token);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadAlerts, supabase]);

  useEffect(() => {
    if (!accessToken || !userId) return;
    let refreshTimer: number | null = null;

    const refreshAlerts = (payload: { id: string; alertUserIds?: string[] }) => {
      const alreadyVisible = alertsRef.current.some((alert) => alert.id === payload.id);
      const addressedToUser = payload.alertUserIds?.includes(userId) === true;
      if (!alreadyVisible && !addressedToUser) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadAlerts(accessToken).catch((nextError: any) => {
          setError(nextError?.message || 'Unable to refresh urgent task alerts.');
        });
      }, 700 + Math.floor(Math.random() * 300));
    };

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadAlerts(accessToken);
      } else {
        clearRefreshTimer();
      }
    };

    const unsubscribe = subscribeToTaskBroadcast(refreshAlerts, { accessToken });
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'TASK_PUSH_RECEIVED') return;
      void loadAlerts(accessToken).catch((nextError: any) => {
        setError(nextError?.message || 'Unable to refresh urgent task alerts.');
      });
    };
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
      unsubscribe();
      clearRefreshTimer();
    };
  }, [accessToken, loadAlerts, userId]);

  useEffect(() => {
    if (!accessToken || !userId) return;
    const leaseKey = `task-alert-poll-lease:${userId}`;
    const ownsPollingLease = () => {
      const now = Date.now();
      try {
        const current = JSON.parse(window.localStorage.getItem(leaseKey) || 'null');
        if (
          current?.owner
          && current.owner !== pollOwnerRef.current
          && Number(current.expiresAt || 0) > now
        ) return false;
        window.localStorage.setItem(leaseKey, JSON.stringify({
          owner: pollOwnerRef.current,
          expiresAt: now + ALERT_POLL_LEASE_MS,
        }));
        return true;
      } catch {
        return true;
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && ownsPollingLease()) {
        void loadAlerts(accessToken).catch(() => {});
      }
    }, ALERT_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      try {
        const current = JSON.parse(window.localStorage.getItem(leaseKey) || 'null');
        if (current?.owner === pollOwnerRef.current) window.localStorage.removeItem(leaseKey);
      } catch {
        // A stale lease naturally expires.
      }
    };
  }, [accessToken, loadAlerts, userId]);

  const current = alerts[0] || null;

  async function acknowledge() {
    if (!current || !accessToken || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetchTaskAlerts('/api/task-alerts', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ taskId: current.id }),
      });
      await responseJson(response);
      const registration = await navigator.serviceWorker?.getRegistration('/push-service-worker.js');
      registration?.active?.postMessage({
        type: 'CLEAR_TASK_NOTIFICATION',
        taskId: current.id,
      });
      setAlerts((existing) => existing.filter((alert) => alert.id !== current.id));
    } catch (nextError: any) {
      const message = nextError?.message || 'Unable to acknowledge this task.';
      setError(message);
      if (/no longer active|already acknowledged/i.test(message)) {
        void loadAlerts(accessToken);
      }
    } finally {
      setBusy(false);
    }
  }

  async function markDone() {
    if (!current || !accessToken || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetchTaskAlerts('/api/task-status', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ taskId: current.id, status: 'DONE' }),
      });
      await responseJson(response);
      const registration = await navigator.serviceWorker?.getRegistration('/push-service-worker.js');
      registration?.active?.postMessage({ type: 'CLEAR_TASK_NOTIFICATION', taskId: current.id });
      setAlerts((existing) => existing.filter((alert) => alert.id !== current.id));
    } catch (nextError: any) {
      setError(nextError?.message || 'Unable to mark this task Done.');
    } finally {
      setBusy(false);
    }
  }

  async function doingNow() {
    if (!current || !accessToken || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetchTaskAlerts('/api/task-alerts', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ taskId: current.id, action: 'DOING_NOW' }),
      });
      await responseJson(response);
      setAlerts((existing) => existing.filter((alert) => alert.id !== current.id));
    } catch (nextError: any) {
      const message = nextError?.message || 'Unable to schedule the next completion check.';
      setError(message);
      if (/no longer active|already handled/i.test(message)) void loadAlerts(accessToken);
    } finally {
      setBusy(false);
    }
  }

  function closeCurrent() {
    if (!current || current.alert_kind === 'CHAMBERMAID_DEFECT') return;
    window.sessionStorage.setItem(dismissedKey(current), '1');
    setAlerts((existing) => existing.filter((alert) =>
      alert.id !== current.id || Number(alert.alert_cycle || 1) !== Number(current.alert_cycle || 1)
    ));
  }

  function openQuickActions() {
    if (!current) return;
    window.sessionStorage.setItem(dismissedKey(current), '1');
    window.location.assign('/dashboard/fo-quick-actions');
  }

  if (!current) return null;

  const isUrgent = current.alert_kind === 'URGENT';
  const isChambermaidDefect = current.alert_kind === 'CHAMBERMAID_DEFECT';
  const isDepartmentFollowUp = current.alert_kind === 'FOLLOW_UP_DEPARTMENT';
  const isFoFollowUp = current.alert_kind === 'FOLLOW_UP_FO';
  const isCompletionFollowUp = isDepartmentFollowUp || isFoFollowUp;
  const priorityLabel = current.urgent === true ? 'URGENT TASK' : 'CUSTOMER WAITING';
  const queueCount = alerts.length;
  return (
    <div className="global-task-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="global-task-alert-title">
      <section className={`global-task-alert-card${isChambermaidDefect ? ' chambermaid-defect' : ''}${isCompletionFollowUp ? ' completion-follow-up' : ''}`}>
        {!isChambermaidDefect && !isDepartmentFollowUp ? (
          <button
            type="button"
            className="global-task-alert-close-x"
            onClick={closeCurrent}
            aria-label="Close this alert without acknowledging"
          >×</button>
        ) : null}
        <div className="global-task-alert-icon" aria-hidden="true">!</div>
        <span className="global-task-alert-kicker">
          {isDepartmentFollowUp ? `${priorityLabel} · COMPLETION CHECK` : isFoFollowUp ? `${priorityLabel} · FO FOLLOW-UP` : isUrgent ? 'URGENT TASK' : isChambermaidDefect ? 'HK SUPERVISOR NOTICE' : 'CUSTOMER WAITING'}
        </span>
        <h2 id="global-task-alert-title">
          {isDepartmentFollowUp ? 'Is this task done?' : isFoFollowUp ? 'Please follow up now' : isUrgent ? 'Immediate attention required' : isChambermaidDefect ? 'New chambermaid defect' : 'A customer is waiting'}
        </h2>
        <div className="global-task-alert-meta">
          <b>{current.task_code}</b>
          <span>{current.room}</span>
          <em>{current.department}</em>
        </div>
        <p className="global-task-alert-description">{current.task_text}</p>
        {!isChambermaidDefect && !isCompletionFollowUp ? (
          <p className="global-task-alert-malay">
            Tekan <b>Acknowledge</b> hanya jika aras ini di bawah tanggungjawab anda. Jika bukan,
            tekan <b>Close</b> supaya petugas yang bertanggungjawab boleh mengesahkannya.
          </p>
        ) : null}
        {isDepartmentFollowUp ? (
          <p className="global-task-alert-malay">
            Tugasan ini telah diakui tetapi masih <b>Open</b> selepas {current.urgent === true ? '5 minit' : '10 minit'}.
            Adakah sudah selesai? Jika sudah, tekan <b>Mark as Done</b>. Jika sedang dibuat, tekan <b>Doing Now</b>.
          </p>
        ) : null}
        {isFoFollowUp ? (
          <p className="global-task-alert-malay">
            Tugasan ini telah diakui tetapi masih <b>Open</b>. Sila follow up dengan <b>{current.department}</b>
            sehingga tugasan selesai.
          </p>
        ) : null}
        {!isChambermaidDefect && !isCompletionFollowUp ? (
          <div className="global-task-alert-timer">
            <small>Completion check starts after acknowledgement</small>
            <strong>{isUrgent ? '5 MINUTES' : '10 MINUTES'}</strong>
          </div>
        ) : null}
        {!isChambermaidDefect && !isCompletionFollowUp && Number(current.escalation_count || 0) > 0 ? (
          <p className="global-task-alert-escalation">
            Follow-up {current.escalation_count} sent — still waiting for one team member to acknowledge.
          </p>
        ) : null}
        {queueCount > 1 ? (
          <p className="global-task-alert-queue">{queueCount} task alerts are waiting.</p>
        ) : null}
        {error ? <div className="global-task-alert-error">{error}</div> : null}
        <div className={`global-task-alert-actions${isDepartmentFollowUp ? ' department-follow-up' : ''}`}>
          {isDepartmentFollowUp ? (
            <>
              <button type="button" className="acknowledge" onClick={() => void markDone()} disabled={busy}>
                {busy ? 'Saving...' : 'Mark as Done'}
              </button>
              <button type="button" className="doing-now" onClick={() => void doingNow()} disabled={busy}>
                {busy ? 'Saving...' : 'Doing Now'}
              </button>
            </>
          ) : isFoFollowUp ? (
            <button type="button" className="acknowledge" onClick={openQuickActions} disabled={busy}>
              Open Quick Actions
            </button>
          ) : (
            <button type="button" className="acknowledge" onClick={() => void acknowledge()} disabled={busy}>
              {busy ? 'Recording...' : 'Acknowledge'}
            </button>
          )}
          {!isChambermaidDefect && !isDepartmentFollowUp ? (
            <button type="button" className="close" onClick={closeCurrent} disabled={busy}>Close</button>
          ) : null}
        </div>
        <p className="global-task-alert-note">
          {isDepartmentFollowUp
            ? 'Doing Now closes this reminder and asks again in 5 minutes. It repeats every 5 minutes until the task is marked Done.'
            : isFoFollowUp
              ? 'Follow up with the assigned department; FO should not close their task for them.'
              : 'Your name and acknowledgement time will be recorded. This clears the alert for the whole team; it does not mark the work Done.'}
        </p>
      </section>
      <style jsx global>{`
        .global-task-alert-overlay{position:fixed;inset:0;z-index:30000;display:grid;place-items:center;padding:14px;background:rgba(50,3,7,.86);backdrop-filter:blur(7px)}
        .global-task-alert-card{position:relative;width:min(570px,100%);border:5px solid #ff3434;border-radius:24px;padding:24px;background:#fff7f7;color:#441013;text-align:center;box-shadow:0 0 0 10px rgba(255,45,45,.25),0 30px 90px rgba(0,0,0,.58);animation:globalUrgentPulse 1s ease-in-out infinite}
        .global-task-alert-close-x{position:absolute;top:12px;right:12px;width:42px;height:42px;border:1px solid #e9b9bc;border-radius:999px;background:#fff;color:#75151b;font-size:29px;font-weight:700;line-height:1;cursor:pointer;box-shadow:0 4px 14px rgba(70,5,10,.16)}
        .global-task-alert-card.chambermaid-defect{border-color:#2563eb;background:#f4f8ff;color:#142a52;box-shadow:0 0 0 10px rgba(37,99,235,.2),0 30px 90px rgba(0,0,0,.5);animation:none}
        .global-task-alert-card.chambermaid-defect .global-task-alert-icon{background:#2563eb;box-shadow:0 0 0 8px #dbeafe}
        .global-task-alert-card.chambermaid-defect .global-task-alert-kicker{color:#1d4ed8}
        .global-task-alert-card.chambermaid-defect h2{color:#173f87}
        .global-task-alert-card.completion-follow-up{border-color:#f59e0b;background:#fffaf0;box-shadow:0 0 0 10px rgba(245,158,11,.22),0 30px 90px rgba(0,0,0,.55);animation:none}
        .global-task-alert-card.completion-follow-up .global-task-alert-icon{background:#d97706;box-shadow:0 0 0 8px #fef3c7}
        .global-task-alert-card.completion-follow-up .global-task-alert-kicker{color:#b45309}
        .global-task-alert-card.completion-follow-up h2{color:#78350f}
        .global-task-alert-icon{width:74px;height:74px;margin:0 auto 10px;border-radius:999px;background:#c51620;color:#fff;display:grid;place-items:center;font-size:50px;font-weight:950;line-height:1;box-shadow:0 0 0 8px #ffd4d6}
        .global-task-alert-kicker{display:block;color:#bd1520;font-size:12px;font-weight:950;letter-spacing:.18em}
        .global-task-alert-card h2{margin:6px 0 15px;color:#861019;font-size:clamp(26px,6vw,38px);line-height:1.02;letter-spacing:-.035em}
        .global-task-alert-meta{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:7px}
        .global-task-alert-meta b,.global-task-alert-meta span,.global-task-alert-meta em{border-radius:999px;padding:6px 10px;background:#f6dfe0;color:#65161b;font-size:11px;font-style:normal;font-weight:900}
        .global-task-alert-description{margin:16px auto;max-width:480px;color:#2e1113;font-size:17px;font-weight:850;line-height:1.45;white-space:pre-wrap}
        .global-task-alert-malay{margin:0 auto 13px;max-width:500px;border:2px solid #efb03b;border-radius:12px;padding:11px 13px;background:#fff3ce;color:#593600;font-size:13px;font-weight:750;line-height:1.45}
        .global-task-alert-timer{border-radius:14px;padding:11px 14px;background:linear-gradient(135deg,#c91e27,#981019);color:#fff;display:grid;gap:2px}
        .global-task-alert-timer small{text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:.12em;opacity:.86}
        .global-task-alert-timer strong{font-variant-numeric:tabular-nums;font-size:clamp(27px,8vw,44px);line-height:1;font-weight:950;letter-spacing:.02em}
        .global-task-alert-queue{margin:10px 0 0;color:#9d1820;font-size:11px;font-weight:900}
        .global-task-alert-escalation{margin:10px 0 0;border-radius:10px;padding:9px;background:#ffe0a8;color:#6b3c00;font-size:11px;font-weight:900}
        .global-task-alert-error{margin-top:11px;border-radius:9px;padding:9px 11px;background:#7d1017;color:#fff;font-size:11px;font-weight:850}
        .global-task-alert-actions{display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-top:15px}
        .global-task-alert-actions.department-follow-up{grid-template-columns:1fr 1fr}
        .global-task-alert-actions:has(.acknowledge:only-child){grid-template-columns:1fr}
        .global-task-alert-actions button{min-height:58px;border:0;border-radius:13px;font-size:17px;font-weight:950;cursor:pointer}
        .global-task-alert-actions .acknowledge{background:#132f57;color:#fff;box-shadow:0 9px 22px rgba(19,47,87,.25)}
        .global-task-alert-actions .close{border:2px solid #c9a2a5;background:#fff;color:#6f1d22}
        .global-task-alert-actions .doing-now{border:2px solid #d97706;background:#fff7e6;color:#7c3f00}
        .global-task-alert-actions button:disabled{opacity:.65;cursor:wait}
        .global-task-alert-note{margin:9px 0 0;color:#87585c;font-size:10px;font-weight:750}
        @keyframes globalUrgentPulse{0%,100%{border-color:#ff3434;box-shadow:0 0 0 8px rgba(255,45,45,.22),0 30px 90px rgba(0,0,0,.58)}50%{border-color:#920812;box-shadow:0 0 0 16px rgba(255,45,45,.38),0 30px 95px rgba(0,0,0,.68)}}
        @media(max-width:620px){.global-task-alert-overlay{padding:9px}.global-task-alert-card{padding:20px 14px;border-width:4px}.global-task-alert-description{font-size:15px}.global-task-alert-actions button{min-height:55px}.global-task-alert-close-x{top:9px;right:9px}}
        @media(prefers-reduced-motion:reduce){.global-task-alert-card{animation:none}}
      `}</style>
    </div>
  );
}
