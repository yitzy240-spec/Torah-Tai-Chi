/**
 * Site text — fetched from Storyblok CDN (preview token, read-only).
 * Component: "site_text"  |  Folder: site-text/
 * Returns the same key/value map the homepage, about, and footer expect.
 */

const PREVIEW_TOKEN = process.env.STORYBLOK_PREVIEW_TOKEN!;
const CDN_BASE = 'https://api.storyblok.com/v2/cdn';

export type SiteContentMap = Record<string, string>;

// Hardcoded fallbacks for graceful degradation. Every string the public
// site renders should have an entry here so the page never goes blank
// when Storyblok is empty for a given key. Yonah edits these via the
// dashboard's site-content page (which writes back to Storyblok); the
// fallbacks below are just the ship-now defaults.
const FALLBACKS: SiteContentMap = {
  // ── HOME ──────────────────────────────────────────────────────────
  'home.hero.kicker': 'Weekly teachings',
  'home.hero.title': 'Where ancient wisdom meets the body.',
  'home.hero.title_em': 'meets the body.',
  'home.hero.body':
    'Torah Tai Chi fuses Torah teaching with the internal arts \u2014 rooting, yielding, song \u2014 to find the place where Jewish wisdom and the body\u2019s intelligence say the same thing.',
  'home.cta.play_teaching_template': 'Play {parsha} teaching',
  'home.cta.play_default': 'Play this week\u2019s teaching',
  'home.cta.explore_all': 'Explore all parshiot',
  'home.video.this_week_label': 'This week:',
  'home.video.fallback_title': '~45s teaching',
  'home.divider.left_phrase': 'rooted release, not collapse',
  'home.divider.right_phrase': 'the craft compounds',
  'home.recent.heading': 'Recent teachings',
  'home.recent.cta_label': 'All 54 parshiot \u2192',
  'home.recent.empty_message': 'The first teaching drops this week.',
  'home.recent.empty_cta': 'Browse all 54 parshiot \u2192',
  'home.articles.heading': 'From the writings',
  'home.articles.cta_label': 'All articles \u2192',
  'home.about.title': 'The practice between traditions.',
  'home.about.body':
    'Torah Tai Chi lives at the intersection of Jewish wisdom and the Chinese internal arts. Each week we draw a teaching from Torah \u2014 sometimes the parsha, sometimes a holiday, sometimes an idea worth turning over \u2014 about character, restraint, holiness, and each carries a parallel in the body: rooting, yielding, releasing tension without collapsing structure.',
  // ── VIDEOS LIST ───────────────────────────────────────────────────
  'videos.kicker': 'THE TEACHINGS',
  'videos.title': 'The weekly teachings',
  'videos.subtitle':
    'Fifty-four parshiot. One cycle through the Torah, told through the body.',
  // ── VIDEO DETAIL ──────────────────────────────────────────────────
  'video_detail.back_link': '\u2190 All teachings',
  'video_detail.script.kicker': 'The teaching',
  'video_detail.script.empty': 'Script coming soon.',
  'video_detail.coming_soon_suffix': 'coming soon',
  'video_detail.more.heading_before_em': 'More ',
  'video_detail.more.heading_em': 'teachings',
  'video_detail.more.cta_label': 'All 54 parshiot \u2192',
  'video_detail.not_found.title': 'Teaching not found',
  'video_detail.not_found.cta': 'Browse all teachings \u2192',
  // ── ABOUT ─────────────────────────────────────────────────────────
  'about.title': 'Where two traditions meet the body.',
  'about.subtitle': 'A practice, not a product.',
  'about.kicker': 'About the practice',
  'about.what_is':
    'Torah Tai Chi is a weekly practice of meeting two traditions in one body. Each week\u2019s teaching from Torah carries a lesson; each Chinese internal-arts principle carries a mirror image of that lesson in the language of rooting, yielding, and release.',
  'about.why_body':
    'The body knows before the mind does. Torah Tai Chi reads the parsha through the spine, the breath, the soft-jaw moment before reaction.',
  'about.how_arrives':
    'Every week: a short teaching, and a breath to try. The teaching runs under a minute. It lands on Friday, in time for Shabbat.',
  'about.byline.name': 'A weekly teaching practice',
  'about.byline.body':
    'Each week we pair a teaching from Torah with a movement from tai chi, and let the two read each other. Sometimes the source is the parsha, sometimes a holiday, sometimes an idea worth turning over. No lecture. No performance. Just a body, a text, and a few minutes of attention.',
  'about.section.what_is.heading': 'What Torah Tai Chi is',
  'about.section.why_body.heading': 'Why the body',
  'about.section.how_arrives.heading': 'How it arrives',
  'about.section.where_to_find.heading': 'Where to find us',
  'about.next.heading': 'Keep going',
  'about.next.deck':
    'The practice lives in the weekly teachings. Start there.',
  'about.next.cta_videos': 'Watch this week\u2019s teaching',
  'about.next.cta_articles': 'Read the writings',
  'about.next.cta_contact': 'Get in touch',
  // ── CONTACT ───────────────────────────────────────────────────────
  'contact.kicker': 'Get in touch',
  'contact.title.before_em': 'Say ',
  'contact.title.em': 'hello',
  'contact.deck':
    'Questions, collaborations, or just to say hi \u2014 we read everything that lands here.',
  'contact.email_intro': 'Or email us directly at',
  // ── ARTICLES LIST ─────────────────────────────────────────────────
  'articles.kicker': 'THE WRITINGS',
  'articles.title': 'From the writings',
  'articles.subtitle':
    'Reflections on where wisdom lives in the body.',
  'articles.empty.no_articles': 'No articles published yet.',
  'articles.category.all': 'All',
  'articles.category.essay': 'Essay',
  'articles.category.teaching': 'Teaching',
  'articles.category.reflection': 'Reflection',
  // ── BOOK ──────────────────────────────────────────────────────────
  'book.kicker': 'THE BOOK',
  'book.coming_soon': 'Available soon.',
  // ── FOOTER ────────────────────────────────────────────────────────
  'footer.copyright': '\u00a9 2026 Torah Tai Chi \u00b7 torahtaichi.com',
  'footer.tagline':
    'Where ancient wisdom meets the body. A weekly practice, in under a minute.',
  'footer.heading.explore': 'Explore',
  'footer.heading.connect': 'Connect',
  'footer.label.contact_us': 'Contact us',
  'footer.contact_email': 'info@torahtaichi.com',
  // ── SHARE / WATCH-ON ──────────────────────────────────────────────
  'share.share_label': 'Share this teaching',
  'share.watch_on_label': 'Watch on',
  // ── SOCIAL URLS + HANDLES ─────────────────────────────────────────
  // Single source of truth — the nav, footer, and about page all read these.
  'social.url.tiktok': 'https://tiktok.com/@torahtaichi',
  'social.url.youtube': 'https://youtube.com/@torahtaichi',
  'social.url.instagram': 'https://instagram.com/torahtaichi',
  'social.url.facebook': 'https://facebook.com/torahtaichi',
  'social.handle.tiktok': '@torahtaichi',
  'social.handle.youtube': '@torahtaichi',
  'social.handle.instagram': '@torahtaichi',
  'social.handle.facebook': '/torahtaichi',
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
