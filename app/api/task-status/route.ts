import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';
import {
  buildTaskInlineKeyboard,
  buildTaskMessageText,
  type TaskStatus,
} from '../../../lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeStatus(value: string): TaskStatus | null {
  const v = String(value || '').trim().toUpperCase();

  if (v === 'DONE' || v === 'CHECKED') return 'DONE';
  if (v === 'PENDING_CHECK' || v === 'PENDING CHECK' || v === 'READY_FOR_CHECK') return 'PENDING_CHECK';
  if (v === 'OPEN' || v === 'REOPEN' || v === 'REOPENED') return 'OPEN';

  return null;
}

function normalizeStoredStatus(value: string): TaskStatus {
  const normalized = normalizeStatus(value);
  return normalized || 'OPEN';
}

function canCheckTask(role?: string | null) {
  const normalized = String(role || '').trim().toUpperCase();
  return normalized === 'SUPERUSER' || normalized === 'MANAGER' || normalized === 'SUPERVISOR';
}

async function telegram(method: string, body: any) {
  if (!BOT_TOKEN) return null;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return res.json();
}

async function refreshTelegramTaskCard(taskId: string) {
  try {
    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .select(
        `
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
        checked_by_name,
        checked_at,
        telegram_task_message_id,
        chat_id
      `
      )
      .eq('id', taskId)
      .single();

    if (error || !task?.telegram_task_message_id || !task?.chat_id) return;

    await telegram('editMessageText', {
      chat_id: task.chat_id,
      message_id: task.telegram_task_message_id,
      text: buildTaskMessageText(task as any),
      reply_markup: buildTaskInlineKeyboard(task.id, normalizeStoredStatus(task.status)),
    });
  } catch {
    // The dashboard status update is already saved; Telegram refresh should not fail it.
  }
}

async function allMediaCompleted(taskId: string) {
  const { data, error } = await supabaseAdmin
    .from('task_images')
    .select('id, completed_at')
    .eq('task_id', taskId);

  if (error) throw error;

  const rows = data || [];
  if (!rows.length) return true;

  return rows.every((row) => !!row.completed_at);
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const taskId = String(body.taskId || body.id || '').trim();
    const requestedStatus = normalizeStatus(body.status || body.command || body.action);

    if (!taskId) return jsonNoCache({ ok: false, error: 'Missing taskId' }, 400);
    if (!requestedStatus) return jsonNoCache({ ok: false, error: 'Invalid status' }, 400);

    const { data: existingTask, error: existingTaskError } = await supabaseAdmin
      .from('tasks')
      .select('id, status')
      .eq('id', taskId)
      .single();

    if (existingTaskError || !existingTask) {
      return jsonNoCache({ ok: false, error: 'Task not found' }, 404);
    }

    if (!user.can_edit_task) {
      return jsonNoCache({ ok: false, error: 'You do not have permission to update this task' }, 403);
    }

    if (requestedStatus === 'DONE' && !canCheckTask(user.role)) {
      return jsonNoCache({ ok: false, error: 'Only supervisors, managers, and superusers can check tasks as done' }, 403);
    }

    if (requestedStatus === 'PENDING_CHECK') {
      const completed = await allMediaCompleted(taskId);
      if (!completed) {
        return jsonNoCache({ ok: false, error: 'Complete all media subtasks before sending for check' }, 400);
      }
    }

    const now = new Date().toISOString();
    const updateData: any = {
      status: requestedStatus,
      updated_at: now,
      last_updated_by_name: user.name,
    };

    let eventType: string = requestedStatus;
    let eventText = `Status changed to ${requestedStatus} by ${user.name} from dashboard`;

    if (requestedStatus === 'DONE') {
      updateData.done_at = now;
      updateData.done_by_name = user.name;
      updateData.checked_at = now;
      updateData.checked_by_name = user.name;
      eventType = 'CHECKED_DONE';
      eventText = `Task checked and moved to Done by ${user.name}`;
    } else if (requestedStatus === 'PENDING_CHECK') {
      updateData.done_at = null;
      updateData.done_by_name = null;
      eventType = 'PENDING_CHECK';
      eventText = `Task submitted for supervisor check by ${user.name}`;
    } else if (requestedStatus === 'OPEN') {
      updateData.done_at = null;
      updateData.done_by_name = null;
      updateData.checked_at = null;
      updateData.checked_by_name = null;
      updateData.reopened_at = now;
      eventType = 'REOPENED';
      eventText = `Task sent back to Open by ${user.name} from dashboard`;
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) return jsonNoCache({ ok: false, error: error.message }, 500);

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: eventType,
      event_text: eventText,
      actor_name: user.name,
    });

    await refreshTelegramTaskCard(task.id);

    return jsonNoCache({ ok: true, task });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Unknown error' }, 500);
  }
}

export async function GET() {
  return jsonNoCache({ ok: true });
}
