// dashboard/src/lib/plan-job.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanJobId, editablePlanJobId, type PlanJobLink } from './plan-job.ts';

// Bereishit-shaped tree: plan root, two clip-1 re-renders, the published
// compose (stitched from the root). Plus an unrelated newer draft plan.
const JOBS: PlanJobLink[] = [
  { id: 'plan', regenOfJobId: null },
  { id: 'rerender-1', regenOfJobId: 'plan' },
  { id: 'rerender-2', regenOfJobId: 'plan' },
  { id: 'live-compose', regenOfJobId: 'plan' },
  { id: 'other-plan', regenOfJobId: null },
];

test('resolvePlanJobId walks a compose job back to its plan', () => {
  assert.equal(resolvePlanJobId(JOBS, 'live-compose'), 'plan');
  assert.equal(resolvePlanJobId(JOBS, 'plan'), 'plan');
  assert.equal(resolvePlanJobId(JOBS, null), null);
  assert.equal(resolvePlanJobId(JOBS, 'missing'), null);
});

test('resolvePlanJobId survives a cycle', () => {
  const cyclic: PlanJobLink[] = [
    { id: 'a', regenOfJobId: 'b' },
    { id: 'b', regenOfJobId: 'a' },
  ];
  assert.equal(resolvePlanJobId(cyclic, 'a'), null);
});

test('published, no draft: Phase 2 opens the live video\'s clips', () => {
  // Yonah's case — this used to be null, i.e. a forever spinner.
  assert.equal(
    editablePlanJobId({ jobs: JOBS, draftJobId: null, liveJobId: 'live-compose', editLive: false, startPlan: false }),
    'plan',
  );
});

test('"Edit clips" from the live page beats an unrelated draft', () => {
  assert.equal(
    editablePlanJobId({ jobs: JOBS, draftJobId: 'other-plan', liveJobId: 'live-compose', editLive: true, startPlan: false }),
    'plan',
  );
});

test('a draft still wins when the live plan was not asked for', () => {
  assert.equal(
    editablePlanJobId({ jobs: JOBS, draftJobId: 'other-plan', liveJobId: 'live-compose', editLive: false, startPlan: false }),
    'other-plan',
  );
});

test('starting a plan from Phase 1 never falls back to the live plan', () => {
  assert.equal(
    editablePlanJobId({ jobs: JOBS, draftJobId: null, liveJobId: 'live-compose', editLive: false, startPlan: true }),
    null,
  );
});

test('nothing published, no draft: nothing to edit', () => {
  assert.equal(
    editablePlanJobId({ jobs: JOBS, draftJobId: null, liveJobId: null, editLive: true, startPlan: false }),
    null,
  );
});
