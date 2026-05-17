// dashboard/src/lib/word-count.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClip, analyzeScript, TARGET_WPS } from './word-count';

test('analyzeScript: empty string -> zero', () => {
  const r = analyzeScript('');
  assert.equal(r.words, 0);
  assert.equal(r.estimatedSeconds, 0);
  assert.equal(r.fits60s, true);
});

test('analyzeScript: 156 words -> ~60s, fits', () => {
  const text = 'word '.repeat(156).trim();
  const r = analyzeScript(text);
  assert.equal(r.words, 156);
  assert.equal(r.estimatedSeconds, 156 / TARGET_WPS); // exactly 60s
  assert.equal(r.fits60s, true);
});

test('analyzeScript: 200 words -> overflow', () => {
  const r = analyzeScript('word '.repeat(200).trim());
  assert.equal(r.fits60s, false);
});

test('analyzeClip: 28 words / 10s -> 2.8 wps, no warning', () => {
  const r = analyzeClip('word '.repeat(28).trim(), 10);
  assert.equal(r.words, 28);
  assert.equal(r.wps, 2.8);
  assert.equal(r.warning, null);
});

test('analyzeClip: 32 words / 10s -> 3.2 wps, tight warning', () => {
  const r = analyzeClip('word '.repeat(32).trim(), 10);
  assert.equal(r.warning, 'tight');
});
