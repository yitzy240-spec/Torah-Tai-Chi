# Premium Blog Editor UX — Design

**Date:** 2026-06-08
**Status:** Approved (design); ready for implementation planning
**Goal:** Make the dashboard article editor an effortless, polished, mobile-friendly
writing experience for a non-technical author (Yonah, iPhone-primary) — without swapping
editors or changing the stored content format.

---

## Context & approach

- The editor is `dashboard/src/components/article-editor.tsx` — TipTap v3.26 with StarterKit
  (code/codeBlock/strike/horizontalRule/underline disabled), Link, Placeholder, Table, and a
  Word-paste sanitizer. A custom brand-styled toolbar (H2/H3, bold, italic, lists, link via
  `window.prompt`, blockquote, table controls).
- Body is stored as TipTap/ProseMirror JSON. The **website** re-renders it via
  `tiptapJsonToHtml` in `website/src/lib/articles.ts` (single source of truth; also feeds RSS).
- **Decision:** ENHANCE this TipTap editor with free, official, MIT TipTap v3 extensions
  (TipTap open-sourced its formerly-Pro extensions in 2025). Keep our brand toolbar; add small
  custom UI for the polish. Do NOT adopt BlockNote or Plate (different document models → would
  require rewriting our renderer). Borrow patterns from Novel (novel.sh) but don't depend on it
  (its npm release is v2-pinned/stale).
- **Audience principle:** effortless over powerful. Power features (slash commands,
  drag-to-reorder, embeds, distraction-free, AI) are explicitly deferred (see Out of Scope).
- Verify exact package import paths against the installed TipTap v3.26 at implementation time
  (v3 reorganized some menu exports); pin all `@tiptap/*` packages to one matching version
  (currently 3.26.0) — a mixed-version install breaks the build (prior incident).

---

## Feature set

