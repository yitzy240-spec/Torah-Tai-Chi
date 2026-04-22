import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kie-balance
 *
 * Proxies Kie's credit-balance endpoint so the client can poll without
 * exposing KIE_AI_API_KEY. Auth-gated on Supabase user to prevent the
 * endpoint from being publicly scrapable.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const key = process.env.KIE_AI_API_KEY;
  if (!key) return NextResponse.json({ error: 'KIE_AI_API_KEY not configured' }, { status: 500 });

  try {
    const r = await fetch('https://api.kie.ai/api/v1/chat/credit', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!r.ok) {
      return NextResponse.json({ error: `Kie ${r.status}` }, { status: 502 });
    }
    const data = await r.json();
    // Defensive field lookup. Observed shape from Kie (Apr 2026):
    //   { code: 200, msg: 'success', data: 1226.98 }
    // — `data` is a raw number, not an object. We also handle the nested
    //   `data.credits` / `data.balance` variants in case Kie changes it.
    const credits =
      (typeof data?.data === 'number' ? data.data : undefined) ??
      (data?.data?.credits as number | undefined) ??
      (data?.data?.balance as number | undefined) ??
      (data?.credits as number | undefined) ??
      (data?.balance as number | undefined) ??
      null;
    // Kie credits convert to USD at $0.005 per credit (published pricing,
    // Apr 2026). Surfaced here so the GenerateDialog can compare estimated
    // spend against balance without duplicating the conversion.
    const usdBalance = typeof credits === 'number' ? credits * 0.005 : null;
    return NextResponse.json({ credits, usdBalance, raw: data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
