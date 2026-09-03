import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { formatDateDDMMYYYY } from '../../../lib/dateDisplay';
import { runMtDailyReviewOnce } from '../../../lib/mtDailyReview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_CHAT_ID = '-1003946542037';
const SINGAPORE_TIME_ZONE = 'Asia/Singapore';
const MAX_LIST_ITEMS = 12;

type ChecklistRow = {
  source_type?: string;
  title?: string;
  owner_name?: string;
  status?: string;
  is_required?: boolean;
};

type ProjectRow = {
  title?: string;
  status?: string;
  progress_percent?: number;
  rooms_done_on_date?: number;
  moving_today?: boolean;
  pending_rooms?: string[];
};

type LinenItem = {
  label?: string;
  previous_in_bill?: number;
  returned?: number;
};

type DailySummary = {
  report_date?: string;
  checklists?: ChecklistRow[];
  special_projects?: ProjectRow[];
  rooms?: {
    linen_rooms_expected?: number;
    linen_rooms_saved?: number;
    linen_rooms_missing?: string[];
    open_manager_room_checks?: number;
    open_manager_rooms?: string[];
  };
  linen?: {
    bill_saved?: boolean;
    bill_saved_rows?: number;
    bill_expected_rows?: number;
    return_saved?: boolean;
    return_saved_rows?: number;
    return_expected_rows?: number;
    items?: LinenItem[];
  };
};

function singaporeDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

