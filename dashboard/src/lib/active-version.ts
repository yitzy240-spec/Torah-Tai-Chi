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
