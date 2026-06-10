// Pure helpers shared by lib/buffer.ts and lib/auto-post.ts.
// Deliberately free of next/cache + Supabase imports so node:test can
// load this file directly (node --test --experimental-strip-types).

/**
 * Typed error for non-2xx Buffer GraphQL responses. The message string
 * intentionally keeps the legacy `Buffer GraphQL: HTTP <status>` shape —
 * auto-post.ts and broadcast.ts match on `includes('HTTP 429')`.
 */
export class BufferApiError extends Error {
  readonly status: number;
  /** Unix seconds when the daily rate-limit window resets (x-ratelimit-reset), if Buffer sent it. */
  readonly rateLimitReset: number | null;

  constructor(status: number, rateLimitReset: number | null) {
    super(`Buffer GraphQL: HTTP ${status}`);
    this.name = 'BufferApiError';
    this.status = status;
    this.rateLimitReset = rateLimitReset;
  }
}

/**
 * Operator-facing message for a 429. Buffer's cap is 100 requests/DAY,
 * so "wait about a minute" (the old copy) was wrong — the window resets
 * roughly 24h after it opened. Always tell Yonah when posting will work.
 */
export function formatBufferRateLimitMessage(
  resetUnixSeconds: number | null,
  nowMs: number,
): string {
  const base = "Buffer's daily request limit is used up.";
  if (!resetUnixSeconds) {
    return `${base} It resets once a day — try again tomorrow.`;
  }
  const deltaMs = resetUnixSeconds * 1000 - nowMs;
  if (deltaMs <= 0) {
    return `${base} Posting should work again shortly — try again in a few minutes.`;
  }
  const reset = new Date(resetUnixSeconds * 1000);
  const hh = String(reset.getUTCHours()).padStart(2, '0');
  const mm = String(reset.getUTCMinutes()).padStart(2, '0');
  const hours = Math.ceil(deltaMs / 3_600_000);
  const when = hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
  return `${base} Posting will work again ${when} (around ${hh}:${mm} UTC).`;
}
