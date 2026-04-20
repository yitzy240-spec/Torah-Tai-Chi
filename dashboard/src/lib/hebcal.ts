/**
 * Hebcal API integration — returns this week's Shabbat parsha and upcoming weeks.
 *
 * Uses the free Hebcal REST API (no auth). New York (geonameid 5128581) as default.
 * Dashboard: uses Next.js unstable_cache with 1-hour revalidation.
 */
import { unstable_cache } from 'next/cache';

export type ShabbatParsha = {
  slug: string;        // our slug, e.g. "kedoshim"
  name: string;        // English, e.g. "Kedoshim"
  hebrew: string;      // Hebrew, e.g. "קְדֹשִׁים"
  shabbatDate: string; // ISO date, e.g. "2026-04-25"
  combined?: string;   // if double-parsha, the other one's name
  holiday?: string;    // closest holiday name this week, if any
};

export const HEBCAL_TO_SLUG: Record<string, string> = {
  "Bereshit":           "bereishit",
  "Noach":              "noach",
  "Lech-Lecha":         "lech-lecha",
  "Vayera":             "vayera",
  "Chayei Sara":        "chayei-sarah",
  "Toldot":             "toldot",
  "Vayetzei":           "vayetzei",
  "Vayishlach":         "vayishlach",
  "Vayeshev":           "vayeshev",
  "Miketz":             "miketz",
  "Vayigash":           "vayigash",
  "Vayechi":            "vayechi",
  "Shemot":             "shemot",
  "Vaera":              "vaera",
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
  "Beha'alotcha":       "behaalotcha",
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
  "Vaetchanan":         "vaetchanan",
  "Eikev":              "eikev",
  "Re'eh":              "reeh",
  "Shoftim":            "shoftim",
  "Ki Teitzei":         "ki-teitzei",
  "Ki Tavo":            "ki-tavo",
  "Nitzavim":           "nitzavim",
  "Vayeilech":          "vayeilech",
  "Nitzavim-Vayeilech": "nitzavim",
  "Ha'Azinu":           "haazinu",
  "Vezot Haberakhah":   "vezot-haberachah",
};

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

async function _fetchThisWeekParsha(): Promise<ShabbatParsha | null> {
  try {
    const res = await fetch(
      "https://www.hebcal.com/shabbat?cfg=json&geonameid=5128581&m=0",
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items: HebcalItem[] = data.items ?? [];
    const parshaItem = items.find((i) => i.category === "parashat");
    if (!parshaItem) return null;
    const holidays = items.filter(
      (i) => i.category !== "parashat" && i.category !== "candles" && i.category !== "havdalah"
    );
    return parshaFromItem(parshaItem, holidays);
  } catch {
    return null;
  }
}

async function _fetchUpcomingWeeks(n: number): Promise<ShabbatParsha[]> {
  try {
    const res = await fetch(
      "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&nx=on&year=now&month=x&ss=on&mf=on&c=on&geo=none&geonameid=5128581",
      { cache: "no-store" }
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

/** Fetch this Shabbat's parsha, cached 1 hour. */
export const getThisWeekParsha = unstable_cache(
  async (): Promise<ShabbatParsha | null> => _fetchThisWeekParsha(),
  ["hebcal-this-week"],
  { revalidate: 3600 }
);

/** Fetch next n Shabbat parshiot, cached 1 hour. */
export const getUpcomingWeeks = unstable_cache(
  async (n = 6): Promise<ShabbatParsha[]> => _fetchUpcomingWeeks(n),
  ["hebcal-upcoming-weeks"],
  { revalidate: 3600 }
);
