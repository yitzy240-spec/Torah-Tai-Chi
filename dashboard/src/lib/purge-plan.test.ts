// dashboard/src/lib/purge-plan.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPurge, type PurgeInput } from './purge-plan.ts';

function input(over: Partial<PurgeInput> = {}): PurgeInput {
  return {
    liveJobId: 'live',
    liveVideoId: 'v-live',
    liveScriptId: 's-live',
    allJobs: [{ id: 'live', status: 'done', script_id: 's-live', regen_of_job_id: null }],
    allVideos: [{ id: 'v-live', job_id: 'live' }],
    allScriptIds: ['s-live'],
    keptClipOwnerJobIds: [],
    ...over,
  };
}

test('finished jobs are purged', () => {
  const plan = planPurge(input({
    allJobs: [
      { id: 'live', status: 'done', script_id: 's-live', regen_of_job_id: null },
      { id: 'd', status: 'done', script_id: null, regen_of_job_id: null },
      { id: 'f', status: 'failed', script_id: null, regen_of_job_id: null },
      { id: 'c', status: 'cancelled', script_id: null, regen_of_job_id: null },
    ],
  }));
  assert.deepEqual(plan.jobsToPurge, ['d', 'f', 'c']);
});

test('queued and every in-flight job are kept', () => {
  const statuses = ['queued', 'loading_parsha', 'generating_plan', 'uploading_refs',
    'generating_clips', 'verifying', 'stitching'];
  const plan = planPurge(input({
    allJobs: statuses.map((s) => ({ id: s, status: s, script_id: null, regen_of_job_id: null })),
  }));
  assert.deepEqual(plan.jobsToPurge, []);
  for (const s of statuses) assert.ok(plan.jobsToKeep.has(s), s);
});

test('a finished job owning a kept (compose) clip is kept, so the clip does not cascade away', () => {
  const plan = planPurge(input({
    allJobs: [
      { id: 'live', status: 'done', script_id: null, regen_of_job_id: null },
      { id: 'owner', status: 'done', script_id: null, regen_of_job_id: null },
    ],
    keptClipOwnerJobIds: ['owner'],
  }));
  assert.deepEqual(plan.jobsToPurge, []);
});

test("a kept job's video and script are not purged", () => {
  const plan = planPurge(input({
    allJobs: [
      { id: 'live', status: 'done', script_id: 's-live', regen_of_job_id: null },
      { id: 'q', status: 'queued', script_id: 's-q', regen_of_job_id: null },
      { id: 'old', status: 'done', script_id: 's-old', regen_of_job_id: null },
    ],
    allVideos: [
      { id: 'v-live', job_id: 'live' },
      { id: 'v-q', job_id: 'q' },
      { id: 'v-old', job_id: 'old' },
    ],
    allScriptIds: ['s-live', 's-q', 's-old'],
  }));
  assert.deepEqual(plan.videosToPurge, ['v-old']);
  assert.deepEqual(plan.scriptsToPurge, ['s-old']);
});

test("an unfinished job's parent chain is kept (its worker reads the parent's plan + clips)", () => {
  const plan = planPurge(input({
    allJobs: [
      { id: 'live', status: 'done', script_id: null, regen_of_job_id: null },
      { id: 'plan', status: 'done', script_id: null, regen_of_job_id: 'grand' },
      { id: 'grand', status: 'done', script_id: null, regen_of_job_id: null },
      { id: 'clips', status: 'queued', script_id: null, regen_of_job_id: 'plan' },
      { id: 'old', status: 'failed', script_id: null, regen_of_job_id: 'plan' },
    ],
  }));
  assert.deepEqual(plan.jobsToPurge, ['old']);
});
