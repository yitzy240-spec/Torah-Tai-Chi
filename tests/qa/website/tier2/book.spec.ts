import { test, expect } from '@playwright/test';

// Tier 2 read-only public page. book/page.tsx guards on c["book.visible"] ===
// "true" and calls notFound() otherwise. If the flag is off on the preview
// env, the detail/link tests auto-skip so the suite stays green.

test.describe('website: book', () => {
  test('book page renders without error', async ({ page }) => {
    const resp = await page.goto('/book');
    const status = resp?.status() ?? 0;
    // book.visible === "false" → notFound() → 404. Skip cleanly in that case.
    test.skip(status === 404, 'book page is hidden (book.visible !== "true")');
    // h1 is the book title; always present when visible.
    await expect(page.locator('h1')).toBeVisible();
    // `.book-wrap` is the <main> wrapper — confirms body rendered, not a fallback.
    await expect(page.locator('main.book-wrap')).toBeVisible();
  });

  test('book purchase link has valid external href', async ({ page }) => {
    const resp = await page.goto('/book');
    test.skip((resp?.status() ?? 0) === 404, 'book page is hidden');
    // The CTA is `a.btn.btn-primary` inside `.book-body`, rendered only when
    // c["book.purchase_url"] is set. If missing, the page shows the
    // "Available soon." <p> instead, so treat the anchor as optional.
    const cta = page.locator('main.book-wrap a.btn-primary');
    const count = await cta.count();
    test.skip(count === 0, 'no purchase URL configured — "Available soon." fallback');
    const href = await cta.first().getAttribute('href');
    expect(href).toBeTruthy();
    // External purchase link: must be absolute http(s) and NOT point back at the site.
    expect(href).toMatch(/^https?:\/\//);
    expect(href).not.toMatch(/^https?:\/\/(?:www\.)?torahtaichi\.com/);
    // Must open in a new tab safely.
    await expect(cta.first()).toHaveAttribute('target', '_blank');
    await expect(cta.first()).toHaveAttribute('rel', /noopener/);
  });

  test('metadata: title/description/og present', async ({ page }) => {
    const resp = await page.goto('/book');
    test.skip((resp?.status() ?? 0) === 404, 'book page is hidden');
    // generateMetadata returns title like "${book.title} — The Book". Ensure
    // the <title> was templated through and contains the "Torah Tai Chi" site suffix.
    await expect(page).toHaveTitle(/torah tai chi/i);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) {
      const meta = page.locator(`meta[property="${prop}"]`);
      await expect(meta).toHaveAttribute('content', /.+/);
    }
    // og:title is ".*— The Book" in generateMetadata.
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /the book/i);
  });

  test('no console errors', async ({ page }) => {
    const resp = await page.goto('/book');
    test.skip((resp?.status() ?? 0) === 404, 'book page is hidden');
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });
    await page.goto('/book');
    await page.waitForLoadState('networkidle');
    expect(consoleErrors, JSON.stringify(consoleErrors, null, 2)).toEqual([]);
    expect(requestFailures, JSON.stringify(requestFailures, null, 2)).toEqual([]);
  });
});
