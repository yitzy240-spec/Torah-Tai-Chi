# Premium Blog Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard article editor into an effortless, polished, mobile-friendly writing experience: selection (bubble) menu, link popover, inline images → Storyblok assets, draft autosave, live word count + auto read-time, typography polish — all on the existing TipTap v3 base.

**Architecture:** Enhance `article-editor.tsx` (TipTap v3.26) with free MIT extensions; keep the stored ProseMirror JSON and the website's `tiptapJsonToHtml` renderer (add an `image` case). Image upload goes through a new server-only dashboard route that uploads to Storyblok assets (token stays server-side). Autosave lives in `article-form.tsx`.

**Tech Stack:** Next.js (both apps), TipTap v3.26 (`@tiptap/*`), Storyblok Management API (asset upload), Node `node --test` for unit tests, Playwright for browser checks.

**Hard rules (from prior incidents):**
- Pin EVERY `@tiptap/*` package to the SAME version (3.26.0). A mixed install breaks `next build` (the `@tiptap/react` ↔ `@tiptap/core` `schedulePositionCheck` skew).
- Gate on a real `next build` for BOTH apps before deploy — `tsc` alone missed that skew.
- In v3.26: the React bubble menu is imported from `@tiptap/react/menus` (verified in node_modules: `@tiptap/react` exports `.` and `./menus`).

---

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `website/src/lib/articles.ts` | `tiptapJsonToHtml` — render `image` nodes | Modify |
| `website/src/lib/articles.test.ts` | image-render unit test | Modify |
| `website/src/app/globals.css` | `.ad-body img` / `figure` styles | Modify |
| `dashboard/src/lib/asset-filename.ts` | pure filename sanitizer | Create |
| `dashboard/src/lib/asset-filename.test.ts` | sanitizer unit test | Create |
| `dashboard/src/lib/storyblok-assets.ts` | server-only `uploadAsset(file)` → Storyblok CDN URL | Create |
| `dashboard/src/app/api/upload/route.ts` | authed multipart upload endpoint | Create |
| `dashboard/src/lib/read-time.ts` | pure `wordsToReadMinutes(words)` | Create |
| `dashboard/src/lib/read-time.test.ts` | read-time unit test | Create |
| `dashboard/src/components/link-popover.tsx` | anchored link editor | Create |
| `dashboard/src/components/article-editor.tsx` | new extensions, bubble menu, link popover, image button, word count, mobile toolbar | Modify |
| `dashboard/src/components/article-form.tsx` | draft autosave + read-time wiring | Modify |
| `dashboard/package.json` | add 4 `@tiptap` extensions @3.26.0 | Modify |

---

## Task 1: Website renders image nodes

**Files:**
- Modify: `website/src/lib/articles.ts` (`tiptapJsonToHtml` switch)
- Modify: `website/src/lib/articles.test.ts`
- Modify: `website/src/app/globals.css`

- [ ] **Step 1: Write the failing test.** Append to `website/src/lib/articles.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify fail.** `cd website && node --test --experimental-strip-types src/lib/articles.test.ts` → the two image tests FAIL (image falls through to `default`).

- [ ] **Step 3: Add the `image` case.** In `website/src/lib/articles.ts`, inside the `switch (n.type)` block (after `case 'tableCell':`, before `case 'hardBreak':`), add:

```ts
        case 'image': {
          const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const src = esc(String(n.attrs?.src ?? ''));
          const alt = esc(String(n.attrs?.alt ?? ''));
          return `<figure><img src="${src}" alt="${alt}" loading="lazy"></figure>`;
        }
```

- [ ] **Step 4: Run, verify pass.** Same command → all tests pass.

- [ ] **Step 5: Add CSS.** In `website/src/app/globals.css`, after the `.ad-body table` rules, add:

```css
.ad-body figure{margin:28px 0;}
.ad-body img{display:block;max-width:100%;height:auto;border-radius:8px;margin:0 auto;}
```

- [ ] **Step 6: Build + commit.** `cd website && npm run build` (must succeed). Then:

```bash
git add website/src/lib/articles.ts website/src/lib/articles.test.ts website/src/app/globals.css
git commit -m "feat(website): render article image nodes (figure/img, lazy, responsive)"
```

---

## Task 2: Storyblok asset upload helper + filename sanitizer

**Files:**
- Create: `dashboard/src/lib/asset-filename.ts`, `dashboard/src/lib/asset-filename.test.ts`
- Create: `dashboard/src/lib/storyblok-assets.ts`

- [ ] **Step 1: Failing test for the sanitizer.** Create `dashboard/src/lib/asset-filename.test.ts`:

```ts
// Run: node --test --experimental-strip-types src/lib/asset-filename.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssetFilename } from './asset-filename.ts';

