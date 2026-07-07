// website/src/lib/parsha-display.ts
//
// Display-name logic for double-parsha weeks (e.g. "Matot-Masei"). Seven weeks
// a year two parshiot are read together; in leap years those same pairs are
// read on separate weeks. We don't store a "this video covers a double parsha"
// flag, so we DERIVE it from data: a pair-LEAD parsha whose PARTNER has no
// separate published video was taught together → show the combined name. If the
// partner has its own video (leap year, taught separately), show the plain name.
// This persists on permanent pages and self-corrects across years without a
// schema change. Combined videos always live at the LEAD slug because Hebcal
// maps "Matot-Masei" → matot and the pipeline keys the video off that parsha.

/** Lead slug → partner slug for the 7 canonical double-parsha pairs. */
export const DOUBLE_PARSHA_PARTNER: Record<string, string> = {
  vayakhel: "pekudei",
  tazria: "metzora",
  "acharei-mot": "kedoshim",
  behar: "bechukotai",
  chukat: "balak",
  matot: "masei",
  nitzavim: "vayeilech",
};

interface Nameable {
  slug: string;
  name: string;
  videoPublishedAt?: string | null;
}

/** The partner slug for a pair-lead, or null if this slug isn't a pair-lead. */
export function partnerSlugOf(slug: string): string | null {
  return DOUBLE_PARSHA_PARTNER[slug] ?? null;
}

function combined(
  parsha: { slug: string; name: string },
  partner: Nameable | null,
): string {
  if (!DOUBLE_PARSHA_PARTNER[parsha.slug]) return parsha.name;
  if (!partner) return parsha.name;
  if (partner.videoPublishedAt) return parsha.name; // taught separately
  return `${parsha.name}-${partner.name}`;
}

/**
 * Display name resolved against a full parsha list. For homepage / catalog
 * callers that already hold every parsha in memory.
 */
export function combinedParshaName(
  parsha: { slug: string; name: string },
  all: Nameable[],
): string {
  const partnerSlug = partnerSlugOf(parsha.slug);
  const partner = partnerSlug ? all.find((p) => p.slug === partnerSlug) ?? null : null;
  return combined(parsha, partner);
}

/**
 * Display name resolved against an already-fetched partner row (or null). For
 * the video detail page + its metadata, where fetching the whole catalog just
 * to read one partner would be wasteful — resolve the partner via
 * `partnerSlugOf` + a single lookup and pass it here.
 */
export function combinedNameWithPartner(
  parsha: { slug: string; name: string },
  partner: Nameable | null,
): string {
  return combined(parsha, partner);
}
