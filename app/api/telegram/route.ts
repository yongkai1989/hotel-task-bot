import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { formatDateTimeDDMMYYYY } from '../../../lib/dateDisplay';
import {
  isManagerRoomCheckTask,
  syncLinkedManagerRoomCheckStatus,
} from '../../../lib/managerRoomCheckTaskSync';
import { broadcastTaskChange } from '../../../lib/taskBroadcastServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type Dept = 'HK' | 'MT' | 'FO';
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID || '';
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS || '';
const SECRET_PATH = process.env.TELEGRAM_SECRET_PATH!;

// Known live group IDs
const MT_CHAT_ID = -1003860980789;
const HK_CHAT_ID = -1003784764929;

async function telegram(method: string, body: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function labelForStatus(status: TaskStatus) {
  if (status === 'IN_PROGRESS') return 'DOING';
  return status;
}

function formatDateTime(value?: string | null) {
  return formatDateTimeDDMMYYYY(value);
}

function getAllowedChatIds(): number[] {
  const parsedEnvIds = String(ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((v) => Number.isFinite(v));

  const singleEnvId = Number(String(ALLOWED_CHAT_ID || '').trim());

  const combined = [
    ...parsedEnvIds,
    Number.isFinite(singleEnvId) ? singleEnvId : null,
    MT_CHAT_ID,
    HK_CHAT_ID
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  return Array.from(new Set(combined));
}

function isAllowedChatId(chatId: number): boolean {
  return getAllowedChatIds().includes(Number(chatId));
}

function buildTaskMessageText(task: {
  task_code: string;
  room: string;
  department: Dept;
  task_text: string;
  created_by_name?: string | null;
  image_url?: string | null;
  status: TaskStatus;
  done_by_name?: string | null;
  done_at?: string | null;
  reopened_at?: string | null;
  last_updated_by_name?: string | null;
  urgent?: boolean | null;
  customer_waiting?: boolean | null;
}) {
  const managerRoomCheck = isManagerRoomCheckTask(task);
  const lines = [
    task.urgent === true ? '🚨 URGENT TASK' : task.customer_waiting === true ? '⏳ CUSTOMER WAITING' : managerRoomCheck ? 'TASK' : '📌 TASK',
    `Task ID: ${task.task_code}`,
    `Room: ${task.room}`,
    `Department: ${task.department}`,
    `Task: ${managerRoomCheck ? 'Manager Room Check.' : task.task_text}`,
    `Status: ${labelForStatus(task.status)}`,
    `Created by: ${task.created_by_name || '-'}`
  ];

  if (task.urgent === true || task.customer_waiting === true) {
    lines.push(
      '',
      'PENTING: Tekan ACKNOWLEDGE dalam aplikasi hanya jika aras ini di bawah tanggungjawab anda.',
      'Jika bukan, tekan CLOSE supaya petugas yang bertanggungjawab boleh mengesahkannya.'
    );
  }

  if (task.image_url && !managerRoomCheck) {
    lines.push('Photo attached: Yes');
  }

  if (task.status === 'DONE') {
    lines.push(`Done by: ${task.done_by_name || '-'}`);
    if (task.done_at) {
      lines.push(`Done at: ${formatDateTime(task.done_at)}`);
    }
  } else {
    if (task.last_updated_by_name) {
      lines.push(`Last updated by: ${task.last_updated_by_name}`);
    }

    if (task.reopened_at) {
      lines.push(`Reopened at: ${formatDateTime(task.reopened_at)}`);
    }
  }

  return lines.join('\n');
}

function buildTaskInlineKeyboard(
  taskId: string,
  status: TaskStatus,
  options?: { managerRoomCheck?: boolean }
) {
  if (options?.managerRoomCheck) {
    return {
      inline_keyboard: [
        [
          {
            text: status === 'DONE' ? '♻️ REOPEN' : '✅ DONE',
            callback_data: `${status === 'DONE' ? 'reopen' : 'done'}:${taskId}`,
          },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text: status === 'IN_PROGRESS' ? '🔵 DOING ✓' : '🔵 DOING',
          callback_data: `doing:${taskId}`
        },
        {
          text: status === 'DONE' ? '✅ DONE ✓' : '✅ DONE',
          callback_data: `done:${taskId}`
        }
      ],
      [
        {
          text: status === 'OPEN' ? '♻️ REOPEN ✓' : '♻️ REOPEN',
          callback_data: `reopen:${taskId}`
        }
      ],
      [
        { text: '📷 ADD PHOTO', callback_data: `photo:${taskId}` }
      ]
    ]
  };
}

async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  try {
    const fileRes = await telegram('getFile', { file_id: fileId });
    if (!fileRes?.ok || !fileRes?.result?.file_path) return null;

    const filePath = fileRes.result.file_path;
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  } catch {
    return null;
  }
}

async function addTaskImage(params: {
  taskId: string;
  imageUrl: string;
  caption?: string | null;
  telegramFileId?: string | null;
  telegramMessageId?: number | null;
  userId?: number | null;
  userName?: string | null;
}) {
  const { error } = await supabase.from('task_images').insert({
    task_id: params.taskId,
    image_url: params.imageUrl,
    caption: params.caption || null,
    telegram_file_id: params.telegramFileId || null,
    telegram_message_id: params.telegramMessageId || null,
    created_by_name: params.userName || null,
    created_by_telegram_user_id: params.userId || null
  });

  if (error) throw error;

  await supabase
    .from('tasks')
    .update({ image_url: params.imageUrl, updated_at: new Date().toISOString() })
    .eq('id', params.taskId);
}

async function refreshTelegramTaskCard(taskId: string) {
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      id,
      task_code,
      room,
      department,
      task_text,
      status,
      created_by_name,
      image_url,
      done_by_name,
      done_at,
      reopened_at,
      last_updated_by_name,
      urgent,
      customer_waiting,
      telegram_task_message_id,
      chat_id
    `)
    .eq('id', taskId)
    .single();

  if (error || !task?.telegram_task_message_id || !task?.chat_id) return;

  await telegram('editMessageText', {
    chat_id: task.chat_id,
    message_id: task.telegram_task_message_id,
    text: buildTaskMessageText(task as any),
    reply_markup: buildTaskInlineKeyboard(task.id, task.status as TaskStatus, {
      managerRoomCheck: isManagerRoomCheckTask(task as any),
    })
  });
}

async function updateTaskStatusByTaskId(params: {
  taskId: string;
  chatId: number;
  userId: number | null;
  userName: string;
  updateId: number;
  command: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  sendConfirmation?: boolean;
}) {
  const now = new Date().toISOString();
  const { data: existingTask, error: existingTaskError } = await supabase
    .from('tasks')
    .select('id, status, room, department, task_text, created_at, customer_waiting, urgent, alert_cycle')
    .eq('id', params.taskId)
    .single();
  if (existingTaskError || !existingTask) throw existingTaskError || new Error('Task not found');

  // Telegram may deliver a callback more than once, or a user may tap twice
  // before the card redraws. Keep repeated requests harmless while still
  // nudging every connected dashboard to reload the saved state.
  if (existingTask.status === params.command) {
    await broadcastTaskChange(existingTask.id, 'UPDATE');
    try {
      await refreshTelegramTaskCard(existingTask.id);
    } catch (refreshError: any) {
      console.warn('Telegram task card refresh failed:', refreshError?.message || refreshError);
    }
    return existingTask;
  }

  if (params.command === 'OPEN' || params.command === 'DONE') {
    await syncLinkedManagerRoomCheckStatus(existingTask, params.command, params.userName);
  }

  const updateData: any = {
    status: params.command,
    updated_at: now,
    last_updated_by_name: params.userName,
    last_updated_by_telegram_user_id: params.userId
  };

  let eventType: string = params.command;
  let confirmationText = '';

  if (params.command === 'DONE') {
    updateData.done_at = now;
    updateData.done_by_name = params.userName;
    updateData.done_by_telegram_user_id = params.userId;
    confirmationText = `Task marked DONE by ${params.userName}`;
  } else if (params.command === 'IN_PROGRESS') {
    updateData.done_at = null;
    updateData.done_by_name = null;
    updateData.done_by_telegram_user_id = null;
    confirmationText = `Task marked DOING by ${params.userName}`;
  } else {
    updateData.done_at = null;
    updateData.done_by_name = null;
    updateData.done_by_telegram_user_id = null;
    updateData.reopened_at = now;
    if (existingTask.customer_waiting === true) {
      updateData.customer_waiting_due_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      updateData.customer_waiting_reminder_sent_at = null;
    }
    if (existingTask.urgent === true) {
      updateData.urgent_due_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    }
    if (existingTask.customer_waiting === true || existingTask.urgent === true) {
      updateData.alert_cycle = Number(existingTask.alert_cycle || 1) + 1;
      updateData.alert_acknowledged_at = null;
      updateData.alert_acknowledged_by_name = null;
      updateData.alert_acknowledged_by_email = null;
      updateData.alert_escalation_count = 0;
      updateData.alert_last_escalated_at = null;
    }
    eventType = 'REOPENED';
    confirmationText = `Task REOPENED by ${params.userName}`;
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', params.taskId)
    .select()
    .single();

  if (error) throw error;

  await supabase.from('task_events').insert({
    task_id: task.id,
    event_type: eventType,
    event_text:
      params.command === 'OPEN'
        ? `Task reopened by ${params.userName}`
        : `Status changed to ${params.command} by ${params.userName}`,
    telegram_update_id: params.updateId,
    actor_user_id: params.userId,
    actor_name: params.userName
  });

  // Both entry points use the same task row. Broadcast after the database
  // commit so open dashboards immediately reflect Telegram status changes.
  await broadcastTaskChange(task.id, 'UPDATE');
  try {
    await refreshTelegramTaskCard(task.id);
  } catch (refreshError: any) {
    // The task status is already saved. A Telegram card redraw must never
    // turn a successful status change into a failed callback.
    console.warn('Telegram task card refresh failed:', refreshError?.message || refreshError);
  }

  if (params.sendConfirmation !== false) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: confirmationText
    });
  }

  return task;
}

async function updateTaskStatus(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  updateId: number;
  replyToMessageId: number | null;
  command: 'OPEN' | 'IN_PROGRESS' | 'DONE';
}) {
  if (!params.replyToMessageId) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Reply directly to the task card with /doing, /done, or /reopen.'
    });
    return;
  }

  const { data: mapping } = await supabase
    .from('telegram_messages')
    .select('task_id')
    .eq('chat_id', params.chatId)
    .eq('telegram_message_id', params.replyToMessageId)
    .maybeSingle();

  if (!mapping?.task_id) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Task not found. Please reply directly to the correct task message.'
    });
    return;
  }

  await updateTaskStatusByTaskId({
    taskId: mapping.task_id,
    chatId: params.chatId,
    userId: params.userId,
    userName: params.userName,
    updateId: params.updateId,
    command: params.command
  });
}

async function attachPhotoToExistingTask(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  updateId: number;
  replyToMessageId: number | null;
  imageUrl: string | null;
  caption?: string | null;
  telegramFileId?: string | null;
  telegramMessageId?: number | null;
}) {
  if (!params.replyToMessageId) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Please reply directly to the task card when sending photos.'
    });
    return;
  }

  if (!params.imageUrl) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Image could not be processed.'
    });
    return;
  }

  const { data: mapping } = await supabase
    .from('telegram_messages')
    .select('task_id')
    .eq('chat_id', params.chatId)
    .eq('telegram_message_id', params.replyToMessageId)
    .maybeSingle();

  if (!mapping?.task_id) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Task not found. Please reply directly to the correct task message.'
    });
    return;
  }

  await addTaskImage({
    taskId: mapping.task_id,
    imageUrl: params.imageUrl,
    caption: params.caption || null,
    telegramFileId: params.telegramFileId || null,
    telegramMessageId: params.telegramMessageId || null,
    userId: params.userId,
    userName: params.userName
  });

  await supabase.from('task_events').insert({
    task_id: mapping.task_id,
    event_type: 'IMAGE_ATTACHED',
    event_text: `Image attached by ${params.userName}`,
    telegram_update_id: params.updateId,
    actor_user_id: params.userId,
    actor_name: params.userName
  });

  await refreshTelegramTaskCard(mapping.task_id);

  await telegram('sendMessage', {
    chat_id: params.chatId,
    text: `Photo attached to task by ${params.userName}`
  });
}

async function handleCallbackQuery(update: any, updateId: number) {
  const callback = update?.callback_query;
  if (!callback) return false;

  const chatId = Number(callback.message?.chat?.id);
  const userId = callback.from?.id ? Number(callback.from.id) : null;
  const userName =
    callback.from?.username
      ? `@${callback.from.username}`
      : [callback.from?.first_name, callback.from?.last_name].filter(Boolean).join(' ') || 'Unknown';

  if (!isAllowedChatId(chatId)) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Unauthorized chat'
    });
    return true;
  }

  const data = String(callback.data || '');
  const [action, rawTaskId] = data.split(':');
  const taskId = String(rawTaskId || '').trim();

  if (!taskId) {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Invalid action'
    });
    return true;
  }

  if (action === 'doing') {
    // Acknowledge first so Telegram stops showing the loading spinner while
    // the database update and message redraw finish in the background request.
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Updating task…'
    });

    try {
      await updateTaskStatusByTaskId({
        taskId,
        chatId,
        userId,
        userName,
        updateId,
        command: 'IN_PROGRESS',
        sendConfirmation: false
      });
    } catch (error: any) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: `Unable to update this task: ${error?.message || 'Unknown error'}`
      });
    }

    return true;
  }

  if (action === 'done') {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Updating task…'
    });

    try {
      await updateTaskStatusByTaskId({
        taskId,
        chatId,
        userId,
        userName,
        updateId,
        command: 'DONE',
        sendConfirmation: false
      });
    } catch (error: any) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: `Unable to mark this task done: ${error?.message || 'Unknown error'}`
      });
    }

    return true;
  }

  if (action === 'reopen') {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Updating task…'
    });

    try {
      await updateTaskStatusByTaskId({
        taskId,
        chatId,
        userId,
        userName,
        updateId,
        command: 'OPEN',
        sendConfirmation: false
      });
    } catch (error: any) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: `Unable to reopen this task: ${error?.message || 'Unknown error'}`
      });
    }

    return true;
  }

  if (action === 'photo') {
    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Reply to this task with photo(s)'
    });

    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Please reply directly to the task card with photo(s) to attach.'
    });

    return true;
  }

  await telegram('answerCallbackQuery', {
    callback_query_id: callback.id,
    text: 'Unknown action'
  });

  return true;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = req.headers.get('x-vercel-id') || crypto.randomUUID();
  try {
    const secretPath = req.nextUrl.searchParams.get('path');
    if (secretPath !== SECRET_PATH) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const update = await req.json();
    const updateId = Number(update?.update_id);
    console.log(JSON.stringify({
      level: 'info',
      msg: 'telegram_update_started',
      route: '/api/telegram',
      requestId,
      updateId,
      kind: update?.callback_query ? 'callback' : update?.message ? 'message' : 'other',
    }));

    const callbackHandled = await handleCallbackQuery(update, updateId);
    if (callbackHandled) {
      console.log(JSON.stringify({
        level: 'info', msg: 'telegram_callback_completed', route: '/api/telegram',
        requestId, updateId, ms: Date.now() - startedAt,
      }));
      return NextResponse.json({ ok: true });
    }

    const msg = update?.message;

    if (!msg) {
      return NextResponse.json({ ok: true, ignored: 'NO_MESSAGE' });
    }

    const chatId = Number(msg.chat?.id);
    const userId = msg.from?.id ? Number(msg.from.id) : null;
    const userName =
      msg.from?.username
        ? `@${msg.from.username}`
        : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';

    const messageId = Number(msg.message_id);
    const textOrCaption = String(msg.text || msg.caption || '').trim();

    if (!isAllowedChatId(chatId)) {
      return NextResponse.json({ ok: true, ignored: 'OTHER_CHAT' });
    }

    const lower = textOrCaption.toLowerCase().replace(/\s+/g, ' ');
    const isStatusCommand = lower === '/doing' || lower === '/done' || lower === '/reopen';
    const isTaskPhotoReply =
      Array.isArray(msg.photo) &&
      msg.photo.length > 0 &&
      Boolean(msg.reply_to_message?.message_id);

    // Normal group conversation is not bot input. Task creation is app-only;
    // Telegram remains available for task-card actions and direct photo replies.
    if (!isStatusCommand && !isTaskPhotoReply) {
      return NextResponse.json({ ok: true, ignored: 'NORMAL_CHAT' });
    }

    const { error: insertUpdateError } = await supabase
      .from('telegram_updates')
      .insert({
        update_id: updateId,
        chat_id: chatId,
        user_id: userId,
        message_id: messageId,
        raw_json: update,
        message_text: textOrCaption
      });

    if (insertUpdateError) {
      const msgText = String(insertUpdateError.message || '').toLowerCase();
      if (msgText.includes('duplicate') || msgText.includes('unique')) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throw insertUpdateError;
    }

    if (isStatusCommand) {
      await updateTaskStatus({
        chatId,
        userId,
        userName,
        updateId,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        command:
          lower === '/doing'
            ? 'IN_PROGRESS'
            : lower === '/done'
              ? 'DONE'
              : 'OPEN'
      });

      await supabase
        .from('telegram_updates')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('update_id', updateId);

      return NextResponse.json({ ok: true });
    }

    let imageUrl: string | null = null;
    let telegramFileId: string | null = null;

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      if (largestPhoto?.file_id) {
        telegramFileId = largestPhoto.file_id;
        imageUrl = await getTelegramFileUrl(largestPhoto.file_id);
      }
    }

    if (imageUrl && msg.reply_to_message?.message_id) {
      await attachPhotoToExistingTask({
        chatId,
        userId,
        userName,
        updateId,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        imageUrl,
        caption: textOrCaption || null,
        telegramFileId,
        telegramMessageId: messageId
      });

      await supabase
        .from('telegram_updates')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('update_id', updateId);

      return NextResponse.json({ ok: true });
    }

    await supabase
      .from('telegram_updates')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('update_id', updateId);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error(JSON.stringify({
      level: 'error', msg: 'telegram_update_failed', route: '/api/telegram',
      requestId, error: error?.message || 'Unknown error', ms: Date.now() - startedAt,
    }));
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Telegram route is alive',
    allowed_chat_ids: getAllowedChatIds()
  });
}
