import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const freshFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  cache: 'no-store',
});

/**
 * Service-role client for scheduled reports and operational reads that must
 * always reflect the database at send time.
 */
export const supabaseAdminFresh = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: freshFetch } }
);
