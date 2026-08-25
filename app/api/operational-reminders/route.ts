import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import {
  HK_PUSH_EMAILS,
  MT_SUPERVISOR_PUSH_EMAILS,
  resolvePushProfiles,
  sendPushNotifications,
} from '../../../lib/taskPush';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SINGAPORE_TIME_ZONE = 'Asia/Singapore';
const HK_TASK_CHAT_ID = '-1003784764929';
const MT_TASK_CHAT_ID = '-1003860980789';
const MAX_VISIBLE_ITEMS = 12;

type ReminderKind = 'CHAMBERMAID_5PM' | 'PREVENTIVE_MAINTENANCE_9AM';

function singaporeDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function requestedKind(request: NextRequest): ReminderKind | null {
  const kind = String(request.nextUrl.searchParams.get('kind') || '').trim().toLowerCase();
  if (kind === 'chambermaid' || kind === 'chambermaid-5pm') return 'CHAMBERMAID_5PM';
  if (kind === 'preventive-maintenance' || kind === 'pm' || kind === 'pm-9am') {
    return 'PREVENTIVE_MAINTENANCE_9AM';
  }
  return null;
}

function clipped(values: string[], limit = MAX_VISIBLE_ITEMS) {
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? ` (+${remaining} more)` : ''}`;
}

async function sendTelegramMessage(chatId: string, text: string, failureLabel: string) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4090),
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `${failureLabel} Telegram reminder failed`);
  }
  return Number(payload?.result?.message_id || 0) || null;
}

async function chambermaidReminder(today: string) {
  const { data: statusRows, error: statusError } = await supabaseAdmin
    .from('linen_room_status')
    .select('room_number')
    .eq('service_date', today)
    .in('status', ['CHECKOUT', 'STAYOVER']);
  if (statusError) throw statusError;

  const expectedRooms = Array.from(new Set(
    (statusRows || []).map((row) => String(row.room_number || '').trim()).filter(Boolean)
  ));
  if (!expectedRooms.length) {
    return { findingCount: 0, delivered: 0, attempted: 0, details: { missingRooms: [] } };
  }

  const { data: entryRows, error: entryError } = await supabaseAdmin
    .from('linen_room_entry')
    .select('room_number')
    .eq('service_date', today)
    .in('room_number', expectedRooms);
  if (entryError) throw entryError;

  const savedRooms = new Set(
    (entryRows || []).map((row) => String(row.room_number || '').trim()).filter(Boolean)
  );
  const missingRooms = expectedRooms.filter((room) => !savedRooms.has(room)).sort();
  if (!missingRooms.length) {
    return { findingCount: 0, delivered: 0, attempted: 0, details: { missingRooms: [] } };
  }

  const profiles = await resolvePushProfiles({ emails: HK_PUSH_EMAILS });
  const [pushResult, telegramMessageId] = await Promise.all([
    sendPushNotifications({
      userIds: profiles.map((profile) => profile.user_id),
      topic: `rooms-${today}`,
      ttlSeconds: 4 * 60 * 60,
      payload: {
        kind: 'REMINDER',
        title: `${missingRooms.length} ROOM SAVE${missingRooms.length === 1 ? '' : 'S'} PENDING`,
        body: `Chambermaid entries still not saved at 5:00 PM: ${clipped(missingRooms)}`,
        url: '/dashboard/chambermaid-entry',
      },
    }),
    sendTelegramMessage(
      HK_TASK_CHAT_ID,
      [
        '🧹 CHAMBERMAID SAVE REMINDER',
        `Date: ${displayDate(today)}`,
        `Pending rooms: ${missingRooms.length}`,
        '',
        `Rooms: ${clipped(missingRooms)}`,
        '',
        'Please open Chambermaid Entry and save the pending rooms.',
      ].join('\n'),
      'Housekeeping'
    ),
  ]);
  if (pushResult.warning) throw new Error(pushResult.warning);

  return {
    findingCount: missingRooms.length,
    delivered: pushResult.delivered,
    attempted: pushResult.attempted,
    telegramMessageId,
    details: { missingRooms },
  };
}

async function preventiveMaintenanceReminder(today: string) {
  const { data, error, count } = await supabaseAdmin
    .from('pm_task_runs')
    .select('id, due_date, status, pm_tasks!inner(title)', { count: 'exact' })
    .eq('pm_tasks.is_active', true)
    .neq('status', 'DONE')
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .limit(100);
  if (error) throw error;

  const overdue = (data || []).map((run: any) => {
    const task = Array.isArray(run.pm_tasks) ? run.pm_tasks[0] : run.pm_tasks;
    return {
      title: String(task?.title || 'Maintenance task').trim(),
      dueDate: String(run.due_date || '').trim(),
    };
  });
  const overdueCount = Number(count || overdue.length);
  if (!overdueCount) {
    return {
      findingCount: 0,
      delivered: 0,
      attempted: 0,
      telegramMessageId: null,
      details: { overdue: [] },
    };
  }

  const itemLines = overdue.slice(0, MAX_VISIBLE_ITEMS).map(
    (item) => `• ${item.title} — due ${displayDate(item.dueDate)}`
  );
  if (overdueCount > itemLines.length) itemLines.push(`• +${overdueCount - itemLines.length} more`);

  const profiles = await resolvePushProfiles({ emails: MT_SUPERVISOR_PUSH_EMAILS });
  const [pushResult, telegramMessageId] = await Promise.all([
    sendPushNotifications({
      userIds: profiles.map((profile) => profile.user_id),
      topic: `pm-${today}`,
      ttlSeconds: 8 * 60 * 60,
      payload: {
        kind: 'REMINDER',
        title: `${overdueCount} OVERDUE PREVENTIVE MAINTENANCE`,
        body: overdue.slice(0, 5).map((item) => `${item.title} (${displayDate(item.dueDate)})`).join(' · '),
        url: '/dashboard/preventive-maintenance',
      },
    }),
    sendTelegramMessage(MT_TASK_CHAT_ID, [
      '🔧 OVERDUE PREVENTIVE MAINTENANCE REMINDER',
      `Date: ${displayDate(today)}`,
      `Overdue: ${overdueCount}`,
      '',
      ...itemLines,
      '',
      'Please open Preventive Maintenance and follow up.',
    ].join('\n'), 'Maintenance'),
  ]);
  if (pushResult.warning) throw new Error(pushResult.warning);

  return {
    findingCount: overdueCount,
    delivered: pushResult.delivered,
    attempted: pushResult.attempted,
    telegramMessageId,
    details: { overdue },
  };
}

export async function GET(request: NextRequest) {
  const bridgeSecret = String(process.env.PRINTER_BRIDGE_KEY || '').trim();
  const authorization = request.headers.get('authorization');
  const headerSecret = request.headers.get('x-printer-bridge-key');
  const isAuthorized = Boolean(
    bridgeSecret &&
      (authorization === `Bearer ${bridgeSecret}` || headerSecret === bridgeSecret)
  );
  if (!isAuthorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const reminderType = requestedKind(request);
  if (!reminderType) {
    return NextResponse.json(
      { ok: false, error: 'Use kind=chambermaid or kind=preventive-maintenance' },
      { status: 400 }
    );
  }

  const notificationDate = singaporeDate();
  const force = request.nextUrl.searchParams.get('force') === '1';
  console.info('[operational-reminders] started', { notificationDate, reminderType, force });
  if (!force) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('daily_operational_notification_runs')
      .select('status, sent_at, finding_count, delivered_count')
      .eq('notification_date', notificationDate)
      .eq('notification_type', reminderType)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    }
    if (existing?.status === 'SENT' || existing?.status === 'NOT_NEEDED') {
      return NextResponse.json({
        ok: true,
        alreadySent: true,
        notificationDate,
        reminderType,
        ...existing,
      });
    }
  }

  await supabaseAdmin.from('daily_operational_notification_runs').upsert({
    notification_date: notificationDate,
    notification_type: reminderType,
    status: 'SENDING',
    attempted_at: new Date().toISOString(),
    sent_at: null,
    error_text: null,
  });

  try {
    const result = reminderType === 'CHAMBERMAID_5PM'
      ? await chambermaidReminder(notificationDate)
      : await preventiveMaintenanceReminder(notificationDate);
    const status = result.findingCount > 0 ? 'SENT' : 'NOT_NEEDED';
    const sentAt = new Date().toISOString();

    await supabaseAdmin
      .from('daily_operational_notification_runs')
      .update({
        status,
        sent_at: sentAt,
        finding_count: result.findingCount,
        attempted_count: result.attempted,
        delivered_count: result.delivered,
        telegram_message_id: 'telegramMessageId' in result ? result.telegramMessageId : null,
        details: result.details,
        error_text: null,
      })
      .eq('notification_date', notificationDate)
      .eq('notification_type', reminderType);

    console.info('[operational-reminders] completed', {
      notificationDate,
      reminderType,
      status,
      findingCount: result.findingCount,
      attempted: result.attempted,
      delivered: result.delivered,
      telegramMessageId: 'telegramMessageId' in result ? result.telegramMessageId : null,
    });

    return NextResponse.json({
      ok: true,
      notificationDate,
      reminderType,
      status,
      sentAt,
      ...result,
    });
  } catch (error: any) {
    const message = error?.message || 'Operational reminder failed';
    console.error('[operational-reminders] failed', { notificationDate, reminderType, error: message });
    await supabaseAdmin
      .from('daily_operational_notification_runs')
      .update({ status: 'FAILED', error_text: message })
      .eq('notification_date', notificationDate)
      .eq('notification_type', reminderType);
    return NextResponse.json(
      { ok: false, notificationDate, reminderType, error: message },
      { status: 500 }
    );
  }
}
