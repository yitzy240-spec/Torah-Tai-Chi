# Article Editor Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard article editor usable for Yonah — visible bullet/heading markers, working tables (paste + light controls), clean Word paste, self-explanatory SEO fields, and a real-site draft preview.

**Architecture:** Articles are Storyblok-backed; body is stored as TipTap/ProseMirror JSON in a generic `body` JSON field (NOT Storyblok native richtext, so arbitrary nodes round-trip). The **website** is the single source of truth for rendering: `tiptapJsonToHtml` in `website/src/lib/articles.ts` recomputes HTML from `body_json` on every read (it also feeds the RSS feed). So each new content type touches four places: editor extension, that converter, website `.ad-body` CSS, editor CSS. The draft preview is a new `website/src/app/preview/[slug]` route that fetches Storyblok's draft version through the same shared rendering component, gated by an env token, marked `noindex`.

**Tech Stack:** Next.js (both apps, Tailwind v4), TipTap v3, Storyblok (Management + CDN APIs), Node built-in test runner (`node --test --experimental-strip-types`) for unit tests, Playwright (`tests/qa/`) for browser assertions.

**Testing seams (important):**
- **Pure functions** (`tiptapJsonToHtml` table cases, `cleanWordHtml`, `isPreviewAuthorized`, `buildPreviewUrl`) → fast `node --test` unit tests. This is the TDD backbone.
- **Browser/UI** (editor markers, table button, SEO captions, preview button) → Playwright assertions in `tests/qa/dashboard/tier1/article-publish.spec.ts`, which already mocks `/api/articles` at the browser layer via `installApiMocks`.
- **Server-side Storyblok draft fetch + full preview route** → not browser-mockable (server-side calls are invisible to `page.route()`); verified by the unit-tested helpers + a final manual deploy verification (Task 9), consistent with the project's "fixed means deployed" rule.

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `website/src/lib/articles.ts` | `tiptapJsonToHtml` (add table cases), add `getArticleDraftBySlug`, `isPreviewAuthorized`, `buildPreviewPath` | Modify |
| `website/src/lib/articles.test.ts` | Unit tests for converter + preview helpers | Create |
| `website/src/components/ArticleView.tsx` | Shared article render (header + body + endrail + related) extracted from `[slug]/page.tsx` | Create |
| `website/src/app/articles/[slug]/page.tsx` | Use `ArticleView` | Modify |
| `website/src/app/preview/[slug]/page.tsx` | Draft preview route (force-dynamic, noindex, token gate) | Create |
| `website/src/app/globals.css` | `.ad-body` list/h3/blockquote/a/table styles | Modify |
| `dashboard/src/components/article-editor.tsx` | Table extension + toolbar controls + list-style CSS + paste hook | Modify |
| `dashboard/src/lib/clean-word-html.ts` | Pure Word-HTML sanitizer | Create |
| `dashboard/src/lib/clean-word-html.test.ts` | Unit tests for sanitizer | Create |
| `dashboard/src/components/article-form.tsx` | SEO default captions + Preview button (when `previewUrl` prop present) | Modify |
| `dashboard/src/app/articles/[id]/edit/page.tsx` | Build preview URL server-side, pass to `ArticleForm` | Modify |
| `dashboard/.env.example`, `website/.env.local.example` | Document new env vars | Modify |
| `tests/qa/dashboard/tier1/article-publish.spec.ts` | Editor markers/table/SEO/preview-button assertions | Modify |

**New env vars:** `ARTICLE_PREVIEW_TOKEN` (both apps — website validates, dashboard signs the URL), `WEBSITE_BASE_URL` (dashboard, e.g. `https://torahtaichi.com`).

---

## Task 1: Converter — table support (+ list regression guard)

**Files:**
- Modify: `website/src/lib/articles.ts` (the `tiptapJsonToHtml` `switch` ~L60-69)
- Create: `website/src/lib/articles.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `website/src/lib/articles.test.ts`:

```ts
// Run: node --test --experimental-strip-types src/lib/articles.test.ts  (from website/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiptapJsonToHtml } from './articles.ts';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
Expected: the table test FAILS (table nodes fall through to `default` and emit only inner text); the list test should PASS already (regression guard).

- [ ] **Step 3: Add table cases to the converter**

In `website/src/lib/articles.ts`, in the `switch (n.type)` block (after the `blockquote` case, before `hardBreak`), add:

