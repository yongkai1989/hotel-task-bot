import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

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

export async function GET(req: NextRequest) {
  try {
    const orderId = String(req.nextUrl.searchParams.get('order_id') || '').trim();
    if (!orderId) return jsonNoCache({ ok: false, error: 'Missing order id' }, 400);

    const { data, error } = await supabaseAdmin
      .from('guest_shop_orders')
      .select('id, room_number, guest_name, status, payment_reference, total_myr, items_json, paid_at, created_at')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonNoCache({ ok: false, error: 'Order not found' }, 404);

    return jsonNoCache({
      ok: true,
      order: {
        id: String(data.id || ''),
        room_number: String(data.room_number || ''),
        guest_name: String(data.guest_name || ''),
        status: String(data.status || 'PENDING_PAYMENT'),
        payment_reference: String(data.payment_reference || ''),
        total_myr: Number(data.total_myr || 0),
        items_json: Array.isArray(data.items_json) ? data.items_json : [],
        paid_at: data.paid_at || null,
        created_at: data.created_at || null,
      },
    });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to load order status' }, 500);
  }
}
