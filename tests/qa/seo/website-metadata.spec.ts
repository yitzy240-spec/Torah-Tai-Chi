import { test, expect } from '@playwright/test';

const STATIC_PAGES = ['/', '/about', '/book', '/videos', '/articles'];

test.describe('website metadata', () => {
  const dynamicPaths: string[] = [];

  test.beforeAll(async ({ request }) => {
    try {
      const resp = await request.get('/sitemap.xml');
      const xml = await resp.text();
      const articleMatch = xml.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
      const videoMatch   = xml.match(/<loc>[^<]*\/videos\/([a-z0-9-]+)<\/loc>/);
      if (articleMatch) dynamicPaths.push(`/articles/${articleMatch[1]}`);
      if (videoMatch)   dynamicPaths.push(`/videos/${videoMatch[1]}`);
    } catch { /* skip dynamic */ }
  });

  for (const path of STATIC_PAGES) {
    test(`metadata complete: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(/.+/);
      for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
        await expect(page.locator(`meta[property="${prop}"]`))
          .toHaveAttribute('content', /.+/);
      }
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /.+/);
    });
  }

  test('metadata on dynamic pages', async ({ page }) => {
    test.skip(dynamicPaths.length === 0, 'No sitemap-resolved paths');
    for (const path of dynamicPaths) {
      await page.goto(path);
      await expect(page).toHaveTitle(/.+/);
      for (const prop of ['og:title', 'og:description', 'og:image']) {
        await expect(page.locator(`meta[property="${prop}"]`))
          .toHaveAttribute('content', /.+/);
      }
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /.+/);
    }
  });

  test('og:image URLs return 200', async ({ page, request }) => {
    await page.goto('/');
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    if (!ogImage) test.skip(true, 'No og:image on homepage');
    const resp = await request.get(ogImage!);
    expect(resp.status()).toBe(200);
  });
});