```ts
        case 'table': return `<table><tbody>${inner}</tbody></table>`;
        case 'tableRow': return `<tr>${inner}</tr>`;
        case 'tableHeader': return `<th>${inner}</th>`;
        case 'tableCell': return `<td>${inner}</td>`;
```

(Leave the existing `bulletList`/`orderedList`/`listItem` cases as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add website/src/lib/articles.ts website/src/lib/articles.test.ts
git commit -m "feat(website): render tables in article body converter"
```

---

## Task 2: Website `.ad-body` CSS — restore markers + table styling

**Files:**
- Modify: `website/src/app/globals.css` (after the `.ad-body h2` rule, ~L822)

No unit test (static CSS); verified visually in Task 9 via the preview route. The converter unit tests (Task 1) already prove the HTML structure is correct.

- [ ] **Step 1: Add the missing `.ad-body` rules**

In `website/src/app/globals.css`, immediately after the `.ad-body h2{...}` line (~L822), insert:

```css
.ad-body h3{font-family:var(--ff-display);font-weight:500;font-size:20px;letter-spacing:-.01em;margin:28px 0 12px 0;color:var(--ink-900);font-variation-settings:"opsz" 22,"SOFT" 30;}
.ad-body ul,.ad-body ol{margin:0 0 22px 0;padding-left:1.4em;font-family:var(--ff-reading);font-size:19px;line-height:1.65;color:var(--ink-800);}
.ad-body ul{list-style:disc outside;}
.ad-body ol{list-style:decimal outside;}
.ad-body li{margin:0 0 8px 0;padding-left:.2em;}
.ad-body blockquote{border-left:2px solid var(--cedar-400);margin:24px 0;padding:4px 0 4px 20px;font-style:italic;color:var(--ink-700);}
.ad-body a{color:var(--navy-700);text-decoration:underline;text-underline-offset:2px;}
.ad-body a:hover{color:var(--navy-900);}
.ad-body table{width:100%;border-collapse:collapse;margin:24px 0;font-family:var(--ff-reading);font-size:17px;line-height:1.5;display:block;overflow-x:auto;}
.ad-body th,.ad-body td{border:1px solid var(--ink-200);padding:10px 14px;text-align:left;vertical-align:top;}
.ad-body th{background:var(--linen-50);font-weight:600;color:var(--ink-900);}
.ad-body td p,.ad-body th p,.ad-body li p{margin:0;}
```

(If any `var(--…)` token doesn't resolve, check `website/src/app/globals.css` / design tokens for the nearest equivalent — `--navy-700`, `--cedar-400`, `--linen-50`, `--ink-200/700/800/900` are all used elsewhere in this file.)

- [ ] **Step 2: Verify lint/build**

Run: `cd website && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add website/src/app/globals.css
git commit -m "feat(website): style article body lists, h3, blockquote, links, tables"
```

---

## Task 3: Editor — table extension, toolbar controls, visible list markers

**Files:**
- Modify: `dashboard/package.json` (deps)
- Modify: `dashboard/src/components/article-editor.tsx`
- Modify: `tests/qa/dashboard/tier1/article-publish.spec.ts` (assertions)

- [ ] **Step 1: Install TipTap table extensions (match installed @tiptap version)**

Run: `cd dashboard && npm install @tiptap/extension-table@^3 @tiptap/extension-table-row@^3 @tiptap/extension-table-header@^3 @tiptap/extension-table-cell@^3`
Expected: four packages added at the same major (^3.x) as the existing `@tiptap/*`.

- [ ] **Step 2: Register the table extensions in the editor**

In `dashboard/src/components/article-editor.tsx`, add imports near the other extension imports (top of file):

```tsx
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
```

In the `extensions: [...]` array (after the `Placeholder.configure(...)` entry), add:

```tsx
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
```

- [ ] **Step 3: Fix invisible list markers in the editor CSS**

In the `<style>` block, replace the existing list rule:

```css
        .article-editor-content ul, .article-editor-content ol {
          margin: 0.8em 0 1.2em;
          padding-left: 1.6em;
        }
```

with:

```css
        .article-editor-content ul, .article-editor-content ol {
          margin: 0.8em 0 1.2em;
          padding-left: 1.6em;
        }
        .article-editor-content ul { list-style: disc outside; }
        .article-editor-content ol { list-style: decimal outside; }
```

And append table styles to the same `<style>` block (before its closing backtick):

```css
        .article-editor-content table { width: 100%; border-collapse: collapse; margin: 1em 0; }
        .article-editor-content th, .article-editor-content td { border: 1px solid var(--ink-200); padding: 6px 10px; text-align: left; vertical-align: top; }
        .article-editor-content th { background: var(--linen-50); font-weight: 600; }
        .article-editor-content .selectedCell { background: var(--navy-100); }
```

- [ ] **Step 4: Add the Insert-table button + in-cell controls to the toolbar**

In the toolbar JSX, after the Blockquote button (after its closing `</button>` ~L208), add a divider and the table controls. The row/column controls render only when the cursor is inside a table (`editor.isActive('table')`):

```tsx
        <div style={{ width: '1px', height: '22px', background: 'var(--ink-200)', margin: '0 4px' }} />

        <button
          type="button"
          title="Insert table"
          aria-label="Insert table"
          style={btnStyle(editor.isActive('table'))}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()
          }
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1"/>
            <path d="M1.5 6.5h13M1.5 10h13M6 2.5v11"/>
          </svg>
        </button>

        {editor.isActive('table') && (
          <>
            <button type="button" title="Add row" aria-label="Add row" style={btnStyle(false)}
              onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</button>
            <button type="button" title="Add column" aria-label="Add column" style={btnStyle(false)}
              onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</button>
            <button type="button" title="Delete row" aria-label="Delete row" style={btnStyle(false)}
              onClick={() => editor.chain().focus().deleteRow().run()}>−Row</button>
            <button type="button" title="Delete column" aria-label="Delete column" style={btnStyle(false)}
              onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</button>
            <button type="button" title="Delete table" aria-label="Delete table" style={btnStyle(false)}
              onClick={() => editor.chain().focus().deleteTable().run()}>✕Table</button>
          </>
        )}
```

(The +Row/+Col text buttons reuse `btnStyle`; they're intentionally text not icons to stay legible on mobile. Widen `btnStyle`'s fixed `width: '34px'` is fine — text buttons will expand via `padding`; if they look cramped, add `padding: '0 8px', width: 'auto'` to a variant, but keep it minimal.)

- [ ] **Step 5: Add Playwright assertions for markers + table**

In `tests/qa/dashboard/tier1/article-publish.spec.ts`, add a test (follow the existing pattern that opens the new-article page with `installApiMocks`, targets `.ProseMirror` for typing and `.article-editor-content` for DOM assertions):

```ts
test('bullet list shows visible markers and table inserts', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/articles/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.type('First point');
  await page.getByRole('button', { name: 'Bullet list' }).click();

  const li = page.locator('.article-editor-content li').first();
  await expect(li).toBeVisible();
  const marker = await li.evaluate((el) => getComputedStyle(el).listStyleType);
  expect(marker).not.toBe('none'); // bug was: markers invisible (Tailwind preflight)

  await page.getByRole('button', { name: 'Insert table' }).click();
  await expect(page.locator('.article-editor-content table')).toBeVisible();
  await expect(page.locator('.article-editor-content th')).toHaveCount(2);
});
```

- [ ] **Step 6: Run the assertions**

Run (dashboard dev server per the QA harness must be reachable at the configured baseURL):
`cd tests/qa && npx playwright test dashboard/tier1/article-publish.spec.ts -g "visible markers"`
Expected: PASS.

- [ ] **Step 7: Verify table JSON round-trips through Storyblok (de-risk)**

Manually (or via a scratch script): in the running dashboard, create a draft with a table, Save draft, reopen the edit page, confirm the table is still present in the editor. This confirms the generic `body` JSON field preserves table nodes (it is typed `body?: object`, not native richtext). If the table is stripped, STOP — the Storyblok field type needs checking before proceeding.
Expected: table persists across save/reload.

- [ ] **Step 8: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/components/article-editor.tsx tests/qa/dashboard/tier1/article-publish.spec.ts
git commit -m "feat(dashboard): tables + visible list markers in article editor"
```

---

## Task 4: Word-paste sanitizer

**Files:**
- Create: `dashboard/src/lib/clean-word-html.ts`
- Create: `dashboard/src/lib/clean-word-html.test.ts`
- Modify: `dashboard/src/components/article-editor.tsx` (wire into `editorProps.transformPastedHTML`)

Pure string→string transform (no DOM) so it's node-unit-testable and also runs in the browser paste hook. TipTap's schema parsing handles structural mapping (drops unsupported nodes/marks); this function strips the Word cruft that otherwise rides along on supported nodes.

- [ ] **Step 1: Write failing unit tests**

Create `dashboard/src/lib/clean-word-html.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && node --test --experimental-strip-types src/lib/clean-word-html.test.ts`
Expected: FAIL — `cleanWordHtml` not defined.

- [ ] **Step 3: Implement the sanitizer**

Create `dashboard/src/lib/clean-word-html.ts`:

```ts
/**
 * Strip Microsoft Word / Office paste cruft from an HTML string while keeping
 * structural tags (p, h2, h3, ul, ol, li, table, tr, td, th, a, strong, em, br).
 * Pure string transform — runs in Node (tests) and the browser (paste hook).
 * TipTap's own schema parsing then maps the cleaned HTML into supported nodes.
 */
export function cleanWordHtml(html: string): string {
  let out = html;
  // 1. Remove MS conditional comments and any HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // 2. Remove Office-namespaced tags (o:p, w:..., m:..., v:...), keep inner content.
  out = out.replace(/<\/?(?:o|w|m|v|st1|x):[^>]*>/gi, '');
  // 3. Strip noise attributes (style, class, lang, mso-*, dir, align, valign, border, width, height) from all tags.
  out = out.replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (_m, tag) => `<${tag.toLowerCase()}>`);
  // 4. Collapse whitespace-only / &nbsp;-only paragraphs.
  out = out.replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/gi, '');
  // 5. Trim runs of whitespace between tags.
  out = out.replace(/>\s+</g, '><').trim();
  return out;
}
```

Note: Step 3's regex deliberately drops ALL attributes (including `href`) from the pasted HTML on the cleaning pass. Because links in Word paste are rare for these articles and `href`-less anchors are harmless, this is acceptable for v1. (If preserving pasted hyperlinks becomes a need, that's a Phase 2 refinement — out of scope here.)

- [ ] **Step 4: Run to verify pass**

Run: `cd dashboard && node --test --experimental-strip-types src/lib/clean-word-html.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Wire into the editor paste hook**

