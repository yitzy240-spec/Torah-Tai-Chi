import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApiMocks } from '../fixtures/mocks';

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const PAGES = [
  '/', '/compose', '/channels', '/calendar', '/analytics',
  '/videos', '/articles', '/settings', '/site-content',
];

for (const path of PAGES) {
  test(`a11y: dashboard ${path}`, async ({ page }) => {
    test.skip(!DASHBOARD_URL, 'DASHBOARD_URL not set');
    await installApiMocks(page);
    await page.goto(`${DASHBOARD_URL}${path}`);
    // Wait for main content to appear so axe scans a stable page.
    await page.waitForLoadState('networkidle').catch(() => { /* ignore */ });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(v =>
      v.impact === 'serious' || v.impact === 'critical'
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
