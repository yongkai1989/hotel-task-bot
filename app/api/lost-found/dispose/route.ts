import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROOF_BUCKET = 'lost-found-disposal-proofs';
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function getAuthorizedContext(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return { response: NextResponse.json({ ok: false, error: 'Missing authorization token' }, { status: 401 }) };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user?.id) {
    return { response: NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 }) };
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await serviceClient
    .from('user_profiles')
    .select('name, email, role, can_access_lost_found')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  const allowed = String(profile?.role || '') === 'SUPERUSER'
    || toPermissionBoolean(profile?.can_access_lost_found);

  if (!allowed) {
    return { response: NextResponse.json({ ok: false, error: 'Lost & Found access denied' }, { status: 403 }) };
  }

  return { serviceClient, user, profile };
}

export async function POST(req: NextRequest) {
  let uploadedPath = '';

  try {
    const context = await getAuthorizedContext(req);
    if ('response' in context) return context.response;

    const { serviceClient, user, profile } = context;
    const body = await req.json();
    const entryId = String(body.entryId || '').trim();
    const image = String(body.image || '');

    if (!entryId) {
      return NextResponse.json({ ok: false, error: 'Missing Lost & Found entry' }, { status: 400 });
    }
    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: 'Guest approval screenshot is required' }, { status: 400 });
    }

    const base64Data = image.split(',')[1] || '';
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length || buffer.length > MAX_PROOF_BYTES) {
      return NextResponse.json({ ok: false, error: 'Approval screenshot must be smaller than 5 MB' }, { status: 400 });
    }

    const { data: entry, error: entryError } = await serviceClient
      .from('lost_found_entries')
      .select('id, returned, disposed')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) throw entryError;
    if (!entry) {
      return NextResponse.json({ ok: false, error: 'Lost & Found entry was not found' }, { status: 404 });
    }
    if (entry.returned || entry.disposed) {
      return NextResponse.json({ ok: false, error: 'Only items currently in storage can be disposed' }, { status: 409 });
    }

    uploadedPath = `${entryId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await serviceClient.storage
      .from(PROOF_BUCKET)
      .upload(uploadedPath, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const actorName = String(profile?.name || profile?.email || user.email || 'Staff');
    const disposedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from('lost_found_entries')
      .update({
        disposed: true,
        disposed_at: disposedAt,
        disposed_by_user_id: user.id,
        disposed_by_name: actorName,
        disposal_proof_path: uploadedPath,
        updated_by_user_id: user.id,
        updated_by_name: actorName,
        updated_at: disposedAt,
      })
      .eq('id', entryId)
      .eq('returned', false)
      .eq('disposed', false)
      .select('id')
      .maybeSingle();

    if (updateError || !updated) {
      await serviceClient.storage.from(PROOF_BUCKET).remove([uploadedPath]);
      uploadedPath = '';
      if (updateError) throw updateError;
      return NextResponse.json({ ok: false, error: 'Item status changed before disposal could be saved' }, { status: 409 });
    }

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to dispose item' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const context = await getAuthorizedContext(req);
    if ('response' in context) return context.response;

    const entryId = String(req.nextUrl.searchParams.get('entryId') || '').trim();
    if (!entryId) {
      return NextResponse.json({ ok: false, error: 'Missing Lost & Found entry' }, { status: 400 });
    }

    const { serviceClient } = context;
    const { data: entry, error: entryError } = await serviceClient
      .from('lost_found_entries')
      .select('disposed, disposal_proof_path')
      .eq('id', entryId)
      .maybeSingle();

    if (entryError) throw entryError;
    if (!entry?.disposed || !entry.disposal_proof_path) {
      return NextResponse.json({ ok: false, error: 'Disposal proof is not available' }, { status: 404 });
    }

    const { data, error: signedUrlError } = await serviceClient.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(entry.disposal_proof_path, 120);

    if (signedUrlError) throw signedUrlError;

    return NextResponse.json(
      { ok: true, url: data.signedUrl },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to open disposal proof' },
      { status: 500 }
    );
  }
}
