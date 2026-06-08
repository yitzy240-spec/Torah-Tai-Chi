// Run: node --test --experimental-strip-types src/lib/asset-filename.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssetFilename } from './asset-filename.ts';

test('lowercases, strips unsafe chars, keeps extension', () => {
  assert.equal(sanitizeAssetFilename('My Photo (1).JPG'), 'my-photo-1.jpg');
});
test('collapses repeats and trims dashes', () => {
  assert.equal(sanitizeAssetFilename('  a—b!!c.png '), 'a-b-c.png');
});
test('falls back when name is empty', () => {
  assert.equal(sanitizeAssetFilename('***.png'), 'image.png');
  assert.equal(sanitizeAssetFilename(''), 'image');
});
