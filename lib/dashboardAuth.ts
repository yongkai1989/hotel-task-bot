import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin';

export type DashboardRole =
  | 'SUPERUSER'
  | 'MANAGER'
  | 'SUPERVISOR'
  | 'FO'
  | 'HK'
  | 'MT';

export type DashboardUser = {
  user_id: string;
  email: string;
  name: string;
  role: DashboardRole;
  can_create_task: boolean;
  can_access_chambermaid_entry: boolean;
  can_access_linen_admin: boolean;
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

    if (authError || !authUser?.id || !authUser?.email) {
      return { user: null, error: 'Invalid session' };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select(
        `
        user_id,
        email,
        name,
        role,
        can_create_task,
        can_access_chambermaid_entry,
        can_access_linen_admin
        `
      )
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (profileError) {
      return { user: null, error: profileError.message };
    }

    if (!profile) {
      return { user: null, error: 'User profile not found' };
    }

    return {
      user: {
        user_id: profile.user_id,
        email: profile.email || authUser.email,
        name: profile.name || authUser.email || 'User',
        role: profile.role as DashboardRole,
        can_create_task: profile.can_create_task ?? true,
        can_access_chambermaid_entry:
          profile.can_access_chambermaid_entry ??
          (profile.role === 'SUPERUSER' ||
            profile.role === 'MANAGER' ||
            profile.role === 'SUPERVISOR' ||
            profile.role === 'HK'),
        can_access_linen_admin:
          profile.can_access_linen_admin ??
          (profile.role === 'SUPERUSER' ||
            profile.role === 'MANAGER' ||
            profile.role === 'SUPERVISOR'),
      },
      error: null,
    };
  } catch (error: any) {
    return { user: null, error: error?.message || 'Auth error' };
  }
}
