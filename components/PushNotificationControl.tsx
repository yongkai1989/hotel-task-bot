'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type State = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on' | 'busy' | 'unconfigured';

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function authHeaders() {
  const supabase = createBrowserSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Please sign in again before enabling notifications.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

export default function PushNotificationControl({ userId }: { userId?: string }) {
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (mounted) setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (mounted) setState('blocked');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/push-service-worker.js');
        const subscription = await registration.pushManager.getSubscription();
        if (mounted) setState(subscription ? 'on' : 'off');
      } catch {
        if (mounted) setState('unsupported');
      }
    })();
    return () => { mounted = false; };
  }, [userId]);

  async function enable() {
    if (state === 'busy' || !userId) return;
    setState('busy');
    setMessage('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }

      const [registration, keyResponse] = await Promise.all([
        navigator.serviceWorker.register('/push-service-worker.js'),
        fetch('/api/push/public-key', { cache: 'no-store' }),
      ]);
      const keyPayload = await responseJson(keyResponse);
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(keyPayload.publicKey),
      });

      const saveResponse = await fetch('/api/push/subscribe', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: await authHeaders(),
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      await responseJson(saveResponse);
      setState('on');
      setMessage('This tablet will receive urgent task alerts.');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to enable notifications.');
      setState(/not configured/i.test(error?.message || '') ? 'unconfigured' : 'off');
    }
  }

  async function disable() {
    if (state === 'busy') return;
    setState('busy');
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/push-service-worker.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const removeResponse = await fetch('/api/push/unsubscribe', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'include',
          headers: await authHeaders(),
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await responseJson(removeResponse);
        await subscription.unsubscribe();
      }
      setState('off');
      setMessage('Notifications are off on this tablet.');
    } catch (error: any) {
      setState('on');
      setMessage(error?.message || 'Unable to disable notifications.');
    }
  }

  if (state === 'checking' || !userId) return null;
  const isOn = state === 'on';
  const label = state === 'busy'
    ? 'Please wait...'
    : isOn
      ? 'Alerts On'
      : state === 'blocked'
        ? 'Alerts Blocked'
        : state === 'unsupported'
          ? 'Alerts Unsupported'
          : state === 'unconfigured'
            ? 'Alerts Not Ready'
            : 'Enable Alerts';

  return (
    <div className="push-control-wrap">
      <button
        type="button"
        className={`push-control ${isOn ? 'enabled' : ''}`}
        onClick={() => void (isOn ? disable() : enable())}
        disabled={state === 'busy' || state === 'unsupported' || state === 'blocked' || state === 'unconfigured'}
        title={message || (isOn ? 'Disable Web Push on this tablet' : 'Enable Web Push on this tablet')}
      >
        <span aria-hidden="true">{isOn ? '●' : '○'}</span>
        {label}
      </button>
      {message ? <span className="push-control-message" role="status">{message}</span> : null}
      <style jsx>{`
        .push-control-wrap{position:relative;display:inline-flex;align-items:center}
        .push-control{min-height:45px;border:1px solid #cbd9ea;border-radius:14px;padding:10px 14px;background:#fff;color:#284261;font-size:12px;font-weight:900;display:inline-flex;align-items:center;gap:7px;cursor:pointer;box-shadow:0 8px 20px rgba(15,23,42,.05)}
        .push-control.enabled{border-color:#75d5a3;background:#effcf5;color:#117542}
        .push-control:disabled{opacity:.65;cursor:not-allowed}
        .push-control-message{position:absolute;z-index:20;top:calc(100% + 7px);left:0;width:260px;border:1px solid #cad8e8;border-radius:10px;padding:8px 10px;background:#fff;color:#31465f;font-size:10px;font-weight:750;box-shadow:0 12px 28px rgba(15,23,42,.14)}
        @media(max-width:620px){.push-control{min-height:42px;padding:9px 11px}.push-control-message{position:fixed;top:auto;left:12px;right:12px;bottom:12px;width:auto}}
      `}</style>
    </div>
  );
}
