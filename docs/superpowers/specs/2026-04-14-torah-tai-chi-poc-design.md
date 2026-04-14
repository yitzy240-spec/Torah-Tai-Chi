# Torah Tai Chi — Phase 1 POC Design

**Date:** 2026-04-14
**Status:** Draft — pending user review
**Owner:** Yitzy Marcus (implementation), Yonah Lloyd (content)

---

## 1. Purpose

Prove end-to-end that we can take a single parsha name and produce a finished, Yonah-approvable Rav Eli video locally, using Seedance 2.0 as the core video model and the existing locked Pixar-style Rav Eli image (plus derived reference shots) as the character anchor.

This is a local proof-of-concept. The output is an MP4 on disk, watchable in chat or via any media player. No hosting, no dashboard, no social posting, no approval UI, no automation. Everything around this pipeline (dashboards, social publishing, website, multi-user) is explicitly deferred to later phases.

## 2. Success Criteria

- Running `py tools/generate.py --parsha Vayikra` produces `output/vayikra.mp4` (60-90s)
- Video features Rav Eli teaching a Torah + Tai Chi insight tied to the named parsha
- Rav Eli's appearance is visually consistent with the locked reference image across all clips in the video
- Voice stays consistent across all clips within a single video
- Yonah watches it and says "this is good enough to build around"
- At least 3 different parshiot produce equivalent-quality output before Phase 1 is declared done

## 3. Non-Goals

Explicitly out of scope for Phase 1:

- Social post generation (YouTube/IG/FB/TikTok/X captions) — deferred
- Hosted/shareable video link — deferred
- Dashboard or review UI — deferred
- Automatic scheduling or cron triggers — deferred
- Auto-posting to social channels — deferred
- Website integration — deferred
- Multi-user, roles, auth — deferred
- Approval workflow / human-in-loop gates — deferred
- Caching, resume, queue, parallelism — YAGNI for POC

## 4. Architecture

### 4.1 Pipeline

```
CLI: py tools/generate.py --parsha Vayikra
        │
        ▼
  1. Parsha lookup         → metadata from parshiot.json
        │
        ▼
  2. Script generation     → Claude API → structured ClipPlan
        │
        ▼
  3. Clip generation       → Kie.ai Seedance 2.0 × N clips
     (sequential, per clip)   (reference images + voice sample + prompt)
        │
        ▼
  4. Stitching             → FFmpeg concat → output/<parsha>.mp4
```

### 4.2 Modules

| Module | Responsibility |
|---|---|
| `src/parsha_data.py` | Load parsha metadata from `parshiot.json` |
| `src/script_generator.py` | Call Claude with structured prompt, return typed `ClipPlan` |
| `src/video_generator.py` | Call Seedance 2.0 via Kie.ai, poll, download clip |
| `src/stitcher.py` | Concat clips via ffmpeg-python |
| `src/kie_client.py` | Shared Kie.ai HTTP client (upload, createTask, poll, download) |
| `tools/generate.py` | CLI entry point, orchestrates full pipeline |

### 4.3 Filesystem Layout

```
torah-tai-chi/
├── .env                        # KIE_AI_API_KEY, ANTHROPIC_API_KEY
├── parshiot.json               # All 54 parshiot with theme/verses metadata
├── references/                 # Locked Rav Eli reference images (Phase 0 output)
│   ├── 01_front_neutral.png
│   ├── 02_front_speaking.png
│   └── ... (10-13 shots)
├── src/                        # Python modules
├── tools/
│   ├── generate.py             # Main CLI
│   └── generate_references.py  # Phase 0 script (already written)
├── work/                       # Per-run artifacts, kept for debugging
│   └── 2026-04-14-vayikra/
│       ├── plan.json           # Claude's ClipPlan output
│       ├── clip_0.mp4          # Raw Seedance clip
│       ├── clip_1.mp4
│       ├── ...
│       └── log.txt             # Run log
└── output/                     # Final stitched MP4s
    └── vayikra.mp4
```

### 4.4 Core Data Contract — `ClipPlan`

