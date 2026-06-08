// Run: node --test --experimental-strip-types src/lib/read-time.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsToReadMinutes } from './read-time.ts';

test('rounds at 200 wpm, min 1', () => {
  assert.equal(wordsToReadMinutes(0), 1);
  assert.equal(wordsToReadMinutes(100), 1);
  assert.equal(wordsToReadMinutes(400), 2);
  assert.equal(wordsToReadMinutes(500), 3); // 2.5 -> 3
});
