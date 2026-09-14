import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_DURATION_MIN_S,
  CLIP_DURATION_MAX_S,
  clampClipDuration,
  isValidClipDuration,
} from './clip-duration.ts';

test('bounds match Kie Seedance createTask (4-15, integer)', () => {
  assert.equal(CLIP_DURATION_MIN_S, 4);
  assert.equal(CLIP_DURATION_MAX_S, 15);
});

test('rejects the 3s value that failed on Haazinu 2026-09-13', () => {
  assert.equal(isValidClipDuration(3), false);
  assert.equal(clampClipDuration(3), 4);
});

test('clamps out-of-range and non-integer input', () => {
  assert.equal(clampClipDuration(0), 4);
  assert.equal(clampClipDuration(-5), 4);
  assert.equal(clampClipDuration(99), 15);
  assert.equal(clampClipDuration(7.4), 7);
  assert.equal(clampClipDuration(Number.NaN), 4);
});

test('passes valid durations through untouched', () => {
  for (const d of [4, 5, 10, 14, 15]) {
    assert.equal(clampClipDuration(d), d);
    assert.equal(isValidClipDuration(d), true);
  }
});
