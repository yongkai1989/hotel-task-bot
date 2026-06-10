import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canManageGuestShop(user: any) {
  const role = String(user?.role || '').trim().toUpperCase();
  const email = normalizeEmail(user?.email);
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com';
}

function todaySingapore() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
}

function toDateInput(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeHours(rows: any[]) {
  const byDay = new Map((rows || []).map((row) => [Number(row.weekday), row]));
  return DAY_NAMES.map((name, weekday) => {
    const row = byDay.get(weekday);
    return {
      weekday,
      name,
      is_open: row?.is_open !== false,
      open_time: String(row?.open_time || '08:00').slice(0, 5),
      close_time: String(row?.close_time || '22:00').slice(0, 5),
    };
  });
}

function isOpenNow(hours: any[], closedDates: any[]) {
  const now = todaySingapore();
  const today = toDateInput(now);
  if ((closedDates || []).some((row) => String(row.closed_date) === today)) {
    return { open: false, reason: 'F&B is closed today.' };
  }

  const day = hours.find((row) => Number(row.weekday) === now.getDay());
  if (!day || day.is_open === false) return { open: false, reason: 'F&B is closed today.' };

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openHour, openMinute] = String(day.open_time || '08:00').split(':').map(Number);
  const [closeHour, closeMinute] = String(day.close_time || '22:00').split(':').map(Number);
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;

  if (currentMinutes < openMinutes || currentMinutes > closeMinutes) {
    return {
      open: false,
      reason: `F&B is open from ${day.open_time} to ${day.close_time}.`,
    };
  }

  return { open: true, reason: '' };
}

export async function GET() {
  try {
    const [{ data: hours, error: hoursError }, { data: closedDates, error: closedError }] =
      await Promise.all([
        supabaseAdmin
          .from('guest_shop_fnb_hours')
          .select('*')
          .order('weekday', { ascending: true }),
        supabaseAdmin
          .from('guest_shop_fnb_closed_dates')
          .select('*')
          .order('closed_date', { ascending: true }),
      ]);

    if (hoursError) throw hoursError;
    if (closedError) throw closedError;

    const normalizedHours = normalizeHours(hours || []);
    const normalizedClosed = (closedDates || []).map((row: any) => ({
      closed_date: String(row.closed_date || ''),
      reason: String(row.reason || ''),
    }));

    return jsonNoCache({
      ok: true,
      hours: normalizedHours,
      closed_dates: normalizedClosed,
      current: isOpenNow(normalizedHours, normalizedClosed),
    });
  } catch (error: any) {
    return jsonNoCache({
      ok: true,
      hours: normalizeHours([]),
      closed_dates: [],
      current: { open: true, reason: '' },
      warning: error?.message || 'F&B operating hours are not installed yet',
    });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);
    if (authError || !user) return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    if (!canManageGuestShop(user)) return jsonNoCache({ ok: false, error: 'Access denied' }, 403);

    const body = await req.json().catch(() => ({}));
    const hours = Array.isArray(body?.hours) ? body.hours : [];
    const closedDates = Array.isArray(body?.closed_dates) ? body.closed_dates : [];

    const hourRows = DAY_NAMES.map((_name, weekday) => {
      const row = hours.find((item: any) => Number(item?.weekday) === weekday) || {};
      return {
        weekday,
        is_open: row?.is_open !== false,
        open_time: normalizeTime(row?.open_time, '08:00'),
        close_time: normalizeTime(row?.close_time, '22:00'),
      };
    });

    const { error: upsertError } = await supabaseAdmin
      .from('guest_shop_fnb_hours')
      .upsert(hourRows, { onConflict: 'weekday' });

    if (upsertError) throw upsertError;

    await supabaseAdmin.from('guest_shop_fnb_closed_dates').delete().neq('closed_date', '1900-01-01');

    const closedRows = closedDates
      .map((row: any) => ({
        closed_date: String(row?.closed_date || '').trim(),
        reason: String(row?.reason || '').trim(),
      }))
      .filter((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(row.closed_date));

    if (closedRows.length) {
      const { error: closedInsertError } = await supabaseAdmin
        .from('guest_shop_fnb_closed_dates')
        .upsert(closedRows, { onConflict: 'closed_date' });

      if (closedInsertError) throw closedInsertError;
    }

    return jsonNoCache({ ok: true });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to save F&B hours' }, 500);
  }
}