### 1. Selection (bubble) menu
Highlight text → a small floating bar appears with **Bold, Italic, Link, H2, H3, Quote**.
Medium-style; works on mobile (appears above the selection).
- Package: `@tiptap/extension-bubble-menu` (+ the React menu wrapper for v3).
- Reuse the same command handlers as the fixed toolbar (DRY). The fixed toolbar stays (the
  bubble menu augments it, doesn't replace it).

### 2. Link popover (replaces `window.prompt`)
Clicking the Link toolbar/bubble button opens a small anchored popover: an input for the URL,
**Apply / Visit / Remove** actions, basic URL validation (prepend `https://` if missing,
reject obviously invalid). Editing an existing link pre-fills its href.
- Custom React component using `editor.chain().setLink({href})` / `unsetLink()`. No new dep.
- Removes the current `handleLink` prompt.

### 3. Inline images → Storyblok assets
Insert via: an image toolbar button (file picker), **drag-drop**, or **paste**.
- Packages: `@tiptap/extension-image` (renders `<img>`) + `@tiptap/extension-file-handler`
  (provides `onDrop`/`onPaste` File hooks).
- Upload flow (keeps the Storyblok Management token server-side):
  1. On drop/paste/pick, immediately insert the image with a **local object-URL placeholder**
     and a "uploading" state.
  2. `POST` the file to a new dashboard route **`/api/upload`** (multipart). The route uploads
     to **Storyblok assets** via the Management API signed-upload flow
     (`POST /spaces/{id}/assets` → upload to the returned signed S3 target → finalize), and
     returns the public asset CDN URL.
  3. On success, replace the placeholder src with the returned URL
     (`editor.chain().setImage({ src, alt })`). On failure, remove the placeholder + show an error.
- New helper `dashboard/src/lib/storyblok-assets.ts` (`uploadAsset(file): Promise<string>`),
  server-only (uses `STORYBLOK_MANAGEMENT_TOKEN` / `STORYBLOK_SPACE_ID`).
- v1 captures **alt text** (accessibility/SEO) via a small prompt/field on the image; **no
  caption UI** in v1 (figcaption can come later).
- **Website rendering:** add an `image` case to `tiptapJsonToHtml` →
  `<figure><img src="…" alt="…" loading="lazy"/></figure>` (escape src/alt). Add `.ad-body img`
  / `.ad-body figure` CSS (max-width:100%, height:auto, rounded, centered, sensible margin).

### 4. Autosave (drafts only)
Once an article exists (`form.id` present) **and is a draft** (`!form.published`), debounce
~2s after the last edit and silently `PATCH /api/articles/{id}` with the current fields
(preserving `published:false`). Show a quiet "Saving… / Saved ✓ / Save failed" indicator.
- **Gated on `form.id`** so it never creates junk drafts, and **drafts only** so it never
  pushes live changes to a published article (per `project_live_state_hides_edit_controls` —
  editing a published article stays an explicit "Save & keep published" action).
- Implemented in `article-form.tsx` with a debounced effect on the serialized form state.
- Coexists with the manual Save/Preview/Publish flow; manual actions cancel any pending
  autosave.

### 5. Live word count + automatic read-time
- Package: `@tiptap/extension-character-count` → `editor.storage.characterCount.words()`.
- Show "**N words · ~M min read**" under the editor. Compute `read_minutes = max(1,
  round(words / 200))` and auto-populate `form.read_minutes` (the manual field is removed or
  becomes a read-only display; pick at implementation — default: auto, no manual field).

### 6. Writing polish
- Package: `@tiptap/extension-typography` — smart quotes, em/en dashes, ellipsis as you type.
- Surface the existing markdown input rules (already active for enabled nodes: `## `→H2,
  `### `→H3, `- `/`* `→bullet, `1. `→ordered, `> `→quote) via a short "formatting tips" hint
  or placeholder text so they're discoverable.

### 7. Mobile polish
Make the toolbar **sticky** at the top of the editor on small screens with comfortable tap
targets (≥40px). Ensure the bubble menu and link popover are reachable one-handed. Verify the
image picker works from the iOS photo library.

---

## Architecture / files

| File | Change |
|------|--------|
| `dashboard/package.json` | add `@tiptap/extension-image`, `-file-handler`, `-bubble-menu`, `-character-count`, `-typography` — all pinned to the installed `@tiptap` version (3.26.0) |
| `dashboard/src/components/article-editor.tsx` | register new extensions; bubble menu UI; link popover; image button + FileHandler upload wiring; sticky mobile toolbar; expose word count |
| `dashboard/src/components/link-popover.tsx` (new) | anchored link editor popover |
| `dashboard/src/lib/storyblok-assets.ts` (new) | server-only `uploadAsset(file)` → Storyblok asset CDN URL |
| `dashboard/src/app/api/upload/route.ts` (new) | authed multipart upload endpoint → `uploadAsset` → `{ url }` |
| `dashboard/src/components/article-form.tsx` | debounced draft autosave + "Saving/Saved" indicator; word-count/read-time display + auto `read_minutes` |
| `website/src/lib/articles.ts` | `tiptapJsonToHtml` `image` node case (escaped) + unit test |
| `website/src/app/globals.css` | `.ad-body img` / `.ad-body figure` responsive styling |

New env: none (reuses `STORYBLOK_MANAGEMENT_TOKEN` / `STORYBLOK_SPACE_ID`, already server-side).

---

## Testing

- **Unit (node --test):** `tiptapJsonToHtml` renders an `image` node to the expected
  `<figure><img…>` with escaped attrs; read-time calc (`words → minutes`) as a pure helper.
- **Build gate:** run a real `dashboard` `next build` AND `website` `next build` before deploy
  (dependency additions must be build-verified, not just `tsc` — prior incident with a TipTap
  version skew that `tsc` missed). Keep all `@tiptap/*` on one version.
- **Manual / E2E (needs a live server + Storyblok):** image drag-drop/paste uploads and renders;
  bubble menu appears on selection; link popover applies/removes; autosave fires on a draft and
  is silent on a published article; word count/read-time update live; mobile toolbar usable on
  iPhone. (Playwright specs for selection menu + image button presence can be committed; the
  upload round-trip is verified manually per the project's "fixed means deployed" rule.)
- **No real side effects in QA:** tests must not perform real Storyblok asset uploads against
  production beyond what's needed; use the manual E2E pass for the live upload check.

---

## Out of scope (future "power" phase)
Slash (`/`) commands, drag-to-reorder blocks, embeds (YouTube/tweets/etc.), distraction-free
mode, AI writing assist, image captions/alignment. All are addable on this same TipTap base later.
