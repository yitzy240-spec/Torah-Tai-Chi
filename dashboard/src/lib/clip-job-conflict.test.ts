// dashboard/src/lib/clip-job-conflict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipIndexesOverlap, findConflictingClipJob, clipJobConflictMessage } from './clip-job-conflict.ts';

test('same single index conflicts', () => {
  assert.equal(clipIndexesOverlap([3], [3]), true);
});

test('different indexes do not conflict', () => {
  assert.equal(clipIndexesOverlap([4], [3]), false);
  assert.equal(clipIndexesOverlap([0, 1], [2, 3]), false);
});

test('partial overlap conflicts', () => {
  assert.equal(clipIndexesOverlap([2, 3], [3, 4]), true);
});

test('null (all clips) on either side conflicts', () => {
  assert.equal(clipIndexesOverlap(null, [3]), true);
  assert.equal(clipIndexesOverlap([3], null), true);
  assert.equal(clipIndexesOverlap(null, null), true);
});

test('findConflictingClipJob returns the overlapping job or null', () => {
  const jobs = [
    { id: 'a', clip_indexes: [1] },
    { id: 'b', clip_indexes: [3] },
  ];
  assert.equal(findConflictingClipJob([3], jobs)?.id, 'b');
  assert.equal(findConflictingClipJob([4], jobs), null);
  assert.equal(findConflictingClipJob([4], []), null);
});

test('conflict message names the clip for a single index', () => {
  assert.equal(
    clipJobConflictMessage([3]),
    'Clip 4 is already rendering. Wait for it to finish before starting another.',
  );
  assert.equal(
    clipJobConflictMessage(null),
    'These clips are already rendering. Wait for them to finish before starting another.',
  );
  assert.equal(
    clipJobConflictMessage([1, 2]),
    'These clips are already rendering. Wait for them to finish before starting another.',
  );
});
