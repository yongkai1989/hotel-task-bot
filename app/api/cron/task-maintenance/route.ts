import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REMINDER_MINUTES = 15;
const DELETE_DONE_AFTER_DAYS = 60;
const CRON_AUTH_HEADER = 'x-cron-secret';

type TaskRow = {
  id: string;
  task_code: string | null;
  room: string | null;
  department: 'HK' | 'MT' | 'FO' | string | null;
  task_text: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | string | null;
  created_at: string;
  created_by_name: string | null;
  reminder_sent_at: string | null;
  telegram_task_message_id?: number | null;
};

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    throw new Error('CRON_SECRET is missing from environment variables');
  }

  const incoming = req.headers.get(CRON_AUTH_HEADER) || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return incoming === secret;
}

async function sendTelegramReminder(task: TaskRow) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALLOWED_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or ALLOWED_CHAT_ID is missing');
  }


  const text = [
    '⚠️ Task Reminder',
    '',
    `Task: ${task.task_code || '-'}`,
    `Room: ${task.room || '-'}`,
    `Department: ${task.department || '-'}`,
    `Status: ${task.status || '-'}`,
    `Created: ${new Date(task.created_at).toLocaleString('en-SG', { hour12: false })}`,
    `Created by: ${task.created_by_name || '-'}`,
    '',
    `${task.task_text || ''}`,
    '',
    'This task is still OPEN after 15 minutes. Please update it to DOING or DONE if action has started or completed.',
  ].join('\n');

  const replyToMessageId = task.telegram_task_message_id || undefined;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.ok) {
    throw new Error(json?.description || 'Failed to send Telegram reminder');
  }
}

async function processOpenTaskReminders() {
  const cutoffIso = new Date(Date.now() - REMINDER_MINUTES * 60 * 1000).toISOString();

  const { data: tasks, error } = await supabaseAdmin
    .from('tasks')
    .select(`
      id,
      task_code,
      room,
      department,
      task_text,
      status,
      created_at,
      created_by_name,
      reminder_sent_at,
      telegram_task_message_id
    `)
    .eq('status', 'OPEN')
    .is('reminder_sent_at', null)
    .lte('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Failed to load reminder candidates: ${error.message}`);
  }

  const remindedTaskIds: string[] = [];

  for (const task of (tasks || []) as TaskRow[]) {
    await sendTelegramReminder(task);

    const { error: updateError } = await supabaseAdmin
      .from('tasks')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', task.id)
      .is('reminder_sent_at', null);

    if (updateError) {
      throw new Error(`Reminder sent but failed to mark task ${task.id}: ${updateError.message}`);
    }

    await supabaseAdmin.from('task_events').insert({
      task_id: task.id,
      event_type: 'AUTO_REMINDER_SENT',
      event_text: 'Automatic Telegram reminder sent because task stayed OPEN for 15 minutes.',
      actor_name: 'SYSTEM',
    });

    remindedTaskIds.push(task.id);
  }

  return remindedTaskIds;
}

async function cleanupOldDoneTasks() {
  const cutoffIso = new Date(Date.now() - DELETE_DONE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: oldTasks, error } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('status', 'DONE')
    .not('done_at', 'is', null)
    .lte('done_at', cutoffIso)
    .limit(500);

  if (error) {
    throw new Error(`Failed to load cleanup candidates: ${error.message}`);
  }

  const taskIds = (oldTasks || []).map((t) => t.id);

  if (!taskIds.length) {
    return taskIds;
  }

  const { error: deleteImagesError } = await supabaseAdmin
    .from('task_images')
    .delete()
    .in('task_id', taskIds);

  if (deleteImagesError) {
    throw new Error(`Failed to delete task images: ${deleteImagesError.message}`);
  }

  const { error: deleteEventsError } = await supabaseAdmin
    .from('task_events')
    .delete()
    .in('task_id', taskIds);

  if (deleteEventsError) {
    throw new Error(`Failed to delete task events: ${deleteEventsError.message}`);
  }

  const { error: deleteTelegramMapError } = await supabaseAdmin
    .from('telegram_messages')
    .delete()
    .in('task_id', taskIds);

  if (deleteTelegramMapError) {
    throw new Error(`Failed to delete telegram message mappings: ${deleteTelegramMapError.message}`);
  }

  const { error: deleteTasksError } = await supabaseAdmin
    .from('tasks')
    .delete()
    .in('id', taskIds);

  if (deleteTasksError) {
    throw new Error(`Failed to delete old tasks: ${deleteTasksError.message}`);
  }

  return taskIds;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return jsonNoCache({ ok: false, error: 'Unauthorized' }, 401);
    }

    const remindedTaskIds = await processOpenTaskReminders();
    const deletedTaskIds = await cleanupOldDoneTasks();

    return jsonNoCache({
      ok: true,
      reminded_count: remindedTaskIds.length,
      reminded_task_ids: remindedTaskIds,
      deleted_count: deletedTaskIds.length,
      deleted_task_ids: deletedTaskIds,
    });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Unknown error' },
      500
    );
  }
}
