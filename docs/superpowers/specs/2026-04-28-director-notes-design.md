# Director Notes — Design

**Date:** 2026-04-28
**Author:** Yitzy + Claude
**Status:** Spec, awaiting plan

## Goal

Give Yonah an optional free-form text field where he can leave directorial notes
("set the outdoor clips by a slow river", "make sure he meditates in the dojo
clip") that flow into the director-agent prompt and shape the generated video,
*within* the existing system rules.

## Non-goals

- Notes do **not** override structural rules: clip count/ordering, camera-verb
  list, dojo-first / outdoor-second block ordering, the 2.8 wps cap, the Hebrew
  phonetic rules, the archetype menu, or the caption schema.
- Notes are not per-clip structured fields. The LLM interprets natural-language
  per-clip targeting ("in the dojo clip…", "for the outdoor part…").
- No "preview the clip plan, then add notes per clip" workflow.

## Where it fits in the existing flow

The director agent is `transform_draft_to_clip_plan` in
[src/script_generator.py:395](../../../src/script_generator.py#L395), invoked by
[modal_app.py:231](../../../modal_app.py#L231). It takes the script (parsha) or
generated draft (topic) and produces a `ClipPlan` JSON. Two entry points feed
the same Modal worker:

- **Parsha flow:** `GenerateDialog` → `triggerGeneration` server action →
  inserts a `jobs` row.
- **Topic flow:** `AiVideoPanel` on `/compose` → `POST /api/compose/generate-video`
  → inserts a `jobs` row with `kind='topic'`.

Director notes attach to the prompt at the same point the draft does, gated by
a phrase that scopes them as scene/feel guidance only.

## Data model

Two new `text` columns, both nullable, both capped at 1000 chars at the API/UI
layer (no DB-level check constraint — keeps migrations simple, validation lives
in the server actions and route handlers):

- **`scripts.director_notes`** — persistent, edited on the script card. Survives
  re-runs. Source of truth for the parsha flow.
- **`jobs.director_notes`** — snapshot taken at the moment Generate is clicked.
  The Modal worker reads only this. Once a job is queued, later edits to the
  script's notes don't affect the running pipeline.

A single Supabase migration adds both columns.

## Director-agent prompt change

In [src/script_generator.py](../../../src/script_generator.py):

1. `build_prompt` gains an optional `director_notes: str | None = None` arg.
2. When non-empty, insert this block immediately before the closing `tail`:

   ```
   DIRECTION FROM YONAH (apply within the existing rules above — these are
   scene/feel guides, NOT structural overrides; do not change clip count,
   ordering, camera-verb list, archetype menu, or WPS caps to satisfy them):
   <notes verbatim>
   ```

3. `transform_draft_to_clip_plan` gains the same optional arg and forwards it.

The "NOT structural overrides" phrasing is the guardrail. The system prompt
already enforces structure; this phrasing tells the LLM how to weight Yonah's
input against those rules.

## Modal worker change

In [modal_app.py](../../../modal_app.py) where the worker selects job fields
(currently `kind, parsha_id, script_id, topic, resolution, model_tier,
motion_ref_slug`), add `director_notes`. Pass it to
`transform_draft_to_clip_plan` in both the topic and parsha branches.

## UI — parsha flow (two surfaces, one source of truth)

### a. Script card editor

Wherever the title/draft editor lives — currently
[dashboard/src/components/script-carousel.tsx](../../../dashboard/src/components/script-carousel.tsx)
is the consumer of `saveScriptDraft`; the implementation plan should confirm
this is the right surface and locate the relevant editor sub-component.

- New "Director notes (optional)" textarea, ~3 rows, below the draft.
- Saved via [saveScriptDraft](../../../dashboard/src/app/actions/save-script-draft.ts) —
  extend it to accept an optional `directorNotes` arg and add it to the patch.
- Placeholder: *e.g. "set the outdoor clips by a slow river" or "make sure he
  meditates in the dojo clip"*.
- Char counter at the field; soft-cap UI at 1000 chars; server enforces.

### b. GenerateDialog

[dashboard/src/components/generate-dialog.tsx](../../../dashboard/src/components/generate-dialog.tsx):

- New collapsible "Direction notes" section above the quality picker.
- Pre-filled from `scripts.director_notes` (passed in as a new prop from the
  caller, fetched alongside the other script fields).
- Collapsed by default when notes are empty; expanded by default when they
  have content (so Yonah always sees what's currently attached before
  approving).
- Editing in the dialog and clicking **Generate** does two things:
  (1) persists the edits back to `scripts.director_notes`, and
  (2) snapshots them onto the new `jobs` row.
  This avoids silent divergence between the dialog's value and the script's
  saved value.

### c. trigger-generation server action

[dashboard/src/app/actions/trigger-generation.ts](../../../dashboard/src/app/actions/trigger-generation.ts)
gains an optional `directorNotes?: string` param:

- **Param absent (undefined):** older callers without notes support; do not
  touch `scripts.director_notes`.
- **Param present (any string, including empty):** user opened the dialog
  and either edited or accepted the pre-filled value. Normalize (trim,
  empty → null) and write to `scripts.director_notes` before queueing the
  job. An empty string is an explicit "clear my notes" — that's a valid
  user action and should persist.
- Always copy the *resulting* `scripts.director_notes` value (post-update)
  onto the new `jobs` row's `director_notes` column.

## UI — topic flow

[dashboard/src/app/compose/ai-video-panel.tsx](../../../dashboard/src/app/compose/ai-video-panel.tsx):

- New "Direction notes (optional)" textarea below the topic field, ~3 rows.
- Sent in the POST body alongside `topic` and `moveSlug`.
- No persistence — topic flow has no `scripts` row to attach to. Each run is
  fresh.

[dashboard/src/app/api/compose/generate-video/route.ts](../../../dashboard/src/app/api/compose/generate-video/route.ts):

- Validate `directorNotes` (optional, string, ≤1000 chars).
- Insert into the `jobs` row alongside the existing fields.

## Validation rules

Apply consistently across all entry points (`saveScriptDraft`,
`triggerGeneration`, `POST /api/compose/generate-video`):

- Optional. Empty / whitespace-only is normalized to `null`.
- Trim leading/trailing whitespace before saving.
- Max 1000 chars after trim. Reject with a clear error otherwise.
- No special-character stripping — the notes go into a Claude system+user
  prompt, not into HTML or shell, so injection isn't a concern beyond the
  usual prompt-content surface that the draft already exposes.

## Testing

- **Unit:** `build_prompt` produces the new `DIRECTION FROM YONAH:` block when
  notes are non-empty, omits it entirely when notes are null/empty.
- **Unit:** `transform_draft_to_clip_plan` forwards the notes argument.
- **Integration (manual):** Run a parsha generation with a note like *"make
  sure clip 1 is by a river"* — confirm the resulting `clip_plans.plan_json`
  shows `setting_id: "RIVERSIDE_GROVE"` (or equivalent natural steer) without
  the dojo block being skipped.
- **Integration (manual):** Run a topic generation with a note — confirm
  `jobs.director_notes` is set and the prompt block appears in the Claude
  request log.
- **Regression:** Generate without notes — output should be byte-equivalent
  to the pre-change pipeline (the new prompt block is fully omitted).

## Out of scope / future considerations

- Showing the user *which* of their notes the director acted on (e.g.,
  diffing the resulting `visual_prompt` fields against the notes). Useful
  diagnostic, but additive and not needed for v1.
- A library of saved note presets ("solemn outdoor", "playful dojo"). Wait
  until Yonah has used the field for a few weeks and we see repeated
  patterns.
- Per-clip structured note fields. Free-form is simpler and matches the
  way Yonah described his notes ("make sure he meditates in this clip").
