import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function canUseGuestLaundry(profile: any) {
  const role = String(profile?.role || '').trim().toUpperCase();
  const email = String(profile?.email || '').trim().toLowerCase();
  return role === 'SUPERUSER' || role === 'FO' || email === 'fenny@hotelhallmark.com';
}

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonNoCache({ ok: false, error: 'Missing authorization token' }, 401);
    }

    const body = await req.json();
    const image = String(body.image || '');

    if (!image.startsWith('data:image/')) {
      return jsonNoCache({ ok: false, error: 'Missing weighing-scale image' }, 400);
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
      return jsonNoCache({ ok: false, error: 'Invalid session' }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: profile, error: profileError } = await serviceClient
      .from('user_profiles')
      .select('email, role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!canUseGuestLaundry(profile)) {
      return jsonNoCache({ ok: false, error: 'Guest Laundry access denied' }, 403);
    }

    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    const type = match?.[1] || 'image/jpeg';
    const payload = match?.[2] || image.split(',')[1] || '';

    if (!type.startsWith('image/')) {
      return jsonNoCache({ ok: false, error: 'Only image files are allowed' }, 400);
    }

    const buffer = Buffer.from(payload, 'base64');
    if (buffer.byteLength > 8 * 1024 * 1024) {
      return jsonNoCache({ ok: false, error: 'Image must be 8MB or smaller after compression' }, 400);
    }

    const path = `guest-laundry/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await serviceClient.storage
      .from('task-images')
      .upload(path, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data } = serviceClient.storage.from('task-images').getPublicUrl(path);

    return jsonNoCache({ ok: true, url: data.publicUrl, path });
  } catch (error: any) {
    return jsonNoCache(
      { ok: false, error: error?.message || 'Failed to upload weighing-scale photo' },
      500
    );
  }
}

