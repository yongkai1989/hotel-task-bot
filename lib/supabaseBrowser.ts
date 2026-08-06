import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient() {
  const createSupabaseClient = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

  // Client Components can still be rendered on the server. Never share a
  // server-side client between requests, but reuse one client inside each
  // browser tab so auth refresh timers, session state, and Realtime transport
  // are not duplicated by the layout, sidebar, and active page.
  if (typeof window === 'undefined') return createSupabaseClient();

  if (!browserClient) browserClient = createSupabaseClient();
  return browserClient;
}
