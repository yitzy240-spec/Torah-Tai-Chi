// dashboard/src/lib/x-char-count.ts
//
// X (Twitter) counts characters differently from JS `String.length`, which is
// why the old `caption.length` counter under-reported and Buffer rejected
// "under-limit" tweets (Yonah 2026-07-07: counter showed 277/280 but the post
// was rejected for exceeding 280).
//
// Two rules matter for our captions:
//   1. URLs are wrapped in t.co and ALWAYS count as 23 characters, regardless
//      of their real length. "TorahTaiChi.com" (15 chars) counts as 23 → +8.
//      This was the actual bug: 277 literal chars = 285 on X.
//   2. Most characters weigh 1, but code points outside a set of "light"
//      ranges (CJK, many symbols, emoji, the ellipsis "…", bullet "•", etc.)
//      weigh 2. Basic Latin, Hebrew, and common punctuation weigh 1.
//
// This mirrors the core of twitter-text's weighted-count config without pulling
// in the dependency. It is intentionally conservative: when unsure it counts
// MORE, never fewer, so we never tell the operator a tweet fits when it doesn't.

export const X_MAX_WEIGHTED_LENGTH = 280;
const TCO_URL_LENGTH = 23;

// Code-point ranges that weigh 1 (twitter-text default config). Everything else
// weighs 2.
const WEIGHT_1_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function charWeight(codePoint: number): number {
  for (const [lo, hi] of WEIGHT_1_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 1;
  }
  return 2;
}

// http(s):// URLs, or bare domains with a common TLD (twitter-text auto-links
// these). Kept deliberately broad on the TLD side so we don't undercount.
const URL_RE =
  /(https?:\/\/\S+|(?<![\w@/.])(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|app|ai|dev|me|tv|us|uk|il)\b(?:\/\S*)?)/gi;

/** Weighted length of `text` as X counts it (URLs = 23). */
export function weightedTweetLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  const withoutUrls = text.replace(URL_RE, '');
  let weight = 0;
  for (const ch of withoutUrls) weight += charWeight(ch.codePointAt(0)!);
  return weight + urls.length * TCO_URL_LENGTH;
}

/** True when the tweet is within X's 280-weighted-character limit. */
export function isWithinXLimit(text: string): boolean {
  return weightedTweetLength(text) <= X_MAX_WEIGHTED_LENGTH;
}
