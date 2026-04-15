# Torah Tai Chi — Video Direction v2 Design

> **Status:** Approved for planning. Builds on Phase 1 POC (`docs/superpowers/specs/2026-04-14-torah-tai-chi-poc-design.md`) after first three live clips revealed direction issues.

## 1. Why This Spec Exists

Phase 1 produced a working pipeline but the first three Vayikra clips showed problems we can't fix at the prompt-template level:

- **Cuts feel jarring.** 6-8 settings in a 60-90s video is disorienting; each cut wastes attention on re-grounding the viewer.
- **Risky generations failed.** Clip 0 tried to render the small Hebrew letter aleph on a Torah scroll — the letter came out as gibberish. The pipeline is automated, so we cannot accept generation patterns Seedance can't reliably do.
- **No visual continuity across the show.** Every video looks like a different show — there's no recurring branded space that says "this is Torah Tai Chi" the way a TV show's standing set does.

The fix is design-level: shorter videos, fewer settings per video, frame-chained continuity within each setting, a locked dojo as the brand anchor, evidence-based guardrails, and Claude choosing settings based on the parsha narrative.

## 2. Goals

- 30-45s finished video (down from 60-90s).
- Two settings per video, frame-chained within each (no jarring cuts inside a setting).
- Dojo visually identical week-to-week (image-locked); outdoor settings rotated by Claude based on parsha themes (text-locked).
- Generation guardrails grounded in Seedance 2.0's documented strengths and weaknesses, not paranoia.

## 3. Non-Goals (Phase 2 — explicitly punted)

- Voice cloning / `@Audio1` lock. Re-evaluate after we ship 3 parshiot and see drift.
- Movement reference videos (Seedance `reference_video_urls`). Architectural slot reserved on `Clip` for later; not used in Phase 2.
- Per-clip caching beyond the existing `work/<run-slug>/clip_NN.mp4` resume.
- Parallel clip generation.
- Any video-analytics-driven setting selection.
- Multiple speaking characters (single-person speaking is what Seedance is reliable at; we use that).

## 4. Architecture Changes from Phase 1

Phase 1 modules stay; behaviors change. New responsibilities are added inside existing modules where they fit, plus one helper for frame extraction.

| Module | Phase 1 | Phase 2 change |
|---|---|---|
| `src/models.py` | `Clip`, `ClipPlan` | Add `setting_id: str` to `Clip` (`"DOJO"` or one of the outdoor archetype IDs). Add optional `motion_ref_url: str \| None = None` (slot for future, not used). |
| `src/settings.py` (new) | — | Holds `DOJO_ANCHOR_TEXT`, `OUTDOOR_ARCHETYPES` dict, `STYLE_LOCK`, and `GUARDRAILS_TEXT`. Single source of truth for direction language. |
| `src/script_generator.py` | One Claude call → `ClipPlan` | New SYSTEM prompt enforcing 4-clip, 2-setting-block structure; injects archetype menu + parsha → setting picking guidance; injects guardrails. |
| `src/video_generator.py` | Per-clip Seedance call | Knows about setting blocks: appends dojo refs to `reference_image_urls` only when `clip.setting_id == "DOJO"`; appends `first_frame_url` when clip is not the first in its block. |
| `src/frame_extract.py` (new) | — | One function: extract last frame of an mp4 as PNG using ffmpeg. ~10 lines. |
| `tools/generate.py` | Sequential clip generation | Between clips of the same block, extract last frame → upload to Kie.ai → use as next clip's `first_frame_url`. Resumes by detecting existing `last_frame.png` next to each `clip_NN.mp4`. |
| `references/` | Character refs (existing) | Adds `references/dojo/*.png` — 1-3 canonical dojo shots. Generated once via a new one-shot `tools/generate_dojo_refs.py` (modeled on existing `generate_references.py`). |

## 5. Video Structure (Locked)

Every video follows this template:

```
Block 1: Dojo (clips 0-1) — establish + teach
  ├── clip 0: hook / opening teaching, ~8s
  └── clip 1: deeper teaching, ~9s, first_frame_url = last frame of clip 0

Block 2: Outdoor archetype, parsha-chosen (clips 2-3) — apply + close
  ├── clip 2: application of teaching in outdoor setting, ~9s
  └── clip 3: CTA / closing breath, ~7-9s, first_frame_url = last frame of clip 2
```