```python
from pydantic import BaseModel

class Clip(BaseModel):
    index: int
    voiceover: str       # text Rav Eli speaks in this clip
    visual_prompt: str   # scene / action description for Seedance
    duration_s: int      # 4-15 per Seedance limits

class ClipPlan(BaseModel):
    parsha: str
    hook: str            # opening line (also clip 0's voiceover)
    full_script: str     # human-readable narration, for debugging
    clips: list[Clip]    # ordered beats, 6-9 total, sum 60-90s
```

This is the single contract between Claude ("what the video says") and Seedance ("what gets generated"). Validated via pydantic on every run. Malformed output fails fast.

## 5. External Services

| Service | Purpose | Auth |
|---|---|---|
| Anthropic Claude API | Script + clip-plan generation | `ANTHROPIC_API_KEY` |
| Kie.ai (Nano Banana Pro) | Reference image generation (Phase 0, one-time) | `KIE_AI_API_KEY` |
| Kie.ai (Seedance 2.0) | Per-clip video generation | `KIE_AI_API_KEY` |
| FFmpeg (local binary) | Clip concatenation | system install |

## 6. Claude Prompt Design — Script Transformation (not generation)

**Important:** Yonah has already produced 3 approved draft scripts per parsha (stored in `Torah_Tai_Chi_Parsha_Scripts.xlsx`, imported to `parshiot.json`). Claude's job is **transform an existing draft** into a ClipPlan — not write from scratch. This preserves Yonah's brand voice exactly and avoids re-generating content he already approved.

### 6.1 Input to Claude

```
PARSHA: Vayikra
BOOK: Leviticus
OPTION: A
TITLE: <from xlsx>
STYLE_NOTE: <from xlsx>
DRAFT_SCRIPT: <full monologue from xlsx with [HOOK]/[TEACHING]/... blocks>
TARGET_DURATION: 75
CLIP_COUNT: 8 (±1)
```

### 6.2 Claude system/user prompt

