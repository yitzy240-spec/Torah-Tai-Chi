// dashboard/src/lib/hebcal-slug.ts
//
// Pure (Next-runtime-free) parsha-name → slug resolver. Lives in its own
// module so it can be unit-tested without Node choking on next/cache,
// which hebcal.ts imports for the unstable_cache fetch wrappers.

/**
 * Collapse a Hebcal parsha title to a punctuation/case-insensitive key.
 * Why: Hebcal's titles drift across renderings — straight vs curly
 * apostrophes (`'` vs `'`), spaces vs hyphens, casing — and we previously
 * keyed HEBCAL_TO_SLUG on exact strings. That broke `Beha'alotcha`,
 * `Sh'lach`, `Re'eh`, and `Ha'Azinu` the moment Hebcal switched to U+2019
 * (incident: 2026-06-01, Today page showed Korach instead of Beha'alotcha).
 * Normalizing both sides of the lookup makes that whole class of bug
 * impossible.
 */
export function normalizeHebcalName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')  // strip combining diacritical marks (niqqud, accents)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');       // strip apostrophes, spaces, hyphens, anything non-alphanumeric
}

/**
 * Map from Hebcal's canonical parsha title → our internal slug as it
 * exists in the Supabase `parshiot` table. DO NOT invent slugs here —
 * every value MUST exactly match a row in `parshiot.slug`. The test
 * `hebcal: every HEBCAL_TO_SLUG value matches a known parshiot DB slug`
 * pins this; PARSHA_DB_SLUGS below is the authoritative list.
 *
 * Why this is critical: previously the map output `behaalotcha` while the
 * DB row was `beha-alotcha`, so the Today page's `.eq('slug', …)` lookup
 * returned null and the Card silently fell through to the next-resolvable
 * parsha. Combined with the curly-apostrophe Hebcal-title bug, that's
 * how Yonah saw "Korach · June 20" on 2026-06-01.
 */
export const HEBCAL_TO_SLUG: Record<string, string> = {
  "Bereshit":           "bereishit",
  "Noach":              "noach",
  "Lech-Lecha":         "lech-lecha",
  "Vayera":             "vayeira",
  "Chayei Sara":        "chayei-sarah",
  "Toldot":             "toldot",
  "Vayetzei":           "vayeitzei",
  "Vayishlach":         "vayishlach",
  "Vayeshev":           "vayeishev",
  "Miketz":             "mikeitz",
  "Vayigash":           "vayigash",
  "Vayechi":            "vayechi",
  "Shemot":             "shemot",
  "Vaera":              "va-eira",
  "Bo":                 "bo",
  "Beshalach":          "beshalach",
  "Yitro":              "yitro",
  "Mishpatim":          "mishpatim",
  "Terumah":            "terumah",
  "Tetzaveh":           "tetzaveh",
  "Ki Tisa":            "ki-tisa",
  "Vayakhel":           "vayakhel",
  "Pekudei":            "pekudei",
  "Vayakhel-Pekudei":   "vayakhel",
  "Vayikra":            "vayikra",
  "Tzav":               "tzav",
  "Shmini":             "shemini",
  "Tazria":             "tazria",
  "Metzora":            "metzora",
  "Tazria-Metzora":     "tazria",
  "Achrei Mot":         "acharei-mot",
  "Kedoshim":           "kedoshim",
  "Achrei Mot-Kedoshim":"acharei-mot",
  "Emor":               "emor",
  "Behar":              "behar",
  "Bechukotai":         "bechukotai",
  "Behar-Bechukotai":   "behar",
  "Bamidbar":           "bamidbar",
  "Nasso":              "naso",
  "Beha'alotcha":       "beha-alotcha",
  "Sh'lach":            "shelach",
  "Korach":             "korach",
  "Chukat":             "chukat",
  "Balak":              "balak",
  "Chukat-Balak":       "chukat",
  "Pinchas":            "pinchas",
  "Matot":              "matot",
  "Masei":              "masei",
  "Matot-Masei":        "matot",
  "Devarim":            "devarim",
  "Vaetchanan":         "va-etchanan",
  "Eikev":              "eikev",
  "Re'eh":              "re-eh",
  "Shoftim":            "shoftim",
  "Ki Teitzei":         "ki-teitzei",
  "Ki Tavo":            "ki-tavo",
  "Nitzavim":           "nitzavim",
  "Vayeilech":          "vayeilech",
  "Nitzavim-Vayeilech": "nitzavim",
  "Ha'Azinu":           "ha-azinu",
  "Vezot Haberakhah":   "v-zot-habracha",
};

