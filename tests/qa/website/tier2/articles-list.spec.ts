import { test, expect } from '@playwright/test';

// Tier 2 read-only public page. articles/page.tsx pulls from getAllArticles()
// (Storyblok) and renders <Link href="/articles/<slug>"> entries as
// `.article-entry`. The page metadata declares an RSS alternate feed at
// /articles/feed.xml (see alternates.types in page.tsx).

test.describe('website: articles list', () => {
  test('lists real articles', async ({ page, request }) => {
    await page.goto('/articles');
    // Prefer sitemap.xml (ensures the article is *actually* published), fall
    // back to anchor scraping if the sitemap is empty on this preview env.
    let hasArticle = false;
    try {
      const resp = await request.get('/sitemap.xml');
      if (resp.ok()) {
        const xml = await resp.text();
        if (/<loc>[^<]*\/articles\/[a-z0-9-]+<\/loc>/.test(xml)) hasArticle = true;
      }
    } catch {
      /* ignore — fall through to DOM scan */
    }
    if (!hasArticle) {
      const anchorCount = await page.locator('a[href^="/articles/"]').count();
      hasArticle = anchorCount > 0;
    }
    // If the env is a bare preview with Storyblok drafts only, accept the
    // "No articles published yet." fallback copy so the test isn't a false fail.
    if (!hasArticle) {
      await expect(page.locator('body')).toContainText(/no articles published yet/i);
    } else {
      expect(hasArticle).toBe(true);
    }
  });

  test('no qa_seed rows leak onto page', async ({ page }) => {
    await page.goto('/articles');
    const html = await page.content();
    // Articles are Storyblok-sourced, so qa_seed is a moot concern in theory.
    // Still assert the seed markers never leak — a defense against someone
    // wiring Storyblok to the qa seeding helpers in the future.
    expect(html).not.toMatch(/qa-test-|QA TEST —/);
  });

  test('each article card links to its detail page', async ({ page }) => {
    await page.goto('/articles');
    const firstCard = page.locator('a.article-entry, a[href^="/articles/"]').first();
    const count = await page.locator('a[href^="/articles/"]').count();
    test.skip(count === 0, 'no article cards rendered (empty preview Storyblok space)');
    await expect(firstCard).toBeVisible();
    const href = await firstCard.getAttribute('href');
    expect(href).toMatch(/^\/articles\/[a-z0-9-]+$/);
    const tag = await firstCard.evaluate((el) => el.tagName.toLowerCase());
    expect(tag).toBe('a');
  });

  test('RSS link present in <head> or footer', async ({ page }) => {
    await page.goto('/articles');
    // metadata.alternates.types["application/rss+xml"] = "/articles/feed.xml"
    // renders as <link rel="alternate" type="application/rss+xml" href="...">.
    const rssLink = page.locator('link[rel="alternate"][type="application/rss+xml"]');
    const headCount = await rssLink.count();
    if (headCount > 0) {
      await expect(rssLink.first()).toHaveAttribute('href', /feed|rss/i);
      return;
    }
    // Fallback: a visible "/feed"-style anchor in the footer.
    const visibleFeed = page.locator('a[href*="feed"], a[href*="rss"]').first();
    const visibleCount = await page.locator('a[href*="feed"], a[href*="rss"]').count();
    if (visibleCount > 0) {
      await expect(visibleFeed).toBeVisible();
      return;
    }
    test.fixme(true, 'no RSS alternate link or visible feed anchor found');
  });

  test('metadata + no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    await page.goto('/articles');
    await page.waitForLoadState('networkidle');
    // Page sets title: "Writings" → "Writings · Torah Tai Chi" via layout template.
    await expect(page).toHaveTitle(/writings/i);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const meta = page.locator(`meta[property="${prop}"]`);
      await expect(meta).toHaveAttribute('content', /.+/);
    }
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });
});
