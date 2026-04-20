import { NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/youtube';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Google OAuth callback. Verifies state, exchanges the auth code for
 * tokens, fetches the signed-in YouTube channel's id+title, and upserts
 * the row in oauth_tokens. On success redirects to /channels.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const error = searchParams.get('error');
  if (error) {
    return NextResponse.redirect(`${origin}/channels?yt_error=${encodeURIComponent(error)}`);
  }

  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const cookieState = request.headers.get('cookie')?.match(/(?:^|;\s*)yt_oauth_state=([^;]+)/)?.[1];
  if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
    return NextResponse.redirect(`${origin}/channels?yt_error=state_mismatch`);
  }

  try {
    const result = await exchangeCode(code, `${origin}/api/auth/youtube/callback`);
    const svc = createServiceClient();
    const now = new Date().toISOString();
    const { error: dbErr } = await svc.from('oauth_tokens').upsert({
      service: 'youtube',
      refresh_token: result.refreshToken,
      access_token: result.accessToken,
      access_token_expires_at: result.expiresAt,
      account_id: result.channelId,
      account_name: result.channelTitle,
      scopes: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly',
      ],
      connected_at: now,
      updated_at: now,
    }, { onConflict: 'service' });
    if (dbErr) throw new Error(`oauth_tokens upsert: ${dbErr.message}`);

    const res = NextResponse.redirect(`${origin}/channels?yt=connected`);
    res.cookies.delete('yt_oauth_state');
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(`${origin}/channels?yt_error=${encodeURIComponent(msg.slice(0, 200))}`);
  }
}
