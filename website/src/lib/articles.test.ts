// Run: node --test --experimental-strip-types src/lib/articles.test.ts  (from website/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiptapJsonToHtml, isPreviewAuthorized } from './articles.ts';

test('bullet list renders with li items (regression guard)', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
      ] },
    ],
  };
  assert.equal(tiptapJsonToHtml(doc), '<ul><li><p>A</p></li><li><p>B</p></li></ul>');
});

test('table renders as semantic table with header row', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Breakdown' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Response' }] }] },
        ] },
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fear' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Return to center' }] }] },
        ] },
      ] },
    ],
  };
  assert.equal(
    tiptapJsonToHtml(doc),
    '<table><tbody>'
    + '<tr><th><p>Breakdown</p></th><th><p>Response</p></th></tr>'
    + '<tr><td><p>Fear</p></td><td><p>Return to center</p></td></tr>'
    + '</tbody></table>'
  );
});

test('link href is attribute-escaped', () => {
  const doc = { type: 'doc', content: [ { type: 'paragraph', content: [
    { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://a.com/?x=1&y="2"' } }] }
  ] } ] };
  assert.equal(tiptapJsonToHtml(doc), '<p><a href="https://a.com/?x=1&amp;y=&quot;2&quot;">x</a></p>');
});

test('isPreviewAuthorized requires exact non-empty token match', () => {
  assert.equal(isPreviewAuthorized('abc', 'abc'), true);
  assert.equal(isPreviewAuthorized('abc', 'xyz'), false);
  assert.equal(isPreviewAuthorized('', ''), false);        // empty expected => never authorize
  assert.equal(isPreviewAuthorized(undefined, 'abc'), false);
  assert.equal(isPreviewAuthorized('abc', undefined), false);
});
