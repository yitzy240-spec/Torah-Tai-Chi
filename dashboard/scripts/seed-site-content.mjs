// One-time seed: ensure every key referenced by the website's site-content
// fallback map exists in Storyblok so Yonah can edit them through the
// dashboard's site-content page.
//
// Idempotent: SKIPS keys that already exist in Storyblok. Yonah's edits
// are never overwritten — only missing rows get created.
//
// Run from repo root:
//   node dashboard/scripts/seed-site-content.mjs
//
// Reads STORYBLOK_MANAGEMENT_TOKEN + STORYBLOK_SPACE_ID from
// dashboard/.env.production.local. Uses native Node fetch (Node 18+).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Load env ─────────────────────────────────────────────────────────
// Priority: real environment variables first (so you can `export` them
// in your shell), then dashboard/.env.production.local as a fallback
// for vars that have non-empty values there.
function readEnvFile(p) {
  try {
    const text = readFileSync(p, "utf8");
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (v.length > 0) out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}
const fromFile = readEnvFile(
  path.resolve(__dirname, "..", ".env.production.local"),
);
const SPACE_ID = process.env.STORYBLOK_SPACE_ID || fromFile.STORYBLOK_SPACE_ID;
const MGMT_TOKEN =
  process.env.STORYBLOK_MANAGEMENT_TOKEN || fromFile.STORYBLOK_MANAGEMENT_TOKEN;
const PREVIEW_TOKEN =
  process.env.STORYBLOK_PREVIEW_TOKEN || fromFile.STORYBLOK_PREVIEW_TOKEN;
if (!SPACE_ID || !MGMT_TOKEN || !PREVIEW_TOKEN) {
  console.error(
    "Missing STORYBLOK_SPACE_ID / STORYBLOK_MANAGEMENT_TOKEN / STORYBLOK_PREVIEW_TOKEN.",
  );
  console.error(
    "Set them in your shell or populate dashboard/.env.production.local " +
      "(values in the Vercel-pulled file are blank for sensitive vars).",
  );
  process.exit(1);
}

const MAPI_BASE = `https://mapi.storyblok.com/v1/spaces/${SPACE_ID}`;
const CDN_BASE = "https://api.storyblok.com/v2/cdn";
const SITE_TEXT_FOLDER = "site-text";

// ── Keys to seed ─────────────────────────────────────────────────────
// Mirrors the FALLBACKS map in website/src/lib/site-content.ts. Each
// entry has a `description` shown next to the value in the dashboard
// site-content editor — this is the "where this appears" hint Yonah was
// missing.
const SEED = [
  // HOME
  ["home.cta.play_teaching_template", "Play {parsha} teaching", "Home hero CTA when this week's parsha is set. {parsha} is replaced with the parsha name."],
  ["home.cta.play_default", "Play this week\u2019s teaching", "Home hero CTA when this week's parsha isn't set yet."],
  ["home.cta.explore_all", "Explore all parshiot", "Home hero secondary link to /videos."],
  ["home.video.this_week_label", "This week:", "Home hero video tag prefix, before the parsha name."],
  ["home.video.fallback_title", "~45s teaching", "Home hero video caption when no per-parsha title exists."],
  ["home.divider.left_phrase", "rooted release, not collapse", "Home page divider, left phrase between Chinese characters."],
  ["home.divider.right_phrase", "the craft compounds", "Home page divider, right phrase between Chinese characters."],
  ["home.recent.heading", "Recent teachings", "Home page section heading for the recent videos carousel."],
  ["home.recent.cta_label", "All 54 parshiot \u2192", "Home page link to /videos next to the Recent teachings heading."],
  ["home.recent.empty_message", "The first teaching drops this week.", "Home page empty state when no teachings exist yet."],
  ["home.recent.empty_cta", "Browse all 54 parshiot \u2192", "Home page empty-state CTA."],
  ["home.articles.heading", "From the writings", "Home page section heading for the articles strip."],
  ["home.articles.cta_label", "All articles \u2192", "Home page link to /articles next to the writings heading."],
  // VIDEOS LIST
  ["videos.kicker", "THE TEACHINGS", "/videos page small caps kicker above the title."],
  ["videos.title", "The weekly teachings", "/videos page main heading."],
  ["videos.subtitle", "Fifty-four parshiot. One cycle through the Torah, told through the body.", "/videos page subtitle (italic)."],
  // VIDEO DETAIL
  ["video_detail.back_link", "\u2190 All teachings", "Top of /videos/[slug] — back link to the list."],
  ["video_detail.script.kicker", "The teaching", "Kicker above the transcript on /videos/[slug]."],
  ["video_detail.script.empty", "Script coming soon.", "Shown when a video has no transcript yet."],
  ["video_detail.coming_soon_suffix", "coming soon", "Trailing label on the video player when no mp4 yet (e.g. 'Emor · coming soon')."],
  ["video_detail.more.heading_before_em", "More ", "First half of the 'More teachings' heading at the bottom of /videos/[slug]."],
  ["video_detail.more.heading_em", "teachings", "Italic part of the 'More teachings' heading."],
  ["video_detail.more.cta_label", "All 54 parshiot \u2192", "Link to /videos in the More teachings header."],
  ["video_detail.not_found.title", "Teaching not found", "Heading when an unknown parsha slug is requested."],
  ["video_detail.not_found.cta", "Browse all teachings \u2192", "Link to /videos from the not-found state."],
  // ABOUT
  ["about.kicker", "About the practice", "/about page small kicker above the title."],
  ["about.byline.name", "A weekly teaching practice", "/about byline (the bold line in the boxed aside)."],
  ["about.byline.body", "Each week we pair a teaching from Torah with a movement from tai chi, and let the two read each other. Sometimes the source is the parsha, sometimes a holiday, sometimes an idea worth turning over. No lecture. No performance. Just a body, a text, and a few minutes of attention.", "/about byline body (the longer description in the aside)."],
  ["about.section.what_is.heading", "What Torah Tai Chi is", "/about section 1 heading."],
  ["about.section.why_body.heading", "Why the body", "/about section 2 heading."],
  ["about.section.how_arrives.heading", "How it arrives", "/about section 3 heading."],
  ["about.section.where_to_find.heading", "Where to find us", "/about social-links section heading."],
  ["about.next.heading", "Keep going", "/about bottom CTA section heading."],
  ["about.next.deck", "The practice lives in the weekly teachings. Start there.", "/about bottom CTA deck (subtitle)."],
  ["about.next.cta_videos", "Watch this week\u2019s teaching", "/about bottom CTA primary button label."],
  ["about.next.cta_articles", "Read the writings", "/about bottom CTA secondary link label (to /articles)."],
  ["about.next.cta_contact", "Get in touch", "/about bottom CTA email link label."],
  // CONTACT
  ["contact.kicker", "Get in touch", "/contact small kicker above the title."],
  ["contact.title.before_em", "Say ", "/contact title — text before the italic word."],
  ["contact.title.em", "hello", "/contact title — the italic word."],
  ["contact.deck", "Questions, collaborations, or just to say hi \u2014 we read everything that lands here.", "/contact subtitle/deck text under the title."],
  ["contact.email_intro", "Or email us directly at", "/contact line preceding the email link."],
  // ARTICLES LIST
  ["articles.kicker", "THE WRITINGS", "/articles page small caps kicker."],
  ["articles.title", "From the writings", "/articles page main heading."],
  ["articles.subtitle", "Reflections on where wisdom lives in the body.", "/articles page subtitle (italic)."],
  ["articles.empty.no_articles", "No articles published yet.", "/articles empty state when no articles exist."],
  ["articles.category.all", "All", "/articles category filter pill — All."],
  ["articles.category.essay", "Essay", "/articles category filter pill — Essay."],
  ["articles.category.teaching", "Teaching", "/articles category filter pill — Teaching."],
  ["articles.category.reflection", "Reflection", "/articles category filter pill — Reflection."],
  // BOOK
  ["book.kicker", "THE BOOK", "/book page small caps kicker."],
  ["book.coming_soon", "Available soon.", "/book page placeholder when no purchase URL is set."],
  // FOOTER
  ["footer.tagline", "Where ancient wisdom meets the body. A weekly practice, in under a minute.", "Footer tagline next to the brand mark."],
  ["footer.heading.explore", "Explore", "Footer first column heading."],
  ["footer.heading.connect", "Connect", "Footer second column heading."],
  ["footer.label.contact_us", "Contact us", "Footer Connect-column link to /contact."],
  ["footer.contact_email", "info@torahtaichi.com", "Public-facing contact email — used in footer + about page CTA."],
  // SHARE / WATCH-ON
  ["share.share_label", "Share this teaching", "Heading above the generic share buttons on /videos/[slug] (when no platform posts exist)."],
  ["share.watch_on_label", "Watch on", "Heading above the platform-direct buttons on /videos/[slug] (when posts have URLs)."],
  // SOCIAL URLS + HANDLES (single source of truth)
  ["social.url.tiktok", "https://tiktok.com/@torahtaichi", "TikTok account URL — used by nav, footer, and about page."],
  ["social.url.youtube", "https://youtube.com/@torahtaichi", "YouTube account URL."],
  ["social.url.instagram", "https://instagram.com/torahtaichi", "Instagram account URL."],
  ["social.url.facebook", "https://facebook.com/torahtaichi", "Facebook page URL."],
  ["social.handle.tiktok", "@torahtaichi", "Display handle for TikTok (shown on the about page)."],
  ["social.handle.youtube", "@torahtaichi", "Display handle for YouTube."],
  ["social.handle.instagram", "@torahtaichi", "Display handle for Instagram."],
  ["social.handle.facebook", "/torahtaichi", "Display handle for Facebook."],
];

// ── Storyblok helpers ────────────────────────────────────────────────
async function cdnExists(slug) {
  // Use draft to catch unpublished rows too — we still want to skip them.
  const url = new URL(`${CDN_BASE}/stories/site-text/${slug}`);
  url.searchParams.set("token", PREVIEW_TOKEN);
  url.searchParams.set("version", "draft");
  url.searchParams.set("cv", String(Date.now()));
  const res = await fetch(url.toString());
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`CDN GET site-text/${slug} → ${res.status}`);
  }
  return true;
}

