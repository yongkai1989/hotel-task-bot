import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { buildTaskInlineKeyboard, buildTaskMessageText } from '../../../lib/telegram';

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
type Dept = 'HK' | 'MT' | 'FO';

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

function canEditTask(role: string, dept: Dept) {
  if (role === 'MANAGER') return true;
  if (role === 'HK') return dept === 'HK';
  if (role === 'MT') return dept === 'MT';
  return false;
}

async function refreshTelegramTaskCard(taskId: string) {
  const { data: task, error } = await supabaseAdmin
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
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: authError || 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();

    const taskId = String(body.taskId || body.id || '').trim();
    const requestedStatus = normalizeStatus(body.status || body.command || body.action);

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

    const { data: existingTask, error: existingTaskError } = await supabaseAdmin
      .from('tasks')
      .select('id, department')
      .eq('id', taskId)
      .single();

    if (existingTaskError || !existingTask) {
      return NextResponse.json(
        { ok: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    if (!canEditTask(user.role, existingTask.department as Dept)) {
      return NextResponse.json(
        { ok: false, error: 'You do not have permission to update this task' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    const updateData: any = {
      status: requestedStatus,
      updated_at: now,
      last_updated_by_name: user.name
    };

    let eventType: string = requestedStatus;

    if (requestedStatus === 'DONE') {
      updateData.done_at = now;
      updateData.done_by_name = user.name;
    } else if (requestedStatus === 'IN_PROGRESS') {
      updateData.done_at = null;
      updateData.done_by_name = null;
    } else if (requestedStatus === 'OPEN') {
      updateData.done_at = null;
      updateData.done_by_name = null;
      updateData.reopened_at = now;
      eventType = 'REOPENED';
    }

    const { data: task, error } = await supabaseAdmin
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

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: eventType,
      event_text:
        requestedStatus === 'OPEN'
          ? `Task reopened by ${user.name} from dashboard`
          : `Status changed to ${requestedStatus} by ${user.name} from dashboard`,
      actor_name: user.name
    });

    await refreshTelegramTaskCard(task.id);

    return NextResponse.json({
      ok: true,
      task
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
