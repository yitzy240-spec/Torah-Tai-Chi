# Editing v2 — Per-Clip Direct Editing UX Design

**Status:** approved 2026-05-04
**Scope:** dashboard `/videos/<slug>` page (single canonical editing surface), Modal pipeline (new no-AI re-render path).
**Out of scope:** visual drift root cause (separate investigation underway), script-edit → clip-remap workflow, topic-video editing flow, clip duration/reordering/adding-clips, public website rendering changes.
**Related:** previous per-clip work at [docs/superpowers/plans/2026-05-01-per-clip-regen-and-compose.md](../plans/2026-05-01-per-clip-regen-and-compose.md) (which shipped but didn't solve Yonah's pain).

## Problem

Yonah is non-technical and struggles with the dashboard's UX. He's paying for ~5 video attempts per parsha and the system "ignores his script." Three concrete failure modes from his own words:

1. **Words come out wrong.** Clip voiceovers are Claude-rewritten phonetics. There's no UI to edit the actual rendered text — only feedback boxes that go through Claude (which often paraphrases or "improves" rather than honoring his text).
2. **Move announcements baked in.** When Yonah picks a tai chi move, Claude inserts a self-introducing sentence into one clip's voiceover. Yonah dislikes the wording but can't find anywhere to edit it.
3. **Title and tagline aren't editable.** `scripts.title` ("Your Body Is Soil") and `scripts.tldr` (the italic teaser) are Claude-generated and read-only. They show on the dashboard AND on the public website. Yonah cannot change them.

Compounding these: TWO editing surfaces (`/videos/<slug>` main page and `/videos/<slug>/edit`) compete for the same job. Both go through Claude as an interpreter — direct text edit isn't an option anywhere.

The architecture was designed assuming AI-as-interpreter is the right interface. For a non-tech-savvy user paying for each Claude/Seedance round, it isn't. He needs **direct word-level control with explicit cost preview** as the default path, with AI assistance available as an opt-in helper for cases where he doesn't know what to type.

## Design

### Section 1 — Page structure (one canonical surface)

The main video page (`/videos/<slug>`) becomes the single editing surface. Top-to-bottom layout:

