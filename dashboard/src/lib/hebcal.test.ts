// dashboard/src/lib/hebcal.test.ts
//
// Regression coverage for the 2026-06-01 incident: Hebcal switched from
// straight (`'`) to curly (`'`, U+2019) apostrophes in parsha titles
// (`Beha'alotcha`, `Sh'lach`, `Re'eh`, `Ha'Azinu`), which our exact-
// string HEBCAL_TO_SLUG lookup silently missed. The dashboard then fell
// through to the next-resolvable parsha and showed Korach (June 20) as
// "next" when today was June 1 and Beha'alotcha was actually next.
//
// These tests pin the punctuation-insensitive lookup so the same shape
// of bug can't return.
//
// Run: node --test --experimental-strip-types src/lib/hebcal.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBCAL_TO_SLUG,
  PARSHA_DB_SLUGS,
  resolveParshaSlug,
  getUnresolvedHebcalNames,
  _resetUnresolvedHebcalNamesForTest,
} from './hebcal-slug.ts';

// Silence the loud-failure log during tests — assertions on
// getUnresolvedHebcalNames() are the actual verification.
const originalConsoleError = console.error;
console.error = () => {};

// ─────────────────────────────────────────────────────────────────────────
// Regression: curly apostrophes (U+2019) from Hebcal must resolve
// ─────────────────────────────────────────────────────────────────────────

const APOSTROPHE_PARSHIOT: Array<[string, string]> = [
  ['Parashat Beha’alotcha', 'beha-alotcha'],  // U+2019 RIGHT SINGLE QUOTATION MARK
  ['Parashat Sh’lach',       'shelach'],
  ['Parashat Re’eh',         're-eh'],
  ['Parashat Ha’Azinu',      'ha-azinu'],
  // Straight-apostrophe variants — must still work
  ["Parashat Beha'alotcha", 'beha-alotcha'],  // U+0027 APOSTROPHE
  ["Parashat Sh'lach",       'shelach'],
  // No-prefix variants — Hebcal sometimes omits "Parashat "
  ['Beha’alotcha',           'beha-alotcha'],
  // Casing variants — defensive against future drift
  ['Parashat BEHA’ALOTCHA',  'beha-alotcha'],
  // Extra whitespace
  ['Parashat   Beha’alotcha  ', 'beha-alotcha'],
];

for (const [title, expectedSlug] of APOSTROPHE_PARSHIOT) {
  test(`hebcal: resolveParshaSlug(${JSON.stringify(title)}) -> ${expectedSlug}`, () => {
    _resetUnresolvedHebcalNamesForTest();
    assert.equal(resolveParshaSlug(title), expectedSlug);
    assert.deepEqual(getUnresolvedHebcalNames(), [], 'no unresolved names expected');
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Defensive: every key in HEBCAL_TO_SLUG resolves to its mapped slug
// under the normalizer (catches typos / future map edits)
// ─────────────────────────────────────────────────────────────────────────

test('hebcal: every HEBCAL_TO_SLUG key resolves to its mapped slug', () => {
  _resetUnresolvedHebcalNamesForTest();
  for (const [hebcalName, expectedSlug] of Object.entries(HEBCAL_TO_SLUG)) {
    assert.equal(
      resolveParshaSlug(hebcalName),
      expectedSlug,
      `${hebcalName} should resolve to ${expectedSlug}`,
    );
  }
  assert.deepEqual(getUnresolvedHebcalNames(), [], 'no HEBCAL_TO_SLUG key should be self-unresolvable');
});

// ─────────────────────────────────────────────────────────────────────────
// Cross-validation: every map value must be a real parshiot DB slug.
// If this fails, the Today page's `.eq('slug', …)` lookup will return
// null and silently fall through to the next-resolvable parsha — which
// is exactly the 2026-06-01 Beha'alotcha → Korach incident.
// ─────────────────────────────────────────────────────────────────────────

test('hebcal: every HEBCAL_TO_SLUG value matches a known parshiot DB slug', () => {
  for (const [hebcalName, slug] of Object.entries(HEBCAL_TO_SLUG)) {
    assert.ok(
      PARSHA_DB_SLUGS.has(slug),
      `${hebcalName} -> ${slug} is not a real DB slug (PARSHA_DB_SLUGS). The Today page lookup will return null and the card will mis-render.`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Loud-failure: a genuinely unmapped title gets recorded
// ─────────────────────────────────────────────────────────────────────────

test('hebcal: unmapped title is recorded in getUnresolvedHebcalNames()', () => {
  _resetUnresolvedHebcalNamesForTest();
  assert.equal(resolveParshaSlug('Parashat NotARealParsha'), null);
  assert.deepEqual(getUnresolvedHebcalNames(), ['NotARealParsha']);
});

test('hebcal: repeated unmapped titles only recorded once (no log spam)', () => {
  _resetUnresolvedHebcalNamesForTest();
  resolveParshaSlug('Parashat NotARealParsha');
  resolveParshaSlug('Parashat NotARealParsha');
  resolveParshaSlug('Parashat NotARealParsha');
  assert.deepEqual(getUnresolvedHebcalNames(), ['NotARealParsha']);
});

// Restore console.error if anyone imports this file in another runner.
test('cleanup: restore console.error', () => {
  console.error = originalConsoleError;
});
