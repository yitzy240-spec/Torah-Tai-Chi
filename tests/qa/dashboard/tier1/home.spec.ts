import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

// Mobile tabbar regression guard comes from commit 55f290c
// ("fix(dashboard): mobile tabbar hiding on desktop — root cause of 'can't
// scroll to bottom'"). The tabbar is controlled by `.tabbar-mobile` in
// globals.css and swaps at the 900px breakpoint.
const TABBAR_BREAKPOINT = 900;

test.describe('dashboard: home', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('renders current parsha block', async ({ page }) => {
    await page.goto('/');
    // The home page always renders a Hebrew "פרשת …" header and an English
    // parsha name heading; asserting on the English word is the most robust
    // loose check (survives translation / parsha-of-the-week rotation).
    await expect(page.locator('body')).toContainText(/parsh[ai]/i);
  });

  test('system health badge renders', async ({ page }) => {
    await page.goto('/');
    // SystemHealthStrip in dashboard/src/components/system-health.tsx exposes
    // `aria-label="System status"` on its root div — use that as the stable
    // hook. It's rendered inside a <Suspense> so we allow the default expect
    // timeout to cover the server-side health probe.
    await expect(page.getByLabel('System status')).toBeVisible();
  });

  test.fixme('empty-state when no content', async () => {
    // Not feasible in the current setup: QA tests hit the shared prod Supabase
    // project which always has real parshiot + scripts seeded. There is no
    // feature flag or query parameter to force the empty branch of the page.
    // Revisit once we have a dedicated dev Supabase project we can toggle.
  });

  test.describe('mobile-only: tabbar visible on mobile viewport', () => {
    test('tabbar is visible below the 900px breakpoint', async ({ page, viewport }) => {
      test.skip(!viewport || viewport.width >= TABBAR_BREAKPOINT, 'mobile-only test');
      await page.goto('/');
      // `.tabbar-mobile` is the regression-sensitive selector: the commit that
      // broke desktop scrolling was a display rule on exactly this class.
      await expect(page.locator('.tabbar-mobile')).toBeVisible();
    });
  });

  test.describe('desktop-only: tabbar hidden on desktop viewport', () => {
    test('tabbar is hidden at or above the 900px breakpoint', async ({ page, viewport }) => {
      test.skip(!viewport || viewport.width < TABBAR_BREAKPOINT, 'desktop-only test');
      await page.goto('/');
      await expect(page.locator('.tabbar-mobile')).toBeHidden();
    });
  });

  test('FAB is visible and has an accessible name', async ({ page }) => {
    await page.goto('/');
    // FAB in dashboard/src/components/fab.tsx renders a <button aria-label="New video">.
    // Using a loose regex keeps the test resilient if the label text evolves.
    await expect(
      page.getByRole('button', { name: /new video|create|compose|new|add/i }).first(),
    ).toBeVisible();
  });
});
