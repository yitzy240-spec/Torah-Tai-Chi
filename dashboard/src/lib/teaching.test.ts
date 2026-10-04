// dashboard/src/lib/teaching.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teachingOf, sameTeachingJobIds, type JobForTeaching } from './teaching.ts';

// Bereishit across two years. Last year: an AI-script plan, a clips-only
// render under it, a compose of that render. This year: Yonah's own script,
// its plan, a clips-only render, and two composes (v1, then a re-stitch v2).
const JOBS: JobForTeaching[] = [
  { id: 'y1-plan', script_id: 's-ai-atight', regen_of_job_id: null },
  { id: 'y1-clips', script_id: null, regen_of_job_id: 'y1-plan' },
  { id: 'y1-compose', script_id: 's-ai-atight', regen_of_job_id: 'y1-clips' },
  { id: 'y2-plan', script_id: 's-custom-yonah', regen_of_job_id: null },
  { id: 'y2-clips', script_id: null, regen_of_job_id: 'y2-plan' },
  { id: 'y2-compose-v1', script_id: 's-custom-yonah', regen_of_job_id: 'y2-clips' },
  { id: 'y2-compose-v2', script_id: 's-custom-yonah', regen_of_job_id: 'y2-clips' },
];

test('teachingOf: a job carrying script_id is its own answer', () => {
  assert.equal(teachingOf(JOBS, 'y2-plan'), 's-custom-yonah');
});

test('teachingOf: clips-only walks up to its plan', () => {
  assert.equal(teachingOf(JOBS, 'y1-clips'), 's-ai-atight');
});

test('teachingOf: compose copies script_id from its reference job', () => {
  assert.equal(teachingOf(JOBS, 'y2-compose-v2'), 's-custom-yonah');
});

test('teachingOf: compose of a clips-only job with NULL script still resolves', () => {
  // compose-video.ts copies refJob.script_id — NULL when the reference is a
  // clips-only job — so the walk has to continue through it.
  const jobs: JobForTeaching[] = [
    { id: 'plan', script_id: 's1', regen_of_job_id: null },
    { id: 'clips', script_id: null, regen_of_job_id: 'plan' },
    { id: 'compose', script_id: null, regen_of_job_id: 'clips' },
  ];
  assert.equal(teachingOf(jobs, 'compose'), 's1');
});

test('teachingOf: unknown when the chain leaves the job list', () => {
  const jobs: JobForTeaching[] = [{ id: 'orphan', script_id: null, regen_of_job_id: 'not-here' }];
  assert.equal(teachingOf(jobs, 'orphan'), null);
});

test('teachingOf: a cycle terminates', () => {
  const jobs: JobForTeaching[] = [
    { id: 'a', script_id: null, regen_of_job_id: 'b' },
    { id: 'b', script_id: null, regen_of_job_id: 'a' },
  ];
  assert.equal(teachingOf(jobs, 'a'), null);
});

test('publishing this year’s re-stitch replaces only this year’s earlier cut', () => {
  const siblings = sameTeachingJobIds(JOBS, 'y2-compose-v2').sort();
  assert.deepEqual(siblings, ['y2-clips', 'y2-compose-v1', 'y2-compose-v2', 'y2-plan']);
  // Last year's teaching is untouched — its video stays on the site.
  assert.ok(!siblings.includes('y1-compose'));
});

test('an unknown teaching matches nothing, so publishing it unpublishes nothing', () => {
  const jobs: JobForTeaching[] = [
    ...JOBS,
    { id: 'legacy-a', script_id: null, regen_of_job_id: null },
    { id: 'legacy-b', script_id: null, regen_of_job_id: null },
  ];
  assert.deepEqual(sameTeachingJobIds(jobs, 'legacy-a'), []);
});
