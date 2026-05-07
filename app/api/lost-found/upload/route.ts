import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function toPermissionBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing authorization token' }, { status: 401 });
    }

    const body = await req.json();
    const image = String(body.image || '');

    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: 'Missing image' }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: profile, error: profileError } = await serviceClient
      .from('user_profiles')
      .select('role, can_access_lost_found')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const role = String(profile?.role || 'FO');
    const allowed = role === 'SUPERUSER' || (role === 'FO' && toPermissionBoolean(profile?.can_access_lost_found));

    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Lost & Found access denied' }, { status: 403 });
    }

    const base64Data = image.split(',')[1] || '';
    const buffer = Buffer.from(base64Data, 'base64');
    const path = `lost-found-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const { error: uploadError } = await serviceClient.storage
      .from('lost-found-photos')
      .upload(path, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data } = serviceClient.storage
      .from('lost-found-photos')
      .getPublicUrl(path);

    return NextResponse.json(
      { ok: true, url: data.publicUrl, path },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to upload photo' },
      { status: 500 }
    );
  }
}
