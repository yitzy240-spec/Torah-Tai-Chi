import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

// FAB + sidebar / tabbar smoke.
//
// Source notes:
//   - dashboard/src/components/fab.tsx renders a `<button aria-label="New video">`
//     with `className="fab-btn"`. Visibility at mobile vs desktop is owned by
//     globals.css @ the 900px breakpoint (same breakpoint as .tabbar-mobile).
//   - dashboard/src/components/sidebar-nav.tsx renders two <nav> blocks:
//     * Desktop sidebar with ~11 NAV_ITEMS (Today, Calendar, Videos, Compose,
//       Articles, Site content, Channels, Analytics, Settings, SEO defaults,
//       Help).
//     * Mobile bottom tabbar (.tabbar-mobile) with 5 MOBILE_ITEMS (Today,
//       Calendar, Videos, Channels, Analytics).
const TABBAR_BREAKPOINT = 900;

const SIDEBAR_HREFS = [
  '/',
  '/calendar',
  '/videos',
  '/compose',
  '/articles',
  '/site-content',
  '/channels',
  '/analytics',
  '/settings',
  '/settings/seo',
  '/help',
];

const MOBILE_TABBAR_HREFS = [
  '/',
  '/calendar',
  '/videos',
  '/channels',
  '/analytics',
];

test.describe('dashboard: fab + nav smoke', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test('FAB visible on mobile, not visible on desktop', async ({ page, viewport }) => {
    await page.goto('/');
    const fab = page.locator('.fab-btn');
    if (!viewport || viewport.width >= TABBAR_BREAKPOINT) {
      // Desktop: globals.css hides .fab-btn above the breakpoint.
      await expect(fab).toBeHidden();
    } else {
      await expect(fab).toBeVisible();
    }
  });

  test('sidebar-nav links all return < 400', async ({ page, request }) => {
    // NAV_ITEMS is source-pinned to SIDEBAR_HREFS above; we don't scrape the
    // DOM because .sidebar-desktop may be display:none at the current
    // viewport, and hidden <a> href attributes still need to be reachable.
    await page.goto('/');
    for (const href of SIDEBAR_HREFS) {
      const resp = await request.get(href);
      expect(resp.status(), `GET ${href}`).toBeLessThan(400);
    }
  });

  test('mobile tabbar items all navigate correctly', async ({ page, viewport }) => {
    test.skip(
      !viewport || viewport.width >= TABBAR_BREAKPOINT,
      'mobile-only test — tabbar is hidden at ≥900px',
    );
    await page.goto('/');
    for (const href of MOBILE_TABBAR_HREFS) {
      // Click the tabbar link by href within .tabbar-mobile and assert the
      // URL pathname matches. This verifies the nav is functional without
      // assuming any particular content on the target page.
      await page.locator('.tabbar-mobile').locator(`a[href="${href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href === '/' ? '/$' : href + '(?:/|$)'}`));
    }
  });
});