In `dashboard/src/components/article-editor.tsx`, import it:

```tsx
import { cleanWordHtml } from '@/lib/clean-word-html';
```

In `useEditor({ ... editorProps: { ... } })`, add a sibling to `attributes`:

```tsx
      transformPastedHTML(html) {
        return cleanWordHtml(html);
      },
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/clean-word-html.ts dashboard/src/lib/clean-word-html.test.ts dashboard/src/components/article-editor.tsx
git commit -m "feat(dashboard): sanitize Word HTML on paste into article editor"
```

---

## Task 5: SEO fields show their defaults

The three SEO inputs already use the title/excerpt as placeholder fallbacks. This task makes the "leave blank to use X" behavior explicit with caption text and adds an OG-image default note, so Yonah understands they're optional overrides.

**Files:**
- Modify: `dashboard/src/components/article-form.tsx` (SEO section ~L326-370)
- Modify: `tests/qa/dashboard/tier1/article-publish.spec.ts` (assertion)

- [ ] **Step 1: Add a caption style + helper captions under each SEO field**

In `dashboard/src/components/article-form.tsx`, define a caption style near the other style consts (top of component/module):

```tsx
const SEO_HINT_STYLE: React.CSSProperties = {
  marginTop: '5px',
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-400)',
  fontFamily: 'var(--ff-body)',
};
```

