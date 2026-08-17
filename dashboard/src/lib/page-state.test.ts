// dashboard/src/lib/page-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPageState, hasScriptRows } from './page-state.ts';

const base = { jobs: [], videos: [], posts: [], clipsByJobId: {}, hasScripts: false };

test('empty: no jobs, no videos -> empty', () => {
  const s = selectPageState(base);
  assert.deepEqual(s, { kind: 'empty' });
});

test('draft-in-progress: in-flight job, no live video -> draft', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      {
        id: 'j1',
        status: 'generating_clips',
        kind: 'parsha',
        videoId: null,
        clipPlanId: 'cp1',
        completedAt: null,
        triggeredAt: '2026-05-17T00:00:00Z',
      },
    ],
    clipsByJobId: { j1: [{ storagePath: '/clips/0.mp4' }] },
  });
  assert.equal(s.kind, 'draft-in-progress');
  // Phase 3 was retired 2026-06-01 — clips with renders but no
  // stitched video now resolve to Phase 2 (the full editor).
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 2);
});

test('live-at-rest: published video, no draft -> live-at-rest', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      {
        id: 'j1',
        status: 'done',
        kind: 'parsha',
        videoId: 'v1',
        clipPlanId: 'cp1',
        completedAt: '2026-05-17T01:00:00Z',
        triggeredAt: '2026-05-17T00:00:00Z',
      },
    ],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: true }],
  });
  assert.deepEqual(s, { kind: 'live-at-rest', liveVideoId: 'v1' });
});

test('live-and-draft: published video AND a new in-flight job -> live-and-draft', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      {
        id: 'j1',
        status: 'done',
        kind: 'parsha',
        videoId: 'v1',
        clipPlanId: 'cp1',
        completedAt: '2026-05-17T01:00:00Z',
        triggeredAt: '2026-05-17T00:00:00Z',
      },
      {
        id: 'j2',
        status: 'generating_plan',
        kind: 'parsha',
        videoId: null,
        clipPlanId: null,
        completedAt: null,
        triggeredAt: '2026-05-17T02:00:00Z',
      },
    ],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: true }],
  });
  assert.equal(s.kind, 'live-and-draft');
});

test('phase 4 when draft has a stitched video but no live row yet', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      {
        id: 'j1',
        status: 'done',
        kind: 'parsha',
        videoId: 'v1',
        clipPlanId: 'cp1',
        completedAt: '2026-05-17T01:00:00Z',
        triggeredAt: '2026-05-17T00:00:00Z',
      },
    ],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: false }],
    // No posts -> not "live". Should be draft-in-progress phase 4.
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 4);
});

test('plan-only done counts as a draft awaiting clip rendering (phase 2)', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      {
        id: 'jp',
        status: 'done',
        kind: 'plan-only',
        videoId: null,
        clipPlanId: 'cp1',
        completedAt: '2026-05-17T00:30:00Z',
        triggeredAt: '2026-05-17T00:00:00Z',
      },
    ],
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 2);
});

test('script-only: hasScripts true, no jobs/videos -> phase 1 draft with null jobId', () => {
  const s = selectPageState({ ...base, hasScripts: true });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') {
    assert.equal(s.phase, 1);
    assert.equal(s.draftJobId, null);
  }
});

test('script-only WITH a live video -> live-and-draft phase 1 with null jobId', () => {
  const s = selectPageState({
    ...base,
    hasScripts: true,
    jobs: [
      {
        id: 'j1',
        status: 'done',
        kind: 'parsha',
        videoId: 'v1',
        clipPlanId: 'cp1',
        completedAt: '2026-05-17T01:00:00Z',
        triggeredAt: '2026-05-17T00:00:00Z',
      },
    ],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: true }],
  });
  assert.equal(s.kind, 'live-and-draft');
  if (s.kind === 'live-and-draft') {
    assert.equal(s.phase, 1);
    assert.equal(s.draftJobId, null);
  }
});

// ── hasScriptRows ──────────────────────────────────────────────────────────
//
// Regression guard for the "Start scripting does nothing" dead end
// (Yonah, Ki Teitzei, 2026-08-16). startFromEmpty writes a placeholder row
// with draft_text ''. shell-data used to require non-empty draft_text here,
// so the row never flipped the page out of 'empty' and the button appeared
// inert. A placeholder MUST count as a script.

test('hasScriptRows: no rows -> false', () => {
  assert.equal(hasScriptRows([]), false);
});

test('hasScriptRows: placeholder row with empty draft_text -> true', () => {
  assert.equal(hasScriptRows([{ id: 's1', option: 'A-tight', draft_text: '' }]), true);
});

test('hasScriptRows: written script -> true', () => {
  assert.equal(hasScriptRows([{ id: 's1', option: 'A-tight', draft_text: 'Shalom.' }]), true);
});

test('placeholder script alone opens Phase 1 rather than the empty state', () => {
  const s = selectPageState({
    ...base,
    hasScripts: hasScriptRows([{ id: 's1', option: 'A-tight', draft_text: '' }]),
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') {
    assert.equal(s.phase, 1);
    assert.equal(s.draftJobId, null);
  }
});
