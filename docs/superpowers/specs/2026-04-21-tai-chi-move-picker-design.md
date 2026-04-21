# Tai Chi Move Picker — Design

**Date:** 2026-04-21
**Status:** Spec, awaiting plan

## Context

The reference-library project (see `2026-04-21-tai-chi-reference-library-design.md`) produced 27 vetted tai chi clips on disk at `references/tai_chi_moves/<slug>.mp4` with matching Gemini-generated sidecars (`<slug>.json` carrying `english`, `pinyin`, `section`, `visual`, `motion_description`). A standalone harness (`tools/test_seedance_ref.py`) proved that Seedance 2.0's `reference_video_urls` input gives Rav Eli credible, practitioner-faithful tai chi motion when paired with the character references.

This spec adds the user-facing feature that activates that library: letting Yonah optionally pick a move for any video he generates, so the clip-plan generator weaves the chosen move into one DOJO clip's scene direction and the Seedance call for that clip uses the reference video.

## Why

Three user needs, confirmed during brainstorming:

1. **Authenticity** — Seedance invents wonky tai chi motions when left unguided; references keep Rav Eli's form credible to practitioners.
2. **Script-driven** — when Yonah's draft references a specific move ("sink to rise", "white crane"), the video should actually show that move.
3. **Variety** — avoid every video looking like Rav Eli's same generic arm-wave; hand-pick a distinct shape each week.

Curriculum is explicitly **not** a driver — there is no "teach the 24-form over the year" goal.

## Scope

### In scope

- New `[Add tai chi move]` action on the script card (Today page + `/videos/[slug]`).
- Picker sheet listing 27 library moves grouped by section, with inline reference-clip previews.
- Move persistence: a picked move sticks to the script row (parsha path) or rides on the job row (topic path).
- Script-generator prompt extension that directs Claude to weave the move's motion into one DOJO clip's visual_prompt.
- Video-generator plumbing that passes the reference video URL on the chosen clip's Seedance call.
- Extending the same picker + data flow to the `/compose` AiVideoPanel (topic videos).
- A one-time sync script that mirrors `references/tai_chi_moves/` into Supabase (`tai_chi_moves` table + `videos/tai_chi_moves/` storage).

### Out of scope (v1)

- Uploading new moves from the dashboard (still goes through the existing CLI + sidecar pipeline + sync).
- Multiple moves per video (exactly 0 or 1).
- Letting Yonah pick which clip gets the reference (Claude decides).
- AI-suggested moves ("Claude recommends White Crane for this parsha").
- Per-generation re-pick inside the Generate dialog (picker lives on the card, not in the quality modal).
- Curriculum tracking (no "used 3 times", no "haven't tried Brush Knee").
- Edit/delete of library moves from the dashboard.
- Retry-without-move fallback if Seedance chokes.
- The FAB "New video" button on the Today page — currently a UI mock that doesn't actually create a job. When it gets wired, move-picker coverage can be added in a follow-up.

## User flow

### Parsha path (script card)

The script card currently shows this actions row:

```
[Approve · generate video]  [Edit script]
```

After this change:

```
[Approve · generate video]  [Edit script]  [Add tai chi move]
```

Click `Add tai chi move` → picker sheet opens → Yonah picks a move → sheet closes → the action row now shows the selection:

```
[Approve · generate video]  [Edit script]  Move: White Crane Spreads Wings (change · remove)
```

Selection persists on the script row (`scripts.motion_ref_slug`). Leaving the page and returning shows the same selection. Regenerating the same script reuses the same move unless Yonah changes it.

Clicking `Approve · generate video` opens the existing quality-tier modal unchanged. The move slug flows through the trigger action into the new `jobs.motion_ref_slug` column.

### Topic path (compose/ai-video-panel)

The `/compose` AiVideoPanel currently has a topic textarea and a generate button. We add an `[Add tai chi move]` control above the generate button, using the same picker sheet component.

Selection is ephemeral (no persistent topic-draft row to anchor to). When Yonah clicks generate, the move slug is sent as part of the POST body to `/api/compose/generate-video`, which writes it to `jobs.motion_ref_slug` directly.

### IdeaCard custom scripts (inherited)

Custom scripts generated via the IdeaCard create normal rows in the `scripts` table and appear in the same carousel. They get the `[Add tai chi move]` action for free with no extra code changes.

## Picker sheet

Shape:

- Sheet slides in from the right (matches existing modal aesthetic).
- Title: **Add a tai chi move.** Subtitle: *Optional — pick one to feature in one of the dojo beats.*
- Search field filters across `english` and `pinyin` as substring match (no fuzzy).
- Body: moves grouped by `section` (Yang 24-form, Basic stances, Chen-style, Other — in that order).
  Each row shows English name on the first line, pinyin + a `▶ preview` button on the second.
