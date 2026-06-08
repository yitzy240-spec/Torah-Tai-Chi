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

test('preserves a single space between adjacent inline elements', () => {
  const input = `<p><strong>bold</strong> <em>italic</em></p>`;
  assert.equal(cleanWordHtml(input), '<p><strong>bold</strong> <em>italic</em></p>');
});

test('still strips structural newlines/indentation between block tags', () => {
  const input = `<ul>\n  <li>A</li>\n  <li>B</li>\n</ul>`;
  // With the run-together fix, between-tag whitespace containing a newline/tab
  // collapses to a single space (harmless in the editor) rather than empty string.
  assert.equal(cleanWordHtml(input), '<ul> <li>A</li> <li>B</li> </ul>');
});

test('removes paragraphs that are empty after stripping inline wrappers', () => {
  assert.equal(cleanWordHtml('<p>Keep</p><p><span></span></p><p><o:p></o:p></p>'), '<p>Keep</p>');
});

test('collapses a line-break between inline spans to a single space (no run-together)', () => {
  assert.equal(cleanWordHtml('<p><span>happens</span>\r\n<span>when</span></p>'), '<p>happens when</p>');
});

test('strips a leading bullet glyph + tab from list-style paragraphs', () => {
  assert.equal(cleanWordHtml('<p>•\tPerception fractures</p>'), '<p>Perception fractures</p>');
  assert.equal(cleanWordHtml('<li>\t one</li>'), '<li>one</li>');
});

test('still preserves a real inline word space and clean lists/tables (regression)', () => {
  assert.equal(cleanWordHtml('<p><strong>bold</strong> <em>italic</em></p>'), '<p><strong>bold</strong> <em>italic</em></p>');
  assert.equal(cleanWordHtml('<ul><li>A</li><li>B</li></ul>'), '<ul><li>A</li><li>B</li></ul>');
});
