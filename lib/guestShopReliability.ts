import { supabaseAdmin } from './supabaseAdmin';
import { createFoTaskForPaidGuestShopOrder } from './guestShopTask';
import { broadcastFnbOrderChange } from './fnbOrderBroadcastServer';

export async function settlePaidGuestShopOrder(orderId: string, paidAt?: string | null) {
  const { data, error } = await supabaseAdmin.rpc('settle_guest_shop_order', {
    p_order_id: orderId,
    p_paid_at: paidAt || new Date().toISOString(),
  });
  if (error) throw error;
  return data as any;
}

function retryDelaySeconds(attempts: number) {
  return Math.min(15 * 60, Math.max(15, 15 * 2 ** Math.max(0, attempts - 1)));
}

export async function processGuestShopOutbox(options: { orderId?: string; limit?: number } = {}) {
  const { data: jobs, error } = await supabaseAdmin.rpc('claim_guest_shop_order_outbox', {
    p_limit: Math.max(1, Math.min(options.limit || 5, 20)),
    p_order_id: options.orderId || null,
  });
  if (error) throw error;

  let completed = 0;
  let failed = 0;
  for (const job of (jobs || []) as any[]) {
    try {
      const { data: order, error: orderError } = await supabaseAdmin
        .from('guest_shop_orders')
        .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, order_type')
        .eq('id', job.order_id)
        .single();
      if (orderError) throw orderError;
      await createFoTaskForPaidGuestShopOrder(order);
      await supabaseAdmin
        .from('guest_shop_order_outbox')
        .update({ status: 'DONE', completed_at: new Date().toISOString(), last_error: null, locked_at: null })
        .eq('id', job.id);
      completed += 1;
    } catch (outboxError: any) {
      const attempts = Number(job.attempts || 1);
      const nextAttemptAt = new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString();
      await supabaseAdmin
        .from('guest_shop_order_outbox')
        .update({
          status: 'FAILED',
          next_attempt_at: nextAttemptAt,
          last_error: String(outboxError?.message || outboxError || 'Notification failed').slice(0, 500),
          locked_at: null,
        })
        .eq('id', job.id);
      failed += 1;
    }
  }
  return { claimed: (jobs || []).length, completed, failed };
}

export async function expireUnacceptedFnbOrders() {
  const { data, error } = await supabaseAdmin.rpc('expire_unaccepted_fnb_orders');
  if (error) throw error;
  const count = Number(data || 0);
  if (count > 0) await broadcastFnbOrderChange('UPDATE');
  return count;
}
