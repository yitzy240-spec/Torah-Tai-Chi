/**
 * Duplicate-post guard helpers.
 *
 * Oct 28 2026: Vayeira TikTok was sent to Buffer three times within ~2
 * minutes after double/triple clicks (and/or retries) on the dashboard
 * post flow. These helpers decide whether an existing posts-row should
 * block a new attempt for the same video+platform.
 *
 * Blocking statuses: pending | scheduled | published.
 * failed does NOT block — operators need to retry after a Buffer/YouTube
 * failure.
 *
 * No unique DB constraint: we refuse in application code using the
 * existing posts table. A true simultaneous race can still slip through
 * without a unique index; sequential double-clicks (the observed bug)
 * are covered.
 */

export const BLOCKING_POST_STATUSES = ['pending', 'scheduled', 'published'] as const;

export type BlockingPostStatus = (typeof BLOCKING_POST_STATUSES)[number];

export function isBlockingPostStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (BLOCKING_POST_STATUSES as readonly string[]).includes(status);
}

/** Pick the newest blocking row from a list of posts for one platform. */
export function findBlockingPost<T extends { status: string; created_at?: string }>(
  posts: readonly T[],
): T | undefined {
  const blocking = posts.filter((p) => isBlockingPostStatus(p.status));
  if (blocking.length === 0) return undefined;
  return [...blocking].sort((a, b) => {
    const aAt = a.created_at ?? '';
    const bAt = b.created_at ?? '';
    return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
  })[0];
}

export function duplicatePostMessage(platform: string, status: string): string {
  return `Already have a ${platform} post for this video (status: ${status}) — refusing duplicate`;
}
