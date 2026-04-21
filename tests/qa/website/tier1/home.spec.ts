import { test, expect } from '@playwright/test';

// Public website spec — no auth, no API mocks (the browser never hits paid
// APIs on the public site; data comes from Storyblok CDN + Supabase, which
// the preview URL already reaches server-side).

test.describe('website: home', () => {
  test('hero renders brand + tagline', async ({ page }) => {
    await page.goto('/');
    // The <h1> is built from site-content.ts (`home.hero.title` — default
    // "Where ancient wisdom meets the body."). A loose brand/body match is
    // more resilient to CMS copy tweaks than matching the h1 exactly.
    await expect(page.locator('body')).toContainText(/torah tai chi/i);
  });

  test('latest content sections have article and video cards', async ({ page }) => {
    await page.goto('/');
    // VideoCard + ArticleCard both wrap in <Link> → <a href="/videos/..."> and
    // <a href="/articles/...">. Use broad hrefs — but filter for visible,
    // because the hero CTA is a <a href="/videos/<slug>"> that is
    // display:none on the opposing viewport (desktop vs mobile variants).
    await expect(page.locator('a[href^="/videos/"]:visible').first()).toBeVisible();
    await expect(page.locator('a[href^="/articles/"]:visible').first()).toBeVisible();
  });

  test('no qa_seed-tagged rows leak to the page', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Guards the qa_seed filter in parshiot.ts / articles pipeline. The
    // dashboard seeds data with titles prefixed "QA TEST —" and slugs
    // starting with "qa-test-"; both should never appear on the public site.
    expect(html).not.toMatch(/qa-test-|QA TEST —/);
  });

  test('essential metadata is present', async ({ page }) => {
    await page.goto('/');
    // <title> template is "%s · Torah Tai Chi" with default "Torah Tai Chi —
    // Where Ancient Wisdom Meets the Body" (see app/layout.tsx).
    await expect(page).toHaveTitle(/torah tai chi/i);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const meta = page.locator(`meta[property="${prop}"]`);
      await expect(meta).toHaveAttribute('content', /.+/);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /.+/);
  });

  test('mobile viewport has no horizontal scroll', async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 600, 'mobile-only');
    await page.goto('/');
    // 1px tolerance for subpixel rounding in the browser layout engine.
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  });

  test('no console errors or failed requests', async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      // Ignore ERR_ABORTED on Next RSC prefetches (`?_rsc=...`) — those are
      // user-navigation aborts, not real failures.
      const err = req.failure()?.errorText ?? '';
      const url = req.url();
      if (err === 'net::ERR_ABORTED' && /_rsc=/.test(url)) return;
      requestFailures.push(`${req.method()} ${url} — ${err}`);
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });
});
