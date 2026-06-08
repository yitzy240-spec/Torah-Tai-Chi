// Run: node --test --experimental-strip-types src/lib/clean-word-html.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanWordHtml } from './clean-word-html.ts';

test('strips MS Office conditional comments', () => {
  const input = `<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>Hello</p>`;
  assert.equal(cleanWordHtml(input), '<p>Hello</p>');
});

test('removes o:p and other office namespace tags but keeps inner text', () => {
  const input = `<p>Real<o:p></o:p> text</p>`;
  assert.equal(cleanWordHtml(input), '<p>Real text</p>');
});

test('strips style, class, lang and mso attributes from tags', () => {
  const input = `<p class="MsoNormal" style="margin:0in;mso-pagination:none" lang="EN-US">Body</p>`;
  assert.equal(cleanWordHtml(input), '<p>Body</p>');
});

test('drops empty paragraphs left by Word', () => {
  const input = `<p>Keep</p><p>&nbsp;</p><p>  </p>`;
  assert.equal(cleanWordHtml(input), '<p>Keep</p>');
});

test('preserves list and table structure', () => {
  const input = `<ul style="x"><li class="MsoListParagraph">A</li></ul><table border=1><tr><td style="y">C</td></tr></table>`;
  assert.equal(
    cleanWordHtml(input),
    '<ul><li>A</li></ul><table><tr><td>C</td></tr></table>'
  );
});
