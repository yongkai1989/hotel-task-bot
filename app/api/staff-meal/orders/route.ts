import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const BRANCHES = ['Crown', 'Leisure', 'View', 'Express'] as const;
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Branch = (typeof BRANCHES)[number];
type MealChoice = 'none' | 'lunch' | 'dinner' | 'both';

function jsonNoCache(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function sgParts(date = new Date()) {
  const shifted = new Date(date.getTime() + SG_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function toDateStringFromUtcMs(ms: number) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function staffMealCycle(now = new Date()) {
  const parts = sgParts(now);
  const dayOffsetFromMonday = (parts.day + 6) % 7;
  const todaySgMidnightUtcMs = Date.UTC(parts.year, parts.month, parts.date);
  const mondayUtcMs = todaySgMidnightUtcMs - dayOffsetFromMonday * DAY_MS;
  const minutes = parts.hour * 60 + parts.minute;
  const afterMondayCutoff = parts.day === 1 && minutes > 9 * 60;
  const weekStartMs = mondayUtcMs + (afterMondayCutoff ? 7 * DAY_MS : 0);
  const weekEndMs = weekStartMs + 6 * DAY_MS;

  return {
    order_week_start: toDateStringFromUtcMs(weekStartMs),
    order_week_end: toDateStringFromUtcMs(weekEndMs),
    closes_at_label: `${toDateStringFromUtcMs(weekStartMs + 7 * DAY_MS)} 9:00 AM`,
  };
}

function normalizeName(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeNameKey(value: unknown) {
  return normalizeName(value).toLowerCase();
}

function normalizeBranch(value: unknown): Branch | null {
  const raw = normalizeName(value).toLowerCase();
  return BRANCHES.find((branch) => branch.toLowerCase() === raw) || null;
}

function sanitizeMealChoice(value: unknown): MealChoice {
  const raw = String(value || 'none').trim().toLowerCase();
  if (raw === 'lunch' || raw === 'dinner' || raw === 'both') return raw;
  return 'none';
}

function normalizeMeals(value: any): Record<string, MealChoice> {
  const result: Record<string, MealChoice> = {};
  Object.entries(value || {}).forEach(([date, choice]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result[date] = sanitizeMealChoice(choice);
    }
  });
  return result;
}

function countMeals(meals: Record<string, MealChoice>) {
  return Object.values(meals).reduce(
    (acc, choice) => {
      if (choice === 'lunch') acc.lunch += 1;
      if (choice === 'dinner') acc.dinner += 1;
      if (choice === 'both') {
        acc.lunch += 1;
        acc.dinner += 1;
      }
      return acc;
    },
    { lunch: 0, dinner: 0 }
  );
}

function canManageStaffMeal(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  return role === 'SUPERUSER' || role === 'MANAGER';
}

async function cleanupOldOrders() {
  await supabaseAdmin.rpc('cleanup_staff_meal_orders').catch(() => null);
}

export async function GET(req: NextRequest) {
  const cycle = staffMealCycle();
  const adminMode = req.nextUrl.searchParams.get('admin') === '1';

  if (!adminMode) {
    return jsonNoCache({ ok: true, cycle, branches: BRANCHES });
  }

  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);

  await cleanupOldOrders();

  const weekStart = req.nextUrl.searchParams.get('week_start') || cycle.order_week_start;
  const { data, error: listError } = await supabaseAdmin
    .from('staff_meal_orders')
    .select('*')
    .eq('order_week_start', weekStart)
    .order('branch', { ascending: true })
    .order('staff_name_normalized', { ascending: true });

  if (listError) return jsonNoCache({ ok: false, error: listError.message }, 500);

  return jsonNoCache({
    ok: true,
    cycle,
    week_start: weekStart,
    branches: BRANCHES,
    orders: data || [],
    can_manage: canManageStaffMeal(user),
  });
}

export async function POST(req: NextRequest) {
  await cleanupOldOrders();

  const cycle = staffMealCycle();
  const body = await req.json().catch(() => ({}));
  const branch = normalizeBranch(body?.branch);
  const staffName = normalizeName(body?.staff_name);
  const staffNameNormalized = normalizeNameKey(staffName);
  const meals = normalizeMeals(body?.meals);
  const totals = countMeals(meals);

  if (!branch) return jsonNoCache({ ok: false, error: 'Please select a valid branch.' }, 400);
  if (!staffName || staffName.length < 2) return jsonNoCache({ ok: false, error: 'Please enter your name.' }, 400);
  if (totals.lunch + totals.dinner <= 0) {
    return jsonNoCache({ ok: false, error: 'Please select at least one lunch or dinner.' }, 400);
  }

  const payload = {
    order_week_start: cycle.order_week_start,
    order_week_end: cycle.order_week_end,
    branch,
    staff_name: staffName,
    staff_name_normalized: staffNameNormalized,
    meals,
    notes: normalizeName(body?.notes || ''),
  };

  const { data, error } = await supabaseAdmin
    .from('staff_meal_orders')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return jsonNoCache({
        ok: false,
        error: `${staffName} has already submitted a staff meal order for ${branch} for this order week.`,
      }, 409);
    }
    return jsonNoCache({ ok: false, error: error.message }, 500);
  }

  return jsonNoCache({ ok: true, cycle, order: data, totals });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
  if (!canManageStaffMeal(user)) return jsonNoCache({ ok: false, error: 'Only managers and superusers can edit staff meal orders.' }, 403);

  const body = await req.json().catch(() => ({}));
  const id = normalizeName(body?.id);
  const branch = normalizeBranch(body?.branch);
  const staffName = normalizeName(body?.staff_name);
  const meals = normalizeMeals(body?.meals);
  const totals = countMeals(meals);

  if (!id) return jsonNoCache({ ok: false, error: 'Missing order id.' }, 400);
  if (!branch) return jsonNoCache({ ok: false, error: 'Please select a valid branch.' }, 400);
  if (!staffName || staffName.length < 2) return jsonNoCache({ ok: false, error: 'Please enter staff name.' }, 400);
  if (totals.lunch + totals.dinner <= 0) return jsonNoCache({ ok: false, error: 'Please select at least one meal.' }, 400);

  const { data, error: updateError } = await supabaseAdmin
    .from('staff_meal_orders')
    .update({
      branch,
      staff_name: staffName,
      staff_name_normalized: normalizeNameKey(staffName),
      meals,
      notes: normalizeName(body?.notes || ''),
      updated_at: new Date().toISOString(),
      updated_by_name: user.name,
      updated_by_email: user.email,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      return jsonNoCache({ ok: false, error: 'Another order already exists for this name and branch.' }, 409);
    }
    return jsonNoCache({ ok: false, error: updateError.message }, 500);
  }

  return jsonNoCache({ ok: true, order: data });
}

export async function DELETE(req: NextRequest) {
  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return jsonNoCache({ ok: false, error: error || 'Unauthorized' }, 401);
  if (!canManageStaffMeal(user)) return jsonNoCache({ ok: false, error: 'Only managers and superusers can delete staff meal orders.' }, 403);

  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return jsonNoCache({ ok: false, error: 'Missing order id.' }, 400);

  const { error: deleteError } = await supabaseAdmin
    .from('staff_meal_orders')
    .delete()
    .eq('id', id);

  if (deleteError) return jsonNoCache({ ok: false, error: deleteError.message }, 500);
  return jsonNoCache({ ok: true });
}