- **Total:** 4 clips, 32-37s typical, ≤45s hard cap.
- **Cuts:** 1 intentional cut (block 1 → block 2). 0 cuts within a block.
- **Why dojo first:** First 0.5s of social video decides retention. Rav Eli mid-tai-chi in his branded dojo is faster recognition than a wide landscape that takes 2s to land.

## 6. Setting System

### 6.1 Dojo (Image-Locked, Single Setting)

Generated once via `tools/generate_dojo_refs.py` (separate one-shot Phase 2 task). Output: 1-3 canonical PNGs in `references/dojo/`. These are passed as `reference_image_urls` *in addition to* the character refs whenever a clip's `setting_id == "DOJO"`.

**Reference image budgeting (Seedance hard limit is 9):** Per dojo clip, the payload uses `min(N, 3)` dojo refs (where N = number of PNGs in `references/dojo/`) plus enough character refs to fill up to 9. Per outdoor clip, the payload uses up to 9 character refs and zero setting refs. The selection is mechanical: dojo refs first (deterministic order by filename), then character refs (deterministic order by filename) until the slot count is reached.

`DOJO_ANCHOR_TEXT` (constant in `src/settings.py`) supplements the image refs with text:
> "A traditional Torah Tai Chi dojo: warm cypress floor, rice-paper screens, single low cedar table with a small ceramic teacup, soft morning light filtering through bamboo blinds. Empty of all other people."

### 6.2 Outdoor Archetypes (Text-Locked, Claude-Picked)

`OUTDOOR_ARCHETYPES` is a dict in `src/settings.py`:

| ID | Anchor description (consistent across runs) | Tonal fit |
|---|---|---|
| `MOUNTAIN_RIDGE` | Alpine ridge at golden hour, stone footpath, distant peaks beyond a wide valley, pine scrub. | Revelation, ascent, perspective |
| `GARDEN_PATH` | Walled stone garden with flowering vines, a worn stone bench, dappled afternoon light through a fig tree. | Beginnings, growth, intimacy |
| `RIVERSIDE_GROVE` | Bend of a slow river, smooth river stones, silver-leafed olive trees, soft midday sun on water. | Flow, yielding, life-giving water |
| `DESERT_OUTCROP` | Sandstone outcrop overlooking a wide dry valley, sparse hardy shrubs, late-afternoon shadows. | Journey, scarcity, clarity |
| `FOREST_CLEARING` | Sunlit clearing in ancient pines, moss-covered fallen log, shafts of light through high canopy. | Hidden wisdom, mystery |
| `SEASHORE` | Quiet rocky shore at low tide, tide pools, gentle morning waves, distant horizon. | Crossing, transition |
| `ORCHARD` | Old fruit orchard in spring bloom, soft breeze rippling tall grass between rows. | Abundance, fruits of practice |
| `HILLTOP_MEADOW` | Wide wildflower meadow at dawn, mist still lifting off the grass. | Rest, peace, expansion |

Claude picks ONE archetype per video based on the parsha's themes. Claude is allowed to add **1-2 sentences of parsha-specific sensory detail** to the anchor (e.g., for parshat Yitro choosing `MOUNTAIN_RIDGE` and adding "thunder still rolling on the far peaks"). Claude must not change the anchor itself — that's the consistency layer.

### 6.3 Style Lock (Updated)

Replaces the Phase 1 `STYLE_LOCK` with a slightly aged voice cue:

> "Same character as in reference images: Pixar-style 3D animation, mid-50s Jewish man, salt-and-pepper hair and trimmed beard, brown leather kippah, navy blue mandarin-collar athletic shirt with Torah Tai Chi yin-yang logo on chest. Soft 3D render, warm cinematic lighting. Character identity must match references exactly. Voice timbre: warm and weathered, an experienced elder teacher in his late 50s, calm authority not booming, the patient cadence of a sage who has said this thousands of times."

## 7. Generation Guardrails

Injected into the `script_generator` SYSTEM prompt as hard rules. Evidence-based on Seedance 2.0 documented strengths/weaknesses:

