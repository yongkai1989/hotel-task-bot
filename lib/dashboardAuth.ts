import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin';

export type DashboardRole = 'MANAGER' | 'FO' | 'HK' | 'MT';

export type DashboardUser = {
  email: string;
  name: string;
  role: DashboardRole;
};

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

export async function getDashboardUserFromRequest(
  req: NextRequest
): Promise<{ user: DashboardUser | null; error: string | null }> {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return { user: null, error: 'Missing authorization token' };
    }

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }
    );

    const {
      data: { user: authUser },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !authUser?.email) {
      return { user: null, error: 'Invalid session' };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('dashboard_users')
      .select('email, name, role')
      .eq('email', authUser.email)
      .single();

    if (profileError || !profile) {
      return { user: null, error: 'Dashboard user not found' };
    }

    return {
      user: {
        email: profile.email,
        name: profile.name,
        role: profile.role as DashboardRole,
      },
      error: null,
    };
  } catch (error: any) {
    return { user: null, error: error?.message || 'Auth error' };
  }
}
