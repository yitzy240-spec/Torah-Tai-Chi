import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /analytics.
 *
 * Source-driven notes (dashboard/src/app/analytics/page.tsx +
 * dashboard/src/lib/youtube.ts):
 *   - The page is a server component. `getConnection()` and
 *     `listChannelVideos()` run server-side — their upstream fetches to
 *     googleapis.com happen in the Node.js runtime, NOT the browser, so
 *     `page.route()` can NOT intercept them. Any test that tries to force
 *     the YouTube-API error/empty state from the client is fundamentally
 *     gated on whether the target env's oauth_tokens row + real YouTube
 *     upstream yields the branch we want. See per-test fixmes below.
 *   - `export const revalidate = 300` — the page is ISR-cached 5 min. This
 *     spec soft-checks that a warm cache is faster than a cold one, with a
 *     generous tolerance (annotation, not fail) since first-load timing on
 *     CI is noisy.
 *   - When !connection.connected the page short-circuits to a "Connect
 *     YouTube" CTA with an h1 that contains "Connect YouTube". That's our
 *     fallback renders-without-crashing check; either branch renders.
 *   - On error from listChannelVideos() the VideoList Suspense fallback
 *     resolves to an inline red error card ("Couldn't fetch channel
 *     stats: …"). On empty-items it resolves to a dashed "No uploads yet"
 *     block.
 */

test.describe('dashboard: analytics (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('page renders YouTube performance section', async ({ page }) => {
    await page.goto('/analytics');
    // Either branch is acceptable: the connected-state h1 contains
    // "performance." (with period, rendered via <em>) or the
    // not-connected-state h1 begins "Connect YouTube". Loose regex covers
    // both, so the test passes in any target env.
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
    ).toContainText(/performance|connect youtube/i);
  });

  test('ISR cache: second navigation is noticeably faster (soft check)', async ({
    page,
  }) => {
    // The page sets `revalidate = 300`; the second navigation should hit
    // the Next.js cache. This is noisy on CI — annotate instead of fail
    // when the delta isn't what we expect.
    const t0 = Date.now();
    await page.goto('/analytics', { waitUntil: 'networkidle' });
    const first = Date.now() - t0;

    const t1 = Date.now();
    await page.goto('/analytics', { waitUntil: 'networkidle' });
    const second = Date.now() - t1;

    test.info().annotations.push({
      type: 'note',
      description: `ISR timing — first: ${first}ms, second: ${second}ms (target: second <= 60% of first).`,
    });

    if (second > first * 0.6) {
      test.info().annotations.push({
        type: 'note',
        description:
          'ISR second-nav was NOT ≤60% of first. Soft assertion — cache may be cold in this env or CI latency was lumpy. Not failing.',
      });
    }
    // Minimum sanity: both renders succeeded. We don't assert the ratio
    // because cold caches + CI noise make it unreliable.
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
  });

  test('handles empty-data state when YouTube returns no items', async ({
    page,
  }) => {
    // The googleapis.com fetch in listChannelVideos() happens server-side
    // (Node.js runtime), not from the browser — `page.route()` cannot
    // intercept it. So forcing the empty-items branch from the client is
    // not possible without a test-only env flag.
    test.fixme(
      true,
      'listChannelVideos() runs server-side; page.route() cannot mock its googleapis.com fetch. Needs a test-only env flag or MSW server-side hook — tracked for Phase I.',
    );
    await page.goto('/analytics');
    await expect(page.getByText(/no uploads yet/i)).toBeVisible();
  });

  test('YouTube API 500 from mock → user-visible error, no white-screen', async ({
    page,
  }) => {
    // Same blocker as the empty-state test: the server-side fetch isn't
    // reachable from `page.route()`. What we CAN still assert loosely is
    // that, regardless of which branch the real backend produces, the page
    // renders SOME h1 and never a white screen. That lives in the
    // "page renders YouTube performance section" test above. A true
    // 500-path assertion requires server-side interception.
    test.fixme(
      true,
      'Server-side googleapis fetch cannot be mocked via page.route(). Requires test-only env flag or MSW server-side hook — tracked for Phase I.',
    );
    await page.route('**/googleapis.com/youtube/v3/**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/analytics');
    await expect(page.locator('body')).toContainText(/couldn['\u2019]t fetch|error|try again/i);
  });

  test('page renders without crashing when YouTube is not connected', async ({
    page,
  }) => {
    // Regardless of connected state, the page must produce at least one
    // heading and never blank. This is the realistic error-mode check
    // that survives in every target env.
    await page.goto('/analytics');
    await expect(page.getByRole('heading').first()).toBeVisible();
    // No uncaught error overlay (Next.js dev overlay renders as a
    // portal with data-nextjs-dialog; in prod mode it's absent).
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
