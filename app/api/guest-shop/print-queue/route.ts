import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import {
  expireUnacceptedFnbOrders,
  processGuestShopOutbox,
} from '../../../../lib/guestShopReliability';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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
  return role === 'SUPERUSER' || email === 'fenny@hotelhallmark.com' || email === 'walter@hotelhallmark.com';
}

function getBridgeKeyStatus(req: NextRequest) {
  const expected = String(process.env.PRINTER_BRIDGE_KEY || '').trim();

  const direct = String(req.headers.get('x-printer-bridge-key') || '').trim();
  const auth = String(req.headers.get('authorization') || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const provided = direct || bearer;

  if (!provided) return { hasBridgeAttempt: false, ok: false, error: '' };
  if (!expected) {
    return {
      hasBridgeAttempt: true,
      ok: false,
      error: 'PRINTER_BRIDGE_KEY is missing on Vercel. Add it to Production env vars and redeploy.',
    };
  }
  if (provided !== expected) {
    return {
      hasBridgeAttempt: true,
      ok: false,
      error: `Printer bridge key mismatch. Bridge sent ${provided.length} chars, Vercel expects ${expected.length} chars.`,
    };
  }

  return { hasBridgeAttempt: true, ok: true, error: '' };
}

async function requireManager(req: NextRequest) {
  const bridgeKey = getBridgeKeyStatus(req);
  if (bridgeKey.ok) return { error: '', status: 200 };
  if (bridgeKey.hasBridgeAttempt) return { error: bridgeKey.error, status: 401 };

  const { user, error } = await getDashboardUserFromRequest(req);
  if (error || !user) return { error: error || 'Unauthorized', status: 401 };
  if (!canManageGuestShop(user)) return { error: 'Guest Shop Admin access denied', status: 403 };
  return { error: '', status: 200 };
}

function getPrinterRole(req: NextRequest) {
  const role = String(req.nextUrl.searchParams.get('printer_role') || req.headers.get('x-printer-role') || '')
    .trim()
    .toUpperCase();

  if (role === 'ALL' || role === 'BREAKFAST' || role === 'FNB' || role === 'FO') return role;
  return 'FNB';
}

async function recordHeartbeat(req: NextRequest, roles: string[]) {
  const now = new Date().toISOString();
  const deviceName = String(req.headers.get('x-printer-device') || '').trim().slice(0, 120) || null;
  const bridgeVersion = String(req.headers.get('x-bridge-version') || '').trim().slice(0, 40) || null;
  await supabaseAdmin.from('guest_shop_printer_heartbeats').upsert(
    roles.map((printerRole) => ({
      printer_role: printerRole,
      last_seen_at: now,
      device_name: deviceName,
      bridge_version: bridgeVersion,
      last_error: null,
      updated_at: now,
    })),
    { onConflict: 'printer_role' }
  );
}

async function loadQueue(role: string) {
  const columns = roleColumns(role);
  const { data, error } = await supabaseAdmin
    .from('guest_shop_orders')
    .select('id, room_number, guest_name, total_myr, items_json, paid_at, payment_reference, print_status, print_requested_at, order_type, voucher_code, voucher_quantity, breakfast_print_status, breakfast_print_requested_at, fnb_print_status, fnb_print_requested_at, fo_print_status, fo_print_requested_at')
    .in('status', ['PAID', 'FULFILLED'])
    .in('order_type', columns.orderTypes)
    .eq(columns.statusColumn, 'QUEUED')
    .order(columns.requestedColumn, { ascending: true })
    .limit(20);
  if (error) throw error;
  return data || [];
}

function roleColumns(role: string) {
  if (role === 'BREAKFAST') {
    return {
      statusColumn: 'breakfast_print_status',
      requestedColumn: 'breakfast_print_requested_at',
      printedColumn: 'breakfast_printed_at',
      errorColumn: 'breakfast_print_error',
      orderTypes: ['BREAKFAST'],
    };
  }

  if (role === 'FO') {
    return {
      statusColumn: 'fo_print_status',
      requestedColumn: 'fo_print_requested_at',
      printedColumn: 'fo_printed_at',
      errorColumn: 'fo_print_error',
      orderTypes: ['GUEST_SHOP', 'FNB'],
    };
  }

  return {
    statusColumn: 'fnb_print_status',
    requestedColumn: 'fnb_print_requested_at',
    printedColumn: 'fnb_printed_at',
    errorColumn: 'fnb_print_error',
    orderTypes: ['FNB'],
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const role = getPrinterRole(req);
    const roles = role === 'ALL' ? ['BREAKFAST', 'FNB', 'FO'] : [role];
    const maintenancePulse = role !== 'ALL' || req.headers.get('x-maintenance-pulse') === '1';
    if (maintenancePulse) {
      await recordHeartbeat(req, roles);
      await Promise.allSettled([expireUnacceptedFnbOrders(), processGuestShopOutbox({ limit: 3 })]);
    }

    if (role === 'ALL') {
      const [breakfast, fnb, fo] = await Promise.all([
        loadQueue('BREAKFAST'), loadQueue('FNB'), loadQueue('FO'),
      ]);
      return jsonNoCache({ ok: true, printer_role: 'ALL', queues: { BREAKFAST: breakfast, FNB: fnb, FO: fo } });
    }

    return jsonNoCache({ ok: true, printer_role: role, orders: await loadQueue(role) });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load print queue', orders: [] }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireManager(req);
    if (auth.error) return jsonNoCache({ ok: false, error: auth.error }, auth.status);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const status = String(body?.print_status || '').trim().toUpperCase();
    const printError = String(body?.print_error || '').trim();
    const role = getPrinterRole(req);
    if (role === 'ALL') return jsonNoCache({ ok: false, error: 'Choose a printer role when updating a ticket' }, 400);
    const columns = roleColumns(role);

    if (!id) throw new Error('Missing order id');
    if (!['PRINTED', 'FAILED', 'QUEUED'].includes(status)) throw new Error('Invalid print status');

    const updatePayload: any = {
      [columns.statusColumn]: status,
      [columns.printedColumn]: status === 'PRINTED' ? new Date().toISOString() : null,
      [columns.errorColumn]: status === 'FAILED' ? printError || 'Printer failed' : null,
    };

    if (role === 'BREAKFAST' || role === 'FNB') {
      updatePayload.print_status = status;
      updatePayload.printed_at = status === 'PRINTED' ? new Date().toISOString() : null;
      updatePayload.print_error = status === 'FAILED' ? printError || 'Printer failed' : null;
    }

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .update(updatePayload)
      .eq('id', id)
      .select(`id, ${columns.statusColumn}, ${columns.printedColumn}, ${columns.errorColumn}`)
      .single();

    if (error) throw error;

    await recordHeartbeat(req, [role]);

    return jsonNoCache({ ok: true, printer_role: role, order: data });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to update print status' }, 500);
  }
}
