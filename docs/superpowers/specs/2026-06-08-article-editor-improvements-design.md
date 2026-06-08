# Article Editor Improvements — Design

**Date:** 2026-06-08
**Status:** Approved (design); ready for implementation planning
**Context:** Yonah is starting to author articles. He hit concrete blockers: bullet markers
don't appear, pasting from Word produces "terrible" formatting, his article's 2-column
"grid" gets dropped, the three SEO override fields are opaque, and there's no way to
preview before publishing.

---

## Background — how articles work today

- **Storage:** Storyblok CMS (component `article`, folder `articles/`). No Supabase
  articles table (dropped Apr 2026).
- **Authoring:** Dashboard at `/articles` → `article-form.tsx` → `article-editor.tsx`
  (TipTap v3, `StarterKit` + `Link` + `Placeholder`). Body saved as ProseMirror/TipTap
  JSON (`body_json`).
- **Rendering:** Website re-derives HTML on every read. `storyToArticle`
  (`website/src/lib/articles.ts`) **always recomputes `body_html` from `body_json`** via
  `tiptapJsonToHtml`. The editor's own HTML output is discarded.
- **Single source of truth for rendering:** `tiptapJsonToHtml` in
  `website/src/lib/articles.ts`. It also feeds the RSS feed
  (`website/src/app/articles/feed.xml/route.ts`), so anything it renders flows to RSS
  automatically.
- **Both apps use Tailwind v4**, whose Preflight resets `ul, ol { list-style: none;
  margin: 0; padding: 0 }` globally.

**Implication:** every new content type touches four places — (1) editor extension,
(2) `tiptapJsonToHtml` converter, (3) website `.ad-body` CSS, (4) editor CSS.

---

## Phase 1 — Editor improvements (build now)

### 1. Fix invisible bullets / headings / blockquote (bug)

**Root cause (verified):** Tailwind v4 Preflight strips list markers. The bullet button
works and creates correct list nodes — the markers are just invisible. The website's
`.ad-body` block styles `p`/`h2` only; it has **no** `ul`/`ol`/`li`/`h3`/`blockquote`
rules, so those are unstyled for readers too.

**Fix:**
- Editor `.article-editor-content ul/ol` (`dashboard/src/components/article-editor.tsx`
  ~L242-246): add `list-style-type: disc` / `decimal` and `list-style-position: outside`.
- Website `globals.css` (`.ad-body`, ~L818): add `.ad-body ul`, `.ad-body ol`,
  `.ad-body li`, and the currently-missing `.ad-body h3`, `.ad-body blockquote`,
  `.ad-body a` rules, styled to match the existing reading typography.

**No data migration.** Purely display. Fixes lists for both authoring and published view.

### 2. Tables (paste + light controls)

His "grid split left/right" is a single 2-column × 6-row table ("Breakdown → Response").

- **Editor:** add `@tiptap/extension-table`, `-table-row`, `-table-header`,
  `-table-cell`. Toolbar gets an **Insert table** button. When the cursor is inside a
  table, show tap-friendly controls: add row, add column, delete row, delete column,
  delete table. (Merge/split cells deferred to Phase 2.)
- **Converter:** add `table`, `tableRow`, `tableHeader`, `tableCell` cases to
  `tiptapJsonToHtml` → semantic `<table><thead?>/<tbody><tr><th|td>`.
