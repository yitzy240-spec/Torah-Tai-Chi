// Run: node --test --experimental-strip-types src/lib/job-stream-generation.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventForGeneration } from './job-stream-generation.ts';

const done = { stage: 'done', videoPath: 'jobs/j/a.mp4' };

test('an event from the current generation is returned', () => {
  assert.equal(eventForGeneration({ generation: 0, event: done }, 0), done);
});

test('a stale terminal event from before a re-stitch is hidden', () => {
  // Initial stitch broadcast 'done' on generation 0; operator hits
  // re-stitch, Phase 4 bumps to generation 1 in the same render.
  assert.equal(eventForGeneration({ generation: 0, event: done }, 1), null);
});

test('no event yet is null', () => {
  assert.equal(eventForGeneration({ generation: 1, event: null }, 1), null);
});