test('lowercases, strips unsafe chars, keeps extension', () => {
  assert.equal(sanitizeAssetFilename('My Photo (1).JPG'), 'my-photo-1.jpg');
});
test('collapses repeats and trims dashes', () => {
  assert.equal(sanitizeAssetFilename('  a—b!!c.png '), 'a-b-c.png');
});
test('falls back when name is empty', () => {
  assert.equal(sanitizeAssetFilename('***.png'), 'image.png');
  assert.equal(sanitizeAssetFilename(''), 'image');
});
```

- [ ] **Step 2: Run, verify fail.** `cd dashboard && node --test --experimental-strip-types src/lib/asset-filename.test.ts`.

- [ ] **Step 3: Implement.** Create `dashboard/src/lib/asset-filename.ts`:

```ts
/** Make an upload filename safe + tidy. Keeps a single trailing extension. */
export function sanitizeAssetFilename(name: string): string {
  const trimmed = (name ?? '').trim();
  const dot = trimmed.lastIndexOf('.');
  const hasExt = dot > 0 && dot < trimmed.length - 1;
  const ext = hasExt ? trimmed.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (hasExt ? trimmed.slice(0, dot) : trimmed)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safeBase = base || 'image';
  return ext ? `${safeBase}.${ext}` : safeBase;
}
```

- [ ] **Step 4: Run, verify pass.** Same command → 3/3 pass.

- [ ] **Step 5: Implement the uploader (no unit test — network; verified by build + manual E2E).** Create `dashboard/src/lib/storyblok-assets.ts`:

```ts
/**
 * Upload a file to Storyblok assets via the Management API and return its public
 * CDN URL. Server-only — uses STORYBLOK_MANAGEMENT_TOKEN / STORYBLOK_SPACE_ID.
 *
 * Flow (Storyblok Management API):
 *  1. POST /spaces/{id}/assets/  { filename, size } -> { id, post_url, fields{} }
 *  2. POST post_url  (multipart/form-data: every `fields` entry, then `file` LAST) -> S3 stores it
 *  3. GET  /spaces/{id}/assets/{id}/finish_upload   -> Storyblok finalizes (mime/size)
 *  Public URL = https://a.storyblok.com/{fields.key}
 */
import { sanitizeAssetFilename } from './asset-filename';

const SPACE_ID = process.env.STORYBLOK_SPACE_ID!;
const MGMT_TOKEN = process.env.STORYBLOK_MANAGEMENT_TOKEN!;
const MAPI = `https://mapi.storyblok.com/v1/spaces/${SPACE_ID}`;