- `▶ preview` toggles an inline `<video muted playsinline loop>` element placed directly beneath the row. Only one preview plays at a time — opening a second preview closes the first.
- Clicking a row selects it (radio-style, one at a time). Footer: `Cancel` and `Select` (disabled until a row is picked).
- Moves without both a `.mp4` and a `.json` sidecar in the filesystem (i.e., the ~10 `needs_review` moves) never make it into the `tai_chi_moves` table, so they are silently absent from the picker. No warnings, no placeholders.
- `Remove` action on the card clears the selection without opening the sheet.

The picker component is reusable between the script-card surface and the AiVideoPanel surface — built once as `<TaiChiMovePicker onSelect={...} currentSlug={...} />`.

## Data model

### New table: `tai_chi_moves`

| column | type | notes |
|---|---|---|
| `slug` | text, PK | e.g. `white_crane_spreads_wings` |
| `english` | text, not null | "White Crane Spreads Its Wings" |
| `pinyin` | text, not null | "Báihè Liàngchì" |
| `section` | text, not null | `yang_24_form`, `basic_stances`, `chen_style`, `other` |
| `visual` | text, not null | One-line posture description |
| `motion_description` | text, not null | Full Gemini sidecar description |
| `mp4_storage_path` | text, not null | Path in Supabase Storage `videos` bucket |
| `duration_s` | int, not null | Must be ≤15 (Seedance hard cap) |
| `created_at` | timestamptz, default now() | |
| `updated_at` | timestamptz, default now() | |

### New columns on existing tables

- `scripts.motion_ref_slug text null` — foreign key to `tai_chi_moves.slug`. Persists Yonah's pick for the parsha path.
- `jobs.motion_ref_slug text null` — copied from `scripts.motion_ref_slug` at trigger time (parsha path), or set directly by the compose route (topic path). Provides a self-contained audit record on the job.
- `clips.motion_ref_url text null` — set by the pipeline on the ONE clip that actually consumed the reference video. Provides a playback/debug trail.

The Pydantic `Clip` model in `src/models.py` already has `motion_ref_url: str | None = None` from earlier phase 2 scaffolding — no code change needed there.

### One-time sync

New script: `tools/sync_moves_to_supabase.py`.

- Walks `references/tai_chi_moves/*.json` sidecars.
- For each, uploads the paired `.mp4` to `videos/tai_chi_moves/<slug>.mp4` in Supabase Storage (upsert).
- Upserts a row into `tai_chi_moves` with sidecar fields + storage path + probed duration (via ffprobe).
- Skips sidecars whose paired mp4 is missing.
- Run manually — once at feature launch, re-run whenever new moves land in the library. No scheduled/cron sync.

## Pipeline integration

### Modal entrypoint

`modal_app.run_pipeline` reads `jobs.motion_ref_slug` at the start of the job. If non-null, it queries `tai_chi_moves` for the full sidecar + storage path, builds the Supabase public URL for the mp4, and carries both forward through the pipeline.

### Script generator (`src/script_generator.py`)

`transform_draft_to_clip_plan` gains an optional parameter:

```python
selected_move: dict | None = None
# When set, contains keys: slug, english, pinyin, visual, motion_description
```

When `selected_move` is provided, the system prompt appends this block:

```
FEATURED TAI CHI MOVE (Yonah selected this):
- Name: {english} ({pinyin})
- Posture: {visual}
- Motion: {motion_description}

Pick exactly ONE dojo clip whose voiceover best pairs thematically with
this move. In that clip's visual_prompt, write Rav Eli performing this
move as the primary physical action, weaving the motion description into
your scene direction naturally (don't paste it verbatim — direct the
scene with it). Keep the voiceover as Yonah's words, unchanged. On that
clip only, emit an extra field: "motion_ref_slug": "{slug}". All other
dojo clips continue as you'd direct them without a featured move.
```

The `Clip` JSON schema in the output adds an optional `motion_ref_slug: string | null`. Exactly 0 or 1 clip in the plan may carry it; a validation in `ClipPlan.model_validator` enforces "at most one."

### Video generator (`src/video_generator.py`)

`generate_clip` gains an optional parameter `reference_video_url: str | None = None`. When non-null, the Seedance payload adds `reference_video_urls: [reference_video_url]`, and this addendum appends to the clip's prompt:

```
Use the reference video as a motion study — mirror the tempo, trajectory,
and stance of the core tai chi motion precisely, adapted to Rav Eli's
body. The reference is silent; Rav Eli continues to speak the voiceover
line naturally throughout — do not mute him or freeze his face. If the
reference video cuts before the move resolves, continue past that cutoff
and settle the body back to center.
```

### Per-clip dispatch (modal_app.run_pipeline)

