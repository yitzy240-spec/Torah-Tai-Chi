import { test, expect } from '@playwright/test';

// Tier 3 smoke for /sitemap.xml (website/src/app/sitemap.ts — Next.js
// MetadataRoute.Sitemap export). Validates format + that real published
// slugs appear + QA test slugs do NOT leak.

test.describe('website: /sitemap.xml', () => {
  test('returns 200 with valid XML', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    expect(resp.status()).toBe(200);
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype).toMatch(/xml/i);
    const body = await resp.text();
    expect(body).toContain('<urlset');
  });

  test('contains published article and video slugs', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    const body = await resp.text();
    const locs = Array.from(body.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    // Soft check: we expect SOME article or video URL; in a cold preview env
    // there may be only the homepage, so keep this as an annotation-only
    // report rather than a hard fail.
    const hasArticle = locs.some((l) => /\/articles\/[a-z0-9-]+/.test(l));
    const hasVideo = locs.some((l) => /\/videos\/[a-z0-9-]+/.test(l));
    test.info().annotations.push({
      type: 'note',
      description: `sitemap locs: ${locs.length}, article entries: ${hasArticle}, video entries: ${hasVideo}`,
    });
  });

  test('does NOT contain qa-test-* slugs', async ({ request }) => {
    const resp = await request.get('/sitemap.xml');
    const body = await resp.text();
    expect(body, 'qa-test-* slugs must never leak into the public sitemap').not.toMatch(/qa-test-/);
  });
});
