import { NextRequest, NextResponse } from 'next/server';
import { getDashboardUserFromRequest } from '../../../../lib/dashboardAuth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 15;

const DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
let cached: { expiresAt: number; snapshot: any } | null = null;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await getDashboardUserFromRequest(req);
    if (!user) return response({ ok: false, error: error || 'Unauthorized' }, 401);
    if (user.role !== 'SUPERUSER') {
      return response({ ok: false, error: 'Superuser access required' }, 403);
    }

    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return response({ ok: true, ...cached.snapshot, cached: true });
    }

    const { data, error: usageError } = await supabaseAdmin.rpc('get_system_usage_snapshot');
    if (usageError) return response({ ok: false, error: usageError.message }, 500);

    const snapshot = {
      usage: data,
      limits: {
        database_bytes: DATABASE_LIMIT_BYTES,
        storage_bytes: STORAGE_LIMIT_BYTES,
        warning_percent: 75,
        critical_percent: 90,
      },
      links: {
        supabase_database: 'https://supabase.com/dashboard/project/idkwlcnqalojdhfxchiz/observability/database',
        supabase_usage: 'https://supabase.com/dashboard/project/idkwlcnqalojdhfxchiz/settings/billing/usage',
        vercel_usage: 'https://vercel.com/dashboard/usage',
      },
      note: 'Database and file storage are measured inside the app. Provider bandwidth and server execution remain authoritative in the linked Vercel and Supabase usage pages.',
    };
    cached = { expiresAt: Date.now() + CACHE_MS, snapshot };
    return response({ ok: true, ...snapshot, cached: false });
  } catch (error: any) {
    return response({ ok: false, error: error?.message || 'Unable to load system usage' }, 500);
  }
}
