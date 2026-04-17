import { supabaseClient } from './supabase';

export type SiteContentMap = Record<string, string>;

// Hardcoded fallbacks for graceful degradation
const FALLBACKS: SiteContentMap = {
  'home.hero.kicker': 'Weekly teachings',
  'home.hero.title': 'Where ancient wisdom meets the body.',
  'home.hero.title_em': 'meets the body.',
  'home.hero.body':
    'Torah Tai Chi fuses the weekly parsha with the internal arts — rooting, yielding, song 松 — to find the place where Jewish wisdom and the body\u2019s intelligence say the same thing.',
  'home.about.title': 'The practice between traditions.',
  'home.about.body':
    'Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week\u2019s parsha carries a teaching about character, restraint, holiness — and each of those teachings has a parallel in the body: rooting, yielding, releasing tension without collapsing structure.',
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

export async function getSiteContent(): Promise<SiteContentMap> {
  try {
    const supabase = supabaseClient();
    const { data, error } = await supabase
      .from('site_content')
      .select('key, value');

    if (error || !data) {
      return FALLBACKS;
    }

    const map: SiteContentMap = { ...FALLBACKS };
    for (const row of data) {
      if (row.key && row.value != null) {
        map[row.key] = row.value;
      }
    }
    return map;
  } catch {
    return FALLBACKS;
  }
}
