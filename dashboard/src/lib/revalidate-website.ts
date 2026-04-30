/**
 * Trigger an on-demand ISR revalidation on the public website right after
 * the dashboard publishes/updates content in Storyblok. Storyblok's own
 * webhook will eventually fire too, but it has 30s-2min latency — calling
 * directly from server-side here cuts the public-facing update lag to a
 * few seconds.
 *
 * Env required (best-effort: missing env logs a warning but never throws —
 * the publish itself must not fail because revalidation didn't fire):
 *   - WEBSITE_REVALIDATE_URL  e.g. https://torahtaichi.com/api/revalidate
 *   - STORYBLOK_WEBHOOK_SECRET (already used elsewhere)
 */

const REVALIDATE_URL = process.env.WEBSITE_REVALIDATE_URL;
const SECRET = process.env.STORYBLOK_WEBHOOK_SECRET;

/**
 * Tell the public website to revalidate the page(s) corresponding to a
 * Storyblok story. The website's revalidate route maps `full_slug` to
 * the right paths (articles/, site-text/, etc).
 *
 * Returns gracefully on failure — never throws. The publish flow shouldn't
 * fail just because the public site is slow to refresh.
 */
export async function revalidateWebsite(
  fullSlug: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!REVALIDATE_URL || !SECRET) {
    console.warn(
      '[revalidate-website] WEBSITE_REVALIDATE_URL or STORYBLOK_WEBHOOK_SECRET '
      + 'not configured — skipping. Storyblok\'s own webhook (if working) '
      + 'will eventually pick this up.'
    );
    return { ok: false, error: 'env not configured' };
  }
  try {
    const res = await fetch(REVALIDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-storyblok-webhook-secret': SECRET,
      },
      body: JSON.stringify({ full_slug: fullSlug }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        `[revalidate-website] ${res.status} for ${fullSlug}: ${text.slice(0, 200)}`
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.warn(`[revalidate-website] error for ${fullSlug}: ${err}`);
    return { ok: false, error: err };
  }
}
