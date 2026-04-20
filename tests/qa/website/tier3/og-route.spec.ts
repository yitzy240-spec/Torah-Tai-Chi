import { test, expect } from '@playwright/test';

// Tier 3 smoke for OG-image endpoints.
//
// Source notes (website/src/app/og/...):
//   - /og/default.png is a static file at website/public/og/default.png
//     (served directly by Next). No dynamic handler at /og itself.
//   - /og/article/[slug] and /og/parsha/[slug] are route.tsx handlers that
//     return an ImageResponse (image/png, 1200x630). Both use
//     `dynamic = "force-static"` with generateStaticParams() — so unknown
//     slugs may 404 in a fully prerendered env.

test.describe('website: /og/* routes', () => {
  test('/og/default.png returns 200 image/png', async ({ request }) => {
    const resp = await request.get('/og/default.png');
    expect(resp.status()).toBe(200);
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype).toMatch(/image\/png/i);
  });

  test('/og/article/<real-slug> returns image/png', async ({ request }) => {
    // Pull a real article slug from the sitemap so this test isn't coupled
    // to any specific story that could get unpublished later.
    const sitemapResp = await request.get('/sitemap.xml');
    const sitemapBody = await sitemapResp.text();
    const match = sitemapBody.match(/<loc>[^<]*\/articles\/([a-z0-9-]+)<\/loc>/);
    test.skip(!match, 'no article slug present in sitemap — skipping dynamic OG check');
    const slug = match![1];
    const resp = await request.get(`/og/article/${slug}`);
    expect(resp.status(), `GET /og/article/${slug}`).toBeLessThan(400);
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype).toMatch(/image\/png/i);
  });

  test('/og/parsha/<any-slug> returns image or sensible status', async ({ request }) => {
    // /og/parsha/[slug] uses force-static + generateStaticParams, so an
    // arbitrary slug may 404 if not prerendered. We accept either a <400
    // (image response) or a 404 (unknown slug) — anything 500+ would be a
    // real bug. Use a plausible parsha slug.
    const resp = await request.get('/og/parsha/bereishit');
    expect(resp.status(), `status should be either an image or a 404, not 5xx`).toBeLessThan(500);
    if (resp.status() < 400) {
      const ctype = resp.headers()['content-type'] ?? '';
      expect(ctype).toMatch(/image\/png/i);
    }
  });
});
