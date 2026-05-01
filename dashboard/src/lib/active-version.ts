/**
 * Pick the version a user is currently viewing on /videos/[slug].
 * Falls back to the latest (last in array) when no id is selected,
 * or when the selected id doesn't match any known version.
 *
 * Use for action controls (publish toggle, schedule sheets) — the
 * action should target the version the user is looking at, not
 * silently the latest.
 *
 * Display panels (captions, cost summary) should keep using `latest`
 * directly, since those summarize the canonical published version.
 */
export function pickActiveVersion<T extends { videoId: string }>(
  versions: T[],
  selectedId: string | null | undefined,
): T | null {
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  if (!selectedId) return latest;
  return versions.find(v => v.videoId === selectedId) ?? latest;
}

/**
 * Resolve the *default* version to show when the page loads without an
 * explicit `?v=` param. Priority:
 *   1. The version currently published to the website (if any).
 *   2. Otherwise, the latest version.
 *
 * After Yonah publishes v3 of Emor, opening /videos/emor (no `?v=`)
 * shows v3 — the canonical live version — not whatever drafts have
 * been generated since. He can still select newer takes via the
 * version chips, but the default mirrors what's actually on the site.
 */
export function defaultSelectedVideoId<
  T extends { videoId: string; publishedToWebsite: boolean },
>(versions: T[]): string | null {
  if (versions.length === 0) return null;
  const published = versions.find(v => v.publishedToWebsite);
  if (published) return published.videoId;
  return versions[versions.length - 1].videoId;
}

/**
 * Resolve `initialSelectedId` for /videos/[slug]: prefer an explicit
 * `?v=` query param when it matches a known version, else fall back to
 * `defaultSelectedVideoId` (which prefers the published version).
 */
export function resolveInitialSelectedId<
  T extends { videoId: string; publishedToWebsite: boolean },
>(
  versions: T[],
  requestedFromQuery: string | null | undefined,
): string {
  if (requestedFromQuery && versions.some(v => v.videoId === requestedFromQuery)) {
    return requestedFromQuery;
  }
  return defaultSelectedVideoId(versions) ?? '';
}