1. Bilingual header (existing — parsha name in Hebrew + English + book label)
2. Status banner — failed/in-flight (from [2026-05-03-failed-retry-ux-design](2026-05-03-failed-retry-ux-design.md))
3. Production arc (existing)
4. **Script carousel** (existing) — with **inline-editable title + tldr**
5. **Editable clip list** (NEW — heart of this spec; replaces today's read-only `VideoFeedback`)
6. Captions panel (existing)
7. Distribution panel (existing)

The `/edit` route redirects to `/videos/<slug>#clips`. The `EditPageClient` and the duplicate `/edit` `ClipCard` are deleted; the useful pieces (per-clip preview, version gallery) move into Section 3 below.

### Section 2 — Inline-editable title and TLDR

Currently `scripts.title` and `scripts.tldr` are AI-generated and read-only inside `ScriptCarousel`. Change:

- Click the title → becomes a single-line `<input>`. Type, blur or Enter to save (debounced 800ms).
- Click the tldr → becomes a `<textarea>`. Same save semantics.
- Inline "Saved ✓" pill flashes on save. No separate publish step — these fields don't drive Seedance.
- **Caption beneath both fields (small italic text):** *"Shown on the dashboard script card and on the public site. Does not affect video rendering."*

Persistence: writes to `scripts.title` and `scripts.tldr` via a new `/api/scripts/edit-meta` server action. The public site already reads from these fields, so changes propagate without a republish.

### Section 3 — Editable clip card (the core UX)

Each clip in the new list (replacing today's read-only `VideoFeedback` per-clip rows) is an editable card with these elements top to bottom:

- **Header row** — *"Clip 3 of 5 · 9.0s · v2 of 3"* (clip index, duration, current version pill).
- **Mini video preview** — 9:16 thumbnail, click to play in modal or inline. Pulls from current `clips[].storage_path` (already populated for done clips).
- **Voiceover field (editable textarea)** — prefilled with current `clips[].voiceover`. Auto-saves to `clips.voiceover` on change (debounced 800ms). Three states shown beside the field:
  - *"Saved"* — quiescent, no unsaved changes
  - *"Saving…"* — debounce-flushing
  - *"Edits not yet rendered"* — saved to DB but the live mp4 still reflects the old voiceover
- **Caption beneath voiceover (small italic):** *"This is the exact text Seedance will speak. Edit it to fix pronunciation, words, or the move announcement."*
- **Disclosure: "Show scene direction"** — collapsed by default. Expanded: editable textarea for `clips[].visual_prompt` with same save semantics. **Caption:** *"Tells Seedance what the clip should look like. Add details like 'navy knit kippah, sits flat' if the visuals drift."*
- **Re-render button** — labeled *"Re-render this clip · ~$1.20 · ~30s"* with the actual cost from [seedance-pricing.ts](../../../dashboard/src/lib/seedance-pricing.ts) and a typical-time hint. Disabled when no unsaved-and-unrendered edits exist. On click: calls a new `regen_clip_from_text(jobId, clipIndex)` Modal function that **bypasses Claude** — sends Yonah's exact voiceover + visual_prompt straight to Seedance. (See Section 4.)
- **Version chips** — *v1 / v2 / v3* clickable thumbs. Click to swap which clip version is "live" for the stitched final video. Same UI as today's `/edit` page version selector. **Caption:** *"Pick the version you like best. The final video stitches the selected version of each clip together."*
- **"Ask AI to help" link (small, below the textareas)** — only visible if Yonah hasn't started typing in the voiceover field. Opens a modal with today's feedback box; submission goes through the existing Claude path (`submit-clip-feedback`). Keeps the AI helper available without making it the default. **Caption above the link:** *"Don't know what to change? Tell the AI what's wrong and let it edit for you."*

### Section 4 — New Modal function: `regen_clip_from_text`

A simpler companion to the existing `regen_single_clip`. Differences:

| | `regen_single_clip` (existing) | `regen_clip_from_text` (new) |
|---|---|---|
| Input | User feedback text | None (reads stored fields) |
| Claude pass | Yes — rewrites voiceover/visual_prompt | **No** — uses stored fields verbatim |
| Use case | "I don't know what to type, tell the AI" | "I typed exactly what I want" |
| Cost | 1 Claude call + 1 Seedance call | 1 Seedance call only |
| Speed | ~60-90s | ~30-60s |

Implementation skeleton:
- Read `clips[clipIndex].voiceover` and `.visual_prompt` from DB
- Send to Seedance via existing `generate_clip_with_meta(...)` exactly as `regen_single_clip` does after Claude rewrites
- Save the new mp4 to Storage as a new clip version
- Trigger re-stitch with the new version selected

The endpoint: `POST /api/regen-clip-from-text` with `{ jobId, clipIndex }`. Auth via the existing pipeline trigger secret pattern.

### Section 5 — Frontend clarity (the wayfinding emphasis)

Yonah struggles with UX. Every editable surface gets:

1. **Section headers** with brief italic captions explaining what the section does ("Edit individual clips. Changes here affect rendering.").
2. **Field-level captions** under every editable input describing exactly what each field controls and where it appears (dashboard / public site / Seedance).
3. **Action buttons labeled with cost + time** when applicable. Re-render: *"Re-render this clip · ~$1.20 · ~30s"*. Generate: *"Generate full video · ~$5-7 · ~8 min"*.
4. **Status indicators** in plain English. "Saved" / "Edits not yet rendered" / "Re-rendering…" — no jargon, no checkmarks without text labels.
5. **Anchor link in the page nav/sidebar** to jump to the clip list section directly.
6. **Empty states with guidance.** First-time visitors to a parsha that hasn't been generated yet see *"No video yet — pick a script and click Generate."* Visitors to a clip with no version yet see *"This clip is being rendered for the first time."*
7. **Confirmation dialogs for destructive or paid actions.** Re-render shows a small dialog: *"Re-render Clip 3? This costs ~$1.20 and takes ~30 seconds. Yonah's edits will be sent to Seedance."*

A persistent help icon (top of the editing section) opens a modal with a 5-line explanation of how the editing works:
- *"This page is everything for one parsha video."*
- *"Edit the script title or teaser at the top — those show on the dashboard and the public site."*
- *"Edit each clip's words below — those affect what Seedance speaks."*
- *"Hit Re-render on a clip to apply your edits. Each re-render costs ~$1.20."*
- *"The final video stitches together the selected version of each clip."*

### Section 6 — Killing duplicate surfaces

- `/edit` route → redirect to `/videos/<slug>#clips` via `app/videos/[slug]/edit/page.tsx`
- Delete `dashboard/src/app/videos/[slug]/edit/edit-page-client.tsx`
- Delete `dashboard/src/app/videos/[slug]/edit/clip-card.tsx` (its useful pieces moved into Section 3's new component)
- Delete `dashboard/src/app/videos/[slug]/edit/compose-row.tsx` (compose feature deferred)
- The current `VideoFeedback` per-clip "Fix this clip" inline rows — replaced by the new `EditableClipCard` list

The general video-level feedback box (whole-video pacing/tone) at the bottom of `VideoFeedback` stays — that's a different workflow.

## Implementation order

1. **`regen_clip_from_text` Modal function** — pipeline foundation (no UI yet).
2. **API route + server action** for the dashboard to call it.
3. **`EditableClipCard` component** — new editable per-clip surface (Section 3).
4. **Inline title + tldr edit** in script carousel (Section 2).
5. **Page restructure** — render the new clip list, kill the duplicate surfaces (Section 6).
6. **FE-clarity pass** — captions, costs, confirms, help modal, anchor links (Section 5).

Each step ships independently. After step 3 alone, Yonah has direct text editing — the most urgent fix. Steps 5 and 6 polish the surface.

## Validation

After all six ship:

- Yonah types a corrected voiceover (e.g. fixes a Hebrew pronunciation), clicks Re-render, sees the new clip in ~30s with the EXACT text he typed (no Claude paraphrase).
- Yonah deletes the move-announcement sentence from a clip's voiceover, re-renders, the new clip starts directly with the teaching (no announcement).
- Yonah edits the title from "Your Body Is Soil" to "When the Land Rests" — change appears on the dashboard carousel header AND on the public site within seconds.
- Yonah lands on `/videos/<slug>/edit` (old URL) — gets redirected to `/videos/<slug>#clips` and lands at the clip list.
- Re-render confirmation dialog states "$1.20" and "30 seconds." Generate full-video dialog states "$5-7" and "8 min."
- Help modal renders the 5 plain-English bullets.

## Out of scope (with reasons)

- **Visual drift / kippah inconsistency** — Section 3's editable `visual_prompt` lets Yonah add reinforcing language ("navy knit kippah, sits flat on crown"), which mitigates the symptom. The root cause (something regressing in ref uploads or Seedance behavior) is being investigated separately.
- **Script-edit → clip-remap** — when Yonah edits `scripts.draft_text`, existing clips don't auto-update. The carousel surfaces this with an honest banner: *"Script saved. Existing clips unchanged — start a new generation to use this draft."* Auto-remapping requires Claude to slot new draft text into existing clip slots while preserving visual_prompts; that's its own design problem.
- **Topic-video editing flow** — the same architecture would apply but the surface is `/jobs/<id>` not `/videos/<slug>`. Tracked separately.
- **Clip duration / reordering / adding clips** — significant additional UI; punted.
