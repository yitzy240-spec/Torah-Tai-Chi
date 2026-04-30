import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// API routes that authenticate via their own header (x-pipeline-secret,
// CRON_SECRET, OAuth state) and must NOT be redirected to /login by
// the session-based middleware. Without these bypasses, Modal/Vercel-
// cron/OAuth callbacks all hit a 307 to /login and the actual handler
// never runs (silent failure mode — webhook 307s for no apparent
// reason from the caller's perspective).
function isHeaderAuthedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/pipeline/') ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/api/auth/youtube/callback'
  );
}

export async function middleware(request: NextRequest) {
  if (isHeaderAuthedPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/auth/callback');
  if (!user && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
