// dashboard/src/lib/rerender-confirm.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldConfirmRerender, rerenderConfirmMessage } from './rerender-confirm.ts';

test('first render of a clip does not ask', () => {
  assert.equal(shouldConfirmRerender(0), false);
});

test('a clip with any version asks before re-rendering', () => {
  assert.equal(shouldConfirmRerender(1), true);
  assert.equal(shouldConfirmRerender(4), true);
});

test('message uses 1-based clip number, next version and the estimate', () => {
  assert.equal(
    rerenderConfirmMessage(3, 1, 3.08),
    'Re-render clip 4? About $3.08, creates v2. Your current versions stay.',
  );
});

test('message pads cents', () => {
  assert.equal(
    rerenderConfirmMessage(0, 2, 2.9),
    'Re-render clip 1? About $2.90, creates v3. Your current versions stay.',
  );
});

test('missing or bad estimate falls back to about $3', () => {
  for (const bad of [null, undefined, Number.NaN, 0, -1]) {
    assert.equal(
      rerenderConfirmMessage(1, 1, bad as number | null | undefined),
      'Re-render clip 2? About $3, creates v2. Your current versions stay.',
    );
  }
});
