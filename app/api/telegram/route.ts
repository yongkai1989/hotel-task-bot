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

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function normalizeDept(value: string): '' | Dept {
  const v = String(value || '').trim().toUpperCase();
  if (v === 'HK' || v === 'H') return 'HK';
  if (v === 'MT' || v === 'M') return 'MT';
  if (v === 'FO' || v === 'F') return 'FO';
  return '';
}

function isDeptOnly(text: string): boolean {
  return ['HK', 'MT', 'FO', 'H', 'M', 'F'].includes(
    String(text || '').trim().toUpperCase()
  );
}

function isValidRoom(room: string): boolean {
  return /^\d{3,5}$/.test(String(room || '').trim());
}

function parseInput(text: string): ParsedInput {
  const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
  const tokens = cleaned.split(' ').filter(Boolean);

  if (tokens.length < 2) return { ok: false };

  const room = tokens[0];
  if (!isValidRoom(room)) return { ok: false };

  const dept = normalizeDept(tokens[1]);

  if (dept) {
    const task = tokens.slice(2).join(' ').trim();
    if (!task) return { ok: false };
    return { ok: true, room, dept, task };
  }

  const task = tokens.slice(1).join(' ').trim();
  if (!task) return { ok: false };

  return { ok: true, room, dept: '', task };
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

async function createTask(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  room: string;
  department: Dept;
  taskText: string;
  updateId: number;
  imageUrl?: string | null;
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

  const sent = await telegram('sendMessage', {
    chat_id: params.chatId,
    text:
      `📌 NEW TASK\n` +
      `Task ID: ${task.task_code}\n` +
      `Room: ${task.room}\n` +
      `Department: ${task.department}\n` +
      `Task: ${task.task_text}\n` +
      `Created by: ${params.userName}\n` +
      `${params.imageUrl ? `Photo attached: Yes\n` : ''}\n` +
      `Reply to this message with:\n/doing\n/done`
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
      text: 'Reply directly to the task card.'
    });
    return;
  }

  const { data: mapping } = await supabase
    .from('telegram_messages')
    .select('task_id')
    .eq('chat_id', params.chatId)
    .eq('telegram_message_id', params.replyToMessageId)
    .maybeSingle();

  if (!mapping?.task_id) return;

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

    const lower = textOrCaption.toLowerCase();

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
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      if (largestPhoto?.file_id) {
        imageUrl = await getTelegramFileUrl(largestPhoto.file_id);
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
        imageUrl
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
        if (!pendingDept) {
          await telegram('sendMessage', {
            chat_id: chatId,
            text: 'Invalid department. Reply only: hk, mt, or fo'
          });
        } else {
          await createTask({
            chatId,
            userId,
            userName,
            room: pending.room,
            department: pendingDept,
            taskText: pending.task_text,
            updateId,
            imageUrl
          });

          await supabase
            .from('pending_inputs')
            .delete()
            .eq('chat_id', chatId)
            .eq('user_id', userId);
        }
      } else {
        await telegram('sendMessage', {
          chat_id: chatId,
          text: 'No pending task found. Please send full format like:\n1234 hk extra towel'
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
        text: `Which department for room ${parsed.room}?\nReply only: hk, mt, or fo`
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
        `Use:\n1234 hk extra towel\n1309 mt tv problem\n1301 fo call guest\n\n` +
        `Or with photo caption:\n1206 mt aircon leaking`
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
