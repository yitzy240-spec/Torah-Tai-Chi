// dashboard/src/lib/kie-balance.ts
//
// Shared Kie balance helpers for /api/kie-balance, the low-balance banner,
// the sidebar indicator and the daily kie-balance cron. The Modal pipeline
// mirrors the same threshold lookup in src/kie_balance.py — keep the key,
// env name and default in sync.

import type { SupabaseClient } from '@supabase/supabase-js';

/** $5 buys 1000 Kie credits. Same constant as KIE_CREDITS_TO_USD in Python. */
export const KIE_CREDITS_TO_USD = 0.005;

/**
 * Low-balance warning threshold. Operator-editable without a deploy via a
 * site_content row (the same kv store as settings.default_tier); the
 * KIE_LOW_BALANCE_USD env var is the fallback, then $20 (~7 clip renders
 * at ~$2.5-3 each on 720p standard).
 */
export const DEFAULT_LOW_BALANCE_USD = 20;
export const LOW_BALANCE_SETTING_KEY = 'settings.kie_low_balance_usd';

/** Observed cost of one 720p standard clip render (~450-530 credits). */
export const CREDITS_PER_RENDER = 500;

/**
 * Pull the credit count out of Kie's /api/v1/chat/credit response.
 * Observed shape (Apr 2026): { code: 200, msg: 'success', data: 1226.98 }
 * — `data` is a raw number. Nested credits/balance variants are accepted
 * in case Kie changes it.
 */
export function parseKieCredits(body: unknown): number | null {
  const b = body as Record<string, unknown> | null | undefined;
  const d = b?.data as Record<string, unknown> | number | null | undefined;
  const candidates: unknown[] = [
    d,
    typeof d === 'object' && d ? d.credits : undefined,
    typeof d === 'object' && d ? d.balance : undefined,
    b?.credits,
    b?.balance,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

function parseUsd(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/^\$/, '');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** site_content value → env value → $20. */
export function resolveLowBalanceUsd(
  settingValue: string | null | undefined,
  envValue: string | null | undefined,
): number {
  return parseUsd(settingValue) ?? parseUsd(envValue) ?? DEFAULT_LOW_BALANCE_USD;
}

export function usdToCredits(usd: number): number {
  return Math.round(usd / KIE_CREDITS_TO_USD);
}

/**
 * Read the threshold with whatever Supabase client the caller has. Never
 * throws — a missing row or a DB blip falls back to env / default.
 */
export async function getLowBalanceThresholdUsd(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<number> {
  let settingValue: string | null = null;
  try {
    const { data } = await supabase
      .from('site_content')
      .select('value')
      .eq('key', LOW_BALANCE_SETTING_KEY)
      .maybeSingle();
    settingValue = (data as { value?: string | null } | null)?.value ?? null;
  } catch {
    // fall through to env / default
  }
  return resolveLowBalanceUsd(settingValue, process.env.KIE_LOW_BALANCE_USD);
}