- Establishes transformation task: preserve Yonah's words, break into clips, add visual prompts, fit timing
- Hard rule: do NOT rewrite or paraphrase the draft's content. Only split into clip-sized voiceover beats.
- Per clip, Claude adds a `visual_prompt` describing Rav Eli's scene/pose/action
- Constrains visuals: always Rav Eli (Pixar-style 3D locked by reference images — don't describe appearance); vary angle/pose/setting; prefer motion; 4-10s per clip
- Returns JSON matching `ClipPlan` schema; no commentary

Full prompt template lives in `src/script_generator.py` and is version-controlled.

## 7. Seedance 2.0 Call Shape

Per clip, the call to Kie.ai Seedance 2.0 includes:

- **Reference images** — a curated subset of up to 9 images from `references/` (Seedance's hard limit), passed as `@Image1 … @Image9`. We generate 10-13 candidates in Phase 0 and lock the canonical 6-9 for use in every call. Same set every call — no per-clip rotation in Phase 1.
- **Voice reference** — `@Audio1` pointing to locked Rav Eli voice sample (deferred until voice-drift is observed; start without it)
- **Prompt** — composed of:
  - Visual direction from `clip.visual_prompt`
  - Dialogue in double quotes: `Character says: "[clip.voiceover]"`
  - Style lock: "Pixar-style 3D animation, same character as @Image1..@ImageN"
- **Duration** — `clip.duration_s`, clamped to [4, 15]
- **Resolution** — 720p (confirmed sufficient for TikTok/YouTube Shorts source)

## 8. Flow Per Run

1. Parse CLI args: `--parsha`, optional `--only-clip N`, `--resolution`, `--dry-run`
2. Load parsha metadata from `parshiot.json`
3. Call Claude → validate ClipPlan schema → save to `work/<date>-<parsha>/plan.json`
4. For each clip (sequential):
   a. Build Seedance prompt (visual + voiceover + style lock)
   b. POST Kie.ai createTask
   c. Poll recordInfo until success/fail (with exponential backoff)
   d. Download MP4 to `work/<date>-<parsha>/clip_N.mp4`
5. Concat all clips via ffmpeg-python → `output/<parsha>.mp4`
6. Print summary: duration, clip count, total cost, output path

## 9. Error Handling

POC-appropriate — surface errors cleanly, don't over-engineer recovery:

- HTTP transient errors: 3 retries, exponential backoff (8s, 16s, 32s)
- Claude returns malformed JSON: pydantic validation error, run stops, print the offending output
- Seedance clip fails permanently: run stops, prints which clip, suggests `--only-clip N` to retry after fix
- FFmpeg failure: run stops, prints ffmpeg stderr

Re-running the full pipeline regenerates everything. No caching.

## 10. Testing & Validation

### 10.1 Automated (in-script)

- Pydantic validation of Claude's ClipPlan output
- Sanity check: clip durations sum to 60-90s ± tolerance
- Seedance response must contain a downloadable URL before download attempt
- Final MP4 via ffprobe: exists, >0 bytes, duration within 10% of expected

### 10.2 Manual (Yonah review)

- Character consistency — does Rav Eli look like Rav Eli across all clips?
- Voice consistency — is the voice the same throughout?
- Content — does the Torah + Tai Chi teaching actually make sense?
- Edit feel — are transitions tolerable?

### 10.3 Phase 1 completion gate

Three different parshiot must produce Yonah-approved output before Phase 1 is declared done. If character drifts → revisit reference set. If voice drifts → add `@Audio1` locked voice sample.

## 11. Dependencies

- Python 3.11+
- `anthropic` (Claude SDK)
- `httpx` (Kie.ai HTTP calls)
- `ffmpeg-python` (stitching)
- `pydantic` (ClipPlan validation)
- `python-dotenv` (env loading)
- System FFmpeg binary (must be on PATH)

## 12. Phase 0 Prerequisites (before Phase 1 implementation)

1. **Rav Eli reference image pack** — 10-13 candidate shots derived from the locked source image via Nano Banana Pro on Kie.ai. Yonah (or Yitzy with good judgment) selects the canonical 6-9 to use in every Seedance call. Script `tools/generate_references.py` already written and running.
2. **`parshiot.json`** — all 54 Torah portions with 3 draft script options each (A/B/C from Yonah's xlsx). Built by `tools/import_parshiot.py` reading `Torah_Tai_Chi_Parsha_Scripts.xlsx`. Schema: `{"parshiot": [{"order": 1, "name": "Bereishit", "book": "Genesis", "scripts": [{"option": "A", "style_note": "...", "title": "...", "draft": "[HOOK]..."}, ...]}]}`
3. **API keys in `.env`** — Kie.ai ✅ done; Anthropic key ⬜ needed.

## 13. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Rav Eli visual drifts across Seedance clips | Multi-image reference pack (10-13 shots); if drift, narrow set to 6 strongest |
| Voice drifts across clips | Add `@Audio1` voice sample to Seedance calls (abstraction built in from day 1) |
| Pixar style drifts toward realism | Strong style lock in every prompt; if drift persists, consider Seedream 4.5 as alternative |
| Claude produces unusable script structure | Strict schema validation; iterate on prompt template; fall back to manual script editing of `plan.json` and re-running from step 4 |
| Kie.ai rate limiting | Sequential clip generation; exponential backoff |
| FFmpeg concat produces artifacts at clip boundaries | If observed, add 2-frame crossfade between clips |

## 14. Next Steps

1. User reviews this spec
2. Phase 0 reference image generation completes
3. `parshiot.json` data assembled
4. Anthropic API key added to `.env`
5. Invoke `writing-plans` skill to produce detailed implementation plan

## 15. Appendix — What Comes After Phase 1

For context only, not part of this design:

- **Phase 2:** Social post generator (5 channels: YT, IG, FB, TikTok, X) wrapped around the same pipeline
- **Phase 3:** Dashboard for Yonah + Harvey — content calendar, script review, regenerate single clip, approve final
- **Phase 4:** Social publishing (YouTube upload, TikTok, IG, FB, X APIs)
- **Phase 5:** Website integration (torahtaichi.com)
- **Phase 6:** Weekly automation (cron trigger, human approval gate)
