'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createBrowserSupabaseClient } from './supabaseBrowser';
import {
  readTaskBroadcastPayload,
  TASK_BROADCAST_CHANNEL,
  TASK_BROADCAST_EVENT,
  type TaskBroadcastPayload,
} from './taskRealtime';

type Listener = (payload: TaskBroadcastPayload) => void;

const listeners = new Set<Listener>();
let activeChannel: RealtimeChannel | null = null;
let currentToken = '';
let startPromise: Promise<void> | null = null;
let generation = 0;
let visibilityAttached = false;

function stopChannel() {
  generation += 1;
  const channel = activeChannel;
  activeChannel = null;
  if (channel) void createBrowserSupabaseClient().removeChannel(channel);
}

function ensureChannel() {
  if (
    typeof document === 'undefined' ||
    document.visibilityState !== 'visible' ||
    listeners.size === 0 ||
    activeChannel ||
    startPromise
  ) return;

  const requestedGeneration = generation;
  startPromise = (async () => {
    const supabase = createBrowserSupabaseClient();
    if (currentToken) await supabase.realtime.setAuth(currentToken);
    else await supabase.realtime.setAuth();

    if (
      requestedGeneration !== generation ||
      listeners.size === 0 ||
      document.visibilityState !== 'visible'
    ) return;

    activeChannel = supabase
      .channel(TASK_BROADCAST_CHANNEL, { config: { private: true } })
      .on('broadcast', { event: TASK_BROADCAST_EVENT }, (message) => {
        const payload = readTaskBroadcastPayload(message?.payload);
        if (!payload) return;
        for (const listener of listeners) listener(payload);
      })
      .subscribe();
  })()
    .catch(() => undefined)
    .finally(() => {
      startPromise = null;
    });
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') {
    stopChannel();
    return;
  }
  const pendingStart = startPromise;
  if (pendingStart) void pendingStart.then(() => ensureChannel());
  else ensureChannel();
}

export function subscribeToTaskBroadcast(
  listener: Listener,
  options: { accessToken?: string } = {}
) {
  listeners.add(listener);
  if (options.accessToken) currentToken = options.accessToken;
  if (!visibilityAttached) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityAttached = true;
  }
  ensureChannel();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopChannel();
    currentToken = '';
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityAttached = false;
  };
}
