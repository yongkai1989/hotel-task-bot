import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

type Dept = 'HK' | 'MT' | 'FO';
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

type ParsedInput =
  | { ok: false }
  | { ok: true; room: string; dept: ''; task: string }
  | { ok: true; room: string; dept: Dept; task: string };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID!;
const SECRET_PATH = process.env.TELEGRAM_SECRET_PATH!;

const DEPT_ALIASES: Record<Dept, string[]> = {
  HK: ['hk', 'hsk', 'housekeeping'],
  MT: ['mt', 'maintenance'],
  FO: ['fo', 'front office', 'frontoffice', 'front-office']
};

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function cleanText(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeDept(value: string): '' | Dept {
  const v = cleanText(value);

  for (const [dept, aliases] of Object.entries(DEPT_ALIASES) as [Dept, string[]][]) {
    if (aliases.includes(v)) return dept;
  }

  return '';
}

function isDeptOnly(text: string): boolean {
  return normalizeDept(text) !== '';
}

function isValidRoom(room: string): boolean {
  return /^\d{3,5}$/.test(String(room || '').trim());
}

function parseInput(text: string): ParsedInput {
  const cleaned = cleanText(text);
  const firstSpace = cleaned.indexOf(' ');

  if (firstSpace === -1) return { ok: false };

  const room = cleaned.slice(0, firstSpace).trim();
  const remainder = cleaned.slice(firstSpace + 1).trim();

  if (!isValidRoom(room) || !remainder) return { ok: false };

  const aliasEntries = (Object.entries(DEPT_ALIASES) as [Dept, string[]][])
    .flatMap(([dept, aliases]) => aliases.map((alias) => ({ dept, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const entry of aliasEntries) {
    if (remainder === entry.alias) {
      return { ok: false };
    }

    if (remainder.startsWith(entry.alias + ' ')) {
      const task = remainder.slice(entry.alias.length).trim();
      if (!task) return { ok: false };
      return { ok: true, room, dept: entry.dept, task };
    }
  }

  return { ok: true, room, dept: '', task: remainder };
}

function labelForStatus(status: TaskStatus) {
  if (status === 'IN_PROGRESS') return 'DOING';
  return status;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
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
}) {
  const lines = [
    '📌 TASK',
    `Task ID: ${task.task_code}`,
    `Room: ${task.room}`,
    `Department: ${task.department}`,
    `Task: ${task.task_text}`,
    `Status: ${labelForStatus(task.status)}`,
    `Created by: ${task.created_by_name || '-'}`
  ];

  if (task.image_url) {
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

function buildTaskInlineKeyboard(taskId: string, status: TaskStatus) {
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
    reply_markup: buildTaskInlineKeyboard(task.id, task.status as TaskStatus)
  });
}

async function createTask(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  room: string;
  department: Dept;
  taskText: string;
  updateId: number;
  imageUrl?: string | null;
  imageCaption?: string | null;
  telegramFileId?: string | null;
  telegramMessageId?: number | null;
}) {
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      room: params.room,
      department: params.department,
      task_text: params.taskText,
      status: 'OPEN',
      reopened_at: null,
      source_update_id: params.updateId,
      created_by_user_id: params.userId,
      created_by_name: params.userName,
      created_by_telegram_user_id: params.userId,
      chat_id: params.chatId,
      image_url: params.imageUrl || null
    })
    .select()
    .single();

  if (error) throw error;

  await supabase.from('task_events').insert({
    task_id: task.id,
    event_type: 'CREATED',
    event_text: params.taskText,
    telegram_update_id: params.updateId,
    actor_user_id: params.userId,
    actor_name: params.userName
  });

  if (params.imageUrl) {
    await addTaskImage({
      taskId: task.id,
      imageUrl: params.imageUrl,
      caption: params.imageCaption || null,
      telegramFileId: params.telegramFileId || null,
      telegramMessageId: params.telegramMessageId || null,
      userId: params.userId,
      userName: params.userName
    });
  }

  const sent = await telegram('sendMessage', {
    chat_id: params.chatId,
    text: buildTaskMessageText({
      task_code: task.task_code,
      room: task.room,
      department: task.department,
      task_text: task.task_text,
      created_by_name: params.userName,
      image_url: params.imageUrl || null,
      status: 'OPEN',
      reopened_at: null
    }),
    reply_markup: buildTaskInlineKeyboard(task.id, 'OPEN')
  });

  const telegramMessageId = sent?.result?.message_id ?? null;

  if (telegramMessageId) {
    await supabase
      .from('tasks')
      .update({ telegram_task_message_id: telegramMessageId })
      .eq('id', task.id);

    await supabase.from('telegram_messages').insert({
      telegram_message_id: telegramMessageId,
      chat_id: params.chatId,
      task_id: task.id,
      message_type: 'TASK_CARD'
    });
  }

  return task;
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

  await refreshTelegramTaskCard(task.id);

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

  if (String(chatId) !== String(ALLOWED_CHAT_ID)) {
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
    await updateTaskStatusByTaskId({
      taskId,
      chatId,
      userId,
      userName,
      updateId,
      command: 'IN_PROGRESS',
      sendConfirmation: false
    });

    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: `Marked DOING by ${userName}`
    });

    return true;
  }

  if (action === 'done') {
    await updateTaskStatusByTaskId({
      taskId,
      chatId,
      userId,
      userName,
      updateId,
      command: 'DONE',
      sendConfirmation: false
    });

    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: `Marked DONE by ${userName}`
    });

    return true;
  }

  if (action === 'reopen') {
    await updateTaskStatusByTaskId({
      taskId,
      chatId,
      userId,
      userName,
      updateId,
      command: 'OPEN',
      sendConfirmation: false
    });

    await telegram('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: `Reopened by ${userName}`
    });

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
  try {
    const secretPath = req.nextUrl.searchParams.get('path');
    if (secretPath !== SECRET_PATH) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const update = await req.json();
    const updateId = Number(update?.update_id);
    console.log(JSON.stringify(body, null, 2));

    const callbackHandled = await handleCallbackQuery(update, updateId);
    if (callbackHandled) {
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

    if (String(chatId) !== String(ALLOWED_CHAT_ID)) {
      return NextResponse.json({ ok: true, ignored: 'OTHER_CHAT' });
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

    const lower = cleanText(textOrCaption);

    if (lower === '/doing' || lower === '/done' || lower === '/reopen') {
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
      const parsedCaption = textOrCaption ? parseInput(textOrCaption) : { ok: false as const };

      if (!(parsedCaption.ok && parsedCaption.dept)) {
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
    }

    const parsed = parseInput(textOrCaption);

    if (parsed.ok && parsed.dept) {
      await createTask({
        chatId,
        userId,
        userName,
        room: parsed.room,
        department: parsed.dept,
        taskText: parsed.task,
        updateId,
        imageUrl,
        imageCaption: textOrCaption || null,
        telegramFileId,
        telegramMessageId: messageId
      });

      await supabase
        .from('pending_inputs')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', userId);

      await supabase
        .from('telegram_updates')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('update_id', updateId);

      return NextResponse.json({ ok: true });
    }

    if (isDeptOnly(textOrCaption)) {
      const { data: pending } = await supabase
        .from('pending_inputs')
        .select('*')
        .eq('chat_id', chatId)
        .eq('user_id', userId)
        .maybeSingle();

      if (pending) {
        const pendingDept = normalizeDept(textOrCaption);

        await createTask({
          chatId,
          userId,
          userName,
          room: pending.room,
          department: pendingDept as Dept,
          taskText: pending.task_text,
          updateId,
          imageUrl,
          imageCaption: textOrCaption || null,
          telegramFileId,
          telegramMessageId: messageId
        });

        await supabase
          .from('pending_inputs')
          .delete()
          .eq('chat_id', chatId)
          .eq('user_id', userId);
      } else {
        await telegram('sendMessage', {
          chat_id: chatId,
          text:
            'No pending task found.\n\n' +
            'Send full format like:\n' +
            '1234 hk extra towel'
        });
      }

      await supabase
        .from('telegram_updates')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('update_id', updateId);

      return NextResponse.json({ ok: true });
    }

    if (parsed.ok && !parsed.dept) {
      await supabase
        .from('pending_inputs')
        .upsert(
          {
            chat_id: chatId,
            user_id: userId!,
            room: parsed.room,
            task_text: parsed.task
          },
          { onConflict: 'chat_id,user_id' }
        );

      await telegram('sendMessage', {
        chat_id: chatId,
        text:
          `Which department for room ${parsed.room}?\n` +
          `Reply with:\n` +
          `HK / HSK / HOUSEKEEPING\n` +
          `MT / MAINTENANCE\n` +
          `FO / FRONT OFFICE`
      });

      await supabase
        .from('telegram_updates')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('update_id', updateId);

      return NextResponse.json({ ok: true });
    }

    if (imageUrl) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text:
          'Photo received, but I could not match it to a task.\n\n' +
          'Either:\n' +
          '1. send photo with caption like:\n' +
          '1234 hk extra towel\n\n' +
          'or\n\n' +
          '2. reply directly to the task card with the photo.'
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
    console.error(error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Telegram route is alive' });
}
