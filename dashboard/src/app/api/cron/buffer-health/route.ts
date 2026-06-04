/**
 * Daily health probe for the Buffer GraphQL API + access token.
 *
 * Why this exists: Yonah hit Buffer's 100/day rate limit twice in 3 days
 * (2026-06-02, 2026-06-03) because keystroke autosaves were silently
 * invalidating the listProfiles cache. The actual fix landed in commits
 * 731007f + 7eca088 + 5.6 (Supabase fallback cache). This cron is the
 * monitoring layer on top — if Buffer ever 4xx's our token (rate limit,
 * expired credentials, scope mismatch), Yonah gets an email instead of
 * discovering it when a real post fails.
 *
 * Triggered by Vercel Cron (see vercel.json). Pings the cheapest query
 * Buffer's GraphQL offers (viewer { id }) — 1 call per day, no impact
 * on the 100/day budget at any non-pathological cadence.
 *
 * Auth: Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server';
import { sendNotification } from '@/lib/email';

const CRON_SECRET = process.env.CRON_SECRET;
const BUFFER_GRAPHQL = 'https://api.buffer.com/graphql';

export async function GET(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'BUFFER_ACCESS_TOKEN not set' }, { status: 503 });
  }

  let status: number;
  let bodyText = '';
  let rateLimit: { remaining?: string; reset?: string } = {};
  try {
    const res = await fetch(BUFFER_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
      cache: 'no-store',
    });
    status = res.status;
    bodyText = (await res.text()).slice(0, 1000);
    rateLimit = {
      remaining: res.headers.get('x-ratelimit-remaining') ?? undefined,
      reset: res.headers.get('x-ratelimit-reset') ?? undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sendNotification({
      subject: '[Torah Tai Chi] Buffer health probe: network error',
      text: `Daily Buffer health probe could not reach https://api.buffer.com/graphql.\n\nError: ${msg}`,
      html: `<p>Daily Buffer health probe could not reach <code>https://api.buffer.com/graphql</code>.</p><pre>${msg}</pre>`,
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  // Buffer returns 200 with a data:{viewer:{id:...}} body on success.
  // Any non-2xx is operator-visible: rate limit hit (429), token revoked
  // (401), scope mismatch (403), or Buffer outage (5xx).
  if (status >= 400) {
    const resetIso = rateLimit.reset
      ? new Date(Number(rateLimit.reset) * 1000).toISOString()
      : '(no x-ratelimit-reset header)';
    const summary =
      status === 429
        ? `Buffer is rate-limiting us. Remaining: ${rateLimit.remaining ?? '?'}, resets at ${resetIso}.`
        : status === 401 || status === 403
        ? `Buffer rejected our access token (HTTP ${status}). Check Settings → Buffer and reconnect.`
        : `Buffer health probe returned HTTP ${status}.`;
    await sendNotification({
      subject: `[Torah Tai Chi] Buffer health: HTTP ${status}`,
      text: `${summary}\n\nResponse body:\n${bodyText}`,
      html: `<p>${summary}</p><pre>${bodyText.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)}</pre>`,
    });
    return NextResponse.json({ ok: false, status, rateLimit }, { status: 200 });
  }

  return NextResponse.json({ ok: true, status, rateLimit });
}