Under the SEO title `<input>` (after it, inside its `<div>`), add:

```tsx
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use the article title{form.title ? `: “${form.title}”` : ''}.
                </p>
```

Under the SEO description `<textarea>`, add:

```tsx
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use the excerpt{form.excerpt ? `: “${form.excerpt.slice(0, 80)}${form.excerpt.length > 80 ? '…' : ''}”` : ''}.
                </p>
```

Under the OG image `<input>` (after the conditional `<img>` preview), add:

```tsx
                <p style={SEO_HINT_STYLE}>
                  Optional. Leave blank to use an automatically generated share image for this article.
                </p>
```

- [ ] **Step 2: Add a Playwright assertion**

In `tests/qa/dashboard/tier1/article-publish.spec.ts`, add:

```ts
test('SEO fields explain their defaults', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/articles/new');
  await page.getByLabel('Title').fill('Parashat Shelach');
  await page.getByRole('button', { name: 'SEO settings' }).click();
  await expect(page.getByText('Leave blank to use the article title')).toBeVisible();
  await expect(page.getByText('Parashat Shelach', { exact: false })).toBeVisible();
  await expect(page.getByText('automatically generated share image')).toBeVisible();
});
```

- [ ] **Step 3: Run the assertion**

Run: `cd tests/qa && npx playwright test dashboard/tier1/article-publish.spec.ts -g "explain their defaults"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/article-form.tsx tests/qa/dashboard/tier1/article-publish.spec.ts
git commit -m "feat(dashboard): explain SEO field defaults to the author"
```