let _folderId = null;
async function getFolderId() {
  if (_folderId) return _folderId;
  const url = new URL(`${MAPI_BASE}/stories`);
  url.searchParams.set("starts_with", SITE_TEXT_FOLDER);
  url.searchParams.set("is_folder", "1");
  url.searchParams.set("per_page", "25");
  const res = await fetch(url.toString(), {
    headers: { Authorization: MGMT_TOKEN },
  });
  if (!res.ok) {
    throw new Error(`MAPI list folders → ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  for (const s of data.stories ?? []) {
    if (s.slug === SITE_TEXT_FOLDER) {
      _folderId = s.id;
      return s.id;
    }
  }
  throw new Error(`Folder ${SITE_TEXT_FOLDER} not found in space`);
}

async function createSiteText(key, value, description) {
  const slug = key.replace(/\./g, "-");
  const folderId = await getFolderId();
  const body = {
    story: {
      name: key,
      slug,
      parent_id: folderId,
      content: {
        component: "site_text",
        key,
        value,
        description: description ?? "",
      },
    },
    publish: 1,
  };
  const res = await fetch(`${MAPI_BASE}/stories/`, {
    method: "POST",
    headers: {
      Authorization: MGMT_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST story ${key} → ${res.status} ${await res.text()}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [key, value, description] of SEED) {
    const slug = key.replace(/\./g, "-");
    try {
      const exists = await cdnExists(slug);
      if (exists) {
        skipped++;
        continue;
      }
      await createSiteText(key, value, description);
      console.log(`  + ${key}`);
      created++;
      // Small delay so we don't hammer Storyblok rate limits.
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      console.error(`  ! ${key}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped (already existed), ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
