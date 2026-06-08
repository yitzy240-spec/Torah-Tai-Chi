// Run: node --test --experimental-strip-types src/lib/tiptap-text.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiptapJsonToText } from './tiptap-text.ts';

const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

test('joins block text with newlines', () => {
  const doc = { type: 'doc', content: [p('First.'), p('Second.')] };
  assert.equal(tiptapJsonToText(doc), 'First.\nSecond.');
});

test('headings and nested marks render as text', () => {
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    ] },
  ] };
  assert.equal(tiptapJsonToText(doc), 'Title\na bold');
});

test('list items are separate lines', () => {
  const doc = { type: 'doc', content: [
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p('one')] },
      { type: 'listItem', content: [p('two')] },
    ] },
  ] };
  assert.equal(tiptapJsonToText(doc), 'one\ntwo');
});

test('null / non-object / empty doc returns empty string', () => {
  assert.equal(tiptapJsonToText(null), '');
  assert.equal(tiptapJsonToText(undefined), '');
  assert.equal(tiptapJsonToText({ type: 'doc', content: [] }), '');
});