/**
 * Authoritative snapshot of the `parshiot.slug` column in Supabase as of
 * 2026-06-01. Every value in HEBCAL_TO_SLUG must appear here, and a CI
 * test enforces that. If the parshiot table is ever re-seeded with new
 * slug shapes, update BOTH this set AND any HEBCAL_TO_SLUG values that
 * still point at the old shape — the test will fail loudly until both
 * are in sync.
 *
 * Holidays are intentionally omitted; they have their own resolver path.
 */
export const PARSHA_DB_SLUGS: ReadonlySet<string> = new Set([
  "bereishit", "noach", "lech-lecha", "vayeira", "chayei-sarah", "toldot",
  "vayeitzei", "vayishlach", "vayeishev", "mikeitz", "vayigash", "vayechi",
  "shemot", "va-eira", "bo", "beshalach", "yitro", "mishpatim",
  "terumah", "tetzaveh", "ki-tisa", "vayakhel", "pekudei", "vayikra",
  "tzav", "shemini", "tazria", "metzora", "acharei-mot", "kedoshim",
  "emor", "behar", "bechukotai", "bamidbar", "naso", "beha-alotcha",
  "shelach", "korach", "chukat", "balak", "pinchas", "matot", "masei",
  "devarim", "va-etchanan", "eikev", "re-eh", "shoftim", "ki-teitzei",
  "ki-tavo", "nitzavim", "vayeilech", "ha-azinu", "v-zot-habracha",
]);

/**
 * Punctuation-insensitive lookup, built once at module load from
 * HEBCAL_TO_SLUG. resolveParshaSlug() queries this; the exported
 * HEBCAL_TO_SLUG stays human-readable.
 */
const HEBCAL_TO_SLUG_NORMALIZED: Record<string, string> = Object.fromEntries(
  Object.entries(HEBCAL_TO_SLUG).map(([k, v]) => [normalizeHebcalName(k), v]),
);

/**
 * Hebcal titles we've already complained about. Prevents log spam when
 * the same upcoming-weeks fetch hits the same unmapped title repeatedly,
 * and gives tests a single surface to assert against.
 */
const unresolvedHebcalNames = new Set<string>();

/** Test/diagnostic helper — Hebcal titles we failed to map this process. */
export function getUnresolvedHebcalNames(): string[] {
  return [...unresolvedHebcalNames];
}

/** Test helper — reset the unresolved set between cases. */
export function _resetUnresolvedHebcalNamesForTest(): void {
  unresolvedHebcalNames.clear();
}

/**
 * Resolve a Hebcal parsha title (with or without the `Parashat ` prefix)
 * to our slug. Returns null on miss AND records the miss in
 * `unresolvedHebcalNames` + logs a structured error so silent
 * fall-through (the actual 2026-06-01 failure mode) can't repeat.
 */
export function resolveParshaSlug(hebcalTitle: string): string | null {
  const rawName = hebcalTitle.replace(/^Parashat\s+/, "").replace(/^Shabbat\s+/, "").trim();
  const slug = HEBCAL_TO_SLUG_NORMALIZED[normalizeHebcalName(rawName)];
  if (slug) return slug;

  if (!unresolvedHebcalNames.has(rawName)) {
    unresolvedHebcalNames.add(rawName);
    const codepoints = [...rawName].map((c) => 'U+' + c.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase()).join(' ');
    console.error(`[hebcal] Unmapped parsha title from Hebcal: ${JSON.stringify(rawName)} (${codepoints}). Add to HEBCAL_TO_SLUG.`);
  }
  return null;
}
