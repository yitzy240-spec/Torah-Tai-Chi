import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferApiError, formatBufferRateLimitMessage } from './buffer-shared.ts';

test('BufferApiError keeps the legacy message shape (HTTP 429 string checks rely on it)', () => {
  const e = new BufferApiError(429, 1781121801);
  assert.equal(e.message, 'Buffer GraphQL: HTTP 429');
  assert.equal(e.status, 429);
  assert.equal(e.rateLimitReset, 1781121801);
  assert.ok(e instanceof Error);
});

test('formatBufferRateLimitMessage with a known reset gives hours + UTC time', () => {
  // reset 5h30m after "now" → ceil to 6 hours
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  const resetUnix = Math.floor(nowMs / 1000) + 5.5 * 3600;
  const msg = formatBufferRateLimitMessage(resetUnix, nowMs);
  assert.equal(
    msg,
    "Buffer's daily request limit is used up. Posting will work again in about 6 hours (around 13:30 UTC).",
  );
});

test('formatBufferRateLimitMessage under an hour says "in about an hour"', () => {
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  const resetUnix = Math.floor(nowMs / 1000) + 600; // 10 min
  assert.equal(
    formatBufferRateLimitMessage(resetUnix, nowMs),
    "Buffer's daily request limit is used up. Posting will work again in about an hour (around 08:10 UTC).",
  );
});

test('formatBufferRateLimitMessage without a reset header falls back to tomorrow', () => {
  assert.equal(
    formatBufferRateLimitMessage(null, Date.UTC(2026, 5, 10, 8, 0, 0)),
    "Buffer's daily request limit is used up. It resets once a day — try again tomorrow.",
  );
});

test('formatBufferRateLimitMessage with a reset in the past says shortly', () => {
  const nowMs = Date.UTC(2026, 5, 10, 8, 0, 0);
  assert.equal(
    formatBufferRateLimitMessage(Math.floor(nowMs / 1000) - 60, nowMs),
    "Buffer's daily request limit is used up. Posting should work again shortly — try again in a few minutes.",
  );
});
