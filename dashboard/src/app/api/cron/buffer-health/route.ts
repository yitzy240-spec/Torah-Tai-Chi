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
 * Triggered by Vercel Cron (see vercel.json). Pings the cheapest valid
 * query (account → organizations → id) — 1 call per day, no meaningful
 * impact on Buffer's request budget at any non-pathological cadence.
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
      // `viewer` was removed in Buffer's 2026 schema overhaul (returns
      // GRAPHQL_VALIDATION_FAILED / HTTP 400 — verified 2026-06-11).
      // account→organizations→id is the cheapest still-valid query.
      body: JSON.stringify({ query: '{ account { organizations { id } } }' }),
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

  // Warm refresh: re-pull the channel list once a day and write it
  // through to buffer_profiles_cache so the Supabase-first read path
  // (lib/buffer.ts, 2026-06-10 inversion) never serves a row older
  // than ~24h. Costs 1 extra Buffer call/day. If the write-through
  // fails (e.g. the table is missing again — the original sin of the
  // 2026-06-10 incident), email Yonah instead of failing silently.
  let cacheRefreshed = false;
  try {
    const { refreshProfilesCache } = await import('@/lib/buffer');
    await refreshProfilesCache(token);
    cacheRefreshed = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sendNotification({
      subject: '[Torah Tai Chi] Buffer profile cache refresh FAILED',
      text:
        `The daily warm refresh of buffer_profiles_cache failed: ${msg}\n\n` +
        `If this persists, dashboard pages will fall back to live Buffer calls ` +
        `and can burn the 100/day budget again. Check that the ` +
        `buffer_profiles_cache table exists and Buffer is reachable.`,
      html: `<p>The daily warm refresh of <code>buffer_profiles_cache</code> failed:</p><pre>${msg}</pre><p>If this persists, dashboard pages fall back to live Buffer calls and can burn the 100/day budget again.</p>`,
    });
  }

  console.log(
    `[buffer-health] ok remaining=${rateLimit.remaining ?? '?'} reset=${rateLimit.reset ?? '?'} cacheRefreshed=${cacheRefreshed}`,
  );
  return NextResponse.json({ ok: true, status, rateLimit, cacheRefreshed });
}
