// dashboard/src/lib/phase-1-data.test.ts
//
// QA battery for the "Phase 1 defaults to the draft's script" data-loss fix.
// Lives in src/lib (not colocated) because CI runs `src/lib/*.test.ts` — the
// [slug] bracket dir breaks shell globs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPhase1Props,
  shouldStartNewPlan,
} from '../app/videos/[slug]/_data/phase-1-data.ts';

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

const s = (id: string, option: string): Script => ({ id, option, title: null, draft_text: null });
const A_TIGHT = s('s-atight', 'A-tight');
const A = s('s-a', 'A');
const B = s('s-b', 'B');
const CUSTOM = s('s-custom', 'custom');

// ── getPhase1Props: default-script resolution ────────────────────────────────

test('getPhase1Props: no draft → A-tight wins', () => {
  assert.equal(getPhase1Props(parsha([B, A, A_TIGHT]))?.scriptId, 's-atight');
});

test('getPhase1Props: no draft, no A-tight → A wins', () => {
  assert.equal(getPhase1Props(parsha([B, A]))?.scriptId, 's-a');
});

test('getPhase1Props: no draft, no A/A-tight → first script wins', () => {
  assert.equal(getPhase1Props(parsha([B, CUSTOM]))?.scriptId, 's-b');
});

test('getPhase1Props: draft script is PREFERRED over A-tight (the fix)', () => {
  const p = getPhase1Props(parsha([A_TIGHT, CUSTOM]), 's-custom');
  assert.equal(p?.scriptId, 's-custom');
  assert.equal(p?.defaultScript.id, 's-custom');
});

test('getPhase1Props: draft script == A-tight → still A-tight (no-op, no regression)', () => {
  assert.equal(getPhase1Props(parsha([A_TIGHT, CUSTOM]), 's-atight')?.scriptId, 's-atight');
});

test('getPhase1Props: draft scriptId missing from scripts → falls back to A-tight', () => {
  assert.equal(getPhase1Props(parsha([A_TIGHT, CUSTOM]), 's-deleted')?.scriptId, 's-atight');
});

test('getPhase1Props: draft scriptId null/undefined → A-tight', () => {
  assert.equal(getPhase1Props(parsha([A_TIGHT]), null)?.scriptId, 's-atight');
  assert.equal(getPhase1Props(parsha([A_TIGHT]), undefined)?.scriptId, 's-atight');
});

test('getPhase1Props: no scripts → null (Phase 1 shows the generating placeholder)', () => {
  assert.equal(getPhase1Props(parsha([])), null);
});

// ── shouldStartNewPlan: the data-loss gate ───────────────────────────────────

test('shouldStartNewPlan: no draft plan → start one (first run)', () => {
  assert.equal(shouldStartNewPlan({ draftScriptId: null, requestedScriptId: 's-atight' }), true);
});

test('shouldStartNewPlan: SAME script → reuse, never orphan (the fix invariant)', () => {
  assert.equal(shouldStartNewPlan({ draftScriptId: 's-custom', requestedScriptId: 's-custom' }), false);
});

test('shouldStartNewPlan: DIFFERENT script → deliberate regenerate', () => {
  assert.equal(shouldStartNewPlan({ draftScriptId: 's-custom', requestedScriptId: 's-atight' }), true);
});

// ── Integration invariant: the round-trip that lost Yonah's work ─────────────
// Operator built the draft from a non-default script, went Back to Phase 1, and
// pressed Generate WITHOUT changing scripts. Phase 1's preselected script id is
// fed straight into the decision. It must resolve to "reuse", never "regen".

for (const draftScriptId of ['s-custom', 's-a', 's-b', 's-atight']) {
  test(`round-trip no-op: draft from ${draftScriptId} → Generate → no regen`, () => {
    const props = getPhase1Props(parsha([A_TIGHT, A, B, CUSTOM]), draftScriptId);
    // What the Generate button will carry = props.scriptId (Pick tab default).
    const regen = shouldStartNewPlan({
      draftScriptId,
      requestedScriptId: props!.scriptId,
    });
    assert.equal(props!.scriptId, draftScriptId, 'Phase 1 must preselect the draft script');
    assert.equal(regen, false, 'round-trip Generate must NOT regenerate/orphan');
  });
}

// Deliberate change still regenerates (the legitimate "redo with a different
// script" flow must keep working).
test('deliberate script change still regenerates', () => {
  const draftScriptId = 's-custom';
  // Operator explicitly picks A-tight in the Pick tab, overriding the default.
  const regen = shouldStartNewPlan({ draftScriptId, requestedScriptId: 's-atight' });
  assert.equal(regen, true);
});
