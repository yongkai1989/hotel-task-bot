import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

type Dept = 'HK' | 'MT' | 'FO';
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
  taskId: number;
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

  // Optional: keep tasks.image_url synced for easy thumbnail display
  await supabase
    .from('tasks')
    .update({ image_url: params.imageUrl, updated_at: new Date().toISOString() })
    .eq('id', params.taskId);
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
    text:
      `📌 NEW TASK\n` +
      `Task ID: ${task.task_code}\n` +
      `Room: ${task.room}\n` +
      `Department: ${task.department}\n` +
      `Task: ${task.task_text}\n` +
      `Created by: ${params.userName}\n` +
      `${params.imageUrl ? `Photo attached: Yes\n` : ''}` +
      `Reply to this message with:\n/doing\n/done\nor send photo(s) to attach`
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

async function updateTaskStatus(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  updateId: number;
  replyToMessageId: number | null;
  command: 'IN_PROGRESS' | 'DONE';
}) {
  if (!params.replyToMessageId) {
    await telegram('sendMessage', {
      chat_id: params.chatId,
      text: 'Reply directly to the task card with /doing or /done.'
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

  const updateData: any = {
    status: params.command,
    updated_at: new Date().toISOString(),
    last_updated_by_name: params.userName,
    last_updated_by_telegram_user_id: params.userId
  };

  if (params.command === 'DONE') {
    updateData.done_at = new Date().toISOString();
    updateData.done_by_name = params.userName;
    updateData.done_by_telegram_user_id = params.userId;
  } else {
    updateData.done_at = null;
    updateData.done_by_name = null;
    updateData.done_by_telegram_user_id = null;
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', mapping.task_id)
    .select()
    .single();

  if (error) throw error;

  await supabase.from('task_events').insert({
    task_id: task.id,
    event_type: params.command,
    event_text: `Status changed to ${params.command} by ${params.userName}`,
    telegram_update_id: params.updateId,
    actor_user_id: params.userId,
    actor_name: params.userName
  });

  await telegram('sendMessage', {
    chat_id: params.chatId,
    text: `Task ${task.task_code} ${params.command === 'DONE' ? 'DONE' : 'IN PROGRESS'} by ${params.userName}`
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

  await telegram('sendMessage', {
    chat_id: params.chatId,
    text: `Photo attached to task by ${params.userName}`
  });
}

export async function POST(req: NextRequest) {
  try {
    const secretPath = req.nextUrl.searchParams.get('path');
    if (secretPath !== SECRET_PATH) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const update = await req.json();
    const updateId = Number(update?.update_id);
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

    if (lower === '/doing' || lower === '/done') {
      await updateTaskStatus({
        chatId,
        userId,
        userName,
        updateId,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        command: lower === '/doing' ? 'IN_PROGRESS' : 'DONE'
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

    // CASE 1: user replies to a task card with photo only (or photo + caption)
    if (imageUrl && msg.reply_to_message?.message_id) {
      const parsedCaption = textOrCaption ? parseInput(textOrCaption) : { ok: false as const };

      // If caption itself is a new task format, create a new task instead of attaching
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

    // CASE 2: normal task creation, including photo + caption
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

    // CASE 3: department-only reply for pending input
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

    // CASE 4: missing department flow
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

    // CASE 5: photo sent without task format and not replying to task card
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

    await telegram('sendMessage', {
      chat_id: chatId,
      text:
        `Invalid format.\n\n` +
        `Examples:\n` +
        `1234 hk extra towel\n` +
        `1309 mt tv problem\n` +
        `1301 fo call guest\n\n` +
        `If department is missing:\n` +
        `1308 extra towel`
    });

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
