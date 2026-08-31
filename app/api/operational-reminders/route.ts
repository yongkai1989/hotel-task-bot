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

type ReminderKind =
  | 'CHAMBERMAID_5PM'
  | 'PREVENTIVE_MAINTENANCE_9AM'
  | 'LINEN_VARIANCE_530PM';

type LinenVarianceItem = {
  key?: string;
  label?: string;
  maid_use?: number;
  in_bill?: number;
  difference?: number;
};

type LinenAreaFlag = {
  block_no?: number;
  floor_no?: number;
  bill_rows?: number;
  flagged_items?: LinenVarianceItem[];
};

type LinenVarianceReport = {
  threshold?: number;
  current_areas_compared?: number;
  current_flags?: LinenAreaFlag[];
};

type SupervisorChecklistPerson = {
  email: string;
  name: string;
};

type SupervisorChecklistStatus = {
  templateId: string | null;
  templateTitle: string | null;
  required: SupervisorChecklistPerson[];
  submitted: SupervisorChecklistPerson[];
  pending: SupervisorChecklistPerson[];
  warning?: string;
};

const HOUSEKEEPING_SUPERVISORS: SupervisorChecklistPerson[] = [
  { email: 'hksup1@hotelhallmark.com', name: 'Ezni' },
  { email: 'hksup2@hotelhallmark.com', name: 'Sofea' },
  { email: 'hksup3@hotelhallmark.com', name: 'Sulaiman' },
];

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
  if (kind === 'linen-variance' || kind === 'linen' || kind === 'linen-530pm') {
    return 'LINEN_VARIANCE_530PM';
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

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function telegramChunks(lines: string[], continuationTitle: string) {
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const candidate = [...current, line].join('\n');
    if (candidate.length > 3800 && current.length) {
      chunks.push(current.join('\n'));
      current = [continuationTitle, '', line];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

function normalizedStaffName(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function supervisorForScheduleName(value: unknown) {
  const normalized = normalizedStaffName(value);
  if (normalized === 'ezni' || normalized === 'izni') return HOUSEKEEPING_SUPERVISORS[0];
  if (normalized === 'sofea') return HOUSEKEEPING_SUPERVISORS[1];
  if (normalized === 'sulaiman') return HOUSEKEEPING_SUPERVISORS[2];
  return null;
}

async function supervisorChecklistStatus(today: string): Promise<SupervisorChecklistStatus> {
  const { data: template, error: templateError } = await supabaseAdmin
    .from('supervisor_checklist_templates')
    .select('id, title')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template?.id) {
    return {
      templateId: null,
      templateTitle: null,
      required: [],
      submitted: [],
      pending: [],
      warning: 'No active HK supervisor checklist is configured.',
    };
  }

  const { data: staffRows, error: staffError } = await supabaseAdmin
    .from('hk_schedule_staff')
    .select('id, staff_name')
    .eq('is_active', true)
    .eq('staff_role', 'SUPERVISOR');
  if (staffError) throw staffError;

  const staffIds = (staffRows || []).map((row) => row.id).filter(Boolean);
  const [entryResult, submissionResult] = await Promise.all([
    staffIds.length
      ? supabaseAdmin
          .from('hk_schedule_entries')
          .select('staff_id, status')
          .eq('schedule_date', today)
          .in('staff_id', staffIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('supervisor_checklist_submissions')
      .select('submitted_by_name, submitted_by_email')
      .eq('template_id', template.id)
      .eq('submission_date', today),
  ]);
  if (entryResult.error) throw entryResult.error;
  if (submissionResult.error) throw submissionResult.error;

  const scheduleEntries = entryResult.data || [];
  const staffById = new Map((staffRows || []).map((row) => [String(row.id), row.staff_name]));
  const scheduledWorkingEmails = new Set(
    scheduleEntries
      .filter((entry) => entry.status === 'WORK')
      .map((entry) => supervisorForScheduleName(staffById.get(String(entry.staff_id)))?.email)
      .filter((email): email is string => Boolean(email))
  );
  const required = scheduleEntries.length
    ? HOUSEKEEPING_SUPERVISORS.filter((person) => scheduledWorkingEmails.has(person.email))
    : HOUSEKEEPING_SUPERVISORS;
  const submittedEmails = new Set(
    (submissionResult.data || [])
      .map((row) => String(row.submitted_by_email || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const submitted = required.filter((person) => submittedEmails.has(person.email));
  const pending = required.filter((person) => !submittedEmails.has(person.email));

  return {
    templateId: String(template.id),
    templateTitle: String(template.title || 'HK Supervisor Checklist'),
    required,
    submitted,
    pending,
  };
}

async function linenVarianceReminder(today: string) {
  const [{ data, error }, checklistResult] = await Promise.all([
    supabaseAdmin.rpc('get_daily_operations_linen_area_variance', {
      p_report_date: today,
    }),
    supervisorChecklistStatus(today).catch((checklistError: any) => ({
      templateId: null,
      templateTitle: null,
      required: [],
      submitted: [],
      pending: [],
      warning: checklistError?.message || 'Unable to load HK supervisor checklist status.',
    })),
  ]);
  if (error) throw error;

  const report = (data || {}) as LinenVarianceReport;
  const threshold = Number(report.threshold || 2);
  const areaFlags = Array.isArray(report.current_flags) ? report.current_flags : [];
  const findingCount = areaFlags.reduce(
    (total, area) => total + (Array.isArray(area.flagged_items) ? area.flagged_items.length : 0),
    0
  );
  const lines = [
    '🧺 5:30 PM LINEN DIFFERENCE FOLLOW-UP',
    `Date: ${displayDate(today)}`,
    `Flag rule: ±${threshold} or more`,
    `Flagged: ${findingCount} linen difference${findingCount === 1 ? '' : 's'} across ${areaFlags.length} level${areaFlags.length === 1 ? '' : 's'}`,
    '',
    '📋 HK SUPERVISOR CHECKLIST',
  ];

  const checklistStatus = checklistResult as SupervisorChecklistStatus;
  if (checklistStatus.warning) {
    lines.push(`⚠️ ${checklistStatus.warning}`);
  } else if (!checklistStatus.required.length) {
    lines.push('ℹ️ No housekeeping supervisor is scheduled to work today.');
  } else if (!checklistStatus.pending.length) {
    lines.push(
      `✅ ${checklistStatus.submitted.length}/${checklistStatus.required.length} scheduled supervisors submitted.`,
      `Submitted: ${checklistStatus.submitted.map((person) => person.name).join(', ')}`
    );
  } else {
    lines.push(
      `⚠️ ${checklistStatus.submitted.length}/${checklistStatus.required.length} scheduled supervisors submitted.`,
      `Pending: ${checklistStatus.pending.map((person) => person.name).join(', ')}`,
      'Please submit the HK Supervisor Checklist immediately.'
    );
  }
  lines.push('', '🧺 LINEN DIFFERENCES', '');

  if (!findingCount) {
    lines.push(
      `✅ No linen difference of ±${threshold} or more was found across ${Number(report.current_areas_compared || 0)} compared level${Number(report.current_areas_compared || 0) === 1 ? '' : 's'}.`,
      'No immediate follow-up is needed.'
    );
  } else {
    for (const area of areaFlags) {
      lines.push(
        `BLOCK ${Number(area.block_no || 0)} · LEVEL ${Number(area.floor_no || 0)}${Number(area.bill_rows || 0) ? '' : ' ⚠️ IN BILL NOT SAVED'}`
      );
      for (const item of area.flagged_items || []) {
        const difference = Number(item.difference || 0);
        lines.push(
          `• ${item.label || 'Linen'} — Chambermaid ${Number(item.maid_use || 0)} | In Bill ${Number(item.in_bill || 0)} | Difference ${signed(difference)}`
        );
      }
      lines.push('');
    }
    lines.push(
      'Positive difference = In Bill is higher.',
      'Negative difference = Chambermaid entry is higher.',
      '',
      'Please check the flagged levels and correct any wrong entry immediately.'
    );
  }

  const messages = telegramChunks(lines, '🧺 5:30 PM LINEN DIFFERENCE FOLLOW-UP (CONTINUED)');
  const telegramMessageIds: number[] = [];
  for (const message of messages) {
    const messageId = await sendTelegramMessage(
      HK_TASK_CHAT_ID,
      message,
      'Housekeeping linen difference'
    );
    if (messageId) telegramMessageIds.push(messageId);
  }

  return {
    findingCount,
    delivered: 0,
    attempted: messages.length,
    telegramMessageId: telegramMessageIds[0] || null,
    alwaysSent: true,
    details: {
      threshold,
      areasCompared: Number(report.current_areas_compared || 0),
      flaggedAreas: areaFlags,
      supervisorChecklist: checklistStatus,
      telegramMessageIds,
    },
  };
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
        'CHAMBERMAID SAVE REMINDER',
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
      { ok: false, error: 'Use kind=chambermaid, kind=preventive-maintenance, or kind=linen-variance' },
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
      : reminderType === 'LINEN_VARIANCE_530PM'
        ? await linenVarianceReminder(notificationDate)
        : await preventiveMaintenanceReminder(notificationDate);
    const status = result.findingCount > 0 || ('alwaysSent' in result && result.alwaysSent)
      ? 'SENT'
      : 'NOT_NEEDED';
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
