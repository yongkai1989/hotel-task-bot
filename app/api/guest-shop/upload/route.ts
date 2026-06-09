import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function canFullManageGuestShop(profile: any) {
  const role = String(profile?.role || '').trim().toUpperCase();
  const email = normalizeEmail(profile?.email);

  return (
    role === 'SUPERUSER' ||
    email === 'fenny@hotelhallmark.com'
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonNoCache({ ok: false, error: 'Missing authorization token' }, 401);
    }

    const body = await req.json();
    const image = String(body?.image || '');

    if (!image.startsWith('data:image/')) {
      return jsonNoCache({ ok: false, error: 'Missing SKU image' }, 400);
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
      .or(`user_id.eq.${user.id},email.eq.${normalizeEmail(user.email)}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!canFullManageGuestShop(profile)) {
      return jsonNoCache({ ok: false, error: 'Guest Shop Admin access denied' }, 403);
    }

    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match?.[1] || 'image/jpeg';
    const payload = match?.[2] || image.split(',')[1] || '';

    if (!mimeType.startsWith('image/')) {
      return jsonNoCache({ ok: false, error: 'Only image files are allowed' }, 400);
    }

    const buffer = Buffer.from(payload, 'base64');
    if (buffer.byteLength > 8 * 1024 * 1024) {
      return jsonNoCache({ ok: false, error: 'Image must be 8MB or smaller after compression' }, 400);
    }

    const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `guest-shop/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const { error: uploadError } = await serviceClient.storage
      .from('task-images')
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data } = serviceClient.storage.from('task-images').getPublicUrl(path);

    return jsonNoCache({ ok: true, url: data.publicUrl, path });
  } catch (error: any) {
    return jsonNoCache({ ok: false, error: error?.message || 'Failed to upload SKU image' }, 500);
  }
}
