// dashboard/src/lib/clip-versions.test.ts
//
// Each Phase 2 version chip must carry the scene direction of ITS OWN clips
// row, never the plan's latest direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVersionsByIndex, versionNumberOf, type RenderedClipRow, type JobTier } from './clip-versions.ts';

function row(id: string, index: number, jobId: string, createdAt: string, visualPrompt: string | null): RenderedClipRow {
  return {
    id,
    index,
    job_id: jobId,
    storage_path: `jobs/${jobId}/clips/clip_${String(index).padStart(2, '0')}.mp4`,
    created_at: createdAt,
    visual_prompt: visualPrompt,
  };
}

const tiers = new Map<string, JobTier>([
  ['j-old', { resolution: '720p', modelTier: 'standard' }],
  ['j-new', { resolution: '1080p', modelTier: 'fast' }],
]);

test('each version keeps the direction from its own row', () => {
  // Newest-first, as phase-2-data orders them.
  const out = buildVersionsByIndex(
    [
      row('c-new', 3, 'j-new', '2026-11-04T12:00:00Z', 'Static camera. Rav Eli bows.'),
      row('c-old', 3, 'j-old', '2026-11-03T12:00:00Z', 'Slow push-in on Rav Eli.'),
    ],
    tiers,
  );
  const v = out.get(3)!;
  assert.equal(v.length, 2);
  assert.equal(v[0].clipId, 'c-new');
  assert.equal(v[0].visualPrompt, 'Static camera. Rav Eli bows.');
  assert.equal(v[1].clipId, 'c-old');
  assert.equal(v[1].visualPrompt, 'Slow push-in on Rav Eli.');
});

test('older version does not inherit the newest direction', () => {
  const out = buildVersionsByIndex(
    [
      row('c3', 0, 'j-new', '2026-11-04T12:00:00Z', 'LATEST'),
      row('c2', 0, 'j-old', '2026-11-04T11:00:00Z', 'middle'),
      row('c1', 0, 'j-old', '2026-11-04T10:00:00Z', 'first'),
    ],
    tiers,
  );
  const older = out.get(0)!.slice(1);
  assert.deepEqual(older.map((x) => x.visualPrompt), ['middle', 'first']);
  assert.ok(older.every((x) => x.visualPrompt !== 'LATEST'));
});

test('versions are grouped per index and carry their job tier', () => {
  const out = buildVersionsByIndex(
    [
      row('a', 0, 'j-new', '2026-11-04T12:00:00Z', 'zero'),
      row('b', 1, 'j-old', '2026-11-04T11:00:00Z', 'one'),
    ],
    tiers,
  );
  assert.deepEqual([...out.keys()].sort(), [0, 1]);
  assert.deepEqual(out.get(0), [
    {
      clipId: 'a',
      jobId: 'j-new',
      storagePath: 'jobs/j-new/clips/clip_00.mp4',
      createdAt: '2026-11-04T12:00:00Z',
      resolution: '1080p',
      modelTier: 'fast',
      visualPrompt: 'zero',
    },
  ]);
  assert.equal(out.get(1)![0].resolution, '720p');
});

test('missing or blank direction becomes null, not someone else\'s text', () => {
  const out = buildVersionsByIndex(
    [
      row('c-new', 2, 'j-new', '2026-11-04T12:00:00Z', 'newest'),
      row('c-blank', 2, 'j-old', '2026-11-04T11:00:00Z', '   '),
      row('c-null', 2, 'j-unknown', '2026-11-04T10:00:00Z', null),
    ],
    tiers,
  );
  const v = out.get(2)!;
  assert.equal(v[1].visualPrompt, null);
  assert.equal(v[2].visualPrompt, null);
  assert.equal(v[2].resolution, null);
  assert.equal(v[2].modelTier, null);
});

test('no rows -> empty map', () => {
  assert.equal(buildVersionsByIndex([], tiers).size, 0);
});

test('versionNumberOf: v1 is the oldest, newest gets the highest number', () => {
  const v = buildVersionsByIndex(
    [
      row('c3', 0, 'j-new', '2026-11-04T12:00:00Z', 'x'),
      row('c2', 0, 'j-old', '2026-11-04T11:00:00Z', 'y'),
      row('c1', 0, 'j-old', '2026-11-04T10:00:00Z', 'z'),
    ],
    tiers,
  ).get(0)!;
  assert.equal(versionNumberOf(v, 'c3'), 3);
  assert.equal(versionNumberOf(v, 'c2'), 2);
  assert.equal(versionNumberOf(v, 'c1'), 1);
  assert.equal(versionNumberOf(v, 'nope'), null);
});
