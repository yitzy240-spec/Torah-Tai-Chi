// website/src/lib/parsha-display.ts
//
// Display logic for double-parsha weeks (e.g. "Matot-Masei"). Seven weeks a
// year two parshiot are read together; in leap years those same pairs are read
// on separate weeks. We don't store a "combined" flag, so we DERIVE the state
// from data:
//
//   - A pair-LEAD (matot) whose PARTNER (masei) has no separate published video
//     was taught together → show the COMBINED name ("Matot-Masei" / "מטות-מסעי")
//     on the lead, in both English and Hebrew.
//   - The PARTNER is then ABSORBED into the lead: it must not appear as its own
//     catalog card, carousel card, or "next teaching" — and /videos/<partner>
//     redirects to the lead. Absorption is gated on the LEAD actually having a
//     video (a confident merge signal) so we never hide a partner in a leap
//     year where the two are genuinely separate and simply unpublished yet.
//
// All self-corrects across years with no schema change. Combined videos live at
// the LEAD slug because Hebcal maps "Matot-Masei" → matot and the pipeline keys
// the video off that parsha.

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

/** Partner slug → lead slug (reverse of the above). */
export const DOUBLE_PARSHA_LEAD: Record<string, string> = Object.fromEntries(
  Object.entries(DOUBLE_PARSHA_PARTNER).map(([lead, partner]) => [partner, lead]),
);

interface Nameable {
  slug: string;
  name: string;
  hebrewName?: string;
  videoPublishedAt?: string | null;
}

function find(all: Nameable[], slug: string | undefined): Nameable | null {
  return slug ? all.find((p) => p.slug === slug) ?? null : null;
}

/** The partner slug for a pair-lead, or null if this slug isn't a pair-lead. */
export function partnerSlugOf(slug: string): string | null {
  return DOUBLE_PARSHA_PARTNER[slug] ?? null;
}

/** True when `parsha` is the lead of a pair whose partner has no own video. */
function isCombinedLead(parsha: { slug: string }, all: Nameable[]): boolean {
  const partner = find(all, DOUBLE_PARSHA_PARTNER[parsha.slug]);
  return !!partner && !partner.videoPublishedAt;
}

/**
 * True when `parsha` is a partner that's been ABSORBED into its lead — i.e. the
 * lead has a published video and this partner does not. Absorbed partners are
 * hidden from listings/nav and their page redirects to the lead.
 */
export function isAbsorbedPartner(parsha: Nameable, all: Nameable[]): boolean {
  const leadSlug = DOUBLE_PARSHA_LEAD[parsha.slug];
  if (!leadSlug) return false;
  const lead = find(all, leadSlug);
  return !!lead && !!lead.videoPublishedAt && !parsha.videoPublishedAt;
}

/** English display name — combined ("Matot-Masei") on a combined lead. */
export function combinedParshaName(
  parsha: { slug: string; name: string },
  all: Nameable[],
): string {
  if (!isCombinedLead(parsha, all)) return parsha.name;
  const partner = find(all, DOUBLE_PARSHA_PARTNER[parsha.slug])!;
  return `${parsha.name}-${partner.name}`;
}

/** Hebrew display name — combined ("מטות-מסעי") on a combined lead. */
export function combinedHebrewName(
  parsha: { slug: string; hebrewName?: string },
  all: Nameable[],
): string {
  const own = parsha.hebrewName ?? "";
  if (!isCombinedLead(parsha as { slug: string }, all)) return own;
  const partner = find(all, DOUBLE_PARSHA_PARTNER[parsha.slug])!;
  const partnerHeb = partner.hebrewName ?? "";
  return partnerHeb ? `${own}-${partnerHeb}` : own;
}
