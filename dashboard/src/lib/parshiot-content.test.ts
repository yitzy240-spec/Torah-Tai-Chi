// dashboard/src/lib/parshiot-content.test.ts
//
// Guards the content source itself, not the code that reads it.
//
// parshiot.json shipped with 52 of the 54 weekly portions: orders 18
// (Mishpatim) and 49 (Ki Teitzei) were absent, so those two parshiot had no
// draft scripts at all. Nothing failed — the seed script faithfully seeded
// what it was given, and the gap surfaced only when Ki Teitzei came up as
// this week's parsha and Yonah found an empty screen.
//
// A missing parsha is a content bug that a build can catch, so it should be
// caught here rather than on a Friday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Script = { option: string; title: string; style_note: string; draft: string };
type Parsha = { order: number; name: string; book: string; scripts: Script[] };

const data = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../parshiot.json'), 'utf8'),
) as { parshiot: Parsha[] };

const REQUIRED_OPTIONS = ['A', 'A-tight', 'B', 'C'];

test('parshiot.json covers all 54 weekly portions, one entry each', () => {
  const orders = data.parshiot.map((p) => p.order);
  const missing = Array.from({ length: 54 }, (_, i) => i + 1).filter(
    (o) => !orders.includes(o),
  );
  assert.deepEqual(missing, [], `parshiot.json is missing order(s): ${missing.join(', ')}`);
  assert.equal(new Set(orders).size, orders.length, 'duplicate order numbers');
});

test('every parsha carries the full set of script options', () => {
  for (const p of data.parshiot) {
    const options = p.scripts.map((s) => s.option).sort();
    assert.deepEqual(options, REQUIRED_OPTIONS, `${p.name} has options: ${options.join(', ')}`);
  }
});

test('no script ships empty — title, style_note and draft all present', () => {
  for (const p of data.parshiot) {
    for (const s of p.scripts) {
      assert.ok(s.title?.trim(), `${p.name}/${s.option} has no title`);
      assert.ok(s.style_note?.trim(), `${p.name}/${s.option} has no style_note`);
      assert.ok(s.draft?.trim(), `${p.name}/${s.option} has no draft`);
    }
  }
});

test('A/B/C drafts keep the four-section shape; A-tight runs label-free', () => {
  for (const p of data.parshiot) {
    for (const s of p.scripts) {
      if (s.option === 'A-tight') {
        assert.ok(!s.draft.includes('[HOOK]'), `${p.name}/A-tight should not carry section labels`);
        continue;
      }
      for (const label of ['[HOOK]', '[TEACHING]', '[APPLICATION]', '[CTA]']) {
        assert.ok(s.draft.includes(label), `${p.name}/${s.option} is missing ${label}`);
      }
    }
  }
});
