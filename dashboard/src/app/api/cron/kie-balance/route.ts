/**
 * Daily Kie credit-balance probe.
 *
 * Why this exists: the in-app banner only helps when someone has the
 * dashboard open. On 2026-09-22 the balance ran out mid-session and five
 * renders failed in a row. This cron emails Yonah when the balance drops
 * below the low-balance threshold (site_content settings.kie_low_balance_usd
 * → KIE_LOW_BALANCE_USD → $20), so a top-up happens before a session
 * rather than during one. The Modal pipeline separately refuses to start
 * renders the balance can't cover (src/kie_balance.py).
 *
 * Triggered by Vercel Cron (see vercel.json). One Kie call per day.
 *
 * Auth: Vercel Cron sets `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server';
import { sendNotification } from '@/lib/email';
import { logEvent } from '@/lib/events';
import {
  CREDITS_PER_RENDER,
  KIE_CREDITS_TO_USD,
  getLowBalanceThresholdUsd,
  parseKieCredits,
} from '@/lib/kie-balance';
import { createServiceClient } from '@/lib/supabase/service';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.KIE_AI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'KIE_AI_API_KEY not set' }, { status: 503 });
  }

  const thresholdUsd = await getLowBalanceThresholdUsd(createServiceClient());

  let credits: number | null = null;
  try {
    const res = await fetch('https://api.kie.ai/api/v1/chat/credit', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (res.ok) credits = parseKieCredits(await res.json());
    else console.warn(`[kie-balance-cron] Kie returned HTTP ${res.status}`);
  } catch (e) {
    console.warn('[kie-balance-cron] fetch failed:', e instanceof Error ? e.message : String(e));
  }

  // A failed probe is not a low balance — don't email a false alarm. The
  // warn event leaves a trail in Diagnostics if it keeps happening.
  if (credits === null) {
    await logEvent({
      actor: 'system',
      level: 'warn',
      event: 'kie.balance_probe_failed',
      message: 'Daily Kie balance probe could not read the balance',
      details: { thresholdUsd },
    });
    return NextResponse.json({ ok: false, error: 'balance unavailable' }, { status: 502 });
  }

  const usd = credits * KIE_CREDITS_TO_USD;
  const low = usd < thresholdUsd;
  console.log(
    `[kie-balance-cron] credits=${credits} usd=${usd.toFixed(2)} threshold=${thresholdUsd} low=${low}`,
  );
  if (!low) {
    return NextResponse.json({ ok: true, credits, usd, thresholdUsd, low });
  }

  const rendersLeft = Math.floor(credits / CREDITS_PER_RENDER);
  const summary =
    `Kie balance is $${usd.toFixed(2)} (${Math.round(credits).toLocaleString()} credits), ` +
    `below the $${thresholdUsd.toFixed(2)} warning level — about ${rendersLeft} ` +
    `clip render${rendersLeft === 1 ? '' : 's'} left. Renders the balance can't cover ` +
    `will be refused before they start.`;
  await logEvent({
    actor: 'system',
    level: 'warn',
    event: 'kie.balance_low',
    message: summary,
    details: { credits, usd, thresholdUsd },
  });
  await sendNotification({
    subject: `[Torah Tai Chi] Kie balance low: $${usd.toFixed(2)}`,
    text: `${summary}\n\nTop up at https://kie.ai/billing`,
    html: `<p>${summary}</p><p><a href="https://kie.ai/billing">Top up at Kie →</a></p>`,
  });
  return NextResponse.json({ ok: true, credits, usd, thresholdUsd, low });
}
