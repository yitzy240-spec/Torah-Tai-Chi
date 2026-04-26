import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the service-role key. Bypasses RLS so
 * server actions (like the contact form submit) can insert into tables
 * that are otherwise read-only via the anon key.
 *
 * Never import this from a client component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
