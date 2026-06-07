import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

// FAB + sidebar / tabbar smoke.
//
// Source notes:
//   - dashboard/src/components/fab.tsx renders a `<button aria-label="New video">`
//     with `className="fab-btn"`. Visibility at mobile vs desktop is owned by
//     globals.css @ the 900px breakpoint (same breakpoint as .tabbar-mobile).
//   - dashboard/src/components/sidebar-nav.tsx renders the nav as:
//     * Desktop sidebar with all 14 NAV_ITEMS (Today, Calendar, Videos,
//       Parshiot, Compose, Articles, Site content, Channels, Analytics,
//       Settings, SEO defaults, Diagnostics, Messages, Help).
//     * Mobile bottom tabbar (.tabbar-mobile) with 4 primary MOBILE_ITEMS
//       (Today, Calendar, Videos, Compose) + a "More" button that opens a
//       bottom sheet (.more-sheet) exposing EVERY remaining destination.
//   Invariant: on mobile, all 14 destinations must be reachable — 4 as tabs,
//   the other 10 inside the More sheet. (Regression: the old tabbar hardcoded
//   5 items and left 9 routes — incl. /articles and /site-content — with no
//   mobile entry point at all.)
const TABBAR_BREAKPOINT = 900;

const SIDEBAR_HREFS = [
  '/',
  '/calendar',
  '/videos',
  '/parshiot',
  '/compose',
  '/articles',
  '/site-content',
  '/channels',
  '/analytics',
  '/settings',
  '/settings/seo',
  '/admin/events',
  '/admin/messages',
  '/help',
];

// The 4 destinations that live in the bottom tab bar's primary slots.
const MOBILE_TABBAR_HREFS = [
  '/',
  '/calendar',
  '/videos',
  '/compose',
];

// Everything else must be reachable via the "More" sheet.
const MORE_SHEET_HREFS = SIDEBAR_HREFS.filter((h) => !MOBILE_TABBAR_HREFS.includes(h));

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

  test('mobile More sheet exposes every non-tabbar destination', async ({ page, viewport }) => {
    test.skip(
      !viewport || viewport.width >= TABBAR_BREAKPOINT,
      'mobile-only test — the More sheet only exists with the tabbar (<900px)',
    );
    await page.goto('/');

    // Sheet starts closed.
    const sheet = page.locator('.more-sheet');
    await expect(sheet).not.toHaveClass(/open/);

    // Open it from the tab bar's "More" control.
    await page.locator('.tabbar-mobile').getByRole('button', { name: 'More' }).click();
    await expect(sheet).toHaveClass(/\bopen\b/);

    // Every destination not in the bottom tab bar must have a link in the sheet.
    for (const href of MORE_SHEET_HREFS) {
      await expect(
        sheet.locator(`a[href="${href}"]`),
        `More sheet missing link to ${href}`,
      ).toHaveCount(1);
    }
  });

  test('mobile More sheet navigates and closes on selection', async ({ page, viewport }) => {
    test.skip(
      !viewport || viewport.width >= TABBAR_BREAKPOINT,
      'mobile-only test — the More sheet only exists with the tabbar (<900px)',
    );
    await page.goto('/');
    const sheet = page.locator('.more-sheet');

    // The two routes the original bug report called out: "article posting"
    // (/articles) and "site editing" (/site-content).
    for (const href of ['/articles', '/site-content']) {
      await page.locator('.tabbar-mobile').getByRole('button', { name: 'More' }).click();
      await expect(sheet).toHaveClass(/\bopen\b/);
      await sheet.locator(`a[href="${href}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}(?:/|$)`));
      // Selecting a link closes the sheet (the link's onClick).
      await expect(sheet).not.toHaveClass(/\bopen\b/);
    }
  });
});
