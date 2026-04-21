import { test, expect } from '@playwright/test';

// Resolve a real published video slug from /sitemap.xml once. Same skip-rather-
// than-fail pattern as article-detail.spec.ts for empty preview envs.
let realVideoSlug: string | null = null;

test.beforeAll(async ({ request }) => {
  try {
    const resp = await request.get('/sitemap.xml');
    if (!resp.ok()) return;
    const xml = await resp.text();
    const match = xml.match(/<loc>[^<]*\/videos\/([a-z0-9-]+)<\/loc>/);
    if (match) realVideoSlug = match[1];
  } catch {
    /* leave realVideoSlug null — tests will skip */
  }
});

test.describe('website: video detail', () => {
  test('published video page renders header + player', async ({ page }) => {
    test.skip(!realVideoSlug, 'No video slug discoverable from sitemap.xml');
    await page.goto(`/videos/${realVideoSlug}`);
    // <h1 class="vd-eng"> is the title in videos/[slug]/page.tsx; the player
    // stand-in is <div class="vd-player-wrap"><div class="vd-player">…
    // (no <iframe> embed yet — the real video player ships with the media
    // pipeline in a later milestone). Pick the outer wrap specifically so
    // the locator resolves to one element (strict-mode safe).
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('.vd-player-wrap')).toBeVisible();
  });

  test('404 for non-existent slug', async ({ page }) => {
    // Unknown slugs render the inline "Teaching not found" fallback with a
    // 200 (dynamicParams = true), so accept either a 404 status or the UI text.
    const resp = await page.goto('/videos/qa-totally-fake-slug-12345');
    const status = resp?.status() ?? 0;
    if (status !== 404) {
      await expect(page.locator('body')).toContainText(/not found/i);
    }
  });

  test('qa-test-* slug returns 404 (qa_seed filter works)', async ({ page }) => {
    const resp = await page.goto('/videos/qa-test-ignore-me');
    const status = resp?.status() ?? 0;
    if (status !== 404) {
      await expect(page.locator('body')).toContainText(/not found/i);
    }
  });

  test('video embed element is present', async ({ page }) => {
    test.skip(!realVideoSlug, 'No video slug discoverable from sitemap.xml');
    await page.goto(`/videos/${realVideoSlug}`);
    // The video surface is `.vd-player` today (SVG play button + label) and
    // upgrades to an <iframe>/<video> when the media pipeline lands. Accept
    // any of the three so this spec doesn't need a refactor at that time.
    const embed = page.locator('iframe, video, .vd-player').first();
    await expect(embed).toBeVisible();
    // If it's an iframe/video, require a src. The placeholder .vd-player has
    // no src, so we only enforce src when the real element is swapped in.
    const tag = await embed.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'iframe' || tag === 'video') {
      await expect(embed).toHaveAttribute('src', /.+/);
    }
  });

  test('OG video tags / video metadata present', async ({ page }) => {
    test.skip(!realVideoSlug, 'No video slug discoverable from sitemap.xml');
    await page.goto(`/videos/${realVideoSlug}`);
    // videos/[slug]/page.tsx sets openGraph.type = "video.other". Next.js
    // doesn't auto-emit og:video:url without a real media URL yet, so we
    // anchor on og:type === "video.*" plus a non-empty og:title/og:image.
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', /^video/i);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect(ogTitle).not.toBe('Torah Tai Chi — Where Ancient Wisdom Meets the Body');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /.+/);
  });

  test('no console errors', async ({ page }) => {
    test.skip(!realVideoSlug, 'No video slug discoverable from sitemap.xml');
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    await page.goto(`/videos/${realVideoSlug}`);
    await page.waitForLoadState('networkidle');
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });
});
