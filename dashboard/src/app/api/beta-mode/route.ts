// Beta mode toggle. Sets (or clears) the vp2 cookie that the
// /videos/[slug] dispatcher reads to decide which page to serve.
//
// Without the cookie, every router.push in the new page that builds
// /videos/<slug>?phase=N would drop the operator's mode and the
// dispatcher would fall back to the (off-in-prod) flag, kicking
// the user back to legacy mid-flow. The cookie persists the choice
// across navigations transparently — no per-link param threading.
//
// Usage:
//   GET /api/beta-mode?mode=on&to=/videos/naso?phase=2
//   GET /api/beta-mode?mode=off&to=/videos/naso

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const COOKIE = 'vp2';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode');
  const to = url.searchParams.get('to') ?? '/';

  // Only allow same-origin redirects — prevent open-redirect to external URLs.
  const safeTo = to.startsWith('/') && !to.startsWith('//') ? to : '/';

  const res = NextResponse.redirect(new URL(safeTo, req.url));

  if (mode === 'on') {
    res.cookies.set({
      name: COOKIE,
      value: '1',
      path: '/',
      sameSite: 'lax',
      // 7 days — long enough for Yonah's testing window, short enough that
      // a stale cookie doesn't pin people to beta after we flip the flag.
      maxAge: 60 * 60 * 24 * 7,
    });
  } else if (mode === 'off') {
    res.cookies.set({
      name: COOKIE,
      value: '0',
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
  } else {
    res.cookies.delete(COOKIE);
  }

  return res;
}
