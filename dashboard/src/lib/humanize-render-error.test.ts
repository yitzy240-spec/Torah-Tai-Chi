import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeRenderError, isKieBalancePreflightError } from './humanize-render-error.ts';

const PREFLIGHT_RAW =
  'InsufficientKieBalance: Not enough Kie credits to start this render. Kie has 600 credits ' +
  '($3.00) left, but 2 clips at 720p standard would cost about $4.92 (984 credits). ' +
  'Nothing was rendered or charged. Top up at kie.ai/billing, then try again.\n' +
  'Traceback (most recent call last):\n  File "/root/modal_app.py", line 616';

test('balance pre-flight failure shows Modal’s sentence, not the 605 copy', () => {
  const out = humanizeRenderError(PREFLIGHT_RAW);
  assert.match(out, /^Not enough Kie credits to start this render/);
  assert.match(out, /\$3\.00/);
  assert.match(out, /\$4\.92/);
  assert.match(out, /kie\.ai\/billing/);
  assert.doesNotMatch(out, /InsufficientKieBalance|Traceback/);
  assert.doesNotMatch(out, /fault on Kie/);
});

test('isKieBalancePreflightError only matches the pre-flight, not Kie 605', () => {
  assert.equal(isKieBalancePreflightError(PREFLIGHT_RAW), true);
  assert.equal(
    isKieBalancePreflightError('KieTaskFailed: 605: Your balance is insufficient. Please top up your account.'),
    false,
  );
  assert.equal(isKieBalancePreflightError(null), false);
});

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

test('a stale tab after a deploy says reload, not retry', () => {
  const out = humanizeRenderError(
    'Server Action "70f520ea8f1f07cd3226d1060f04cc41cbf0e7ba21" was not found on the server.',
  );
  assert.match(out, /Reload the page/);
  assert.doesNotMatch(out, /Kie/);
});
