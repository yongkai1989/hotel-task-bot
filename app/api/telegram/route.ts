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

async function createTask(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  room: string;
  department: Dept;
  taskText: string;
  updateId: number;
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
      chat_id: params.chatId
    })
    .select()
    .single();

  if (error) throw error;

  const sent = await telegram('sendMessage', {
    chat_id: params.chatId,
    text:
      `📌 NEW TASK\n` +
      `Task ID: ${task.task_code}\n` +
      `Room: ${task.room}\n` +
      `Department: ${task.department}\n` +
      `Task: ${task.task_text}\n` +
      `Created by: ${params.userName}\n\n` +
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
}

async function updateTaskStatus(params: {
  chatId: number;
  userId: number | null;
  userName: string;
  updateId: number;
  replyToMessageId: number | null;
  command: 'IN_PROGRESS' | 'DONE';
}) {
  if (!params.replyToMessageId) return;

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
    last_updated_by_name: params.userName
  };

  if (params.command === 'DONE') {
    updateData.done_at = new Date().toISOString();
    updateData.done_by_name = params.userName;
  }

  const { data: task } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', mapping.task_id)
    .select()
    .single();

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
    const msg = update?.message;
    if (!msg) return NextResponse.json({ ok: true });

    const chatId = Number(msg.chat?.id);
    const userId = msg.from?.id ? Number(msg.from.id) : null;

    const userName =
      msg.from?.username
        ? `@${msg.from.username}`
        : [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';

    const text = String(msg.text || '').trim().toLowerCase();

    if (String(chatId) !== String(ALLOWED_CHAT_ID)) {
      return NextResponse.json({ ok: true });
    }

    if (text === '/doing' || text === '/done') {
      await updateTaskStatus({
        chatId,
        userId,
        userName,
        updateId: update.update_id,
        replyToMessageId: msg.reply_to_message?.message_id ?? null,
        command: text === '/doing' ? 'IN_PROGRESS' : 'DONE'
      });

      return NextResponse.json({ ok: true });
    }

    const parsed = parseInput(text);

    if (parsed.ok && parsed.dept) {
      await createTask({
        chatId,
        userId,
        userName,
        room: parsed.room,
        department: parsed.dept,
        taskText: parsed.task,
        updateId: update.update_id
      });

      return NextResponse.json({ ok: true });
    }

    await telegram('sendMessage', {
      chat_id: chatId,
      text: 'Invalid format. Example:\n1234 hk extra towel'
    });

    return NextResponse.json({ ok: true });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
