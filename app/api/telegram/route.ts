import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
type Dept = 'HK' | 'MT' | 'FO';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

async function telegram(method: string, body: any) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function normalizeStatus(value: string): TaskStatus | null {
  const v = String(value || '').trim().toUpperCase();

  if (v === 'DONE') return 'DONE';
  if (v === 'IN_PROGRESS' || v === 'DOING') return 'IN_PROGRESS';
  if (v === 'OPEN' || v === 'REOPEN' || v === 'REOPENED') return 'OPEN';

  return null;
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const taskId = String(body.taskId || body.id || '').trim();
    const requestedStatus = normalizeStatus(body.status || body.command || body.action);
    const userName = String(
      body.userName ||
        body.actorName ||
        body.updatedByName ||
        body.doneByName ||
        'Dashboard'
    ).trim();

    if (!taskId) {
      return NextResponse.json(
        { ok: false, error: 'Missing taskId' },
        { status: 400 }
      );
    }

    if (!requestedStatus) {
      return NextResponse.json(
        { ok: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const updateData: any = {
      status: requestedStatus,
      updated_at: now,
      last_updated_by_name: userName
    };

    let eventType: string = requestedStatus;

    if (requestedStatus === 'DONE') {
      updateData.done_at = now;
      updateData.done_by_name = userName;
    } else if (requestedStatus === 'IN_PROGRESS') {
      updateData.done_at = null;
      updateData.done_by_name = null;
    } else if (requestedStatus === 'OPEN') {
      updateData.done_at = null;
      updateData.done_by_name = null;
      updateData.reopened_at = now;
      eventType = 'REOPENED';
    }

    const { data: task, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    await supabase.from('task_events').insert({
      task_id: task.id,
      event_type: eventType,
      event_text:
        requestedStatus === 'OPEN'
          ? `Task reopened by ${userName} from dashboard`
          : `Status changed to ${requestedStatus} by ${userName} from dashboard`,
      actor_name: userName
    });

    await refreshTelegramTaskCard(task.id);

    return NextResponse.json({
      ok: true,
      task
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
