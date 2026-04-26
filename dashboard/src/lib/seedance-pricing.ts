export type Resolution = '480p' | '720p' | '1080p';
export type ModelTier = 'standard' | 'fast';

// Per-second USD, from Kie.ai pricing April 18 2026
const RATES: Record<ModelTier, Partial<Record<Resolution, number>>> = {
  standard: { '480p': 0.095,  '720p': 0.205, '1080p': 0.51 },
  fast:     { '480p': 0.0775, '720p': 0.165 }, // no 1080p on Fast
};

export function estimateSeedanceCost(
  totalDurationS: number,
  resolution: Resolution,
  tier: ModelTier,
): number | null {
  const rate = RATES[tier]?.[resolution];
  if (!rate) return null;
  return Math.round(totalDurationS * rate * 100) / 100;
}

export const TIER_OPTIONS = [
  { tier: 'fast' as const,     resolution: '480p' as const, label: '480p Fast',     note: 'Cheapest — great for drafts' },
  { tier: 'standard' as const, resolution: '480p' as const, label: '480p Standard', note: 'Low-res baseline' },
  { tier: 'fast' as const,     resolution: '720p' as const, label: '720p Fast',     note: '~20% cheaper, but lip-sync gets shaky' },
  { tier: 'standard' as const, resolution: '720p' as const, label: '720p Standard', note: 'Recommended — full quality' },
  { tier: 'standard' as const, resolution: '1080p' as const, label: '1080p Standard', note: 'Hero / flagship — 2.5× cost' },
];
