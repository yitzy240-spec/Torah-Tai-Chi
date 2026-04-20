import { test, expect, request as playwrightRequest } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const PROTECTED_PAGES = [
  '/', '/compose', '/channels', '/calendar', '/analytics',
  '/videos', '/articles', '/settings', '/site-content',
];
const PROTECTED_API: Array<[string, string]> = [
  ['GET',   '/api/articles'],
  ['POST',  '/api/articles'],
  ['POST',  '/api/compose/generate-image'],
  ['POST',  '/api/compose/upload'],
  ['GET',   '/api/site-content'],
  ['PUT',   '/api/settings/seo'],  // PUT per discovery in C.8
  ['POST',  '/api/cron/reconcile-posts'],
];

test.describe('unauth dashboard pages redirect to /login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const p of PROTECTED_PAGES) {
    test(`${p} → /login`, async ({ page }) => {
      test.skip(!DASHBOARD_URL, 'DASHBOARD_URL not set');
      await page.goto(`${DASHBOARD_URL}${p}`);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('unauth API rejections', () => {
  for (const [method, pathname] of PROTECTED_API) {
    test(`${method} ${pathname}`, async () => {
      test.skip(!DASHBOARD_URL, 'DASHBOARD_URL not set');
      const ctx = await playwrightRequest.newContext();
      const res = await ctx.fetch(`${DASHBOARD_URL}${pathname}`, { method });
      // Accept 401/403 (rejected), 302/307 (middleware redirect to /login as HTML),
      // or 404 (route doesn't exist — fine, not exploitable).
      expect([401, 403, 302, 307, 404]).toContain(res.status());
      // Hard fail only on an actual success status.
      expect(res.status(), `${method} ${pathname} returned ${res.status()} without auth — potential leak`).not.toBe(200);
      expect(res.status()).not.toBe(201);
    });
  }
});
