import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  KIE_CREDITS_TO_USD,
  getLowBalanceThresholdUsd,
  parseKieCredits,
  usdToCredits,
} from '@/lib/kie-balance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kie-balance
 *
 * Proxies Kie's credit-balance endpoint so the client can poll without
 * exposing KIE_AI_API_KEY. Auth-gated on Supabase user to prevent the
 * endpoint from being publicly scrapable.
 *
 * Also returns the low-balance threshold (site_content
 * settings.kie_low_balance_usd → KIE_LOW_BALANCE_USD → $20) so the banner
 * and sidebar share one configurable number with the Modal pre-flight.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const key = process.env.KIE_AI_API_KEY;
  if (!key) return NextResponse.json({ error: 'KIE_AI_API_KEY not configured' }, { status: 500 });

  try {
    const [r, lowThresholdUsd] = await Promise.all([
      fetch('https://api.kie.ai/api/v1/chat/credit', {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      }),
      getLowBalanceThresholdUsd(supabase),
    ]);
    if (!r.ok) {
      return NextResponse.json({ error: `Kie ${r.status}` }, { status: 502 });
    }
    const data = await r.json();
    const credits = parseKieCredits(data);
    // Surfaced here so the GenerateDialog can compare estimated spend
    // against balance without duplicating the conversion.
    const usdBalance = typeof credits === 'number' ? credits * KIE_CREDITS_TO_USD : null;
    return NextResponse.json({
      credits,
      usdBalance,
      lowThresholdUsd,
      lowThresholdCredits: usdToCredits(lowThresholdUsd),
      raw: data,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
