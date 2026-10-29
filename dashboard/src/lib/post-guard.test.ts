import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKING_POST_STATUSES,
  duplicatePostMessage,
  findBlockingPost,
  isBlockingPostStatus,
} from './post-guard.ts';

test('blocking statuses are pending, scheduled, published', () => {
  assert.deepEqual([...BLOCKING_POST_STATUSES], ['pending', 'scheduled', 'published']);
  for (const s of BLOCKING_POST_STATUSES) {
    assert.equal(isBlockingPostStatus(s), true, s);
  }
});

test('failed and unknown statuses do not block (retry allowed)', () => {
  assert.equal(isBlockingPostStatus('failed'), false);
  assert.equal(isBlockingPostStatus('cancelled'), false);
  assert.equal(isBlockingPostStatus(''), false);
  assert.equal(isBlockingPostStatus(null), false);
  assert.equal(isBlockingPostStatus(undefined), false);
});

test('findBlockingPost returns undefined when only failed rows exist', () => {
  const found = findBlockingPost([
    { status: 'failed', created_at: '2026-10-28T10:00:00Z' },
    { status: 'failed', created_at: '2026-10-28T10:01:00Z' },
  ]);
  assert.equal(found, undefined);
});

test('findBlockingPost picks the newest blocking row', () => {
  const found = findBlockingPost([
    { status: 'published', created_at: '2026-10-28T10:00:00Z', id: 'old' },
    { status: 'failed', created_at: '2026-10-28T10:01:00Z', id: 'fail' },
    { status: 'scheduled', created_at: '2026-10-28T10:02:00Z', id: 'new' },
  ]);
  assert.equal(found?.id, 'new');
  assert.equal(found?.status, 'scheduled');
});

test('findBlockingPost treats pending as blocking (in-flight)', () => {
  const found = findBlockingPost([{ status: 'pending', created_at: '2026-10-28T10:00:00Z', id: 'p' }]);
  assert.equal(found?.id, 'p');
});

test('duplicatePostMessage is explicit for the operator', () => {
  assert.equal(
    duplicatePostMessage('tiktok', 'published'),
    'Already have a tiktok post for this video (status: published) — refusing duplicate',
  );
});
