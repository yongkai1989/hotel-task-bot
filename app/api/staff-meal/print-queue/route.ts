import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const BRANCHES = ['Crown', 'Leisure', 'Express', 'View'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

type Branch = (typeof BRANCHES)[number];
type MealChoice = 'none' | 'lunch' | 'dinner' | 'both';
type PrinterRole = 'FNB' | 'STAFF_MEAL';

function jsonNoCache(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function isMissingTable(error: any) {
  return error?.code === '42P01' || String(error?.message || '').toLowerCase().includes('does not exist');
}

function getBridgeKeyStatus(req: NextRequest) {
  const expected = String(process.env.PRINTER_BRIDGE_KEY || '').trim();
  const direct = String(req.headers.get('x-printer-bridge-key') || '').trim();
  const auth = String(req.headers.get('authorization') || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const provided = direct || bearer;

  if (!provided) return { ok: false, error: 'Missing authorization token' };
  if (!expected) return { ok: false, error: 'PRINTER_BRIDGE_KEY is missing on Vercel.' };
  if (provided !== expected) return { ok: false, error: 'Invalid printer bridge key' };
  return { ok: true, error: '' };
}

function getPrinterRole(req: NextRequest): PrinterRole {
  const role = String(req.nextUrl.searchParams.get('printer_role') || req.headers.get('x-printer-role') || 'STAFF_MEAL')
    .trim()
    .toUpperCase();
  return role === 'FNB' ? 'FNB' : 'STAFF_MEAL';
}

function formatIsoFromUtcMs(ms: number) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function utcMsFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(value: string, days: number) {
  return formatIsoFromUtcMs(utcMsFromIso(value) + days * DAY_MS);
}

function currentSgDateParts(now = new Date()) {
  const shifted = new Date(now.getTime() + SG_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
  };
}

function currentServiceWeekStart(now = new Date()) {
  const parts = currentSgDateParts(now);
  const todaySgMidnightUtcMs = Date.UTC(parts.year, parts.month, parts.date);
  const dayOffsetFromMonday = (parts.day + 6) % 7;
  return formatIsoFromUtcMs(todaySgMidnightUtcMs - dayOffsetFromMonday * DAY_MS);
}

function shortDate(value: string) {
  const ms = utcMsFromIso(value);
  if (!ms) return value;
  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function cleanText(value: unknown) {
  return String(value || '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMeal(value: unknown): MealChoice {
  const raw = String(value || 'none').trim().toLowerCase();
  if (raw === 'lunch' || raw === 'dinner' || raw === 'both') return raw;
  return 'none';
}

function mealLabel(choice: MealChoice) {
  if (choice === 'lunch') return 'Lunch';
  if (choice === 'dinner') return 'Dinner';
  if (choice === 'both') return 'Lunch + Dinner';
  return 'Off';
}

function hasLunch(choice: MealChoice) {
  return choice === 'lunch' || choice === 'both';
}

function hasDinner(choice: MealChoice) {
  return choice === 'dinner' || choice === 'both';
}

function getMeal(order: any, date: string): MealChoice {
  return normalizeMeal(order?.meals?.[date]);
}

function countDayMeals(orders: any[], date: string) {
  return orders.reduce(
    (acc, order) => {
      const choice = getMeal(order, date);
      if (hasLunch(choice)) acc.lunch += 1;
      if (hasDinner(choice)) acc.dinner += 1;
      return acc;
    },
    { lunch: 0, dinner: 0 }
  );
}

function branchSortValue(branch: string) {
  const index = BRANCHES.indexOf(branch as Branch);
  return index === -1 ? BRANCHES.length : index;
}

function sortOrders(a: any, b: any) {
  const branchDiff = branchSortValue(a.branch) - branchSortValue(b.branch);
  if (branchDiff !== 0) return branchDiff;
  return cleanText(a.staff_name).localeCompare(cleanText(b.staff_name), undefined, { sensitivity: 'base' });
}

function buildReportPayload(orders: any[], weekStart: string) {
  const sortedOrders = [...orders].sort(sortOrders);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = addDays(weekStart, 6);
  const lines: string[] = [];
  const summaryDates = dates.map((date) => ({
    date,
    label: shortDate(date),
  }));
  const summaryRows = sortedOrders.map((order) => ({
    branch: cleanText(order.branch),
    name: cleanText(order.staff_name),
    meals: dates.map((date) => {
      const choice = getMeal(order, date);
      return {
        date,
        meal: mealLabel(choice),
        meal_code: choice === 'both' ? 'L+D' : choice === 'lunch' ? 'L' : choice === 'dinner' ? 'D' : '',
      };
    }),
  }));
  const summaryTotals = dates.map((date) => ({
    date,
    label: shortDate(date),
    ...countDayMeals(sortedOrders, date),
  }));
  const reportDays = dates.map((date) => {
    const dayTotals = countDayMeals(sortedOrders, date);
    return {
      date,
      label: shortDate(date),
      totals: dayTotals,
      branches: BRANCHES.map((branch) => {
        const branchOrders = sortedOrders.filter((order) => order.branch === branch && getMeal(order, date) !== 'none');
        const branchTotals = countDayMeals(branchOrders, date);
        return {
          branch,
          totals: branchTotals,
          staff: branchOrders.map((order) => ({
            name: cleanText(order.staff_name),
            meal: mealLabel(getMeal(order, date)),
            meal_code: getMeal(order, date) === 'both' ? 'L+D' : getMeal(order, date) === 'lunch' ? 'L' : 'D',
            notes: cleanText(order.notes),
          })),
        };
      }).filter((branch) => branch.staff.length > 0),
    };
  });

  lines.push('STAFF MEAL REPORT');
  lines.push(`${shortDate(weekStart)} - ${shortDate(weekEnd)}`);
  lines.push('');
  lines.push('DAILY GRAND TOTALS');
  dates.forEach((date) => {
    const totals = countDayMeals(sortedOrders, date);
    lines.push(`${shortDate(date)}  Lunch ${totals.lunch}  Dinner ${totals.dinner}`);
  });

  dates.forEach((date) => {
    const dayTotals = countDayMeals(sortedOrders, date);
    lines.push('');
    lines.push('==========================================');
    lines.push(`${shortDate(date)}  L${dayTotals.lunch} D${dayTotals.dinner}`);
    lines.push('==========================================');

    BRANCHES.forEach((branch) => {
      const branchOrders = sortedOrders.filter((order) => order.branch === branch && getMeal(order, date) !== 'none');
      const branchTotals = countDayMeals(branchOrders, date);
      if (!branchOrders.length) return;

      lines.push(`${branch.toUpperCase()}  L${branchTotals.lunch} D${branchTotals.dinner}`);
      branchOrders.forEach((order, index) => {
        const meal = mealLabel(getMeal(order, date));
        const name = cleanText(order.staff_name);
        const notes = cleanText(order.notes);
        lines.push(`${String(index + 1).padStart(2, '0')}. ${name} - ${meal}`);
        if (notes) lines.push(`    Note: ${notes}`);
      });
    });
  });

  if (!sortedOrders.length) {
    lines.push('');
    lines.push('No staff meal orders found for this week.');
  }

  return {
    title: 'Staff Meal Report',
    week_start: weekStart,
    week_end: weekEnd,
    order_count: sortedOrders.length,
    summary: {
      dates: summaryDates,
      rows: summaryRows,
      totals: summaryTotals,
    },
    days: reportDays,
    text_lines: lines,
  };
}

async function queueStaffMealReport(weekStart: string, printerRole: PrinterRole, forceReprint = false) {
  const weekEnd = addDays(weekStart, 6);
  const { data: orders, error: orderError } = await supabaseAdmin
    .from('staff_meal_orders')
    .select('id, order_week_start, order_week_end, branch, staff_name, meals, notes, created_at')
    .eq('order_week_start', weekStart);

  if (orderError) throw orderError;

  const payload = buildReportPayload(orders || [], weekStart);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('staff_meal_print_jobs')
    .select('id, status, printed_at')
    .eq('job_type', 'WEEKLY_REPORT')
    .eq('week_start', weekStart)
    .eq('printer_role', printerRole)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.status === 'PRINTED' && !forceReprint) {
    return { job: existing, queued: false, message: 'This staff meal report has already been printed.' };
  }

  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from('staff_meal_print_jobs')
      .update({
        week_end: weekEnd,
        payload,
        status: 'QUEUED',
        requested_at: new Date().toISOString(),
        printed_at: null,
        print_error: null,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) throw error;
    return { job: data, queued: true, message: existing.status === 'PRINTED' ? 'Existing staff meal report reprinted.' : 'Existing staff meal report re-queued.' };
  }

  const { data, error } = await supabaseAdmin
    .from('staff_meal_print_jobs')
    .insert({
      job_type: 'WEEKLY_REPORT',
      week_start: weekStart,
      week_end: weekEnd,
      printer_role: printerRole,
      status: 'QUEUED',
      payload,
    })
    .select('*')
    .single();

  if (error) throw error;
  return { job: data, queued: true, message: 'Staff meal report queued.' };
}

export async function GET(req: NextRequest) {
  try {
    const auth = getBridgeKeyStatus(req);
    if (!auth.ok) return jsonNoCache({ ok: false, error: auth.error, jobs: [] }, 401);

    const role = getPrinterRole(req);
    const isOneTimeStaffMealRun = req.nextUrl.searchParams.get('one_time') === 'true';

    // Staff Meal prints only on the explicitly launched weekly run. This also
    // protects the database if an obsolete bridge process keeps polling.
    if (role === 'STAFF_MEAL' && !isOneTimeStaffMealRun) {
      return jsonNoCache({ ok: true, jobs: [], polling_disabled: true });
    }

    const { data, error } = await supabaseAdmin
      .from('staff_meal_print_jobs')
      .select('*')
      .eq('printer_role', role)
      .eq('status', 'QUEUED')
      .order('requested_at', { ascending: true })
      .limit(5);

    if (error) {
      if (isMissingTable(error)) return jsonNoCache({ ok: true, setup_required: true, jobs: [] });
      throw error;
    }
    return jsonNoCache({ ok: true, jobs: data || [] });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load staff meal print queue', jobs: [] }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getBridgeKeyStatus(req);
    if (!auth.ok) return jsonNoCache({ ok: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const weekStart = String(body?.week_start || req.nextUrl.searchParams.get('week_start') || currentServiceWeekStart()).trim();
    const forceReprint = body?.force_reprint === true || req.nextUrl.searchParams.get('force_reprint') === 'true';
    const role = getPrinterRole(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return jsonNoCache({ ok: false, error: 'Invalid week_start.' }, 400);

    const result = await queueStaffMealReport(weekStart, role, forceReprint);
    return jsonNoCache({ ok: true, ...result });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to queue staff meal report' }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = getBridgeKeyStatus(req);
    if (!auth.ok) return jsonNoCache({ ok: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const status = String(body?.print_status || body?.status || '').trim().toUpperCase();
    const printError = cleanText(body?.print_error || '');

    if (!id) return jsonNoCache({ ok: false, error: 'Missing print job id.' }, 400);
    if (!['PRINTED', 'FAILED', 'QUEUED'].includes(status)) return jsonNoCache({ ok: false, error: 'Invalid print status.' }, 400);

    const { data, error } = await supabaseAdmin
      .from('staff_meal_print_jobs')
      .update({
        status,
        printed_at: status === 'PRINTED' ? new Date().toISOString() : null,
        print_error: status === 'FAILED' ? printError || 'Printer failed' : null,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return jsonNoCache({ ok: true, job: data });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update staff meal print job' }, 500);
  }
}
