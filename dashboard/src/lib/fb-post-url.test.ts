import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacebookPostUrl } from './fb-post-url.ts';

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
