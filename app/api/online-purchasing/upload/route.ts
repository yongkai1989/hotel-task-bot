import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const auth = await getDashboardUserFromRequest(req);
  const user = auth.user;
  if (!user) return errorResponse(auth.error || 'Unauthorized', 401);
  if (user.role !== 'SUPERUSER' && !user.can_access_online_purchasing) {
    return errorResponse('Online Purchasing access denied', 403);
  }

  const form = await req.formData();
  const orderId = String(form.get('order_id') || '').trim();
  const documentType = String(form.get('document_type') || '').trim().toUpperCase();
  const file = form.get('file');
  if (!orderId || !['E_INVOICE', 'PHOTO', 'REFUND_PHOTO'].includes(documentType)) {
    return errorResponse('Invalid upload details');
  }
  if (!(file instanceof File)) return errorResponse('Choose a file to upload');
  if (!ALLOWED_TYPES.has(file.type)) return errorResponse('Only PDF, JPG, PNG, and WebP files are allowed');
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return errorResponse('Each file must be 10 MB or smaller');
  if (documentType === 'E_INVOICE' && file.type !== 'application/pdf') {
    return errorResponse('The e-Invoice must be a PDF');
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('online_purchase_orders')
    .select('id,hotel_code,status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError || !order) return errorResponse(orderError?.message || 'Order not found', 404);

  const { data: assignment } = await supabaseAdmin
    .from('online_purchasing_user_access')
    .select('id')
    .eq('user_id', user.user_id)
    .eq('hotel_code', order.hotel_code)
    .eq('access_role', 'PURCHASER')
    .maybeSingle();
  if (!assignment) return errorResponse('Purchaser access for this hotel is required', 403);
  if (!['ARRIVED_INVOICE_PENDING', 'REFUND_PENDING'].includes(order.status)) {
    return errorResponse('Files cannot be added at this stage');
  }
  if (order.status === 'REFUND_PENDING' && documentType === 'E_INVOICE') {
    return errorResponse('Only supporting photos can be added during refund follow-up');
  }

  const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] || 'bin';
  const path = `${order.hotel_code}/${order.id}/${Date.now()}-${randomUUID()}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploaded = await supabaseAdmin.storage
    .from('online-purchasing-documents')
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploaded.error) return errorResponse(uploaded.error.message, 500);

  const inserted = await supabaseAdmin.from('online_purchase_documents').insert({
    order_id: order.id,
    document_type: documentType,
    storage_path: path,
    file_name: file.name.slice(0, 180),
    mime_type: file.type,
    file_size: file.size,
    uploaded_by: user.user_id,
  });
  if (inserted.error) {
    await supabaseAdmin.storage.from('online-purchasing-documents').remove([path]);
    return errorResponse(inserted.error.message, 500);
  }

  return NextResponse.json({ ok: true });
}
