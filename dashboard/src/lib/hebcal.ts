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

export type UpcomingHoliday = {
  slug: string;        // our parshiot slug, e.g. "rosh-hashana"
  name: string;        // display name, e.g. "Rosh Hashana"
  hebrew: string;      // Hebrew name from Hebcal
  date: string;        // ISO date of first day, e.g. "2026-09-12"
};

// Hebcal calls each holiday by a specific title. We match by regex so
// "Sukkot I" / "Pesach I" / etc. fold to one slug per holiday.
const HEBCAL_HOLIDAY_PATTERNS: Array<[RegExp, string]> = [
  [/^Rosh Hashana( I)?$/,        'rosh-hashana'],
  [/^Yom Kippur$/,                'yom-kippur'],
  [/^Sukkot I$/,                  'sukkot'],
  [/^Shmini Atzeret$/,            'shemini-atzeret'],
  [/^Simchat Torah$/,             'simchat-torah'],
  [/^Chanukah: 1 Candle$/,        'chanukah'],
  [/^Tu BiShvat$/,                'tu-bishvat'],
  [/^Purim$/,                     'purim'],
  [/^Pesach I$/,                  'pesach'],
  [/^Yom HaShoah$/,               'yom-hashoah'],
  [/^Yom HaZikaron$/,             'yom-hazikaron'],
  [/^Yom HaAtzma'?ut$/,           'yom-haatzmaut'],
  [/^Lag BaOmer$/,                'lag-baomer'],
  [/^Shavuot I$/,                 'shavuot'],
  [/^Tish'?a B'?Av$/,             'tisha-bav'],
];

function holidaySlugFor(title: string): string | null {
  for (const [re, slug] of HEBCAL_HOLIDAY_PATTERNS) {
    if (re.test(title)) return slug;
  }
  return null;
}

// The slug map + punctuation-insensitive resolver lives in a Next-free
// sibling module so it can be unit-tested directly (next/cache breaks
// node --test imports).
export {
  HEBCAL_TO_SLUG,
  resolveParshaSlug,
  getUnresolvedHebcalNames,
  _resetUnresolvedHebcalNamesForTest,
} from './hebcal-slug';
import { resolveParshaSlug } from './hebcal-slug';

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
  const slug = resolveParshaSlug(item.title);
  if (!slug) return null;

  const holiday = holidays.find((h) => h.category === "holiday")?.title;

  // Hebcal's hebrew includes a leading "פרשת" prefix (sometimes with niqqud);
  // strip it so callers can render the prefix once without duplicating.
  // The \u0591-\u05C7 range covers Hebrew niqqud/cantillation marks.
  const rawHebrew = (item.hebrew ?? "").trim();
  const hebrew = rawHebrew.replace(
    /^פ[\u0591-\u05C7]*ר[\u0591-\u05C7]*ש[\u0591-\u05C7]*ת[\u0591-\u05C7]*\s+/,
    "",
  );

  return {
    slug,
    name: rawName.includes("-") ? rawName.split("-")[0].trim() : rawName,
    hebrew,
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
    if (parshaItem) {
      const holidays = items.filter(
        (i) => i.category !== "parashat" && i.category !== "candles" && i.category !== "havdalah"
      );
      return parshaFromItem(parshaItem, holidays);
    }
    // Holiday week — no parashat is read this Shabbat (e.g. Shavuot II
    // falling on Shabbat, Sukkot, Pesach I/VII, etc.). Hebcal returns
    // only the holiday items. Callers want "the parsha to highlight as
    // current/upcoming," not literally-this-week — so fall through to
    // the next upcoming parashat. Without this, the dashboard/website
    // fallback chain returns the FIRST parsha by torah order (= Bereshit),
    // which is what Yonah saw during Shavuot week 2026-05-18.
    const upcoming = await _fetchUpcomingWeeks(1);
    return upcoming[0] ?? null;
  } catch {
    return null;
  }
}

async function _fetchUpcomingWeeks(n: number): Promise<ShabbatParsha[]> {
  try {
    const res = await fetch(
      // `s=on` is the Sedrot/Parashiyot flag — without it Hebcal returns
      // candles/holidays but zero parashat entries, causing /calendar to fall
      // through to the "can't connect" empty state.
      "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&nx=on&year=now&month=x&ss=on&mf=on&c=on&s=on&geo=none&geonameid=5128581",
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
  ["hebcal-this-week-v2"],
  { revalidate: 3600 }
);

/** Fetch next n Shabbat parshiot, cached 1 hour. */
export const getUpcomingWeeks = unstable_cache(
  async (n = 6): Promise<ShabbatParsha[]> => _fetchUpcomingWeeks(n),
  ["hebcal-upcoming-weeks-v3-sedrot"],
  { revalidate: 3600 }
);

async function _fetchUpcomingHolidays(daysAhead: number): Promise<UpcomingHoliday[]> {
  try {
    const res = await fetch(
      "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&nx=on&year=now&month=x&ss=on&mf=on&c=on&s=on&geo=none&geonameid=5128581",
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items: HebcalItem[] = data.items ?? [];

    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + daysAhead * 86400000)
      .toISOString().slice(0, 10);

    const seen = new Set<string>();
    const out: UpcomingHoliday[] = [];
    for (const item of items) {
      if (item.category !== "holiday") continue;
      if (item.date < today || item.date > cutoff) continue;
      const slug = holidaySlugFor(item.title);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        slug,
        name: item.title.replace(/^Erev\s+/, ""),
        hebrew: item.hebrew ?? "",
        date: item.date,
      });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  } catch {
    return [];
  }
}

/** Fetch upcoming holidays within the next N days. Cached 1 hour. */
export const getUpcomingHolidays = unstable_cache(
  async (daysAhead = 180): Promise<UpcomingHoliday[]> => _fetchUpcomingHolidays(daysAhead),
  ["hebcal-upcoming-holidays-v1"],
  { revalidate: 3600 }
);
