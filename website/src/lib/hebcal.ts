/**
 * Hebcal API integration — returns this week's Shabbat parsha and upcoming weeks.
 *
 * Uses the free Hebcal REST API (no auth). New York (geonameid 5128581) as default.
 * At build time Next.js static export handles caching automatically.
 */

export type ShabbatParsha = {
  slug: string;        // our slug, e.g. "kedoshim"
  name: string;        // English, e.g. "Kedoshim"
  hebrew: string;      // Hebrew, e.g. "קְדֹשִׁים"
  shabbatDate: string; // ISO date, e.g. "2026-04-25"
  combined?: string;   // if double-parsha, the other one's name
  holiday?: string;    // closest holiday name this week, if any
};

// Maps Hebcal English parsha names → our URL slugs.
// Combined parshiot like "Tazria-Metzora" are handled by splitting at "-" and mapping each half.
export const HEBCAL_TO_SLUG: Record<string, string> = {
  "Bereshit":        "bereishit",
  "Noach":           "noach",
  "Lech-Lecha":      "lech-lecha",
  "Vayera":          "vayera",
  "Chayei Sara":     "chayei-sarah",
  "Toldot":          "toldot",
  "Vayetzei":        "vayetzei",
  "Vayishlach":      "vayishlach",
  "Vayeshev":        "vayeshev",
  "Miketz":          "miketz",
  "Vayigash":        "vayigash",
  "Vayechi":         "vayechi",
  "Shemot":          "shemot",
  "Vaera":           "vaera",
  "Bo":              "bo",
  "Beshalach":       "beshalach",
  "Yitro":           "yitro",
  "Mishpatim":       "mishpatim",
  "Terumah":         "terumah",
  "Tetzaveh":        "tetzaveh",
  "Ki Tisa":         "ki-tisa",
  "Vayakhel":        "vayakhel",
  "Pekudei":         "pekudei",
  "Vayakhel-Pekudei": "vayakhel", // combined → first
  "Vayikra":         "vayikra",
  "Tzav":            "tzav",
  "Shmini":          "shemini",
  "Tazria":          "tazria",
  "Metzora":         "metzora",
  "Tazria-Metzora":  "tazria",    // combined → first
  "Achrei Mot":      "acharei-mot",
  "Kedoshim":        "kedoshim",
  "Achrei Mot-Kedoshim": "acharei-mot", // combined → first
  "Emor":            "emor",
  "Behar":           "behar",
  "Bechukotai":      "bechukotai",
  "Behar-Bechukotai": "behar",   // combined → first
  "Bamidbar":        "bamidbar",
  "Nasso":           "naso",
  "Beha'alotcha":    "behaalotcha",
  "Sh'lach":         "shelach",
  "Korach":          "korach",
  "Chukat":          "chukat",
  "Balak":           "balak",
  "Chukat-Balak":    "chukat",   // combined → first
  "Pinchas":         "pinchas",
  "Matot":           "matot",
  "Masei":           "masei",
  "Matot-Masei":     "matot",    // combined → first
  "Devarim":         "devarim",
  "Vaetchanan":      "vaetchanan",
  "Eikev":           "eikev",
  "Re'eh":           "reeh",
  "Shoftim":         "shoftim",
  "Ki Teitzei":      "ki-teitzei",
  "Ki Tavo":         "ki-tavo",
  "Nitzavim":        "nitzavim",
  "Vayeilech":       "vayeilech",
  "Nitzavim-Vayeilech": "nitzavim", // combined → first
  "Ha'Azinu":        "haazinu",
  "Vezot Haberakhah": "vezot-haberachah",
};

/** Extract combined partner name from a Hebcal parsha title, e.g. "Tazria-Metzora" → "Metzora" */
function combinedPartner(title: string): string | undefined {
  if (!title.includes("-")) return undefined;
  const parts = title.split("-");
  return parts.slice(1).join("-").trim() || undefined;
}

interface HebcalItem {
  category: string;
  title: string;
  hebrew?: string;
  date: string;
}

function parshaFromItem(item: HebcalItem, holidays: HebcalItem[]): ShabbatParsha | null {
  // Strip "Parashat " prefix
  const rawName = item.title.replace(/^Parashat\s+/, "").replace(/^Shabbat\s+/, "").trim();
  const slug = HEBCAL_TO_SLUG[rawName];
  if (!slug) return null;

  const holiday = holidays.find((h) => h.category === "holiday")?.title;

  return {
    slug,
    name: rawName.includes("-") ? rawName.split("-")[0].trim() : rawName,
    hebrew: item.hebrew ?? "",
    shabbatDate: item.date,
    combined: combinedPartner(rawName),
    holiday,
  };
}

/** Fetch this Shabbat's parsha from Hebcal. Returns null on any failure.
 *  When this Shabbat is a holiday (e.g. Shavuot II, Sukkot, Pesach I/VII)
 *  Hebcal returns no parashat entry — fall through to the next upcoming
 *  parashat so callers don't fall back to "first parsha by torah order"
 *  (= Bereshit) and display the wrong week. */
export async function getThisWeekParsha(): Promise<ShabbatParsha | null> {
  try {
    const res = await fetch(
      "https://www.hebcal.com/shabbat?cfg=json&geonameid=5128581&m=0",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items: HebcalItem[] = data.items ?? [];
    const parshaItem = items.find((i) => i.category === "parashat");
    if (parshaItem) {
      const holidays = items.filter((i) => i.category !== "parashat" && i.category !== "candles" && i.category !== "havdalah");
      return parshaFromItem(parshaItem, holidays);
    }
    // Holiday week — defer to the year-view endpoint to find the next
    // upcoming parashat. This is what the dashboard does too; both
    // surfaces want "the parsha to highlight," not literally-this-week.
    const upcoming = await getUpcomingWeeks(1);
    return upcoming[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch the next `n` Shabbat parshiot from Hebcal's year-view endpoint. */
export async function getUpcomingWeeks(n = 6): Promise<ShabbatParsha[]> {
  try {
    const res = await fetch(
      // `s=on` is the Sedrot/Parashiyot flag — without it Hebcal returns
      // candles/holidays but zero parashat entries (mirrors the dashboard
      // fix in commit f8ecace area). Without this the holiday-fallthrough
      // path above silently returns null and we fall back to Bereshit.
      "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&nx=on&year=now&month=x&ss=on&mf=on&c=on&s=on&geo=none&geonameid=5128581",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items: HebcalItem[] = data.items ?? [];

    const today = new Date().toISOString().slice(0, 10);
    const parshiot = items.filter(
      (i) => i.category === "parashat" && i.date >= today
    );
    const holidays = items.filter((i) => i.category !== "parashat");

    const results: ShabbatParsha[] = [];
    for (const p of parshiot) {
      // Find any holiday within 6 days of this Shabbat
      const shabbatDate = new Date(p.date);
      const nearby = holidays.filter((h) => {
        const hd = new Date(h.date);
        const diff = Math.abs(hd.getTime() - shabbatDate.getTime()) / 86400000;
        return diff <= 6;
      });
      const parsed = parshaFromItem(p, nearby);
      if (parsed) results.push(parsed);
      if (results.length >= n) break;
    }
    return results;
  } catch {
    return [];
  }
}
