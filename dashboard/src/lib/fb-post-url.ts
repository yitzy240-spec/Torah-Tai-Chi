// dashboard/src/lib/fb-post-url.ts
//
// Buffer's externalLink for Facebook posts is inconsistent: some weeks it
// returns a proper public URL (https://www.facebook.com/reel/<id>/), other
// weeks the raw graph composite id as a URL
// (https://facebook.com/<pageid>_<postid>), which is NOT a resolvable
// permalink — logged-out it bounces to a login wall, logged-in it shows
// "This isn't available" (Yonah, 2026-08-09, Re'eh). The composite ids are
// real; Facebook just doesn't accept that path shape. Rewriting to the
// canonical /<pageid>/posts/<postid> form redirects to the public post
// (browser-verified on the Re'eh video).

const COMPOSITE_RE =
  /^https?:\/\/(?:www\.)?facebook\.com\/(\d{6,20})_(\d{6,20})\/?$/;

/** Normalize a Facebook post URL from Buffer into a public permalink.
 *  Non-composite URLs pass through unchanged. */
export function normalizeFacebookPostUrl(url: string): string {
  const m = url.match(COMPOSITE_RE);
  if (!m) return url;
  return `https://www.facebook.com/${m[1]}/posts/${m[2]}`;
}
