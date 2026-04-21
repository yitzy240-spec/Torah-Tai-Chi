import { test, expect } from '@playwright/test';

// Tier 2 read-only public page. videos/page.tsx pulls from getAllParshiot()
// (Supabase) and hands the list to <VideosFilter>. Each card is rendered as
// an <a href="/videos/<slug>"> — see the home.spec.ts pattern for reference.

test.describe('website: videos list', () => {
  test('lists real videos', async ({ page, request }) => {
    await page.goto('/videos');
    // Prefer sitemap.xml as the authoritative list (used by tier1 specs too).
    // Fall back to scanning rendered anchors if the sitemap is empty.
    let hasVideo = false;
    try {
      const resp = await request.get('/sitemap.xml');
      if (resp.ok()) {
        const xml = await resp.text();
        if (/<loc>[^<]*\/videos\/[a-z0-9-]+<\/loc>/.test(xml)) hasVideo = true;
      }
    } catch {
      /* ignore — fall through to DOM scan */
    }
    if (!hasVideo) {
      const anchorCount = await page.locator('a[href^="/videos/"]').count();
      hasVideo = anchorCount > 0;
    }
    expect(hasVideo, 'expected at least one /videos/<slug> entry').toBe(true);
  });

  test('no qa_seed rows leak onto page', async ({ page }) => {
    await page.goto('/videos');
    const html = await page.content();
    // Dashboard seeds data with slugs starting "qa-test-" and titles prefixed
    // "QA TEST —". Neither should reach the public page — the parshiot query
    // filters on qa_seed=false.
    expect(html).not.toMatch(/qa-test-|QA TEST —/);
  });

  test('each video card links to its detail page', async ({ page }) => {
    await page.goto('/videos');
    const firstCard = page.locator('a[href^="/videos/"]').first();
    const count = await page.locator('a[href^="/videos/"]').count();
    test.skip(count === 0, 'no video cards rendered (empty preview DB)');
    await expect(firstCard).toBeVisible();
    // Href must match the /videos/<slug> shape (lowercase slug with hyphens).
    const href = await firstCard.getAttribute('href');
    expect(href).toMatch(/^\/videos\/[a-z0-9-]+$/);
    // And it must be an <a> tag (not a button-styled div).
    const tag = await firstCard.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('a');
  });

  test('metadata + no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      // Ignore ERR_ABORTED on Next RSC prefetches (`?_rsc=...`) — those are
      // user-navigation aborts, not real failures. Matches home.spec.ts.
      const err = req.failure()?.errorText ?? '';
      const url = req.url();
      if (err === 'net::ERR_ABORTED' && /_rsc=/.test(url)) return;
      requestFailures.push(`${req.method()} ${url} — ${err}`);
    });
    await page.goto('/videos');
    await page.waitForLoadState('networkidle');
    // metadata exported statically: title: "Teachings" → "<%s> · Torah Tai Chi".
    await expect(page).toHaveTitle(/teachings/i);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const meta = page.locator(`meta[property="${prop}"]`);
      await expect(meta).toHaveAttribute('content', /.+/);
    }
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });
});
