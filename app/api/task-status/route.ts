import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import { buildTaskInlineKeyboard, buildTaskMessageText } from '../../../lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

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

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

async function refreshTelegramTaskCard(taskId: string) {
  try {
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
  } catch {
    // The dashboard status update is already saved; Telegram refresh should not fail it.
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache(
        { ok: false, error: authError || 'Unauthorized' },
        401
      );
    }

    const body = await req.json();

    const taskId = String(body.taskId || body.id || '').trim();
    const requestedStatus = normalizeStatus(body.status || body.command || body.action);

    if (!taskId) {
      return jsonNoCache(
        { ok: false, error: 'Missing taskId' },
        400
      );
    }

    if (!requestedStatus) {
      return jsonNoCache(
        { ok: false, error: 'Invalid status' },
        400
      );
    }

    const { data: existingTask, error: existingTaskError } = await supabaseAdmin
      .from('tasks')
      .select('id')
      .eq('id', taskId)
      .single();

    if (existingTaskError || !existingTask) {
      return jsonNoCache(
        { ok: false, error: 'Task not found' },
        404
      );
    }

    if (!user.can_edit_task) {
      return jsonNoCache(
        { ok: false, error: 'You do not have permission to update this task' },
        403
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
      return jsonNoCache(
        { ok: false, error: error.message },
        500
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

    return jsonNoCache({
      ok: true,
      task
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}

export async function GET() {
  return jsonNoCache({ ok: true });
}
