import {
  FNB_ORDER_BROADCAST_CHANNEL,
  FNB_ORDER_BROADCAST_EVENT,
  type FnbOrderBroadcastEventType,
} from './fnbOrderRealtime';

export async function broadcastFnbOrderChange(eventType: FnbOrderBroadcastEventType) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) return;

  try {
    const response = await fetch(
      `${supabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(FNB_ORDER_BROADCAST_CHANNEL)}/events/${encodeURIComponent(FNB_ORDER_BROADCAST_EVENT)}?private=true`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventType, changedAt: new Date().toISOString() }),
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      console.warn(`F&B order broadcast failed with status ${response.status}.`);
    }
  } catch (error: any) {
    // Order writes must remain successful if a transient notification fails.
    console.warn('F&B order broadcast failed:', error?.message || error);
  }
}

