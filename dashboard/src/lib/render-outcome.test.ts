// dashboard/src/lib/render-outcome.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastFailedRenderByIndex, type FailedRenderJob } from './render-outcome.ts';

const PLAN = [0, 1, 2];
const none = new Map<number, string>();
const idle = new Set<number>();

function failed(id: string, triggeredAt: string, clipIndexes: number[] | null, msg: string | null = 'Kie 605'): FailedRenderJob {
  return { id, clipIndexes, triggeredAt, errorMessage: msg };
}

test('no failed jobs -> nothing to report', () => {
  assert.deepEqual(
    lastFailedRenderByIndex({ failedJobs: [], planIndexes: PLAN, newestVersionAtByIndex: none, pendingIndexes: idle }),
    {},
  );
});

test('a failed single-clip re-render is reported on that clip only', () => {
  // Yonah's case: clip 1 already had a version from earlier; the re-render
  // failed. This is what a refresh must still show.
  const out = lastFailedRenderByIndex({
    failedJobs: [failed('j-rerender', '2026-10-04T18:20:00Z', [0])],
    planIndexes: PLAN,
    newestVersionAtByIndex: new Map([[0, '2026-10-04T17:00:00Z']]),
    pendingIndexes: idle,
  });
  assert.deepEqual(Object.keys(out), ['0']);
  assert.equal(out[0].jobId, 'j-rerender');
  assert.equal(out[0].message, 'Kie 605');
});

test('a later successful version supersedes the failure', () => {
  const out = lastFailedRenderByIndex({
    failedJobs: [failed('j-fail', '2026-10-04T18:20:00Z', [0])],
    planIndexes: PLAN,
    newestVersionAtByIndex: new Map([[0, '2026-10-04T18:31:00Z']]),
    pendingIndexes: idle,
  });
  assert.deepEqual(out, {});
});

test('a render in flight supersedes the failure (the card shows a spinner)', () => {
  const out = lastFailedRenderByIndex({
    failedJobs: [failed('j-fail', '2026-10-04T18:20:00Z', [0])],
    planIndexes: PLAN,
    newestVersionAtByIndex: none,
    pendingIndexes: new Set([0]),
  });
  assert.deepEqual(out, {});
});

test('a failed "Generate all" (clip_indexes NULL) reports every clip without a newer version', () => {
  const out = lastFailedRenderByIndex({
    failedJobs: [failed('j-all', '2026-10-04T18:00:00Z', null)],
    planIndexes: PLAN,
    newestVersionAtByIndex: new Map([[1, '2026-10-04T18:10:00Z']]), // clip 1 later rendered fine
    pendingIndexes: idle,
  });
  assert.deepEqual(Object.keys(out).sort(), ['0', '2']);
});

test('the newest failure per clip wins, whatever order the jobs arrive in', () => {
  const older = failed('j-old', '2026-10-04T17:00:00Z', [0], 'old error');
  const newer = failed('j-new', '2026-10-04T18:00:00Z', [0], 'new error');
  for (const jobs of [[older, newer], [newer, older]]) {
    const out = lastFailedRenderByIndex({ failedJobs: jobs, planIndexes: PLAN, newestVersionAtByIndex: none, pendingIndexes: idle });
    assert.equal(out[0].jobId, 'j-new');
    assert.equal(out[0].message, 'new error');
  }
});

test('a failure with no error text still says something', () => {
  const out = lastFailedRenderByIndex({
    failedJobs: [failed('j', '2026-10-04T18:00:00Z', [2], null)],
    planIndexes: PLAN,
    newestVersionAtByIndex: none,
    pendingIndexes: idle,
  });
  assert.match(out[2].message, /stopped/);
});
