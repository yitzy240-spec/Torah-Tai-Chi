/**
 * Build the public website's draft-preview URL for an article slug.
 * Server-only: reads ARTICLE_PREVIEW_TOKEN (must never reach the client bundle).
 * Returns null if the website URL or token isn't configured, or slug is empty.
 */
export function buildPreviewUrl(slug: string): string | null {
  const base = process.env.WEBSITE_BASE_URL;
  const token = process.env.ARTICLE_PREVIEW_TOKEN;
  if (!base || !token || !slug) return null;
  return `${base}/preview/${slug}?token=${encodeURIComponent(token)}`;
}
