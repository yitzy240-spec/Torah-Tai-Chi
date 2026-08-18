import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacebookPostUrl, parseFacebookPostUrl } from './fb-post-url.ts';

test('rewrites composite pageid_postid URLs to /posts/ permalinks', () => {
  assert.equal(
    normalizeFacebookPostUrl('https://facebook.com/1134355293098388_122126071833345697'),
    'https://www.facebook.com/1134355293098388/posts/122126071833345697',
  );
  assert.equal(
    normalizeFacebookPostUrl('https://www.facebook.com/1134355293098388_122120918439345697/'),
    'https://www.facebook.com/1134355293098388/posts/122120918439345697',
  );
});

test('passes proper URLs through unchanged', () => {
  for (const url of [
    'https://www.facebook.com/reel/1045896848196805/',
    'https://www.facebook.com/TorahTaiChi/videos/1798526841293088/',
    'https://www.facebook.com/1134355293098388/posts/122126071833345697',
  ]) {
    assert.equal(normalizeFacebookPostUrl(url), url);
  }
});

test('parseFacebookPostUrl accepts reel, watch, posts, videos, share, fb.watch', () => {
  const cases: Array<[string, string]> = [
    ['https://www.facebook.com/reel/1045896848196805/', 'https://www.facebook.com/reel/1045896848196805/'],
    ['https://m.facebook.com/reel/1045896848196805', 'https://m.facebook.com/reel/1045896848196805'],
    ['https://www.facebook.com/watch/?v=123', 'https://www.facebook.com/watch/?v=123'],
    ['https://www.facebook.com/TorahTaiChi/posts/122126071833345697', 'https://www.facebook.com/TorahTaiChi/posts/122126071833345697'],
    ['https://www.facebook.com/TorahTaiChi/videos/1798526841293088/', 'https://www.facebook.com/TorahTaiChi/videos/1798526841293088/'],
    ['https://www.facebook.com/share/r/abc123/', 'https://www.facebook.com/share/r/abc123/'],
    ['https://fb.watch/abc123', 'https://fb.watch/abc123'],
    ['www.facebook.com/reel/1045896848196805/', 'https://www.facebook.com/reel/1045896848196805/'],
    [
      'https://facebook.com/1134355293098388_122126071833345697',
      'https://www.facebook.com/1134355293098388/posts/122126071833345697',
    ],
  ];
  for (const [raw, expected] of cases) {
    const parsed = parseFacebookPostUrl(raw);
    assert.equal(parsed.ok, true, raw);
    if (parsed.ok) assert.equal(parsed.url, expected, raw);
  }
});

test('parseFacebookPostUrl rejects empty and non-Facebook URLs', () => {
  for (const raw of ['', '   ', 'not a url', 'https://instagram.com/p/abc', 'javascript:alert(1)', 'https://evil.com/facebook.com']) {
    const parsed = parseFacebookPostUrl(raw);
    assert.equal(parsed.ok, false, raw);
    if (!parsed.ok) assert.ok(parsed.error.length > 0);
  }
});
