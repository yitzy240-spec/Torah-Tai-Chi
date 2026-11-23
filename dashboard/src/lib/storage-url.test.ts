// Run: node --test --experimental-strip-types src/lib/storage-url.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';

const {
  assetVersionToken,
  withAssetVersion,
  publicVideoUrl,
  downloadUrl,
} = await import('./storage-url.ts');

const BASE = 'https://proj.supabase.co/storage/v1/object/public/videos/jobs/j/vayishlach-follow.mp4';

test('publicVideoUrl without a version is the bare storage URL', () => {
  assert.equal(publicVideoUrl('jobs/j/vayishlach-follow.mp4'), BASE);
});

test('publicVideoUrl strips a leading slash on the path', () => {
  assert.equal(publicVideoUrl('/jobs/j/vayishlach-follow.mp4'), BASE);
});

test('publicVideoUrl appends a stable ?v= token from completed_at', () => {
  const iso = '2026-11-23T21:08:00.000Z';
  const token = assetVersionToken(iso);
  assert.equal(token, String(Date.parse(iso)));
  assert.equal(
    publicVideoUrl('jobs/j/vayishlach-follow.mp4', iso),
    `${BASE}?v=${token}`,
  );
});

test('equivalent completed_at instants produce the same token', () => {
  const a = assetVersionToken('2026-11-23T21:08:00.000Z');
  const b = assetVersionToken('2026-11-23T21:08:00+00:00');
  const c = assetVersionToken(Date.parse('2026-11-23T21:08:00.000Z'));
  assert.equal(a, b);
  assert.equal(a, c);
});

test('a new completed_at (re-stitch) changes the URL', () => {
  const first = publicVideoUrl('jobs/j/vayishlach-follow.mp4', '2026-11-23T20:24:26.000Z');
  const again = publicVideoUrl('jobs/j/vayishlach-follow.mp4', '2026-11-23T21:08:00.000Z');
  assert.notEqual(first, again);
  assert.match(again, /\?v=\d+$/);
});

test('null / empty versions leave the URL unchanged', () => {
  assert.equal(publicVideoUrl('jobs/j/vayishlach-follow.mp4', null), BASE);
  assert.equal(publicVideoUrl('jobs/j/vayishlach-follow.mp4', undefined), BASE);
  assert.equal(publicVideoUrl('jobs/j/vayishlach-follow.mp4', ''), BASE);
  assert.equal(withAssetVersion(BASE, null), BASE);
});

test('withAssetVersion uses & when the URL already has a query', () => {
  const withQ = `${BASE}?download=vayishlach-follow.mp4`;
  assert.equal(withAssetVersion(withQ, 123), `${withQ}&v=123`);
});

test('downloadUrl after a version token uses &download=', () => {
  const versioned = publicVideoUrl('jobs/j/vayishlach-follow.mp4', '2026-11-23T21:08:00.000Z');
  const dl = downloadUrl(versioned, 'vayishlach-follow.mp4');
  assert.equal(dl, `${versioned}&download=${encodeURIComponent('vayishlach-follow.mp4')}`);
});