---

## Task 6: Website preview infrastructure — shared view + draft fetch + auth helpers

**Files:**
- Create: `website/src/components/ArticleView.tsx`
- Modify: `website/src/app/articles/[slug]/page.tsx` (use `ArticleView`)
- Modify: `website/src/lib/articles.ts` (add `getArticleDraftBySlug`, `isPreviewAuthorized`, `buildPreviewPath`)
- Modify: `website/src/lib/articles.test.ts` (helper tests)

- [ ] **Step 1: Write failing unit tests for the helpers**

Append to `website/src/lib/articles.test.ts`:

```ts
import { isPreviewAuthorized, buildPreviewPath } from './articles.ts';

test('isPreviewAuthorized requires exact non-empty token match', () => {
  assert.equal(isPreviewAuthorized('abc', 'abc'), true);
  assert.equal(isPreviewAuthorized('abc', 'xyz'), false);
  assert.equal(isPreviewAuthorized('', ''), false);        // empty expected => never authorize
  assert.equal(isPreviewAuthorized(undefined, 'abc'), false);
  assert.equal(isPreviewAuthorized('abc', undefined), false);
});

test('buildPreviewPath composes slug + token query', () => {
  assert.equal(buildPreviewPath('naase-vnishma', 'tok'), '/preview/naase-vnishma?token=tok');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
Expected: FAIL — helpers not defined.

- [ ] **Step 3: Implement helpers + draft fetch in `articles.ts`**

Add to `website/src/lib/articles.ts`:

```ts
export function isPreviewAuthorized(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  return provided === expected;
}

export function buildPreviewPath(slug: string, token: string): string {
  return `/preview/${slug}?token=${encodeURIComponent(token)}`;
}

