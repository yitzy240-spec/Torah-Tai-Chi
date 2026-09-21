// dashboard/src/lib/seed-scripts.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptsToSeed } from './seed-scripts.ts';
import type { CandidateScript } from './seed-scripts.ts';

const candidates: CandidateScript[] = ['A', 'B', 'C', 'A-tight'].map((option) => ({
  option,
  title: `${option} title`,
  style_note: `${option} note`,
  draft: `${option} draft`,
}));

const options = (rows: CandidateScript[]) => rows.map((r) => r.option);

test('a parsha with no scripts gets the full set', () => {
  assert.deepEqual(options(scriptsToSeed([], candidates)), ['A', 'B', 'C', 'A-tight']);
});

test('an empty placeholder row does not count as written', () => {
  const existing = [{ option: 'A-tight', draft_text: '' }];
  assert.deepEqual(options(scriptsToSeed(existing, candidates)), ['A', 'B', 'C', 'A-tight']);
});

test('whitespace-only text does not count as written either', () => {
  const existing = [{ option: 'A-tight', draft_text: '   \n  ' }];
  assert.ok(options(scriptsToSeed(existing, candidates)).includes('A-tight'));
});

test('null draft_text does not count as written', () => {
  const existing = [{ option: 'B', draft_text: null }];
  assert.ok(options(scriptsToSeed(existing, candidates)).includes('B'));
});

// The regression this file exists for. A half-seeded parsha — A written, the
// rest missing — must still receive B, C and A-tight. The per-parsha guard
// this replaced returned nothing here and left the parsha permanently short.
test('a half-seeded parsha still receives its remaining options', () => {
  const existing = [
    { option: 'A', draft_text: 'The Torah holds you responsible…' },
    { option: 'A-tight', draft_text: '' },
  ];
  assert.deepEqual(options(scriptsToSeed(existing, candidates)), ['B', 'C', 'A-tight']);
});

test("an operator's written draft is never overwritten", () => {
  const existing = candidates.map((c) => ({ option: c.option, draft_text: 'hand written' }));
  assert.deepEqual(scriptsToSeed(existing, candidates), []);
});

test('re-running after a complete pass is a no-op', () => {
  const afterSeeding = candidates.map((c) => ({ option: c.option, draft_text: c.draft }));
  assert.deepEqual(scriptsToSeed(afterSeeding, candidates), []);
});
