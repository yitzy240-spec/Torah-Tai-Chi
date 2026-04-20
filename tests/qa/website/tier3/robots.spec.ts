import { test, expect } from '@playwright/test';

// Tier 3 smoke for /robots.txt (website/src/app/robots.ts — Next.js
// MetadataRoute.Robots export). Catastrophic-finding guard: a blanket
// `Disallow: /` would deindex the whole site.

test.describe('website: /robots.txt', () => {
  test('returns 200 with text/plain', async ({ request }) => {
    const resp = await request.get('/robots.txt');
    expect(resp.status()).toBe(200);
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype).toMatch(/text\/plain/i);
  });

  test('contains User-agent and Sitemap lines', async ({ request }) => {
    const resp = await request.get('/robots.txt');
    const body = await resp.text();
    expect(body).toMatch(/User-agent:/i);
    expect(body).toMatch(/Sitemap:/i);
  });

  test('does not Disallow "/" unconditionally', async ({ request }) => {
    const resp = await request.get('/robots.txt');
    const body = await resp.text();
    // Match a bare `Disallow: /` on its own line (trailing whitespace ok).
    // A specific path like `Disallow: /admin` is fine; `Disallow: /` is a
    // catastrophic deindex.
    const lines = body.split(/\r?\n/).map((l) => l.trim());
    const blanketDisallow = lines.some((l) => /^Disallow:\s*\/\s*$/i.test(l));
    expect(blanketDisallow, `robots.txt must not blanket-Disallow "/".\n${body}`).toBe(false);
  });
});