/** Fetch the DRAFT (unpublished) version of an article. No caching — previews must be live. */
export async function getArticleDraftBySlug(slug: string): Promise<Article | null> {
  try {
    const url = new URL(`${CDN_BASE}/stories/articles/${slug}`);
    url.searchParams.set('token', PREVIEW_TOKEN);
    url.searchParams.set('version', 'draft');
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.story) return null;
    return storyToArticle(data.story);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Extract `ArticleView` from the article page**

Create `website/src/components/ArticleView.tsx` containing the header + `.ad-body` + endrail + related-articles JSX currently in `website/src/app/articles/[slug]/page.tsx` (the `return (...)` body from `<header>` through the related section). Signature:

```tsx
import Link from "next/link";
import ArticleCard from "@/components/ArticleCard";
import ShareButton from "@/components/ShareButton";
import type { Article } from "@/lib/articles";

export function ArticleView({
  article,
  bodyHtml,
  otherArticles,
  pageUrl,
}: {
  article: Article;
  bodyHtml: string;
  otherArticles: Article[];
  pageUrl: string;
}) {
  const formattedDate = article.published_at
    ? new Date(article.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";
  return (
    /* paste the existing <header>…related-section JSX here, unchanged */
  );
}
```

Move the existing markup verbatim; do not restyle. The JSON-LD `<script>` tags stay on the public page (Task 6 Step 6), NOT in `ArticleView` (preview should not emit indexable schema).

- [ ] **Step 6: Use `ArticleView` in the public page**

In `website/src/app/articles/[slug]/page.tsx`, replace the inlined header/body/endrail/related markup with:

```tsx
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: artSchema }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: crumbSchema }} />
      <ArticleView article={article} bodyHtml={bodyHtml} otherArticles={otherArticles} pageUrl={pageUrl} />
```

Add `import { ArticleView } from "@/components/ArticleView";` and remove now-unused imports (`ArticleCard`, `ShareButton`, `Link` if no longer referenced — check before deleting). Keep `getAllArticles`, `getArticleBySlug`, `tiptapJsonToHtml`, `articleSchema`, `breadcrumbSchema`.

- [ ] **Step 7: Verify build + existing article tests**

Run: `cd website && npm run lint && npm run build`
Expected: builds clean; `/articles/[slug]` renders identically (no visual change — pure refactor).

- [ ] **Step 8: Commit**

```bash
git add website/src/components/ArticleView.tsx website/src/app/articles/[slug]/page.tsx website/src/lib/articles.ts website/src/lib/articles.test.ts
git commit -m "refactor(website): extract ArticleView; add draft fetch + preview-auth helpers"
```

---

## Task 7: Website draft preview route

**Files:**
- Create: `website/src/app/preview/[slug]/page.tsx`
- Modify: `website/.env.local.example`

- [ ] **Step 1: Create the preview route**

Create `website/src/app/preview/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticleDraftBySlug, isPreviewAuthorized, tiptapJsonToHtml } from "@/lib/articles";
import { ArticleView } from "@/components/ArticleView";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

// Previews must never be cached or indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ArticlePreviewPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { token } = await searchParams;

  if (!isPreviewAuthorized(token, process.env.ARTICLE_PREVIEW_TOKEN)) {
    notFound();
  }

  const article = await getArticleDraftBySlug(slug);
  if (!article) notFound();

  const bodyHtml = article.body_html || tiptapJsonToHtml(article.body_json);

  return (
    <>
      <div style={{ background: "var(--cedar-100, #f3ece2)", color: "var(--ink-700)", textAlign: "center", padding: "8px 16px", fontSize: "13px", fontFamily: "var(--ff-body)" }}>
        Draft preview — not published. Only people with this link can see it.
      </div>
      <ArticleView article={article} bodyHtml={bodyHtml} otherArticles={[]} pageUrl={`https://torahtaichi.com/articles/${slug}`} />
    </>
  );
}
```

- [ ] **Step 2: Document the env var**

In `website/.env.local.example`, add:

```
# Token that gates /preview/[slug] draft previews. Must match the dashboard's ARTICLE_PREVIEW_TOKEN.
ARTICLE_PREVIEW_TOKEN=
```

- [ ] **Step 3: Verify build**

Run: `cd website && npm run lint && npm run build`
Expected: route compiles as a dynamic route.

- [ ] **Step 4: Commit**

```bash
git add website/src/app/preview/[slug]/page.tsx website/.env.local.example
git commit -m "feat(website): token-gated noindex draft preview route"
```

---

## Task 8: Dashboard Preview button

**Files:**
- Modify: `dashboard/src/app/articles/[id]/edit/page.tsx` (build preview URL server-side)
- Modify: `dashboard/src/components/article-form.tsx` (accept `previewUrl` prop, render button)
- Modify: `dashboard/.env.example`
- Modify: `tests/qa/dashboard/tier1/article-publish.spec.ts`

The edit page is a server component, so the token stays server-side; the assembled URL is passed as a prop. The "new" page passes nothing → button hidden (a draft has no slug to preview yet).

- [ ] **Step 1: Build the preview URL in the edit page**

In `dashboard/src/app/articles/[id]/edit/page.tsx`, before the `return`, compute:

```tsx
  const previewBase = process.env.WEBSITE_BASE_URL;
  const previewToken = process.env.ARTICLE_PREVIEW_TOKEN;
  const previewUrl =
    previewBase && previewToken && story.slug
      ? `${previewBase}/preview/${story.slug}?token=${encodeURIComponent(previewToken)}`
      : undefined;
```

Pass it to the form: add `previewUrl={previewUrl}` to the `<ArticleForm ... />` props.

- [ ] **Step 2: Accept the prop + render the button in `ArticleForm`**

In `dashboard/src/components/article-form.tsx`, add `previewUrl?: string` to the component's props type, and render a Preview link in the action row (near Save draft / Publish). Use an anchor (opens the live site in a new tab), styled as a secondary/tertiary action so it isn't confused with publish:

```tsx
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'var(--ff-body)',
              fontSize: '14px',
              color: 'var(--navy-700)',
              textDecoration: 'none',
              padding: '0 8px',
            }}
          >
            Preview ↗
          </a>
        )}
