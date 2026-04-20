import { test, expect } from '@playwright/test';

// Tier 2 read-only public page. about/page.tsx renders an <h1> from
// site-content (`about.title`) + sections and a social list. Metadata is
// produced by generateMetadata() with a fallback description, so the OG
// tags should always be non-empty even if Storyblok is down.

test.describe('website: about', () => {
  test('about page renders without error', async ({ page }) => {
    await page.goto('/about');
    // h1 comes from c['about.title'] — content varies, so only require visibility.
    await expect(page.locator('h1')).toBeVisible();
    // `.about-wrap` is the <main> wrapper; presence confirms the page body rendered
    // (not the notFound/error fallback).
    await expect(page.locator('main.about-wrap')).toBeVisible();
  });

  test('metadata: title/description/og present', async ({ page }) => {
    await page.goto('/about');
    // <title> template in layout is "%s · Torah Tai Chi"; about sets title: "About".
    await expect(page).toHaveTitle(/about/i);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const meta = page.locator(`meta[property="${prop}"]`);
      await expect(meta).toHaveAttribute('content', /.+/);
    }
    // og:title specifically should contain "About" (page-scoped, not site default).
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /about/i);
  });

  test('no console errors or failed requests', async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    await page.goto('/about');
    await page.waitForLoadState('networkidle');
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });

  test('mobile viewport has no horizontal scroll', async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 600, 'mobile-only');
    await page.goto('/about');
    // 1px tolerance for subpixel rounding — matches the home.spec.ts pattern.
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  });
});
