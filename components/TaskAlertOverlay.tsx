'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';
import { subscribeToTaskBroadcast } from '../lib/taskRealtimeClient';

type AlertTask = {
  id: string;
  task_code: string;
  room: string;
  department: string;
  task_text: string;
  alert_kind: 'URGENT' | 'CUSTOMER_WAITING' | 'CHAMBERMAID_DEFECT';
  due_at?: string | null;
  created_at: string;
};

type Props = {
  userId?: string;
};

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

function timerLabel(dueAt: string | null | undefined, now: number) {
  const parsed = Date.parse(String(dueAt || ''));
  if (!Number.isFinite(parsed)) return 'ATTEND NOW';
  const remaining = parsed - now;
  if (remaining <= 0) return 'TARGET TIME PASSED';
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TaskAlertOverlay({ userId }: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [alerts, setAlerts] = useState<AlertTask[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadAlerts = useCallback(async (token: string) => {
    if (!token || !userId) return;
    const response = await fetchTaskAlerts('/api/task-alerts', {
      cache: 'no-store',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await responseJson(response);
    setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted || !session?.access_token) return;
      setAccessToken(session.access_token);
      try {
        await loadAlerts(session.access_token);
      } catch (nextError: any) {
        if (mounted) setError(nextError?.message || 'Unable to load urgent task alerts.');
      }
    })();
    return () => { mounted = false; };
  }, [loadAlerts, supabase]);

  useEffect(() => {
    if (!accessToken || !userId) return;
    let refreshTimer: number | null = null;

    const refreshAlerts = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadAlerts(accessToken).catch((nextError: any) => {
          setError(nextError?.message || 'Unable to refresh urgent task alerts.');
        });
      }, 180);
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
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
      clearRefreshTimer();
    };
  }, [accessToken, loadAlerts, userId]);

  const current = alerts[0] || null;

  useEffect(() => {
    if (!current || current.alert_kind === 'CHAMBERMAID_DEFECT') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [current?.alert_kind, current?.id]);

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

  if (!current) return null;

  const isUrgent = current.alert_kind === 'URGENT';
  const isChambermaidDefect = current.alert_kind === 'CHAMBERMAID_DEFECT';
  const queueCount = alerts.length;
  return (
    <div className="global-task-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="global-task-alert-title">
      <section className={`global-task-alert-card${isChambermaidDefect ? ' chambermaid-defect' : ''}`}>
        <div className="global-task-alert-icon" aria-hidden="true">!</div>
        <span className="global-task-alert-kicker">
          {isUrgent ? 'URGENT TASK' : isChambermaidDefect ? 'HK SUPERVISOR NOTICE' : 'CUSTOMER WAITING'}
        </span>
        <h2 id="global-task-alert-title">
          {isUrgent ? 'Immediate attention required' : isChambermaidDefect ? 'New chambermaid defect' : 'A customer is waiting'}
        </h2>
        <div className="global-task-alert-meta">
          <b>{current.task_code}</b>
          <span>{current.room}</span>
          <em>{current.department}</em>
        </div>
        <p className="global-task-alert-description">{current.task_text}</p>
        {!isChambermaidDefect ? (
          <div className="global-task-alert-timer">
            <small>{isUrgent ? '5-minute response target' : '10-minute customer target'}</small>
            <strong>{timerLabel(current.due_at, now)}</strong>
          </div>
        ) : null}
        {queueCount > 1 ? (
          <p className="global-task-alert-queue">{queueCount} alerts are waiting for your acknowledgement.</p>
        ) : null}
        {error ? <div className="global-task-alert-error">{error}</div> : null}
        <button type="button" onClick={() => void acknowledge()} disabled={busy}>
          {busy ? 'Recording...' : 'Acknowledge'}
        </button>
        <p className="global-task-alert-note">
          Your name and acknowledgement time will be recorded on this task.
        </p>
      </section>
      <style jsx global>{`
        .global-task-alert-overlay{position:fixed;inset:0;z-index:30000;display:grid;place-items:center;padding:14px;background:rgba(50,3,7,.86);backdrop-filter:blur(7px)}
        .global-task-alert-card{width:min(570px,100%);border:5px solid #ff3434;border-radius:24px;padding:24px;background:#fff7f7;color:#441013;text-align:center;box-shadow:0 0 0 10px rgba(255,45,45,.25),0 30px 90px rgba(0,0,0,.58);animation:globalUrgentPulse 1s ease-in-out infinite}
        .global-task-alert-card.chambermaid-defect{border-color:#2563eb;background:#f4f8ff;color:#142a52;box-shadow:0 0 0 10px rgba(37,99,235,.2),0 30px 90px rgba(0,0,0,.5);animation:none}
        .global-task-alert-card.chambermaid-defect .global-task-alert-icon{background:#2563eb;box-shadow:0 0 0 8px #dbeafe}
        .global-task-alert-card.chambermaid-defect .global-task-alert-kicker{color:#1d4ed8}
        .global-task-alert-card.chambermaid-defect h2{color:#173f87}
        .global-task-alert-icon{width:74px;height:74px;margin:0 auto 10px;border-radius:999px;background:#c51620;color:#fff;display:grid;place-items:center;font-size:50px;font-weight:950;line-height:1;box-shadow:0 0 0 8px #ffd4d6}
        .global-task-alert-kicker{display:block;color:#bd1520;font-size:12px;font-weight:950;letter-spacing:.18em}
        .global-task-alert-card h2{margin:6px 0 15px;color:#861019;font-size:clamp(26px,6vw,38px);line-height:1.02;letter-spacing:-.035em}
        .global-task-alert-meta{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:7px}
        .global-task-alert-meta b,.global-task-alert-meta span,.global-task-alert-meta em{border-radius:999px;padding:6px 10px;background:#f6dfe0;color:#65161b;font-size:11px;font-style:normal;font-weight:900}
        .global-task-alert-description{margin:16px auto;max-width:480px;color:#2e1113;font-size:17px;font-weight:850;line-height:1.45;white-space:pre-wrap}
        .global-task-alert-timer{border-radius:14px;padding:11px 14px;background:linear-gradient(135deg,#c91e27,#981019);color:#fff;display:grid;gap:2px}
        .global-task-alert-timer small{text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:.12em;opacity:.86}
        .global-task-alert-timer strong{font-variant-numeric:tabular-nums;font-size:clamp(27px,8vw,44px);line-height:1;font-weight:950;letter-spacing:.02em}
        .global-task-alert-queue{margin:10px 0 0;color:#9d1820;font-size:11px;font-weight:900}
        .global-task-alert-error{margin-top:11px;border-radius:9px;padding:9px 11px;background:#7d1017;color:#fff;font-size:11px;font-weight:850}
        .global-task-alert-card>button{width:100%;min-height:58px;margin-top:15px;border:0;border-radius:13px;background:#132f57;color:#fff;font-size:17px;font-weight:950;cursor:pointer;box-shadow:0 9px 22px rgba(19,47,87,.25)}
        .global-task-alert-card>button:disabled{opacity:.65;cursor:wait}
        .global-task-alert-note{margin:9px 0 0;color:#87585c;font-size:10px;font-weight:750}
        @keyframes globalUrgentPulse{0%,100%{border-color:#ff3434;box-shadow:0 0 0 8px rgba(255,45,45,.22),0 30px 90px rgba(0,0,0,.58)}50%{border-color:#920812;box-shadow:0 0 0 16px rgba(255,45,45,.38),0 30px 95px rgba(0,0,0,.68)}}
        @media(max-width:620px){.global-task-alert-overlay{padding:9px}.global-task-alert-card{padding:20px 14px;border-width:4px}.global-task-alert-description{font-size:15px}.global-task-alert-card>button{min-height:55px}}
        @media(prefers-reduced-motion:reduce){.global-task-alert-card{animation:none}}
      `}</style>
    </div>
  );
}
