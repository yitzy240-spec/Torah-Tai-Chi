// dashboard/src/lib/phase-1-data.test.ts
//
// Lives in src/lib (not colocated) because CI runs `src/lib/*.test.ts` — the
// [slug] bracket dir breaks shell globs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPhase1Props } from '../app/videos/[slug]/_data/phase-1-data.ts';

type Script = { id: string; option: string; title: string | null; draft_text: string | null };

function parsha(scripts: Script[]) {
  return {
    id: 'p1',
    name: 'Matot',
    book: 'Bamidbar',
    slug: 'matot',
    hebrew_name: null,
    scripts,
  } as unknown as Parameters<typeof getPhase1Props>[0];
}

const A_TIGHT: Script = { id: 's-atight', option: 'A-tight', title: null, draft_text: null };
const CUSTOM: Script = { id: 's-custom', option: 'custom', title: null, draft_text: null };

test('phase-1: defaults to A-tight when there is no draft yet', () => {
  const p = getPhase1Props(parsha([A_TIGHT, CUSTOM]));
  assert.equal(p?.scriptId, 's-atight');
});

test('phase-1: defaults to the DRAFT script, not A-tight (prevents wrong-script regen)', () => {
  // The draft was built from the custom script. Returning to Phase 1 must
  // preselect it so pressing Generate reuses the plan instead of regenerating
  // from A-tight and orphaning rendered clips.
  const p = getPhase1Props(parsha([A_TIGHT, CUSTOM]), 's-custom');
  assert.equal(p?.scriptId, 's-custom');
  assert.equal(p?.defaultScript.id, 's-custom');
});

test('phase-1: falls back to A-tight when the draft script id no longer exists', () => {
  const p = getPhase1Props(parsha([A_TIGHT]), 's-deleted');
  assert.equal(p?.scriptId, 's-atight');
});

test('phase-1: returns null when there are no scripts', () => {
  assert.equal(getPhase1Props(parsha([])), null);
});