function displayDate(value: string) {
  return formatDateDDMMYYYY(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function returnMinusPreviousBill(item: LinenItem) {
  return numberValue(item.returned) - numberValue(item.previous_in_bill);
}

function clippedList(values: string[], emptyText: string) {
  if (!values.length) return emptyText;
  const visible = values.slice(0, MAX_LIST_ITEMS);
  const remaining = values.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? ` (+${remaining} more)` : ''}`;
}

function checklistLabel(row: ChecklistRow) {
  const labels: Record<string, string> = {
    DAILY_FORM: 'Daily Form',
    FO_CHECKLIST: 'FO Checklist',
    SUPERVISOR_CHECKLIST: 'Supervisor Checklist',
    PA_CHECKLIST: 'PA Checklist',
    FNB_CHECKLIST: 'F&B Checklist',
  };
  return `${labels[String(row.source_type || '')] || 'Checklist'} — ${row.title || 'Untitled'}`;
}

function buildReportMessage(params: {
  reportDate: string;
  summary: DailySummary;
  overdueMaintenance: any[];
  overdueMaintenanceCount: number;
  openTasks: any[];
  openTaskCount: number;
}) {
  const { reportDate, summary, overdueMaintenance, overdueMaintenanceCount, openTasks, openTaskCount } = params;
  const checklists = summary.checklists || [];
  const missingChecklists = checklists.filter(
    (row) => row.is_required !== false && String(row.status || '').toUpperCase() !== 'SUBMITTED'
  );
  const projects = summary.special_projects || [];
  const movingProjects = projects.filter((row) => row.moving_today);
  const rooms = summary.rooms || {};
  const linen = summary.linen || {};
  const linenVarianceItems = (linen.items || []).filter(
    (item) => Math.abs(returnMinusPreviousBill(item)) >= 3
  );
  const missingRooms = rooms.linen_rooms_missing || [];
  const lines = [
    '📋 DAILY OPERATIONS UPDATE',
    `Yesterday: ${displayDate(reportDate)}`,
    '',
    `CHECKLISTS — ${missingChecklists.length ? `❌ ${missingChecklists.length} not completed` : '✅ all completed'}`,
  ];

  if (missingChecklists.length) {
    for (const row of missingChecklists.slice(0, MAX_LIST_ITEMS)) {
      lines.push(`• ${row.owner_name || 'Unassigned'}: ${checklistLabel(row)}`);
    }
    if (missingChecklists.length > MAX_LIST_ITEMS) {
      lines.push(`• +${missingChecklists.length - MAX_LIST_ITEMS} more`);
    }
  }

  lines.push('', `SPECIAL PROJECTS — ${projects.length ? `${movingProjects.length}/${projects.length} moved yesterday` : 'no active projects'}`);
  for (const project of projects.slice(0, MAX_LIST_ITEMS)) {
    const movement = project.moving_today
      ? `+${numberValue(project.rooms_done_on_date)} room(s)`
      : 'no movement';
    lines.push(`• ${project.title || 'Untitled'}: ${numberValue(project.progress_percent)}% (${movement})${project.status === 'OVERDUE' ? ' ⚠️ OVERDUE' : ''}`);
  }

  const expectedRooms = numberValue(rooms.linen_rooms_expected);
  const savedRooms = numberValue(rooms.linen_rooms_saved);
  lines.push(
    '',
    `ROOM & LINEN SAVES — ${missingRooms.length || !linen.bill_saved || !linen.return_saved ? '⚠️ follow-up needed' : '✅ complete'}`,
    `• Pending rooms saved: ${savedRooms}/${expectedRooms}${missingRooms.length ? ` — missing ${clippedList(missingRooms, '')}` : ' ✅'}`,
    `• In Bill saved: ${numberValue(linen.bill_saved_rows)}/${numberValue(linen.bill_expected_rows) || 8}${linen.bill_saved ? ' ✅' : ' ❌'}`,
    `• Return saved: ${numberValue(linen.return_saved_rows)}/${numberValue(linen.return_expected_rows) || 2}${linen.return_saved ? ' ✅' : ' ❌'}`
  );

  lines.push(
    '',
    `LINEN RETURN VARIANCE — ${linenVarianceItems.length ? `⚠️ ${linenVarianceItems.length} at ±3 or more` : '✅ all below ±3'}`
  );
  for (const item of linenVarianceItems) {
    const difference = returnMinusPreviousBill(item);
    lines.push(`• ${item.label || 'Linen'}: ${difference > 0 ? '+' : ''}${difference}`);
  }

  const openChecks = numberValue(rooms.open_manager_room_checks);
  lines.push(
    '',
    `MANAGER ROOM CHECKS — ${openChecks ? `❌ ${openChecks} incomplete` : '✅ none incomplete'}`
  );
  if (openChecks) {
    lines.push(`• Rooms: ${clippedList(rooms.open_manager_rooms || [], 'Room details unavailable')}`);
  }

  lines.push(
    '',
    `PREVENTIVE MAINTENANCE — ${overdueMaintenanceCount ? `❌ ${overdueMaintenanceCount} overdue` : '✅ none overdue'}`
  );
  for (const run of overdueMaintenance.slice(0, MAX_LIST_ITEMS)) {
    const task = Array.isArray(run.pm_tasks) ? run.pm_tasks[0] : run.pm_tasks;
    lines.push(`• ${task?.title || 'Maintenance task'} — due ${run.due_date}`);
  }
  if (overdueMaintenanceCount > MAX_LIST_ITEMS) {
    lines.push(`• +${overdueMaintenanceCount - MAX_LIST_ITEMS} more`);
  }

  lines.push('', `PENDING TASKS — ${openTaskCount ? `❌ ${openTaskCount} open` : '✅ none open'}`);
  for (const task of openTasks.slice(0, MAX_LIST_ITEMS)) {
    lines.push(`• ${task.task_code || 'Task'} [${task.department || '-'}] ${task.room || '-'} — ${task.task_text || ''}`);
  }
  if (openTaskCount > MAX_LIST_ITEMS) {
    lines.push(`• +${openTaskCount - MAX_LIST_ITEMS} more`);
  }

  lines.push('', 'Open Daily Operations Summary for full details.');
  return lines.join('\n').slice(0, 4090);
}

async function sendTelegramMessage(chatId: string, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Telegram send failed');
  }
  return numberValue(payload?.result?.message_id);
}

export async function GET(request: NextRequest) {
  const bridgeSecret = process.env.PRINTER_BRIDGE_KEY;
  const authorization = request.headers.get('authorization');
  const headerSecret = request.headers.get('x-printer-bridge-key');
  const isAuthorized = Boolean(
    bridgeSecret &&
      (authorization === `Bearer ${bridgeSecret}` || headerSecret === bridgeSecret)
  );

  if (!isAuthorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const reportDate = singaporeDate(-1);
  const today = singaporeDate(0);
  const force = request.nextUrl.searchParams.get('force') === '1';
  const chatId = process.env.DAILY_OPERATIONS_TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;

  if (!force) {
    const { data: existing } = await supabaseAdmin
      .from('daily_telegram_report_runs')
      .select('status, sent_at')
      .eq('report_date', reportDate)
      .maybeSingle();
    if (existing?.status === 'SENT') {
      try {
        const mtDailyReview = await runMtDailyReviewOnce(today, force);
        return NextResponse.json({ ok: true, alreadySent: true, reportDate, sentAt: existing.sent_at, mtDailyReview });
      } catch (error: any) {
        return NextResponse.json(
          { ok: false, reportDate, error: error?.message || 'Maintenance daily review failed' },
          { status: 500 }
        );
      }
    }
  }

  await supabaseAdmin.from('daily_telegram_report_runs').upsert({
    report_date: reportDate,
    status: 'SENDING',
    attempted_at: new Date().toISOString(),
    sent_at: null,
    telegram_message_id: null,
    error_text: null,
  });

  try {
    const mtDailyReview = await runMtDailyReviewOnce(today, force);
    const [summaryResult, maintenanceResult, tasksResult] = await Promise.all([
      supabaseAdmin.rpc('get_daily_operations_summary', { p_report_date: reportDate }),
      supabaseAdmin
        .from('pm_task_runs')
        .select('id, due_date, status, pm_tasks!inner(title)', { count: 'exact' })
        .eq('pm_tasks.is_active', true)
        .neq('status', 'DONE')
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(MAX_LIST_ITEMS),
      supabaseAdmin
        .from('tasks')
        .select('id, task_code, department, room, task_text, created_at', { count: 'exact' })
        .eq('status', 'OPEN')
        .not('task_text', 'ilike', 'Urgent Manager Room Check%')
        .neq('task_text', 'Manager Room Check.')
        .order('created_at', { ascending: true })
        .limit(MAX_LIST_ITEMS),
    ]);

    if (summaryResult.error) throw summaryResult.error;
    if (maintenanceResult.error) throw maintenanceResult.error;
    if (tasksResult.error) throw tasksResult.error;

    const summary = (summaryResult.data || {}) as DailySummary;
    const message = buildReportMessage({
      reportDate,
      summary,
      overdueMaintenance: maintenanceResult.data || [],
      overdueMaintenanceCount: maintenanceResult.count || 0,
      openTasks: tasksResult.data || [],
      openTaskCount: tasksResult.count || 0,
    });
    const telegramMessageId = await sendTelegramMessage(chatId, message);

    await supabaseAdmin
      .from('daily_telegram_report_runs')
      .update({
        status: 'SENT',
        sent_at: new Date().toISOString(),
        telegram_message_id: telegramMessageId,
        report_payload: summary,
        error_text: null,
      })
      .eq('report_date', reportDate);

    return NextResponse.json({ ok: true, reportDate, telegramMessageId, mtDailyReview });
  } catch (error: any) {
    const message = error?.message || 'Daily operations Telegram report failed';
    await supabaseAdmin
      .from('daily_telegram_report_runs')
      .update({ status: 'FAILED', error_text: message })
      .eq('report_date', reportDate);
    return NextResponse.json({ ok: false, reportDate, error: message }, { status: 500 });
  }
}
