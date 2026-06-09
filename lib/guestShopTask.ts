import { supabaseAdmin } from './supabaseAdmin';
import { sendTelegramTaskCard } from './telegram';

const FO_DEPARTMENT = 'FO' as const;

function resolveFoTelegramChatId() {
  const fallbackRaw = process.env.ALLOWED_CHAT_ID;
  const fallbackChatId = Number(fallbackRaw);

  if (!fallbackRaw || Number.isNaN(fallbackChatId)) {
    return null;
  }

  return fallbackChatId;
}

function orderItemsSummary(items: any[]) {
  if (!Array.isArray(items) || !items.length) return 'No item details';

  return items
    .map((item) => {
      const quantity = Number(item?.quantity || item?.qty || 1);
      const name = String(item?.name || item?.item_name || 'Item');
      const optionText = Array.isArray(item?.selected_options)
        ? item.selected_options
            .flatMap((group: any) =>
              Array.isArray(group?.options)
                ? group.options.map((option: any) => String(option?.name || '').trim()).filter(Boolean)
                : []
            )
            .join(', ')
        : '';
      return `${quantity}x ${name}${optionText ? ` (${optionText})` : ''}`;
    })
    .join(', ');
}

export async function createFoTaskForPaidGuestShopOrder(order: any) {
  const orderId = String(order?.id || '').trim();
  if (!orderId) return null;

  const marker = `[GuestShop:${orderId}]`;

  const { data: existingTask, error: existingError } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('department', FO_DEPARTMENT)
    .ilike('task_text', `%${marker}%`)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingTask?.id) return existingTask;

  const room = String(order?.room_number || '-').trim() || '-';
  const guest = String(order?.guest_name || '-').trim() || '-';
  const paymentRef = String(order?.payment_reference || '-').trim() || '-';
  const total = Number(order?.total_myr || 0).toFixed(2);
  const items = orderItemsSummary(order?.items_json || []);
  const orderType = String(order?.order_type || 'GUEST_SHOP').trim().toUpperCase();
  const chatId = resolveFoTelegramChatId();

  const taskText = [
    `${orderType === 'FNB' ? 'F&B' : 'Guest Shop'} paid order ${marker}`,
    `Guest: ${guest}`,
    `Items: ${items}`,
    `Total: RM${total}`,
    `Payment Ref: ${paymentRef}`,
    'Please prepare and deliver to guest.',
  ].join('\n');

  const { data: task, error: insertError } = await supabaseAdmin
    .from('tasks')
    .insert({
      room,
      department: FO_DEPARTMENT,
      task_text: taskText,
      status: 'OPEN',
      created_by_name: 'Guest Shop',
      created_by_email: 'guest-shop@hotelhallmark.com',
      chat_id: chatId,
      image_url: null,
      customer_waiting: false,
      customer_waiting_reminder_sent_at: null,
      reopened_at: null,
    })
    .select(
      `
      id,
      task_code,
      room,
      department,
      task_text,
      status,
      created_by_name,
      created_by_email,
      chat_id,
      image_url,
      done_by_name,
      done_at,
      reopened_at,
      last_updated_by_name,
      created_at
      `
    )
    .single();

  if (insertError || !task) {
    throw insertError || new Error('Failed to create Guest Shop FO task');
  }

  await supabaseAdmin.from('task_events').insert({
    task_id: task.id,
    event_type: 'CREATED',
    event_text: `${orderType === 'FNB' ? 'F&B' : 'Guest Shop'} paid order created from Billplz payment ${paymentRef}`,
    actor_name: 'Guest Shop',
  });

  if (!chatId) {
    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'TELEGRAM_SKIPPED',
      event_text: 'FO Telegram chat is not configured. Set ALLOWED_CHAT_ID.',
      actor_name: 'Guest Shop',
    });
    return task;
  }

  try {
    const telegramMessageId = await sendTelegramTaskCard({
      chatId,
      task: {
        id: task.id,
        task_code: task.task_code,
        room: task.room,
        department: FO_DEPARTMENT,
        task_text: task.task_text,
        created_by_name: task.created_by_name,
        image_url: null,
        status: task.status,
        done_by_name: task.done_by_name,
        done_at: task.done_at,
        reopened_at: null,
        last_updated_by_name: task.last_updated_by_name,
      },
    });

    if (telegramMessageId) {
      await supabaseAdmin
        .from('tasks')
        .update({ telegram_task_message_id: telegramMessageId })
        .eq('id', task.id);

      await supabaseAdmin.from('telegram_messages').insert({
        telegram_message_id: telegramMessageId,
        chat_id: chatId,
        task_id: task.id,
        message_type: 'TASK_CARD',
      });
    }
  } catch (error: any) {
    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'TELEGRAM_FAILED',
      event_text: error?.message || 'Guest Shop Telegram notification failed',
      actor_name: 'Guest Shop',
    });
  }

  return task;
}
