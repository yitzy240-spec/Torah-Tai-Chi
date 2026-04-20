import { NextResponse } from 'next/server';
import { disconnect } from '@/lib/youtube';
import { createClient } from '@/lib/supabase/server';

/**
 * Revoke the stored YouTube refresh token at Google and delete the
 * oauth_tokens row. POST only — CSRF-safe via Supabase session cookie.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  try {
    await disconnect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/channels?yt=disconnected`, { status: 303 });
}
