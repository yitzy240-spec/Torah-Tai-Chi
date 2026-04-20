/**
 * Site text — fetched from Storyblok CDN (preview token, read-only).
 * Component: "site_text"  |  Folder: site-text/
 * Returns the same key/value map the homepage, about, and footer expect.
 */

const PREVIEW_TOKEN = process.env.STORYBLOK_PREVIEW_TOKEN!;
const CDN_BASE = 'https://api.storyblok.com/v2/cdn';

export type SiteContentMap = Record<string, string>;

// Hardcoded fallbacks for graceful degradation
const FALLBACKS: SiteContentMap = {
  'home.hero.kicker': 'Weekly teachings',
  'home.hero.title': 'Where ancient wisdom meets the body.',
  'home.hero.title_em': 'meets the body.',
  'home.hero.body':
    'Torah Tai Chi fuses the weekly parsha with the internal arts \u2014 rooting, yielding, song \u2014 to find the place where Jewish wisdom and the body\u2019s intelligence say the same thing.',
  'home.about.title': 'The practice between traditions.',
  'home.about.body':
    'Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week\u2019s parsha carries a teaching about character, restraint, holiness \u2014 and each of those teachings has a parallel in the body: rooting, yielding, releasing tension without collapsing structure.',
  'about.title': 'Where two traditions meet the body.',
  'about.subtitle': 'A practice, not a product.',
  'about.what_is':
    'Torah Tai Chi is a weekly practice of meeting two traditions in one body. Each week\u2019s parsha carries a teaching; each Chinese internal-arts principle carries a mirror image of that teaching in the language of rooting, yielding, and release.',
  'about.why_body':
    'The body knows before the mind does. Torah Tai Chi reads the parsha through the spine, the breath, the soft-jaw moment before reaction.',
  'about.how_arrives':
    'Every week: a short teaching, and a breath to try. The teaching runs under a minute. It lands on Friday, in time for Shabbat.',
  'footer.copyright': '\u00a9 2026 Torah Tai Chi \u00b7 torahtaichi.com',
};

/**
 * Split a title around an emphasized portion so callers can render
 * `<>{before}<em>{em}</em>{after}</>`. If em is not found in title,
 * returns the whole title as before with empty em/after.
 */
export function splitEm(title: string, em: string): { before: string; em: string; after: string } {
  if (!em || !title.includes(em)) return { before: title, em: '', after: '' };
  const idx = title.indexOf(em);
  return {
    before: title.slice(0, idx),
    em,
    after: title.slice(idx + em.length),
  };
}

export async function getSiteContent(): Promise<SiteContentMap> {
  try {
    const url = new URL(`${CDN_BASE}/stories`);
    url.searchParams.set('token', PREVIEW_TOKEN);
    url.searchParams.set('starts_with', 'site-text/');
    url.searchParams.set('filter_query[component][in]', 'site_text');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('version', 'published');

    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACKS;

    const data = await res.json();
    const map: SiteContentMap = { ...FALLBACKS };
    for (const story of data.stories ?? []) {
      const key = story.content?.key;
      const value = story.content?.value;
      if (key && value != null) {
        map[key] = value;
      }
    }
    return map;
  } catch {
    return FALLBACKS;
  }
}
