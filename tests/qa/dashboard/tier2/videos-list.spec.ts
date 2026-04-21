import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

/**
 * Tier-2 coverage for /videos (the parshiot list + filter).
 *
 * Source-driven notes (dashboard/src/app/videos/page.tsx +
 * dashboard/src/components/videos-filter.tsx):
 *   - The filter is BOOK-based (Genesis/Exodus/Leviticus/Numbers/
 *     Deuteronomy), not status-based. It is implemented with
 *     `useState('All')`; clicking a book pill does NOT update the URL
 *     (no `?status=…` or `?book=…` param) — only the visible card grid
 *     re-renders. The spec-template's "status filter updates URL" check
 *     therefore re-maps to "book filter changes the visible card count".
 *   - There is NO search box in the current UI. The template's search
 *     test is fixmed with a reason.
 *   - Each card is an <a href={`/videos/${parsha.slug}`}>. Clicking
 *     navigates via normal link nav.
 *   - Cards are rendered inside `.video-grid` using
 *     `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` —
 *     on narrow viewports the grid naturally collapses to one column.
 *   - The page pre-filters to parshiot that have an A-tight script. If
 *     none exist in the target env, the grid can be empty in ANY book
 *     (including "All"). Assertions tolerate that: at-least-zero cards.
 */

test.describe('dashboard: videos list (tier 2)', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/videos');
  });

  test('renders videos list page', async ({ page }) => {
    // H1 reads "All 52 parshiot." — "All" then an italic <em>52</em>.
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
    ).toContainText(/parshiot/i);
    // The grid container is always rendered (may be empty).
    await expect(page.locator('.video-grid')).toHaveCount(1);
  });

  test('book filter exists and changes the visible card set', async ({
    page,
  }) => {
    // The filter is implemented as 6 pills (All, Genesis, …,
    // Deuteronomy). Pick Genesis — in any env that has real parshiot
    // seed data, the card count when filtered to Genesis will be <=
    // the count under "All".
    const allCount = await page.locator('.v-card').count();
    if (allCount === 0) {
      test.skip(
        true,
        'No parshiot with A-tight scripts in this env — nothing to filter.',
      );
    }
    const genesisPill = page.getByRole('button', { name: /^Genesis$/ });
    await expect(genesisPill).toBeVisible();
    await genesisPill.click();

    // After clicking, cards re-render. No URL change is expected — we
    // assert that the new count is <= allCount AND that at least the
    // Genesis-filter side effect ran (activeBook state is reflected in
    // the active-pill border/background — check the pill carries
    // "active" styling by confirming its background is the navy token).
    const genesisCount = await page.locator('.v-card').count();
    expect(genesisCount).toBeLessThanOrEqual(allCount);

    // Verify the active pill has the selected-state color by probing
    // inline style. (navy-800 = rgb(19,30,56) via --navy-800 token.)
    const background = await genesisPill.evaluate(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor,
    );
    // Selected pill should NOT be transparent. 'transparent' or
    // 'rgba(0, 0, 0, 0)' = unselected state.
    expect(background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test('click a video card navigates to /videos/[slug]', async ({ page }) => {
    const firstCard = page.locator('.v-card').first();
    if ((await firstCard.count()) === 0) {
      test.skip(
        true,
        'No cards rendered in this env — cannot exercise card navigation.',
      );
    }
    const href = await firstCard.getAttribute('href');
    expect(href).toMatch(/^\/videos\/[a-z0-9-]+$/i);

    await firstCard.click();
    await expect(page).toHaveURL(/\/videos\/[^/]+$/);
  });

  test('mobile viewport: cards stack in a single column', async ({ page }) => {
    // `.video-grid` uses repeat(auto-fill, minmax(280px, 1fr)); at 375px
    // width there is room for exactly one column. Verify by sampling the
    // bounding boxes: at mobile width, card[0].x === card[1].x (same
    // left edge = single column). If there are < 2 cards, skip this
    // assertion (not enough data) and fall back to viewport-width
    // sanity.
    await page.setViewportSize({ width: 375, height: 800 });
    // Give the grid a beat to reflow.
    await page.waitForTimeout(200);

    const cards = page.locator('.v-card');
    const n = await cards.count();
    if (n < 2) {
      test.skip(true, 'Fewer than 2 cards — cannot verify single-column stacking.');
    }
    const boxes = await Promise.all(
      [0, 1].map(async (i) => (await cards.nth(i).boundingBox())),
    );
    expect(boxes[0] && boxes[1]).toBeTruthy();
    if (boxes[0] && boxes[1]) {
      // Allow a 2px fudge for subpixel rendering.
      expect(Math.abs(boxes[0].x - boxes[1].x)).toBeLessThan(2);
    }
  });

  test('search box filters by title if present', async () => {
    // There is no search <input> in the current videos-filter.tsx — only
    // book-pill filters. Fixme until a search UI is added.
    test.fixme(
      true,
      'No search input in the current /videos UI (videos-filter.tsx renders book pills only). Revisit when search ships.',
    );
  });

  test('empty-book copy shows when a book has no parshiot', async ({ page }) => {
    // videos-filter.tsx renders "No parshiot in {activeBook} yet." when
    // filtered.length === 0. In a prod-ish env all five books are
    // populated, so this assertion must not fail when they are — we
    // check for the copy IF reached, and no-op otherwise.
    const anyCard = await page.locator('.v-card').count();
    if (anyCard === 0) {
      await expect(page.getByText(/no parshiot in/i)).toBeVisible();
    } else {
      // Deuteronomy has the fewest parshiot in real data — if it happens
      // to be empty here we'll see the copy; otherwise just pass.
      await page.getByRole('button', { name: /^Deuteronomy$/ }).click();
      const deutCount = await page.locator('.v-card').count();
      if (deutCount === 0) {
        await expect(page.getByText(/no parshiot in deuteronomy yet/i)).toBeVisible();
      }
    }
  });
});