**Forbidden in `visual_prompt` (because Seedance fails on these):**
- Any in-frame rendered text — letters, words, numbers, signs, scrolls with readable text, plaques, screens with content. (This is what produced the aleph gibberish in the first run.)
- Intricate repeating patterns expected to stay sharp under motion (decorative borders, complex weaves, fine-print fabric).
- Multiple speaking characters in the same shot. (Multi-person lip-sync is Seedance's documented weakness.)
- Held objects requiring specific intricate shape (a specific tool, a labeled bottle, an instrument with detailed mechanism).

**Permitted (because Seedance is reliable here):**
- Single-character close-ups with speaking. (Single-character lip-sync is a Seedance strength — we lean into it.)
- Background characters who do NOT speak, used as silent narrative presence (a child sitting nearby watching, two figures in the distance walking).
- Held objects with simple, smooth shapes (a teacup, a smooth river stone, a walking stick, a folded cloth).
- Detailed camera direction language: dolly in/out, pan left/right, tilt up/down, push in, slow orbit, crane up, lateral tracking. Seedance follows these well; we should always specify one.

**Required for every `visual_prompt`:**
- Exactly one camera direction (from the list above).
- Either (a) a clear subject action (Rav Eli is doing X) or (b) a clear environmental motion (wind through grass, water flowing) — never a fully static shot.
- Lighting cue (golden hour, soft morning, dappled afternoon, etc.).

## 8. Frame-Chaining Mechanics

For clip 1 (within block 1) and clip 3 (within block 2), the orchestrator does:

```
1. Wait for previous clip in the same block to download (work/<run>/clip_NN.mp4).
2. Extract last frame as PNG via ffmpeg → work/<run>/clip_NN_lastframe.png.
3. Upload that PNG to Kie.ai → get a public URL.
4. Pass that URL as `first_frame_url` in the Seedance payload for the next clip.
```

Resume safety: if `clip_NN_lastframe.png` already exists from a prior run, skip the extract + re-upload (cache the URL alongside in `clip_NN_lastframe.url`).

The first clip of each block has NO `first_frame_url` — it sets the scene fresh.

## 9. Data Contract Changes

```python
class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str  # "DOJO" or one of OUTDOOR_ARCHETYPES keys
    motion_ref_url: str | None = None  # reserved for future use, must be None in Phase 2

class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=4, max_length=4)
    outdoor_archetype_id: str  # the chosen archetype for block 2

    @property
    def total_duration_s(self) -> int: ...
```

Validators:
- `clips[0].setting_id == "DOJO"` and `clips[1].setting_id == "DOJO"`
- `clips[2].setting_id == outdoor_archetype_id` and `clips[3].setting_id == outdoor_archetype_id`
- `clips[2].setting_id != "DOJO"` and is in `OUTDOOR_ARCHETYPES`
- `total_duration_s` between 28 and 45

## 10. Failure Handling

- **Seedance returns garbled output for a specific clip:** existing resume flow handles retry. New: if clip 1 or clip 3 fails after 2 retries, the orchestrator falls back to omitting the `first_frame_url` (clean cut instead of chained continuity). Logs the fallback.
- **Frame extraction fails (ffmpeg error):** halt the run, surface ffmpeg stderr to the user. Don't fabricate.
- **Pydantic validation rejects Claude's output (e.g., wrong setting_id):** halt, print the offending field and Claude's raw response, ask the user to re-run (which will re-call Claude). One automatic retry with a stricter "fix the JSON" Claude call before halting.

## 11. Testing Strategy

Unit-level (run on every commit):
- `test_settings.py`: archetype dict has at least 8 entries; every entry has anchor text non-empty; `DOJO_ANCHOR_TEXT` is non-empty.
- `test_models.py`: extended for new `setting_id` field, validator behavior, `motion_ref_url` defaults to None.
- `test_script_generator.py`: extended `transform_draft_to_clip_plan` test asserts validators reject malformed plans (wrong number of clips, wrong block structure).
- `test_video_generator.py`: `build_seedance_input` with `setting_id="DOJO"` includes dojo refs; with outdoor `setting_id` excludes them. With `first_frame_url` set, payload contains `first_frame_url` field.
- `test_frame_extract.py`: `extract_last_frame(in.mp4, out.png)` produces a PNG whose timestamp matches the input's last frame ±1 frame. `@pytest.mark.slow` (needs ffmpeg).

Integration-level (manual, paid):
- One full Vayikra v2 run end-to-end. Compare side-by-side with v1 Vayikra (same parsha, same script).
- One additional parsha (Bereishit or Noach — whichever has clearest archetype fit) to see week-to-week dojo consistency.

## 12. Open Questions for Phase 3+ (not blocking Phase 2)

- How to detect drift across parshiot empirically (probably comparison of frame samples).
- When `@Audio1` voice lock becomes worth implementing.
- Whether to add a third in-between setting (e.g., dojo → garden → mountain) for slightly longer videos in the future.
- Whether motion reference videos (`reference_video_urls`) actually improve tai chi authenticity — needs A/B test of a single clip with vs without.
