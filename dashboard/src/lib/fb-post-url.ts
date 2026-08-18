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

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mobile.facebook.com',
  'fb.watch',
  'www.fb.watch',
]);

/** Normalize a Facebook post URL from Buffer into a public permalink.
 *  Non-composite URLs pass through unchanged. */
export function normalizeFacebookPostUrl(url: string): string {
  const m = url.match(COMPOSITE_RE);
  if (!m) return url;
  return `https://www.facebook.com/${m[1]}/posts/${m[2]}`;
}

export type ParsedFacebookPostUrl =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Validate an operator-pasted Facebook reel/post URL and normalize it.
 *  Accepts reel, watch, /posts/, /videos/, share, and fb.watch forms,
 *  plus Buffer's unresolvable pageid_postid composite. */
export function parseFacebookPostUrl(raw: string): ParsedFacebookPostUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Paste the Facebook reel or post link' };

  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'That does not look like a URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Need a facebook.com link' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!FACEBOOK_HOSTS.has(host)) {
    return { ok: false, error: 'Need a facebook.com (or fb.watch) link' };
  }

  return { ok: true, url: normalizeFacebookPostUrl(parsed.toString()) };
}
