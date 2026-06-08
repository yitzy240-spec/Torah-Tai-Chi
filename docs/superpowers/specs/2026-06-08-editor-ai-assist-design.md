# Editor AI Assist — Design

**Date:** 2026-06-08
**Status:** Approved (design); ready for implementation planning
**Goal:** Give the non-technical article author one-click AI help for the things that
cause real friction — generating the SEO title + meta description, generating the excerpt,
and improving/shortening/grammar-fixing selected text — without inventing facts and without
blocking the save/publish flow.

---

## Context

- The dashboard already calls Claude via OpenRouter through `dashboard/src/lib/claude.ts`
  (`callClaude({ systemPrompt, userPrompt, model?, maxTokens? }) → string`). Reuse it.
  Default model there is `anthropic/claude-opus-4.7`; these utility calls don't need Opus.
- The article editor (`article-editor.tsx`, TipTap v3.26) now has a selection **bubble menu**;
  the article form (`article-form.tsx`) holds the SEO title/description + excerpt fields.
- Yonah explicitly asked how to fill the SEO fields (current answer: "paste into ChatGPT").
  This feature brings that in-house. Content is Torah commentary — **accuracy matters**.

## Model

- Reuse `callClaude` with a **Sonnet-tier** `model` override (faster + far cheaper than Opus;
  ample for SEO lines, an excerpt, and a grammar pass). Small `maxTokens` per task.
- **Pin the exact current Sonnet id at implementation time** by querying
  `https://openrouter.ai/api/v1/models` (the web summary returned an ambiguous
  `~…latest` alias not to be trusted verbatim). Put the verified id in one constant.

## Architecture

### Server: `dashboard/src/app/api/ai/route.ts` (new)
- `POST`, gated by `requireAuth()` (same pattern as the other routes; 401 otherwise).
- Body: `{ task, articleText?, selectionText? }`, `task ∈
  'seo-title' | 'seo-description' | 'excerpt' | 'improve' | 'shorten' | 'fix-grammar'`.
- Validates `task` against the enum (400 otherwise). Builds the prompt via `buildAiPrompt`
  (below), calls `callClaude` with the Sonnet model + the task's `maxTokens`, returns
  `{ text }` (200) or `{ error }` (502 on model failure, 400 on bad input). Trims the result.
- Best-effort: errors return a message; they never block anything client-side.

### Pure helper: `dashboard/src/lib/ai-prompts.ts` (new, unit-tested)
- `buildAiPrompt(task, { articleText, selectionText }) → { system, user, maxTokens }`.
- Per-task system prompts share a common preamble: calm, contemplative blog voice; **never
  invent quotes, citations, sources, or facts — only work from the provided text**; return
  ONLY the requested text (no preamble, quotes, or markdown).
  - `seo-title`: ≤ ~60 chars, compelling, faithful to the article. maxTokens ~64.
  - `seo-description`: ~140–155 chars, one sentence. maxTokens ~96.
  - `excerpt`: 1–2 sentences summarizing the article for a card. maxTokens ~128.
  - `improve`: rewrite the selection more clearly, preserving meaning + voice + length-ish.
  - `shorten`: tighten the selection, same meaning, fewer words.
  - `fix-grammar`: fix grammar/punctuation only; keep wording + meaning otherwise.
  - improve/shorten/fix-grammar: maxTokens ≈ selection length × 2 (cap ~512).
- `articleText` feeds seo-*/excerpt; `selectionText` feeds improve/shorten/fix-grammar.

### Pure helper: `dashboard/src/lib/tiptap-text.ts` (new, unit-tested)
- `tiptapJsonToText(doc) → string`: walk the ProseMirror JSON, concatenate `text` nodes,
  separate block nodes (paragraph/heading/listItem/blockquote/tableCell) with newlines.
  Used to give the model the article body as plain text. Resilient to null/odd input ('' ).

### Client: SEO + excerpt (`article-form.tsx`)
- A small **"✨ Generate"** affordance on **SEO title**, **SEO description**, and **excerpt**.
- On click: POST `/api/ai` with the task + `articleText` (`tiptapJsonToText(form.body_json)`,
  prefixed with the title). Per-field loading state; inline error on failure.
- **Apply behavior (fill-empty / confirm-before-replace):** if the target field is empty,
  set it to the result immediately. If it already has text, show a small inline bar under the
  field: the suggestion preview + **[Replace] [Keep mine]**. Replace sets the field; Keep
  mine discards. Never silently overwrites the author's text.

### Client: improve menu (`article-editor.tsx` bubble menu)
- Add a **✨** button to the selection bubble menu that opens a tiny menu:
  **Improve / Shorten / Fix grammar**.
- On pick: read the selected text (`editor.state.doc.textBetween(from, to, ' ')`), POST
  `/api/ai` with the task + `selectionText`; on success, replace the selection in place
  (`editor.chain().focus().insertContentAt({ from, to }, text).run()`). Editor undo (Cmd/Ctrl+Z)
  reverts it. Show a brief loading state on the ✨ button; inline/transient error on failure.
  No-op if the selection is empty.

## Error / loading / safety
- All AI calls are best-effort and non-blocking: a failure shows a small inline message and
  leaves the field/selection untouched. Saving and publishing never depend on AI.
- The route is auth-gated; the OpenRouter key stays server-side (in `callClaude`).
- No streaming (keep it simple); responses are short.

## Testing
- **Unit (`node --test`):** `ai-prompts` — each task returns a `{system,user,maxTokens}` with
  the task's constraint text present and the right input wired (articleText vs selectionText);
  `tiptap-text` — paragraphs/headings/lists/nested/empty render to expected plain text.
- **Build gate:** `tsc --noEmit` AND `next build` for the dashboard before deploy; the
  website is untouched by this feature. (CI runs bare `tsc` over test files — keep them typed.)
- **Manual E2E (deployed, logged in):** Generate SEO title/description + excerpt on a real
  article (empty → fills; non-empty → confirm bar); ✨ Improve/Shorten/Fix-grammar on a
  selection rewrites it and undo reverts; an induced AI error surfaces inline and blocks nothing.
- **No real AI calls in CI** (no key, and cost) — the pure helpers are what CI covers.

## Out of scope (later)
Inline "continue writing" autocomplete, streaming responses, title/headline brainstorming,
AI image generation (separate), multi-language.
