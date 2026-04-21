import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WEBSITE_URL = process.env.WEBSITE_URL;
const STATIC_PAGES = ['/', '/about', '/book', '/videos', '/articles'];

test.describe('website a11y', () => {
  const dynamicPaths: string[] = [];

  test.beforeAll(async ({ request }) => {
    if (!WEBSITE_URL) return;
    try {
      const resp = await request.get(`${WEBSITE_URL}/sitemap.xml`);
      const xml = await resp.text();
      const articleMatch = xml.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
      const videoMatch   = xml.match(/<loc>[^<]*\/videos\/([a-z0-9-]+)<\/loc>/);
      if (articleMatch) dynamicPaths.push(`/articles/${articleMatch[1]}`);
      if (videoMatch)   dynamicPaths.push(`/videos/${videoMatch[1]}`);
    } catch { /* skip dynamic */ }
  });

  for (const path of STATIC_PAGES) {
    test(`a11y: website ${path}`, async ({ page }) => {
      test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
      await page.goto(`${WEBSITE_URL}${path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(v =>
        v.impact === 'serious' || v.impact === 'critical'
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }

  test('a11y: dynamic detail pages', async ({ page }) => {
    test.skip(!WEBSITE_URL, 'WEBSITE_URL not set');
    test.skip(dynamicPaths.length === 0, 'No sitemap-resolved paths');
    for (const path of dynamicPaths) {
      await page.goto(`${WEBSITE_URL}${path}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(v =>
        v.impact === 'serious' || v.impact === 'critical'
      );
      expect(blocking, `${path}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
    }
  });
});
