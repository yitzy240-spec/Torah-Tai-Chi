// Run: node --test --experimental-strip-types src/lib/articles.test.ts  (from website/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiptapJsonToHtml, isPreviewAuthorized, sortArticlesNewestFirst } from './articles.ts';

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

test('sortArticlesNewestFirst orders by published_at desc, undated last', () => {
  const mk = (slug, published_at) => ({ slug, published_at });
  const out = sortArticlesNewestFirst([
    mk('feb', '2026-02-21T12:00:00Z'),
    mk('jun', '2026-06-08T10:42:08Z'),  // newer; was sorting last when content date blank
    mk('nodate', null),
    mk('apr', '2026-04-12T12:00:00Z'),
  ]);
  assert.deepEqual(out.map((a) => a.slug), ['jun', 'apr', 'feb', 'nodate']);
});

test('isPreviewAuthorized requires exact non-empty token match', () => {
  assert.equal(isPreviewAuthorized('abc', 'abc'), true);
  assert.equal(isPreviewAuthorized('abc', 'xyz'), false);
  assert.equal(isPreviewAuthorized('', ''), false);        // empty expected => never authorize
  assert.equal(isPreviewAuthorized(undefined, 'abc'), false);
  assert.equal(isPreviewAuthorized('abc', undefined), false);
});

test('image node renders an escaped figure/img', () => {
  const doc = { type: 'doc', content: [
    { type: 'image', attrs: { src: 'https://a.storyblok.com/f/1/x.jpg', alt: 'A "view"' } },
  ] };
  assert.equal(
    tiptapJsonToHtml(doc),
    '<figure><img src="https://a.storyblok.com/f/1/x.jpg" alt="A &quot;view&quot;" loading="lazy"></figure>'
  );
});

test('image with no alt still renders', () => {
  const doc = { type: 'doc', content: [ { type: 'image', attrs: { src: 'https://a.storyblok.com/f/1/y.png' } } ] };
  assert.equal(tiptapJsonToHtml(doc), '<figure><img src="https://a.storyblok.com/f/1/y.png" alt="" loading="lazy"></figure>');
});
