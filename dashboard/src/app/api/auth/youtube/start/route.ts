import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { YOUTUBE_SCOPES } from '@/lib/youtube';
import { createClient } from '@/lib/supabase/server';

/**
 * Start the YouTube OAuth flow. Generates a random state token, stores it
 * in a signed httpOnly cookie, and redirects the browser to Google's
 * consent screen. The callback route verifies the returned state matches.
 *
 * Only authenticated dashboard users can start the flow.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL('/settings/youtube?error=not_configured', request.url));
  }

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/auth/youtube/callback`;
  const state = randomBytes(24).toString('hex');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  // access_type=offline + prompt=consent ensures Google returns a refresh_token
  // even if the user has previously authorized our app.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set('yt_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/auth/youtube',
    maxAge: 600,
  });
  return res;
}