export async function uploadAsset(file: File): Promise<string> {
  const filename = sanitizeAssetFilename(file.name || 'image');
  const buf = Buffer.from(await file.arrayBuffer());

  // 1. sign
  const signRes = await fetch(`${MAPI}/assets/`, {
    method: 'POST',
    headers: { Authorization: MGMT_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, size: buf.length }),
  });
  if (!signRes.ok) throw new Error(`Storyblok sign failed: ${signRes.status} ${await signRes.text()}`);
  const signed = await signRes.json() as { id: number; post_url: string; fields: Record<string, string> };

  // 2. upload to S3 — fields first, file LAST
  const form = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
  form.append('file', new Blob([buf], { type: file.type || 'application/octet-stream' }), filename);
  const s3Res = await fetch(signed.post_url, { method: 'POST', body: form });
  if (!s3Res.ok && s3Res.status !== 204) throw new Error(`S3 upload failed: ${s3Res.status}`);

  // 3. finalize
  const finRes = await fetch(`${MAPI}/assets/${signed.id}/finish_upload`, {
    method: 'GET',
    headers: { Authorization: MGMT_TOKEN },
  });
  if (!finRes.ok) throw new Error(`Storyblok finish failed: ${finRes.status}`);

  return `https://a.storyblok.com/${signed.fields.key}`;
}
```

- [ ] **Step 6: Commit.**

```bash
git add dashboard/src/lib/asset-filename.ts dashboard/src/lib/asset-filename.test.ts dashboard/src/lib/storyblok-assets.ts
git commit -m "feat(dashboard): Storyblok asset upload helper + filename sanitizer"
```

---

## Task 3: Upload API route

**Files:**
- Create: `dashboard/src/app/api/upload/route.ts`

- [ ] **Step 1: Implement the route.** Create `dashboard/src/app/api/upload/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { uploadAsset } from '@/lib/storyblok-assets';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireAuth();
  if (authResponse) return authResponse;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 10 MB)' }, { status: 413 });
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 415 });
  }

  try {
    const url = await uploadAsset(file);
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

(Verify `@/lib/api-auth` exports `requireAuth` returning `{ response }` — the articles routes use exactly this pattern.)

- [ ] **Step 2: Build verify.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/app/api/upload/route.ts
git commit -m "feat(dashboard): authed image upload endpoint -> Storyblok assets"
```

---

## Task 4: Read-time helper

**Files:**
- Create: `dashboard/src/lib/read-time.ts`, `dashboard/src/lib/read-time.test.ts`

- [ ] **Step 1: Failing test.** Create `dashboard/src/lib/read-time.test.ts`:

```ts
// Run: node --test --experimental-strip-types src/lib/read-time.test.ts  (from dashboard/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsToReadMinutes } from './read-time.ts';

test('rounds at 200 wpm, min 1', () => {
  assert.equal(wordsToReadMinutes(0), 1);
  assert.equal(wordsToReadMinutes(100), 1);
  assert.equal(wordsToReadMinutes(400), 2);
  assert.equal(wordsToReadMinutes(500), 3); // 2.5 -> 3
});
```

- [ ] **Step 2: Run, verify fail.** `cd dashboard && node --test --experimental-strip-types src/lib/read-time.test.ts`.

- [ ] **Step 3: Implement.** Create `dashboard/src/lib/read-time.ts`:

```ts
/** Estimated read time in minutes at ~200 words/min, minimum 1. */
export function wordsToReadMinutes(words: number): number {
  return Math.max(1, Math.round((words || 0) / 200));
}
```

- [ ] **Step 4: Run, verify pass.** Same command → 1/1 pass.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/lib/read-time.ts dashboard/src/lib/read-time.test.ts
git commit -m "feat(dashboard): word-count -> read-time helper"
```

---

## Task 5: Install + register editor extensions (image, file-handler, char-count, typography)

**Files:**
- Modify: `dashboard/package.json`, `dashboard/src/components/article-editor.tsx`

- [ ] **Step 1: Install at the pinned version.** From `dashboard/`:

```bash
npm install @tiptap/extension-image@3.26.0 @tiptap/extension-file-handler@3.26.0 @tiptap/extension-character-count@3.26.0 @tiptap/extension-typography@3.26.0
```
Expected: four packages at 3.26.0 (matching the existing `@tiptap/*`).

- [ ] **Step 2: Import + register.** In `article-editor.tsx`, add imports near the other extension imports:

```tsx
import Image from '@tiptap/extension-image';
import FileHandler from '@tiptap/extension-file-handler';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
```

Add a prop so the editor can report word count up to the form. Change the component props:

```tsx
interface ArticleEditorProps {
  initialContent?: object | null;
  onChange: (doc: object, html: string) => void;
  onWordCount?: (words: number) => void;
  placeholder?: string;
}
```
and destructure `onWordCount` in the signature.

In the `extensions: [...]` array (after the Table extensions), add:

```tsx
      Image.configure({ inline: false, allowBase64: false }),
      CharacterCount,
      Typography,
      FileHandler.configure({
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
        onDrop: (currentEditor, files, pos) => {
          files.forEach((file) => uploadAndInsert(currentEditor, file, pos));
        },
        onPaste: (currentEditor, files) => {
          files.forEach((file) => uploadAndInsert(currentEditor, file, currentEditor.state.selection.anchor));
        },
      }),
```

Report word count from `onUpdate` (extend the existing `onUpdate`):

```tsx
    onUpdate({ editor }) {
      onChangeRef.current(editor.getJSON(), editor.getHTML());
      onWordCount?.(editor.storage.characterCount.words());
    },
```

- [ ] **Step 3: Add the upload-and-insert helper.** Above the component (module scope), add:

```tsx
import type { Editor } from '@tiptap/react';

async function uploadAndInsert(editor: Editor, file: File, pos: number) {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      window.alert(`Image upload failed: ${b.error ?? res.status}`);
      return;
    }
    const { url } = await res.json();
    editor.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url, alt: '' } }).run();
  } catch {
    window.alert('Image upload failed.');
  }
}
```
(v1 inserts after upload completes; a placeholder-swap is a later refinement. `window.alert` is acceptable for a single-operator tool error; keep it simple.)

- [ ] **Step 4: Build verify.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0) then `npm run build` (must succeed — confirms the new extensions resolve, the version-skew class of bug).