```

(Placement: in the same flex row as the existing Save/Publish buttons. It's a link, not a submit button, so it never triggers the form. Demoting it visually follows `project_yonah_operator_patterns`.)

- [ ] **Step 3: Document env vars**

In `dashboard/.env.example`, add:

```
# Public website origin, used to build draft-preview links from the article editor.
WEBSITE_BASE_URL=https://torahtaichi.com
# Token appended to /preview links; must match the website's ARTICLE_PREVIEW_TOKEN.
ARTICLE_PREVIEW_TOKEN=
```

- [ ] **Step 4: Add a Playwright assertion (button hidden on new, link shape on edit)**

In `tests/qa/dashboard/tier1/article-publish.spec.ts`, add:

```ts
test('Preview link is absent on new-article page', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/articles/new');
  await expect(page.getByRole('link', { name: /Preview/ })).toHaveCount(0);
});
```

(Edit-page coverage requires the server-side Storyblok fetch + env, which the browser mocks can't supply — that path is covered by the env-driven URL build and verified manually in Task 9.)

- [ ] **Step 5: Run the assertion**

Run: `cd tests/qa && npx playwright test dashboard/tier1/article-publish.spec.ts -g "Preview link is absent"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/app/articles/[id]/edit/page.tsx dashboard/src/components/article-form.tsx dashboard/.env.example tests/qa/dashboard/tier1/article-publish.spec.ts
git commit -m "feat(dashboard): Preview button linking to website draft preview"
```

---

## Task 9: End-to-end verification with the real article (deploy gate)

Per project rule "fixed means deployed": the editor/website split + server-side Storyblok draft fetch are only truly verified against deployed apps with real env. The `Derech HaPnimi - Shelach.docx` is the test artifact.

**Files:** none (verification only).

- [ ] **Step 1: Set env in both deployments**

Set `ARTICLE_PREVIEW_TOKEN` (same value) in the website (Vercel) and dashboard envs, and `WEBSITE_BASE_URL` in the dashboard. Redeploy both.

- [ ] **Step 2: Run all unit tests green**

Run:
`cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
`cd dashboard && node --test --experimental-strip-types src/lib/clean-word-html.test.ts`
Expected: all PASS.

- [ ] **Step 3: Paste-and-author the real article**

In the deployed dashboard, create a new article. Open `dashboard/Derech HaPnimi - Shelach.docx`, copy its full body, paste into the editor. Verify: headings, paragraphs, **visible bullet lists**, and the 2-column "Breakdown → Response" **table** all come through with no stray Word styling. Fix the title/slug, Save draft.

- [ ] **Step 4: Verify draft preview**

Click **Preview ↗**. Confirm the live website preview shows the article with visible bullets, styled table, h3/blockquote — and that the page is `noindex` (view source / check robots meta). Confirm the URL without the token returns a 404.

- [ ] **Step 5: Verify SEO clarity**

Open the SEO section; confirm each field shows its "leave blank to use…" caption and the title/excerpt placeholders.

- [ ] **Step 6: Publish + confirm public render**

Publish the article. Confirm the public `/articles/<slug>` shows visible bullets + table (the Task 2 CSS), matching the preview.

- [ ] **Step 7: Final commit / PR**

Open a PR from `article-editor-improvements` to `main` summarizing Phase 1. (Do not merge without the user's go-ahead.)

---

## Self-review notes

- **Spec coverage:** §1 bullets→Tasks 2,3; §2 tables→Tasks 1,2,3; §3 Word paste→Task 4; §4 SEO defaults→Task 5; §5 draft preview→Tasks 6,7,8. ✓
- **Type consistency:** `tiptapJsonToHtml`, `getArticleDraftBySlug`, `isPreviewAuthorized(provided, expected)`, `buildPreviewPath(slug, token)`, `cleanWordHtml(html)`, `ArticleView({article, bodyHtml, otherArticles, pageUrl})`, `previewUrl?: string` prop — names used consistently across tasks. ✓
- **Storyblok round-trip risk** for tables is explicitly verified in Task 3 Step 7 before the feature is built on. ✓
- **Token never reaches client bundle** — built in the server-component edit page, passed as a prop. ✓