After the clip plan lands, Modal walks the clips. For the one whose `motion_ref_slug` field is set (if any), it passes the Supabase mp4 URL as `reference_video_url` to `generate_clip`. That clip's row in the `clips` table is updated with `motion_ref_url` set to the same URL for the audit trail. All other clips run identically to today.

If a move was picked but Claude's output attaches it to zero clips (a soft failure), the pipeline logs a warning event and generates the video normally without the reference video. We don't hard-fail.

### Unvalidated assumption

The test harness (`tools/test_seedance_ref.py`) used a fully silent style lock because the test clip had no voiceover. Production clips carry Yonah's voiceover. The addendum above ("reference is silent; Rav Eli continues to speak the voiceover line naturally") is the production hypothesis — it hasn't been tested with voiceover yet. The implementation plan must include a validation step: generate a single clip with both voiceover and a motion reference, verify there are no lip-sync artifacts or muted-character regressions, and iterate on the prompt wording if needed before enabling the feature end-to-end.

## Dashboard API surface

### Server action: `addMoveToScript(scriptId, slug | null)`

Updates `scripts.motion_ref_slug`. Returns `{ ok: true }` or `{ ok: false, error }`. Authenticated. Called by the script-card picker.

### Server action: `triggerGeneration` (existing)

Modified: when inserting the `jobs` row, also copy `scripts.motion_ref_slug` into the new `jobs.motion_ref_slug` column (parsha path).

### Route: `POST /api/compose/generate-video` (existing)

Modified: accept an optional `moveSlug: string | null` in the request body. Validate against `tai_chi_moves`. Set `jobs.motion_ref_slug` at insert time.

### Route: `GET /api/tai-chi-moves` (new)

Returns all rows from `tai_chi_moves` ordered by `section` then `english`, each with a signed or public URL to the `.mp4`. The picker fetches from this route at sheet open.

Public bucket vs signed URL is a one-line check at implementation time — if `videos` is public-read, we return public URLs; otherwise we mint signed URLs valid for ~1 hour per preview.

## File changes summary

### New

- `dashboard/src/components/tai-chi-move-picker.tsx` — the sheet component.
- `dashboard/src/app/actions/add-move-to-script.ts` — persists the pick on a script row.
- `dashboard/src/app/api/tai-chi-moves/route.ts` — returns the library to the picker.
- `tools/sync_moves_to_supabase.py` — one-time sync of library to Supabase.
- `dashboard/supabase/migrations/<timestamp>_tai_chi_moves.sql` — new table + three new nullable columns.

### Modified

- `dashboard/src/components/script-carousel.tsx` — add `[Add tai chi move]` button + selection display on the script card.
- `dashboard/src/app/actions/trigger-generation.ts` — copy `scripts.motion_ref_slug` to `jobs.motion_ref_slug`.
- `dashboard/src/app/compose/ai-video-panel.tsx` — add picker control + send `moveSlug` in the POST body.
- `dashboard/src/app/api/compose/generate-video/route.ts` — accept + persist `moveSlug`.
- `src/script_generator.py` — add `selected_move` parameter, extend system prompt, extend output schema.
- `src/video_generator.py` — add `reference_video_url` parameter to `generate_clip`.
- `src/models.py` — `ClipPlan.model_validator` enforces "at most one clip carries `motion_ref_slug`".
- `modal_app.py` — read `jobs.motion_ref_slug`, look up move row, pass through to generators, persist `clips.motion_ref_url` on the matched clip.

## Risks

1. **Voiceover + motion-ref interaction (untested).** The addendum prompt assumes Seedance will copy motion-only while keeping lip-sync from the voiceover audio. This might need iteration. Mitigation: validation step in the plan before shipping.
2. **Claude might attach `motion_ref_slug` to zero clips.** Soft-fail behavior handles this, but repeated occurrence would mean wasted picker selection. Mitigation: log the event, review frequency after first few runs, tighten the prompt if needed.
3. **Reference video > 15s slipping into the table.** `duration_s` column is enforced ≤15 at sync time via ffprobe; anything longer is skipped with a warning.
4. **New section in `moves.yaml` without UI update.** Picker shows any unknown section under "Other" so it never crashes; we update the label map when a new section lands.

## Success criteria

- Yonah can pick a move from the script card, click Approve, and receive a video where one DOJO clip visibly performs that move with correct form (credible to a tai chi practitioner's eye).
- The voiceover plays naturally over the ref'd clip; Rav Eli is not muted or frozen.
- Unselected videos continue to generate exactly as they do today (no regression in the non-move path).
- Topic videos from `/compose` also support move picking via the same picker component.
- Adding a new move to the library is: drop the `.mp4` + sidecar into `references/tai_chi_moves/`, run `sync_moves_to_supabase.py`, and it appears in the picker within minutes.