- [ ] **Step 5: Commit.**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/components/article-editor.tsx
git commit -m "feat(dashboard): image upload (drag/drop/paste), char-count, typography in editor"
```

---

## Task 6: Link popover (replace window.prompt)

**Files:**
- Create: `dashboard/src/components/link-popover.tsx`
- Modify: `dashboard/src/components/article-editor.tsx`

- [ ] **Step 1: Create the popover.** Create `dashboard/src/components/link-popover.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith('/') || v.startsWith('mailto:')) return v;
  return `https://${v}`;
}

export function LinkPopover({
  initialUrl,
  hasLink,
  onApply,
  onRemove,
  onClose,
}: {
  initialUrl: string;
  hasLink: boolean;
  onApply: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function apply() {
    const norm = normalizeUrl(url);
    if (!norm) { onRemove(); return; }
    onApply(norm);
  }

  return (
    <div
      style={{
        position: 'absolute', zIndex: 20, marginTop: '6px',
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'white', border: '1px solid var(--ink-200)', borderRadius: 'var(--r-sm)',
        padding: '6px 8px', boxShadow: '0 6px 24px rgba(0,0,0,.12)',
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <input
        ref={inputRef}
        type="url"
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', border: '1px solid var(--ink-100)', borderRadius: '4px', padding: '5px 8px', width: '220px', outline: 'none' }}
      />
      <button type="button" onClick={apply} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--navy-700)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>Apply</button>
      {hasLink && (
        <button type="button" onClick={onRemove} style={{ fontSize: '12px', color: 'var(--tassel)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>Remove</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the editor.** In `article-editor.tsx`, add state + handlers and render the popover near the toolbar (replace the old `handleLink` prompt). Add:

```tsx
import { LinkPopover } from './link-popover';
// ...inside the component:
const [linkOpen, setLinkOpen] = useState(false);

const openLink = useCallback(() => {
  if (!editor) return;
  setLinkOpen(true);
}, [editor]);
```
Replace the Link toolbar button's `onClick={handleLink}` with `onClick={openLink}`, delete the old `handleLink`, and render the popover (right after the toolbar `</div>`), positioned relative to the toolbar container (the toolbar wrapper needs `position: 'relative'`):

```tsx
{linkOpen && editor && (
  <LinkPopover
    initialUrl={editor.getAttributes('link').href ?? ''}
    hasLink={editor.isActive('link')}
    onApply={(url) => { editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); setLinkOpen(false); }}
    onRemove={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}
    onClose={() => setLinkOpen(false)}
  />
)}
```

- [ ] **Step 3: Build verify.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/components/link-popover.tsx dashboard/src/components/article-editor.tsx
git commit -m "feat(dashboard): link popover replaces window.prompt"
```

---

## Task 7: Bubble (selection) menu + image button + mobile sticky toolbar

**Files:**
- Modify: `dashboard/src/components/article-editor.tsx`

- [ ] **Step 1: Bubble menu.** Add import (v3.26 path verified in node_modules):

```tsx
import { BubbleMenu } from '@tiptap/react/menus';
```
Render inside the editor wrapper (e.g. right before `<EditorContent .../>`), reusing the existing command pattern:

```tsx
{editor && (
  <BubbleMenu editor={editor} options={{ placement: 'top' }}>
    <div style={{ display: 'flex', gap: '2px', background: 'var(--ink-900)', borderRadius: 'var(--r-sm)', padding: '4px', boxShadow: '0 6px 24px rgba(0,0,0,.18)' }}>
      <button type="button" aria-label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} style={bubbleBtn(editor.isActive('bold'))}>B</button>
      <button type="button" aria-label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} style={{ ...bubbleBtn(editor.isActive('italic')), fontStyle: 'italic' }}>I</button>
      <button type="button" aria-label="Link" onClick={openLink} style={bubbleBtn(editor.isActive('link'))}>Link</button>
      <button type="button" aria-label="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} style={bubbleBtn(editor.isActive('heading', { level: 2 }))}>H2</button>
      <button type="button" aria-label="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} style={bubbleBtn(editor.isActive('heading', { level: 3 }))}>H3</button>
      <button type="button" aria-label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} style={bubbleBtn(editor.isActive('blockquote'))}>&ldquo;</button>
    </div>
  </BubbleMenu>
)}
```
Add a `bubbleBtn` style helper near `btnStyle`:

```tsx
const bubbleBtn = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: '30px', height: '30px', padding: '0 8px', borderRadius: '4px', border: 'none',
  background: active ? 'var(--navy-700)' : 'transparent', color: 'var(--linen-50)',
  cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--ff-body)',
});
```
(If `@tiptap/react/menus` `BubbleMenu` prop API differs in 3.26 — e.g. `shouldShow` / `options` — check `dashboard/node_modules/@tiptap/react/dist/menus` typings and adapt; the editor + children contract is stable.)

- [ ] **Step 2: Image toolbar button.** Add a hidden file input + button in the toolbar (after the table controls divider):

```tsx
<button type="button" title="Insert image" aria-label="Insert image" style={btnStyle(false)}
  onClick={() => fileInputRef.current?.click()}>
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6" r="1.2"/><path d="M2 12l3.5-3.5 2.5 2.5 3-3 3 3.5"/></svg>
</button>
```
With (near other refs/state): `const fileInputRef = useRef<HTMLInputElement>(null);` and render once:

```tsx
<input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
  onChange={(e) => { const f = e.target.files?.[0]; if (f && editor) uploadAndInsert(editor, f, editor.state.selection.anchor); e.target.value = ''; }} />
```

- [ ] **Step 3: Word count display.** Below `<EditorContent>`, add (reads live from editor storage):

```tsx
{editor && (
  <div style={{ padding: '8px 24px 16px', fontFamily: 'var(--ff-body)', fontSize: '12px', color: 'var(--ink-400)' }}>
    {editor.storage.characterCount.words()} words · ~{Math.max(1, Math.round(editor.storage.characterCount.words() / 200))} min read
  </div>
)}
```

- [ ] **Step 4: Mobile sticky toolbar.** In the toolbar wrapper style, add `position: 'sticky'`, `top: 0`, `zIndex: 5`. In the component `<style>` block add a mobile rule ensuring tap targets:

```css
@media (max-width: 640px) {
  .article-editor-content { font-size: 16px; }
}
```

- [ ] **Step 5: Build verify.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0) then `npm run build` (must succeed).

- [ ] **Step 6: Commit.**

```bash
git add dashboard/src/components/article-editor.tsx
git commit -m "feat(dashboard): bubble menu, image button, live word/read-time, mobile sticky toolbar"
```

---

## Task 8: Draft autosave + auto read-time in the form

**Files:**
- Modify: `dashboard/src/components/article-form.tsx`

- [ ] **Step 1: Pass word count down + store it.** Where `<ArticleEditor … />` is rendered in `article-form.tsx`, add `onWordCount={(w) => setWords(w)}`. Add state near the others: `const [words, setWords] = useState(0);` and import the helper: `import { wordsToReadMinutes } from '@/lib/read-time';`.

- [ ] **Step 2: Auto read-time.** Replace the manual `read_minutes` input with a computed read-only display (find the read_minutes form field and the value sent in `save()`'s payload). In `save()`'s payload, set `read_minutes: wordsToReadMinutes(words)` instead of `form.read_minutes !== '' ? Number(form.read_minutes) : null`. Below the editor render a read-only line: `~{wordsToReadMinutes(words)} min read (auto)`. (Remove the now-unused manual read_minutes `<input>` and its label.)

- [ ] **Step 3: Draft autosave.** Add a debounced effect that saves only an existing DRAFT. Near the other state add `const [autosaveAt, setAutosaveAt] = useState<number | null>(null);` and:

```tsx
// Autosave drafts only: never creates a story (needs form.id) and never touches
// a published article (drafts only). Debounced 2s after the last change.
useEffect(() => {
  if (!form.id || form.published || savingAction) return;
  const handle = setTimeout(async () => {
    const res = await fetch(`/api/articles/${form.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title, subtitle: form.subtitle || null, slug: form.slug || undefined,
        category: form.category || null, excerpt: form.excerpt || null,
        read_minutes: wordsToReadMinutes(words), body_json: form.body_json, body_html: form.body_html || null,
        published: false,
        seo_title: form.seo_title || null, seo_description: form.seo_description || null, seo_og_image: form.seo_og_image || null,
      }),
    });
    if (res.ok) setAutosaveAt(Date.now());
  }, 2000);
  return () => clearTimeout(handle);
  // Re-run when editable content changes:
}, [form.id, form.published, form.title, form.subtitle, form.slug, form.category, form.excerpt, form.body_json, form.body_html, form.seo_title, form.seo_description, form.seo_og_image, words, savingAction]);
```

- [ ] **Step 4: Autosave indicator.** Near the action row (or under the editor), show a quiet status when not mid-manual-save:

```tsx
{autosaveAt && !savingAction && (
  <span style={{ fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px', color: 'var(--ink-400)' }}>Draft autosaved</span>
)}
```

- [ ] **Step 5: Build verify.** `cd dashboard && npx tsc --noEmit -p tsconfig.json` (exit 0) then `npm run build` (must succeed).

- [ ] **Step 6: Commit.**

```bash
git add dashboard/src/components/article-form.tsx
git commit -m "feat(dashboard): draft autosave + automatic read-time"
```

---

## Task 9: Build gate, deploy, and E2E verification

**Files:** none (verification).

- [ ] **Step 1: All unit tests green.**
  - `cd website && node --test --experimental-strip-types src/lib/articles.test.ts`
  - `cd dashboard && node --test --experimental-strip-types src/lib/asset-filename.test.ts`
  - `cd dashboard && node --test --experimental-strip-types src/lib/read-time.test.ts`

- [ ] **Step 2: Real builds for BOTH apps** (the non-negotiable gate): `cd dashboard && npm run build` and `cd website && npm run build` — both succeed.

- [ ] **Step 3: Open PR / merge per the team's flow** (this branch is `premium-editor-ux`). After deploy, run the manual E2E below against the live dashboard.

- [ ] **Step 4: Manual E2E (deployed dashboard, logged in).**
  - Drag-drop an image into an article body → it uploads and renders; published article shows it on the public site (responsive, lazy).
  - Paste an image from clipboard → same.
  - Select text → bubble menu appears; Bold/Italic/H2/Link work from it.
  - Click Link → popover; apply a URL (no scheme → https:// added), then Remove.
  - Type a paragraph → "N words · ~M min read" updates; published article shows the auto read-time.
  - Edit a DRAFT, wait 2s → "Draft autosaved"; reload → changes persisted. Edit a PUBLISHED article → confirm it does NOT autosave (no silent live change).
  - On iPhone (or narrow viewport): toolbar sticky + usable; image insert from photo library works.

---

## Self-review notes
- **Spec coverage:** bubble menu→T7; link popover→T6; images→T1(render)+T2+T3(upload)+T5(editor wiring); autosave→T8; word count/read-time→T4+T7+T8; typography→T5; mobile→T7. ✓
- **Type consistency:** `uploadAsset(file)→string`, `sanitizeAssetFilename(name)→string`, `wordsToReadMinutes(words)→number`, `uploadAndInsert(editor,file,pos)`, `onWordCount(words)`, `<LinkPopover initialUrl hasLink onApply onRemove onClose>` — names used consistently across tasks. ✓
- **Version pin:** every new `@tiptap/*` at 3.26.0; both `next build`s gate every editor task. ✓
- **No token leak:** upload token stays in `storyblok-assets.ts` (server) behind the authed `/api/upload` route. ✓
