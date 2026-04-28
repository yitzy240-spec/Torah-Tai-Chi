import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Require an authenticated Supabase user for API route handlers.
 *
 * Usage at top of every method handler:
 *   const { user, response } = await requireAuth();
 *   if (response) return response;
 *
 * Returns either:
 *   - { user: User, response: null } — caller should proceed
 *   - { user: null, response: NextResponse(401) } — caller should `return response`
 *
 * The middleware (`dashboard/src/middleware.ts`) already 302-redirects
 * unauthenticated browser sessions to /login, but that's a soft control
 * for non-browser callers (curl, scripts, attackers). This helper makes
 * the auth check explicit at the route layer so every handler returns a
 * proper 401 JSON response when there's no session.
 */
export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null as null,
      response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }),
    };
  }
  return { user, response: null as null };
}
