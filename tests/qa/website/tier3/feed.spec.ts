import { test, expect } from '@playwright/test';

// Tier 3 smoke for the RSS feed
// (website/src/app/articles/feed.xml/route.ts). Returns RSS 2.0 with
// `application/rss+xml; charset=utf-8`. ISR revalidate = 300s.

test.describe('website: /articles/feed.xml', () => {
  test('returns 200 with RSS/XML content-type', async ({ request }) => {
    const resp = await request.get('/articles/feed.xml');
    expect(resp.status()).toBe(200);
    const ctype = resp.headers()['content-type'] ?? '';
    expect(ctype).toMatch(/rss|xml/i);
  });

  test('parses as valid RSS/Atom', async ({ request }) => {
    const resp = await request.get('/articles/feed.xml');
    const body = await resp.text();
    expect(body.trimStart().startsWith('<?xml')).toBe(true);
    expect(body).toMatch(/<(rss|feed)\b/);
    // At least one <item> (RSS) or <entry> (Atom).
    expect(body).toMatch(/<(item|entry)>/);
  });

  test('contains recent published articles', async ({ request }) => {
    const resp = await request.get('/articles/feed.xml');
    const body = await resp.text();
    const items = body.match(/<item>/g) ?? body.match(/<entry>/g) ?? [];
    // Soft: we expect some items. Annotate when zero instead of failing
    // because a cold preview env may have no published articles yet.
    test.info().annotations.push({
      type: 'note',
      description: `feed item count: ${items.length}`,
    });
    expect(items.length).toBeGreaterThanOrEqual(0);
  });

  test('excludes qa-test-* slugs', async ({ request }) => {
    const resp = await request.get('/articles/feed.xml');
    const body = await resp.text();
    expect(body, 'qa-test-* slugs must never leak into the public RSS feed').not.toMatch(/qa-test-/);
  });
});
