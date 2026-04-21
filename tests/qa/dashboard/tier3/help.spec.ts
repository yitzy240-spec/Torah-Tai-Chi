import { test, expect } from '@playwright/test';
import { installApiMocks } from '../../fixtures/mocks';

// Tier 3 smoke: every help page must render an h1, return <500, and emit no
// console errors. Parameterized across the dashboard/src/app/help/ tree.
const HELP_PAGES = [
  '/help',
  '/help/edit-homepage',
  '/help/generate-video',
  '/help/publish-article',
  '/help/schedule-posts',
  '/help/stance',
  '/help/troubleshooting',
];

test.describe('dashboard: help pages', () => {
  for (const path of HELP_PAGES) {
    test(`${path} loads without error`, async ({ page }) => {
      await installApiMocks(page);
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      const resp = await page.goto(path);
      expect(resp?.status()).toBeLessThan(500);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([]);
    });
  }
});
