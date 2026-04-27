import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Magic-link / password-reset callback. Supports both Supabase flows:
 *
 *   1. PKCE flow (?code=<pkce>): default for client-side signInWithOtp.
 *      Exchange the code for a session server-side, then redirect to `next`.
 *
 *   2. Implicit flow (#access_token=...&refresh_token=...): Supabase admin-
 *      generated links and recovery emails land here. Tokens live in the URL
 *      fragment, which the server can't read. Return a tiny HTML shim that
 *      reads the fragment client-side, calls setSession to write cookies, then
 *      redirects to `next`.
 *
 * `next` is honored from the query string and falls back to `/`. Only same-
 * origin paths are accepted (must start with `/` and not `//`).
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  // Path 1 — PKCE
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // Path 2 — Implicit flow: the fragment is only visible client-side.
  // Render a tiny shim that hydrates the session and redirects.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing in…</title></head><body style="background:#FAF4E8;color:#231B10;font:14px system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><div>Signing in…</div><script type="module">
import { createBrowserClient } from 'https://esm.sh/@supabase/ssr@latest';
const hash = new URLSearchParams(location.hash.slice(1));
const access_token = hash.get('access_token');
const refresh_token = hash.get('refresh_token');
const next = ${JSON.stringify(next)};
if (!access_token || !refresh_token) {
  location.replace('/login?error=auth');
} else {
  const sb = createBrowserClient(
    '${process.env.NEXT_PUBLIC_SUPABASE_URL}',
    '${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}',
  );
  sb.auth.setSession({ access_token, refresh_token })
    .then(({ error }) => {
      if (error) { location.replace('/login?error=auth'); return; }
      location.replace(next);
    })
    .catch(() => location.replace('/login?error=auth'));
}
</script></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
