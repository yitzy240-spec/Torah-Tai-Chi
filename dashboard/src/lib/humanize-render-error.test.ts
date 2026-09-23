import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeRenderError } from './humanize-render-error.ts';

test('Kie 605 reads as a billing fault, not a traceback and not a top-up demand', () => {
  const raw =
    'KieTaskFailed: 605: Your balance is insufficient. Please top up your account.\n' +
    'Traceback (most recent call last):\n  File "/root/modal_app.py", line 6288';
  const out = humanizeRenderError(raw);
  assert.match(out, /nothing was charged/i);
  assert.match(out, /kie\.ai\/billing/);
  assert.doesNotMatch(out, /Traceback/);
  // Verified 2026-09-23 that 605 fires on a HEALTHY balance, so the copy
  // must not assert the account is empty or demand a top-up.
  assert.doesNotMatch(out, /credits have run out|out of (kie )?credits/i);
});

test('poll timeout still steers away from an immediate re-render', () => {
  const out = humanizeRenderError('TimeoutError: poll timeout for task abc123');
  assert.match(out, /don’t re-render right away|do not re-render right away/i);
});

test('empty input falls back to the generic message', () => {
  assert.match(humanizeRenderError(''), /Render failed/i);
  assert.match(humanizeRenderError(null), /Render failed/i);
});

test('does not claim "out of credits" just because digits 605 appear', () => {
  const raw =
    'RuntimeError: something broke\n  File "/root/modal_app.py", line 6053, in run\n' +
    '  job 8f605a12-0000-4000-8000-000000000000';
  const out = humanizeRenderError(raw);
  assert.doesNotMatch(out, /nothing was charged/i);
});

test('the 605 error-code branch fires on its own (not dead code)', () => {
  // Wording-free variant: only the code is present.
  const out = humanizeRenderError('KieTaskFailed: 605: rendering rejected');
  assert.match(out, /nothing was charged|fault on Kie/i);
});
