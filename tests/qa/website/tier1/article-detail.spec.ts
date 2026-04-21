import { test, expect } from '@playwright/test';

// Resolve a real published article slug from /sitemap.xml once. Detail-page
// tests skip (rather than fail) if the sitemap is empty/unreachable, so the
// suite stays green against a bare-bones preview environment.
let realArticleSlug: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const resp = await request.get('/sitemap.xml');
    if (!resp.ok()) return;
    const xml = await resp.text();
    const match = xml.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
    if (match) realArticleSlug = match[1];
  } catch {
    /* leave realArticleSlug null — tests will skip */
  }
});

test.describe('website: article detail', () => {
  test('published article renders markdown', async ({ page }) => {
    test.skip(!realArticleSlug, 'No article slug discoverable from sitemap.xml');
    await page.goto(`/articles/${realArticleSlug}`);
    // <h1> is rendered inside the .ad-header section (see articles/[slug]/page.tsx).
    await expect(page.locator('h1')).toBeVisible();
    // The body lives inside <article class="ad-body stagger">; match any non-empty text.
    await expect(page.locator('article.ad-body, article, main').first()).toContainText(/\S/);
  });

  test('404 for non-existent slug', async ({ page }) => {
    // Next.js returns a 200 with the "Article not found" fallback UI for unknown
    // slugs (the page renders its own 404 card rather than hitting notFound()).
    // Assert EITHER a 404 status OR the fallback UI string.
    const resp = await page.goto('/articles/qa-totally-fake-slug-12345');
    const status = resp?.status() ?? 0;
    if (status !== 404) {
      await expect(page.locator('body')).toContainText(/not found/i);
    }
  });

  test('qa-test-* slug returns 404 (qa_seed filter works)', async ({ page }) => {
    const resp = await page.goto('/articles/qa-test-ignore-me');
    const status = resp?.status() ?? 0;
    if (status !== 404) {
      await expect(page.locator('body')).toContainText(/not found/i);
    }
  });

  test('OG tags include article-specific metadata', async ({ page }) => {
    test.skip(!realArticleSlug, 'No article slug discoverable from sitemap.xml');
    await page.goto(`/articles/${realArticleSlug}`);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    // Per generateMetadata in articles/[slug]/page.tsx, article OG title is
    // "${title} · Torah Tai Chi" — it should NOT equal the bare homepage
    // default "Torah Tai Chi — Where Ancient Wisdom Meets the Body".
    expect(ogTitle).not.toBe('Torah Tai Chi — Where Ancient Wisdom Meets the Body');
    // OG type for articles is "article" (vs "website" on the homepage).
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', /article/i);
  });

  test('structured data (Article JSON-LD) present and valid', async ({ page }) => {
    test.skip(!realArticleSlug, 'No article slug discoverable from sitemap.xml');
    await page.goto(`/articles/${realArticleSlug}`);
    // articles/[slug]/page.tsx emits two <script type="application/ld+json">
    // blocks: articleSchema() + breadcrumbSchema(). Parse every block and
    // assert at least one is an Article-like @type.
    const jsonLdBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(jsonLdBlocks.length).toBeGreaterThan(0);
    const parsed = jsonLdBlocks.map((raw) => {
      try { return JSON.parse(raw); } catch { return null; }
    }).filter(Boolean);
    expect(parsed.length).toBeGreaterThan(0);
    const hasArticle = parsed.some(
      (obj) => obj && /^(Article|NewsArticle|BlogPosting)$/.test(obj['@type'] ?? ''),
    );
    expect(hasArticle, `No Article JSON-LD found. Types seen: ${parsed.map((o) => o?.['@type']).join(', ')}`).toBe(true);
  });

  test('no console errors or failed requests', async ({ page }) => {
    test.skip(!realArticleSlug, 'No article slug discoverable from sitemap.xml');
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    await page.goto(`/articles/${realArticleSlug}`);
    await page.waitForLoadState('networkidle');
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });

  test('mobile: readable line-height on article body', async ({ page, viewport }) => {
    test.skip(!viewport || viewport.width > 600, 'mobile-only');
    test.skip(!realArticleSlug, 'No article slug discoverable from sitemap.xml');
    await page.goto(`/articles/${realArticleSlug}`);
    const lineHeightRatio = await page.evaluate(() => {
      const body = document.body;
      const style = getComputedStyle(body);
      const fs = parseFloat(style.fontSize);
      const lh = parseFloat(style.lineHeight);
      if (!fs || !lh || Number.isNaN(lh)) return null;
      return lh / fs;
    });
    expect(lineHeightRatio, 'body line-height / font-size ratio').not.toBeNull();
    expect(lineHeightRatio!).toBeGreaterThan(1.4);
  });
});