- **Website CSS:** add `.ad-body table` styling (borders, padding, header emphasis,
  mobile horizontal scroll wrapper so wide tables don't break the column).
- **Editor CSS:** matching `.article-editor-content table` styling.

### 3. Word-paste sanitizer

The mangling came from Word's junk inline styles/spans plus dropped tables (tables
weren't a supported node). With lists + tables now supported, add a paste transform that
**keeps** what the schema supports (headings H2/H3, bold, italic, lists, tables, links)
and **strips** Word's inline cruft (mso styles, span soup, empty paragraphs, font tags).

- Implement via TipTap `editorProps.transformPastedHTML` (and/or a
  `transformPasted/clipboardTextParser` hook) that runs pasted HTML through an allowlist
  before TipTap parses it.
- Headings above H3 (e.g. Word's H1/title) map down to H2 or paragraph per our schema.
- Plain-text artifacts like the arrow line "Seeing → Remembering → Aligning" come through
  as plain paragraph text — acceptable.
- **Success criterion:** pasting the full `Derech HaPnimi - Shelach.docx` body yields
  clean structure — headings, paragraphs, visible bullet lists, and the 2-column table —
  with no manual cleanup of stray styling.

### 4. SEO fields show their defaults

On the article form's three SEO override fields, show the **actual value the site will
use if the field is left blank**, as greyed placeholder text plus one line of helper copy
("Leave blank to use the article title / excerpt / an auto-generated image").

Per-article fallbacks (from `website/src/app/articles/[slug]/page.tsx` `generateMetadata`):
- **SEO title** default → the article title
- **SEO description** default → the excerpt (then subtitle)
- **OG image** default → the auto-generated per-article image (`/og/article/{slug}`)

These are the *per-article* fallbacks, **not** the global `/settings/seo` defaults (those
apply only to pages without their own metadata). Placeholder values update live as the
operator edits the title/excerpt fields.

### 5. Draft preview (real site, draft mode)

A **Preview** button on a saved draft opens the real website article page rendering the
unpublished draft — zero drift, exactly what readers will see.

- **Website route:** new `/preview/[slug]` (segregated from the public `/articles/[slug]`)
  that fetches the Storyblok **draft** version (`version=draft`, using the preview token
  the website already holds) and renders through the same article page component + CSS.
- **Indexing/access:** route emits `noindex`; access gated by an unguessable token stored
  in env (compared on the request). No login — fits a single mobile operator. Not linked
  from any public nav or sitemap.
- **Dashboard:** edit page gets a **Preview** button (opens the preview URL in a new tab).
  Enabled only after the article has been saved at least once (a draft must exist in
  Storyblok to have a slug to preview).

### Phase 1 scope guardrails (YAGNI)

Explicitly **out** of Phase 1 (see Phase 2): scheduled publishing, slug-uniqueness guard,
merge/split table cells, global-SEO-defaults page redesign, social posting, autosave,
delete-article UI, SEO length counters.

---

## Phase 2 — Roadmap (sequenced: Workflow → SEO → Editor → Distribution)

Each lettered block below is a candidate for its own spec → plan → implementation cycle
when reached. Scheduled publishing and social posting are large enough to be mini-projects.
Tech-debt cleanup (2E) can be folded into whichever block touches the relevant code first.

### 2A — Publishing workflow (first)

- **Scheduled publishing** — publish at a future date/time. Larger effort: needs a
  scheduling store + a trigger (Storyblok scheduled publish, or a cron in the dashboard /
  Vercel that flips `published` at the target time) + UI for setting/clearing a schedule.
- **`published_at` re-sort fix** — today `published_at` is only stamped on first publish
  (`article-form.tsx` ~L128), so unpublish→republish doesn't re-sort the list. Decide
  intended semantics (first-publish date vs. latest-publish date) and make it consistent
  between the list sort and the public `datePublished`.
- **Slug-uniqueness guard** — warn or block when a new/edited slug collides with an
  existing article (silent collisions break website routing today).
- **Delete-article UI** — wire a delete button + confirmation to the existing
  `DELETE /api/articles/[id]` (route exists, nothing calls it).

### 2B — Editor depth (after SEO)

- **Richer tables** — merge/split cells, header-row toggle, per-column alignment.
- **Autosave + unsaved-changes warning** — no protection today (flagged in QA fixmes);
  add periodic draft autosave and a `beforeunload` guard.

### 2C — SEO polish (after workflow)

- **Global `/settings/seo` redesign** — clarify the three global default fields with the
  same visibility treatment used in Phase 1 (show what each controls and where it applies).
- **Length hints/counters** — soft guidance on SEO title (~55 char) and description
  (~155 char); no hard limit.
- **Resolve dead `SearchAction`** — `website/src/lib/jsonld.ts` advertises a `/search`
  endpoint that doesn't exist. Either build site search or remove the `SearchAction` from
  the WebSite schema.

### 2D — Distribution (last)

- **Article → social posting** — on publishing an article, auto-draft a Buffer post that
  links to it (articles touch nothing in Buffer today; Buffer integration is video-only).
  Reuse the existing Buffer plumbing; decide draft-vs-auto-schedule and which channels.

### 2E — Tech-debt cleanup (fold in opportunistically)

- Drop the orphaned Supabase `site_content` table (no code reads or writes it; everything
  uses Storyblok).
- Remove the unused `marked` dependency from the website.

---

## Testing

- **Phase 1 lists/tables:** extend `tests/qa/dashboard/tier1/article-publish.spec.ts` to
  assert bullet/ordered lists and a table round-trip through save; add a website render
  assertion that `.ad-body ul` shows markers and a pasted table renders as `<table>`.
- **Converter:** unit-test `tiptapJsonToHtml` for the new `table`/list node cases.
- **Paste:** test `transformPastedHTML` strips representative Word HTML to clean nodes
  (fixture derived from the Shelach `.docx`).
- **SEO defaults:** assert placeholders reflect title/excerpt live.
- **Preview:** test the `/preview/[slug]` route returns draft content + `noindex`, and
  rejects requests without the token.
- **No real side effects in QA** (per project rule): preview/test must not trigger live
  Buffer posts or publishes.
