# Direction v2.5 — Cinematographer Claude + On-Screen Captions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset the pipeline to the "cinematographer Claude" philosophy: Yonah's voiceover text is verbatim, Claude directs the scene around it, video length is emergent, and the finished mp4 carries subtle on-screen captions synced via Whisper.

**Architecture:** In-place edits to `src/models.py`, `src/script_generator.py`, and `tools/generate.py`. New module `src/caption_burner.py` runs after `stitcher.py` in the pipeline. The 67KB direction guide stays on disk as human reference but stops being loaded at runtime. A per-platform `captions` field is added to `ClipPlan` alongside new per-Clip `caption_position` and `emotive_note` fields.

**Tech Stack:** Python 3.11+, existing pipeline modules, new dependency: `faster-whisper` for forced alignment (CPU-only, ~500MB model), system `ffmpeg` with `libass` subtitle support.

**Spec:** [docs/superpowers/specs/2026-04-15-torah-tai-chi-direction-v2.5-cinematographer-design.md](../specs/2026-04-15-torah-tai-chi-direction-v2.5-cinematographer-design.md)

---

## Prerequisites

- [ ] Current pipeline working: Bereishit v2.4 video produced at `output/bereishit-a-v2.mp4`
- [ ] ffmpeg on PATH with libass support: `ffmpeg -buildconf 2>&1 | grep -i libass` prints `--enable-libass` or similar
- [ ] `faster-whisper` installed: `py -c "from faster_whisper import WhisperModel"` prints no error. If pip hangs in the sandbox, install manually in a terminal that has PyPI access: `py -m pip install --user faster-whisper`. The first call will also download the `small` model (~470MB) into `~/.cache/huggingface/` — expect the first caption-burn run to take longer than subsequent ones.
- [ ] Confirm ~$12 of Kie.ai credits available for Tasks 9 and 10

---

## Task 1: Remove `MAX_WORDS_PER_SECOND` Validator + Flex Duration Window

**Files:**
- Modify: `src/models.py`
- Modify: `tests/test_models.py`

The density validator was the v2.4 regression. Total-duration window widens to 28-90s. Clip count window widens to 3-8.

- [ ] **Step 1: Update `tests/test_models.py` — drop density tests, update duration tests, update clip-count tests**

Open `tests/test_models.py` and make these changes:

Remove these three tests entirely (they assert behavior we're deleting):
- `test_clip_rejects_voiceover_density_over_2_wps`
- `test_clip_accepts_voiceover_density_at_boundary`
- `test_clip_accepts_sage_pace_voiceover`

Rename `test_clipplan_rejects_total_over_50s` to `test_clipplan_rejects_total_over_90s` and replace its body with:

```python
def test_clipplan_rejects_total_over_90s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0, 15), _dojo_clip(1, 15), _dojo_clip(2, 15),
                _outdoor_clip(3, "GARDEN_PATH", 15),
                _outdoor_clip(4, "GARDEN_PATH", 15),
                _outdoor_clip(5, "GARDEN_PATH", 15),
                _outdoor_clip(6, "GARDEN_PATH", 15),
                _outdoor_clip(7, "GARDEN_PATH", 15),
            ],
        )  # 8 x 15s = 120s > 90s cap
```

Rename `test_clipplan_requires_exactly_four_clips` to `test_clipplan_requires_at_least_three_clips` and replace:

```python
def test_clipplan_requires_at_least_three_clips():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="MOUNTAIN_RIDGE",
            clips=[_dojo_clip(0), _dojo_clip(1)],  # 2 clips, below min
        )
```

Add a new test for the upper bound:

```python
def test_clipplan_rejects_more_than_eight_clips():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[_dojo_clip(i, 4) for i in range(4)] +
                  [_outdoor_clip(i, "GARDEN_PATH", 4) for i in range(4, 9)],
            # 9 clips = above max
        )
```

Add tests that demonstrate flex in both directions:

```python
def test_clipplan_accepts_three_clips():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        clips=[
            _dojo_clip(0, 10),
            _outdoor_clip(1, "GARDEN_PATH", 10),
            _outdoor_clip(2, "GARDEN_PATH", 10),
        ],  # 30s total, 1 dojo + 2 outdoor
    )
    assert len(plan.clips) == 3


def test_clipplan_accepts_six_clips():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        clips=[
            _dojo_clip(0, 10), _dojo_clip(1, 10), _dojo_clip(2, 10),
            _outdoor_clip(3, "GARDEN_PATH", 10),
            _outdoor_clip(4, "GARDEN_PATH", 10),
            _outdoor_clip(5, "GARDEN_PATH", 10),
        ],  # 60s total, 3 dojo + 3 outdoor
    )
    assert plan.total_duration_s == 60
```

The existing `test_clipplan_block_structure_dojo_then_outdoor` test should still pass (it uses 4 clips which is within the new 3-8 range). Same with `test_clipplan_total_duration`.

The existing `test_clipplan_rejects_wrong_block_ordering` uses a 4-clip plan that's valid structurally. Keep as-is but ensure the validator logic below still catches the block-order violation.

- [ ] **Step 2: Run tests to confirm expected new failures**

Run: `py -m pytest tests/test_models.py -v`
Expected: failures on any test that references `MAX_WORDS_PER_SECOND`, the exactly-4-clips assumption, or the 50s duration cap.

- [ ] **Step 3: Update `src/models.py`**

Replace the full contents of `src/models.py` with:

```python
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from src.settings import OUTDOOR_ARCHETYPES


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str = Field(min_length=1)
    caption_position: Literal["bottom", "top", "middle"] = "bottom"
    emotive_note: str | None = None
    motion_ref_url: str | None = None


class PlatformCaptions(BaseModel):
    tiktok: str = Field(min_length=1, max_length=300)
    instagram: str = Field(min_length=1, max_length=600)
    youtube_title: str = Field(min_length=1, max_length=100)
    youtube_description: str = Field(min_length=1, max_length=800)
    facebook: str = Field(min_length=1, max_length=600)


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    outdoor_archetype_id: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=3, max_length=8)
    captions: PlatformCaptions

    @property
    def total_duration_s(self) -> int:
        return sum(c.duration_s for c in self.clips)

    @model_validator(mode="after")
    def _check_structure(self) -> "ClipPlan":
        if self.outdoor_archetype_id not in OUTDOOR_ARCHETYPES:
            raise ValueError(
                f"outdoor_archetype_id {self.outdoor_archetype_id!r} is not "
                f"in OUTDOOR_ARCHETYPES; allowed: {sorted(OUTDOOR_ARCHETYPES)}"
            )

        # Dojo block first, outdoor block second. At least 1 of each.
        dojo_end = 0
        for i, c in enumerate(self.clips):
            if c.setting_id == "DOJO":
                if dojo_end != i:
                    raise ValueError(
                        f"clip {i} is DOJO but dojo block already ended at clip "
                        f"{dojo_end}; dojo clips must be contiguous at the start"
                    )
                dojo_end = i + 1
            elif c.setting_id == self.outdoor_archetype_id:
                pass
            else:
                raise ValueError(
                    f"clip {i} setting_id {c.setting_id!r} is neither 'DOJO' nor "
                    f"the outdoor_archetype_id {self.outdoor_archetype_id!r}"
                )

        if dojo_end == 0:
            raise ValueError("no DOJO clips — dojo block must have at least 1 clip")
        if dojo_end == len(self.clips):
            raise ValueError(
                "all clips are DOJO — outdoor block must have at least 1 clip"
            )

        total = self.total_duration_s
        if not (28 <= total <= 90):
            raise ValueError(f"total_duration_s {total} not in [28, 90]")
        return self
```

Key changes vs current `models.py`:
- `Clip` — added `caption_position` and `emotive_note` fields; removed the `_check_word_density` validator (no more `MAX_WORDS_PER_SECOND`)
- `ClipPlan` — clips `min_length=3, max_length=8` (was 4/4); added required `captions: PlatformCaptions` field; total duration window widened to 28-90 (was 28-50)
- `ClipPlan._check_structure` — generalized the block-order check so it works for any clip count (find the dojo/outdoor boundary dynamically, enforce contiguous dojo prefix then contiguous outdoor suffix; require at least 1 of each)
- New `PlatformCaptions` type
- New `Literal` import from typing

- [ ] **Step 4: Add captions fixture for existing tests that build `ClipPlan`**

Several existing tests in `tests/test_models.py` build `ClipPlan` directly. They'll now fail validation because `captions` is required. Add a helper at the top of the file (just below the existing `_dojo_clip` / `_outdoor_clip` helpers):

```python
from src.models import PlatformCaptions

def _captions() -> PlatformCaptions:
    return PlatformCaptions(
        tiktok="t", instagram="i", youtube_title="y",
        youtube_description="d", facebook="f",
    )
```

Then update every `ClipPlan(...)` call in the test file to include `captions=_captions()` as one of its arguments. Touch every existing test that instantiates `ClipPlan` directly. Verify with a search: no `ClipPlan(` in the test file lacks `captions=`.

- [ ] **Step 5: Run tests to confirm all pass**

Run: `py -m pytest tests/test_models.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/models.py tests/test_models.py
git commit -m "feat(models): v2.5 — drop density validator, flex clip count + duration, add caption fields"
```

---

## Task 2: Strip `script_generator.py` — Remove Guide Loading + Tight SYSTEM Prompt

**Files:**
- Modify: `src/script_generator.py`
- Modify: `tests/test_script_generator.py`

- [ ] **Step 1: Update `tests/test_script_generator.py` for new schema**

Open `tests/test_script_generator.py`. Every mock response that returns a `ClipPlan`-shaped dict needs a `captions` field. Update the fakes. Also update every `Clip` in the fake plans to have `caption_position` (optional, default bottom, so this is only needed if you want to assert a non-default).

Replace the two main mock-response fake plans so they include `captions`:

```python
def _fake_plan_with_captions(outdoor_archetype_id: str = "GARDEN_PATH") -> dict:
    return {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "outdoor_archetype_id": outdoor_archetype_id,
        "captions": {
            "tiktok": "Test TikTok caption #parsha",
            "instagram": "Test IG caption. With a few sentences.",
            "youtube_title": "Test YouTube title",
            "youtube_description": "Test YT description body.",
            "facebook": "Test FB caption, a bit longer and more conversational.",
        },
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "prompt",
             "duration_s": 8, "setting_id": "DOJO", "caption_position": "bottom"},
            {"index": 1, "voiceover": "b", "visual_prompt": "prompt",
             "duration_s": 9, "setting_id": "DOJO", "caption_position": "bottom"},
            {"index": 2, "voiceover": "c", "visual_prompt": "prompt",
             "duration_s": 9, "setting_id": outdoor_archetype_id, "caption_position": "top"},
            {"index": 3, "voiceover": "d", "visual_prompt": "prompt",
             "duration_s": 8, "setting_id": outdoor_archetype_id, "caption_position": "bottom"},
        ],
    }
```

Replace `test_transform_draft_returns_valid_v2_plan`, `test_transform_draft_propagates_validation_error_on_bad_block`, and `test_transform_draft_strips_json_fence_wrapper` so they use `_fake_plan_with_captions()` as the return body. Adjust assertions:

```python
@pytest.mark.asyncio
async def test_transform_draft_returns_valid_v2_plan():
    async with respx.mock(assert_all_called=True) as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json=_anthropic_response_body(_fake_plan_with_captions())),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="modern", title="t",
            draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
            api_key="test-key",
        )
    assert isinstance(plan, ClipPlan)
    assert plan.outdoor_archetype_id == "GARDEN_PATH"
    assert plan.clips[0].setting_id == "DOJO"
    assert plan.clips[3].setting_id == "GARDEN_PATH"
    assert plan.captions.tiktok.startswith("Test TikTok")
    assert plan.clips[2].caption_position == "top"
    assert 28 <= plan.total_duration_s <= 90
```

For `test_transform_draft_propagates_validation_error_on_bad_block`, mutate the fake so `clips[0].setting_id` is the archetype (invalid — dojo must come first). Helper for this case:

```python
@pytest.mark.asyncio
async def test_transform_draft_propagates_validation_error_on_bad_block():
    fake = _fake_plan_with_captions()
    # Break the block structure: put an outdoor clip at index 0
    fake["clips"][0]["setting_id"] = "GARDEN_PATH"
    from pydantic import ValidationError
    async with respx.mock() as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json=_anthropic_response_body(fake)),
        )
        with pytest.raises(ValidationError):
            await transform_draft_to_clip_plan(
                parsha_name="Vayikra", book="Leviticus", option="A",
                style_note="x", title="t", draft="x",
                api_key="test-key",
            )
```

For `test_transform_draft_strips_json_fence_wrapper`, wrap `_fake_plan_with_captions("MOUNTAIN_RIDGE")` in a ```json fence and check the returned plan has archetype `MOUNTAIN_RIDGE`:

```python
@pytest.mark.asyncio
async def test_transform_draft_strips_json_fence_wrapper():
    fake = _fake_plan_with_captions("MOUNTAIN_RIDGE")
    fenced = "```json\n" + json.dumps(fake) + "\n```"
    async with respx.mock() as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json={
                "id": "msg", "type": "message", "role": "assistant",
                "content": [{"type": "text", "text": fenced}],
                "model": "claude-opus-4-6", "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 10},
            }),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="x", title="t", draft="x",
            api_key="test-key",
        )
    assert plan.outdoor_archetype_id == "MOUNTAIN_RIDGE"
```

- [ ] **Step 2: Run tests to confirm expected new failures**

Run: `py -m pytest tests/test_script_generator.py -v`
Expected: failures from tests referencing the old plan shape (missing `captions` field, etc.).

- [ ] **Step 3: Replace `src/script_generator.py`**

Write the full new file:

```python
from __future__ import annotations
import json
from src.models import ClipPlan
from src.settings import (
    DOJO_ANCHOR_TEXT, OUTDOOR_ARCHETYPES, STYLE_LOCK, GUARDRAILS_TEXT,
)


def _archetype_menu_text() -> str:
    lines = []
    for key, anchor in OUTDOOR_ARCHETYPES.items():
        lines.append(f"  - {key}: {anchor}")
    return "\n".join(lines)


# v2.5: the heavy direction guide (docs/direction/seedance_prompting_guide.md) is
# NO LONGER loaded at runtime. It stays on disk as human reference only.
# The prompt below is intentionally tight — rules that matter, plus two examples.


SYSTEM_TEMPLATE = """You are the cinematographer, editor, and caption writer for a short-form
weekly video based on an already-approved dvar torah script by Yonah.

**You do NOT rewrite the script.** The voiceover text is Yonah's, verbatim. Your
job is to decide how to split it across clips, where the camera goes, what the
character does, what setting each beat plays out in, how it feels, and what the
post captions say.

CHARACTER (locked by reference images — do not re-describe in every prompt):
- Rav Eli: Pixar-style 3D mid-50s Jewish man, salt-and-pepper beard, brown
  leather kippah, navy mandarin-collar shirt with Torah Tai Chi yin-yang logo.

VIDEO STRUCTURE:
- 3 to 8 clips total, 28-90 seconds combined (emergent from script length).
- Dojo block FIRST, outdoor block SECOND. At least 1 clip of each. Clip count
  per block flexes based on where the script's natural beats fall.
- Each clip: 4-15 seconds (Seedance hard limit).
- Decide clip count and per-clip duration by reading the script at natural
  sage-teacher pace (~2.3 words per second average). Do not force short
  durations on text-dense beats; do not pad sparse beats. Let it breathe.

VOICEOVER — YONAH'S WORDS, PRESERVED:
- Split his draft into clips at natural phrase boundaries (comma, period,
  em-dash, section break). NEVER paraphrase, rewrite, or drop content.
- Hebrew names/terms in the voiceover field must be written as English-
  phonetic breakdowns with CAPS on the stressed syllable:
    Vayikra -> "Vah-yeek-RAH"
    Moshe -> "MOH-sheh"
    Bereishit -> "Beh-ray-SHEET"
    Baal HaTurim -> "BAH-ahl hah-too-REEM"
    Torah -> "TOH-rah"
    korbanot -> "kor-bah-NOTE"
    karov -> "kah-ROV"
    Shabbat -> "shah-BAHT"
  Put phonetic form directly in the voiceover field; do NOT duplicate or
  include the standard spelling.
- Pause markers the TTS will respect: ellipsis "...", em-dash " — ",
  commas, periods. Use them where they naturally fall in Yonah's prose.
  Don't invent new pauses to pad; don't delete existing ones.

VISUAL PROMPT per clip (concise, composed in this order):
1. Setting anchor verbatim (DOJO_ANCHOR_TEXT for dojo clips, archetype
   anchor for outdoor clips).
2. Subject action: what Rav Eli is doing. Prefer naturalistic (walking,
   gesturing, observing, breathing, sitting, hand on heart). Micro-
   expressions welcome ("eyes close gently", "slight smile").
3. Single camera-direction phrase from this list: "static medium shot",
   "slow push in", "slight pull back", "pan left", "pan right", "tilt up",
   "tilt down", "slow orbit", "lateral tracking shot".
4. Lighting cue from the anchor (carry it forward).
5. Optional: a brief tone/cadence note ("speaks reverently", "this lands
   with a held breath before the next line").

OUTDOOR ARCHETYPE — pick ONE id whose tonal fit matches the parsha theme:
{archetype_menu}

DOJO ANCHOR (prepend to every dojo visual_prompt, verbatim):
{dojo_anchor}

GUARDRAILS (failures the video model makes every time; enforce strictly):
{guardrails}

CAPTION_POSITION per clip — choose based on where Rav Eli sits in frame:
- "bottom" = default; for close/medium shots of Rav Eli centered or in
  upper 2/3 of frame (most clips).
- "top" = for wide shots where Rav Eli is small and in the lower half
  (landscape establishing shots, wide meadow shots).
- "middle" = rarely; only when the upper and lower thirds both have
  important content.

EMOTIVE_NOTE per clip (optional, one short line):
A directorial tone cue for this clip, e.g., "speak this reverently",
"this lands with a pause before the next line", "voice lifts with wonder".
Omit the field (or set null) if no special direction needed.

PLATFORM CAPTIONS (the "captions" field in output):
Generate all four in one pass. Not for on-screen use — these are the
captions that live under the video on each platform.
- tiktok: punchy, 1-2 sentences, hashtag-heavy at end. <=250 chars.
  Example style: "The smallest letter in the Torah carries a teaching
  about humility. Here's the practice. #torahtaichi #parsha #vayikra"
- instagram: story-driven, 2-4 sentences, 3-5 hashtags at the end on
  their own line. <=550 chars.
- youtube_title: click-through optimized, <=95 chars. Include the parsha
  name. Example: "Vayikra: The Smallest Letter in the Torah | 60s wisdom"
- youtube_description: 2-3 sentences of context for the video, <=750
  chars. Can mention the parsha and book of Torah.
- facebook: longer-form, conversational 2-4 sentences. Fewer hashtags
  than TT/IG. <=550 chars.

OUTPUT SCHEMA (JSON only, no markdown fences, no commentary):
{{
  "parsha": "<name>",
  "hook": "<first full sentence from the draft>",
  "full_script": "<the original draft with section markers stripped>",
  "outdoor_archetype_id": "<one archetype id>",
  "captions": {{
    "tiktok": "...",
    "instagram": "...",
    "youtube_title": "...",
    "youtube_description": "...",
    "facebook": "..."
  }},
  "clips": [
    {{"index": 0, "voiceover": "...", "visual_prompt": "...",
      "duration_s": <int 4-15>, "setting_id": "DOJO",
      "caption_position": "bottom", "emotive_note": "..." or null}},
    ... (3-8 clips total, dojo block first, outdoor block second)
  ]
}}

EXAMPLE — Vayikra, short script (104 words), natural output ~46s, 4 clips:
Draft:
[HOOK]
The smallest letter in the Torah is an aleph.
[TEACHING]
Vayikra — "and he called" — opens with that tiny letter. The Baal HaTurim
teaches: Moshe wrote himself small so God's voice could come through.
[APPLICATION]
In tai chi, we sink to rise. We yield to advance. We empty to receive.
[CTA]
Right now: exhale fully. Take up less space. Notice what opens. Follow
Torah Tai Chi for weekly wisdom.

Possible output (sketch):
{{
  "outdoor_archetype_id": "DESERT_OUTCROP",
  "clips": [
    {{"index": 0, "setting_id": "DOJO", "duration_s": 6,
      "voiceover": "The smallest letter in the TOH-rah... is an AH-lef.",
      "visual_prompt": "<DOJO anchor> Rav Eli stands on the indigo runner,
        gaze soft, tracing a small shape in the air with his finger as he
        speaks. Slow push in. Soft morning light.",
      "caption_position": "bottom",
      "emotive_note": "speak this with held stillness, like revealing a
        secret"}},
    {{"index": 1, "setting_id": "DOJO", "duration_s": 13,
      "voiceover": "Vah-yeek-RAH — 'and he called' — opens with that tiny
        letter. The BAH-ahl hah-too-REEM teaches: MOH-sheh wrote himself
        small so God's voice could come through.",
      "visual_prompt": "<DOJO anchor> Rav Eli sits low at the olive-wood
        table, palms resting open upward, speaking evenly. Static medium
        shot. Soft morning light.",
      "caption_position": "bottom",
      "emotive_note": "measured, patient; teacher tone"}},
    {{"index": 2, "setting_id": "DESERT_OUTCROP", "duration_s": 12,
      "voiceover": "In tai chi, we sink to rise. We yield to advance. We
        empty to receive.",
      "visual_prompt": "<DESERT_OUTCROP anchor> Wind moves the dry shrubs
        at the cliff edge. Rav Eli stands on the sandstone, knees softly
        bending, arms rising as he exhales. Lateral tracking shot. Late
        afternoon golden hour.",
      "caption_position": "top",
      "emotive_note": "three short lines, held beat between each"}},
    {{"index": 3, "setting_id": "DESERT_OUTCROP", "duration_s": 11,
      "voiceover": "Right now: exhale fully. Take up less space. Notice
        what opens. Follow Torah Tai Chi for weekly wisdom.",
      "visual_prompt": "<DESERT_OUTCROP anchor> Rav Eli stands facing the
        valley, eyes closed gently. A long exhale visibly settles his
        shoulders. He turns slowly back to camera on the final phrase.
        Slight pull back. Warm low light.",
      "caption_position": "bottom",
      "emotive_note": "instructional cadence; pause between each
        instruction; final line is the sign-off"}}
  ]
}}
""".format(
    archetype_menu=_archetype_menu_text(),
    dojo_anchor=DOJO_ANCHOR_TEXT,
    guardrails=GUARDRAILS_TEXT,
)


def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str) -> str:
    return (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n\n"
        f"DRAFT SCRIPT (preserve wording exactly — you split it, you do not rewrite it):\n"
        f"---\n{draft}\n---\n\n"
        "Produce the ClipPlan JSON now. Remember: 3-8 clips, dojo first then outdoor, "
        "total 28-90 seconds based on natural sage pace (~2.3 wps). Include the "
        "full 'captions' object with all four platform variants."
    )


ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    api_key: str, model: str = "claude-opus-4-6",
    timeout_s: float = 180.0,
) -> ClipPlan:
    import httpx
    prompt = build_prompt(parsha_name, book, option, style_note, title, draft)
    async with httpx.AsyncClient(timeout=timeout_s) as http:
        r = await http.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 4000,
                "system": SYSTEM_TEMPLATE,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        r.raise_for_status()
        data = r.json()
    raw = data["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    parsed = json.loads(raw)
    return ClipPlan(**parsed)
```

Key changes:
- No more `pathlib` import or `_GUIDE_PATH` / `_DIRECTION_GUIDE` loading
- SYSTEM_TEMPLATE is self-contained, ~6KB after formatting
- Schema in the prompt shows the new `captions` object and per-clip `caption_position` / `emotive_note`
- One worked example embedded in the prompt (Vayikra) instead of the full guide's five
- `build_prompt` user message updated to say "you split it, you do not rewrite it" and reference new bounds

- [ ] **Step 4: Run tests to confirm all pass**

Run: `py -m pytest tests/test_script_generator.py -v`
Expected: all tests pass. If any fail, compare the assertion path against the returned `ClipPlan` shape; missing `captions=_captions()` on a build is the most likely cause.

Also run the full suite to catch cross-module breaks:
Run: `py -m pytest -q`
Expected: all pass (caption_burner tests don't exist yet — those come in Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(script_generator): v2.5 — cinematographer philosophy, strip 84KB guide to 6KB, captions schema"
```

---

## Task 3: Update `GUARDRAILS_TEXT` — Trim to Terse Bullets

**Files:**
- Modify: `src/settings.py`
- Modify: `tests/test_settings.py`

The current `GUARDRAILS_TEXT` in `settings.py` is verbose multi-paragraph. We keep all the rules but compress to terse bullet form, because they now have to fit inside the tight 6KB SYSTEM prompt without dominating it.

- [ ] **Step 1: Check existing test expectations**

Run: `py -m pytest tests/test_settings.py -v`
Expected: all 5 tests pass (this is pre-existing state).

Look at `tests/test_settings.py` and verify it only checks:
- `"text" in GUARDRAILS_TEXT.lower()`
- `"letters" in GUARDRAILS_TEXT.lower()` OR `"letter" in GUARDRAILS_TEXT.lower()`

If that's all, our new terser GUARDRAILS_TEXT will still pass.

- [ ] **Step 2: Update `src/settings.py`**

Replace the existing `GUARDRAILS_TEXT` assignment (and nothing else in the file) with this tight version:

```python
GUARDRAILS_TEXT = """\
FORBIDDEN (Seedance fails on these):
- In-frame rendered text of any kind: letters, words, numbers, signs, scrolls
  with readable text, screens with content. Exception: the Torah Tai Chi logo
  carved on the dojo wall and on Rav Eli's shirt — those render cleanly
  because they are locked by reference images.
- Intricate repeating patterns expected to stay sharp in motion.
- Multiple speaking characters in a shot (multi-person lip-sync fails).
- Held objects with intricate mechanisms (labeled bottles, complex tools).
- Prescriptive named tai chi forms ("push hands", "rooting posture",
  "white crane", etc.) — they render awkward and fake. Use naturalistic
  action instead.
- Wide-to-close dolly moves or long-to-close zooms — character physics
  drifts across the zoom (stands then kneels, etc.).
- Compound camera directions ("push in while panning") — one motion only.
- "Slow orbit" when Rav Eli's face is the focus; face geometry breaks as
  the camera rotates. OK for landscape or full-body-small shots.

PERMITTED (reliable):
- Single-character close-ups speaking, including micro-expressions
  ("eyes close gently", "slight smile, lips together", "brow softens").
- Silent background presence (a child watching from a distance, two
  figures walking far behind) — they must not speak.
- Simple held objects with smooth shapes (teacup, smooth stone, walking
  stick, folded cloth).
- Naturalistic action: walking, gesturing, observing, breathing visibly,
  sitting or rising, hand on heart, tracing slow shapes in the air.

CAMERA — one verb per clip from this list only:
"static medium shot", "slow push in", "slight pull back", "pan left",
"pan right", "tilt up", "tilt down", "slow orbit", "lateral tracking shot".

REQUIRED in every visual_prompt:
- Either a clear subject action OR a clear environmental motion (wind in
  grass, water flowing). Never a fully static shot.
- A lighting cue ("golden hour", "soft morning light", "dappled afternoon",
  "low warm sunlight").
- Clip 0 opens close or medium-close (head-and-shoulders to waist-up). Never
  a wide establishing shot at clip 0 — the first 0.5s of social video decides
  retention.
"""
```

What's gone:
- The HEBREW PRONUNCIATION block (already hoisted into the SYSTEM prompt as a
  first-class section in Task 2 — lives there, not here)
- The instructional-clip camera-cover paragraph (the script_generator can
  describe this on a per-clip basis via visual_prompt; baking it into the
  guardrails as a rule was over-constraining)
- The positive-constraint-closer rule (removed — it was a symptom of over-
  rigid prompting that this rewrite corrects)

What stays: the hard-earned failure-mode rules (forbidden / permitted / camera
list) in compact form.

- [ ] **Step 3: Run tests to confirm all pass**

Run: `py -m pytest tests/test_settings.py -v`
Expected: all 5 pass (assertions are on "text" / "letter" tokens that still exist).

- [ ] **Step 4: Commit**

```bash
git add src/settings.py
git commit -m "feat(settings): terse GUARDRAILS_TEXT for v2.5 (Hebrew phonetics hoisted to SYSTEM)"
```

---

## Task 4: Mark the Direction Guide as Reference-Only

**Files:**
- Modify: `docs/direction/seedance_prompting_guide.md` (add a header note)

The 67KB guide stays on disk but stops being loaded into the runtime prompt (we already stopped loading it in Task 2). Add a clear note so future readers know.

- [ ] **Step 1: Prepend a "How this is used" banner to the guide**

Open `docs/direction/seedance_prompting_guide.md` and change the top from whatever it currently is to this:

```markdown
# Torah Tai Chi — Seedance Direction Guide

> **⚠️ NOT LOADED AT RUNTIME AS OF v2.5** (2026-04-15).
>
> This guide was originally loaded into Claude's SYSTEM prompt by
> `src/script_generator.py`. After v2.4 (Bereishit) came back incomprehensible
> from over-constrained prompting, v2.5 dropped the runtime load. This file
> stays on disk as **human reference material** — useful background when you
> want to understand why the pipeline's rules are what they are, or when you
> want to research Seedance prompt craft.
>
> The authoritative rules live in `src/script_generator.py` (SYSTEM_TEMPLATE)
> and `src/settings.py` (DOJO_ANCHOR_TEXT, OUTDOOR_ARCHETYPES, STYLE_LOCK,
> GUARDRAILS_TEXT). Read those first.

---

(original guide content follows)
```

Leave the rest of the guide untouched. The content is still valuable reference.

- [ ] **Step 2: Commit**

```bash
git add docs/direction/seedance_prompting_guide.md
git commit -m "docs: mark direction guide as reference-only (not runtime-loaded since v2.5)"
```

---

## Task 5: `src/caption_burner.py` — Whisper + ASS + ffmpeg

**Files:**
- Create: `src/caption_burner.py`
- Create: `tests/test_caption_burner.py`

The burner runs AFTER `concat_clips`. It reads the stitched mp4 plus the `ClipPlan`, uses Whisper to align the known voiceover text to the audio timeline (more accurate than blind transcription because we already know what was said), groups words into phrase-sized subtitle cues, writes an ASS subtitle file with per-clip positioning, and uses ffmpeg to burn the subtitles into the final mp4.

- [ ] **Step 1: Write failing tests at `tests/test_caption_burner.py`**

```python
import pytest
from pathlib import Path
from src.caption_burner import (
    group_words_into_cues,
    build_ass_file,
    ass_position_tag,
)


def test_ass_position_tag_bottom():
    # Bottom = margin from bottom (ASS default for bottom-aligned styles)
    tag = ass_position_tag("bottom", video_w=720, video_h=1280)
    assert "pos(" in tag or "an2" in tag.lower() or tag == ""  # some styles use alignment


def test_ass_position_tag_top():
    tag = ass_position_tag("top", video_w=720, video_h=1280)
    # Should produce an inline override that places text in top third
    assert tag.startswith("{")
    assert "pos(" in tag or "an8" in tag.lower()


def test_group_words_into_cues_breaks_on_punctuation():
    words = [
        {"word": "The", "start": 0.0, "end": 0.2},
        {"word": "smallest", "start": 0.2, "end": 0.7},
        {"word": "letter...", "start": 0.7, "end": 1.2},  # ellipsis = break
        {"word": "is", "start": 1.4, "end": 1.6},
        {"word": "an", "start": 1.6, "end": 1.8},
        {"word": "aleph.", "start": 1.8, "end": 2.3},  # period = break
    ]
    cues = group_words_into_cues(words, max_words=6)
    # First cue ends at the ellipsis, second cue ends at the period
    assert len(cues) == 2
    assert cues[0]["text"].strip().endswith("...") or "letter" in cues[0]["text"]
    assert cues[1]["text"].strip().endswith(".") or "aleph" in cues[1]["text"]


def test_group_words_into_cues_respects_max_words():
    words = [
        {"word": f"w{i}", "start": i * 0.2, "end": (i + 1) * 0.2}
        for i in range(10)
    ]  # 10 words, no punctuation breaks
    cues = group_words_into_cues(words, max_words=4)
    assert all(len(c["text"].split()) <= 4 for c in cues)
    # Full coverage — timing spans all words
    assert cues[0]["start"] == pytest.approx(0.0)
    assert cues[-1]["end"] == pytest.approx(2.0)


def test_build_ass_file_writes_valid_header(tmp_path):
    cues = [
        {"text": "Hello world", "start": 0.0, "end": 1.5, "position": "bottom"},
        {"text": "Another line", "start": 1.6, "end": 3.0, "position": "top"},
    ]
    out = tmp_path / "subs.ass"
    build_ass_file(cues, out, video_w=720, video_h=1280)
    content = out.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "[V4+ Styles]" in content
    assert "[Events]" in content
    assert "Hello world" in content
    assert "Another line" in content


@pytest.mark.slow
def test_burn_captions_end_to_end(tmp_path):
    """
    Slow integration test: uses ffmpeg and (stub) whisperx.
    Generates a 2s silent mp4 fixture, then feeds a pre-made cues list
    (bypassing Whisper) to burn_captions_raw to exercise the ASS+ffmpeg path.
    """
    import subprocess
    from src.caption_burner import burn_cues_to_mp4

    in_mp4 = tmp_path / "in.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=720x1280:d=2",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        str(in_mp4),
    ], check=True, capture_output=True)

    cues = [
        {"text": "Test caption", "start": 0.3, "end": 1.5, "position": "bottom"},
    ]
    out_mp4 = tmp_path / "out.mp4"
    burn_cues_to_mp4(in_mp4, cues, out_mp4, video_w=720, video_h=1280)
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 0
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `py -m pytest tests/test_caption_burner.py -v`
Expected: `ModuleNotFoundError: No module named 'src.caption_burner'`.

- [ ] **Step 3: Create `src/caption_burner.py`**

```python
"""Burn word-timed subtitles onto the stitched video.

Flow:
  1. Align the known voiceover text to the stitched audio via Whisper forced
     alignment (more accurate than blind transcription because we already
     know what was said).
  2. Group aligned words into phrase-sized cues (3-6 words, breaking at
     natural pause markers: ellipsis, em-dash, period, comma).
  3. Write an ASS subtitle file with per-clip positioning derived from each
     clip's caption_position field in the ClipPlan.
  4. Invoke ffmpeg with `-vf subtitles=...` to burn the subs into a new mp4.

Used by tools/generate.py after src/stitcher.py produces the stitched mp4.
"""
from __future__ import annotations
import re
import subprocess
from pathlib import Path
from typing import Any

from src.models import ClipPlan


# --- low-level helpers (pure, easy to test) ---

_PAUSE_RE = re.compile(r"[.!?\u2026]|[\u2014]|,")  # . ! ? ellipsis em-dash comma
_MAX_WORDS_PER_CUE = 6


def _ends_with_hard_break(word_text: str) -> bool:
    """True if the word token ends with .! ? or ellipsis (hard pause)."""
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (".", "!", "?", "\u2026")


def _ends_with_soft_break(word_text: str) -> bool:
    """True if the word token ends with a comma or em-dash (soft pause)."""
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (",", "\u2014")


def group_words_into_cues(
    words: list[dict[str, Any]],
    max_words: int = _MAX_WORDS_PER_CUE,
) -> list[dict[str, Any]]:
    """Group word-level Whisper output into phrase-sized caption cues.

    Input: [{"word": "The", "start": 0.0, "end": 0.2}, ...]
    Output: [{"text": "The smallest letter...", "start": 0.0, "end": 1.2}, ...]

    Break rules (any one triggers a cue boundary):
      - hard break (period, ellipsis, question mark, exclamation) — always break
      - soft break (comma, em-dash) — break if current cue has 3+ words
      - max_words reached — break
    """
    cues: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(w["word"] for w in current)
        cues.append({
            "text": text,
            "start": current[0]["start"],
            "end": current[-1]["end"],
        })
        current.clear()

    for w in words:
        current.append(w)
        word_text = w["word"]
        hit_max = len(current) >= max_words
        hard = _ends_with_hard_break(word_text)
        soft = _ends_with_soft_break(word_text) and len(current) >= 3
        if hard or soft or hit_max:
            flush()
    flush()
    return cues


def ass_position_tag(
    position: str, video_w: int, video_h: int,
) -> str:
    """ASS inline override for a given caption_position.

    bottom: no override (relies on default bottom-aligned style)
    top:    inline pos() at top 15% centered
    middle: inline pos() at vertical center
    """
    if position == "bottom":
        return ""
    cx = video_w // 2
    if position == "top":
        cy = int(video_h * 0.15)
    elif position == "middle":
        cy = int(video_h * 0.5)
    else:
        return ""
    return f"{{\\an5\\pos({cx},{cy})}}"


def _fmt_ass_time(t: float) -> str:
    """Format seconds as ASS time H:MM:SS.CS (centiseconds)."""
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def build_ass_file(
    cues: list[dict[str, Any]],
    out_path: Path,
    video_w: int,
    video_h: int,
) -> Path:
    """Write an ASS subtitle file with subtle styling + per-cue positioning.

    Each cue dict: {"text": str, "start": float, "end": float,
                    "position": "bottom"|"top"|"middle"}
    """
    font_size = max(24, int(video_h * 0.042))  # ~5% of video height
    margin_v = max(40, int(video_h * 0.08))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Inter Medium,{font_size},&H00FFFFFF,&H00000000,&H00000000,0,2,1,2,60,60,{margin_v}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines: list[str] = [header]
    for cue in cues:
        pos_override = ass_position_tag(
            cue.get("position", "bottom"), video_w, video_h,
        )
        start = _fmt_ass_time(cue["start"])
        end = _fmt_ass_time(cue["end"])
        text = cue["text"].replace("\n", " ").replace(",", "\u2060,")  # zero-width to avoid ASS comma parsing
        text_with_pos = pos_override + text
        lines.append(
            f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text_with_pos}"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def burn_cues_to_mp4(
    in_mp4: Path, cues: list[dict[str, Any]], out_mp4: Path,
    video_w: int, video_h: int,
) -> Path:
    """Given a prepared cues list, build ASS + burn into video."""
    ass_path = out_mp4.with_suffix(".ass")
    build_ass_file(cues, ass_path, video_w, video_h)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    # Escape the ASS path for ffmpeg filter (colons and backslashes)
    ass_for_filter = (
        str(ass_path.resolve()).replace("\\", "/").replace(":", "\\:")
    )
    subprocess.run([
        "ffmpeg", "-y", "-i", str(in_mp4),
        "-vf", f"subtitles='{ass_for_filter}'",
        "-c:a", "copy",
        str(out_mp4),
    ], check=True, capture_output=True)
    return out_mp4


# --- high-level API (ties Whisper + cues + burn together) ---


def _probe_video_dimensions(mp4: Path) -> tuple[int, int]:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(mp4),
    ], check=True, capture_output=True, text=True)
    lines = result.stdout.strip().splitlines()
    return int(lines[0]), int(lines[1])


def _words_for_plan(
    stitched_mp4: Path, plan: ClipPlan, model_size: str = "small",
) -> list[dict[str, Any]]:
    """Use Whisper forced alignment on the known voiceover text."""
    from faster_whisper import WhisperModel  # imported here — keeps module importable when whisper isn't installed

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    # Concatenate all voiceovers in clip order as the "expected" transcript
    expected = " ".join(c.voiceover for c in plan.clips)
    segments, _info = model.transcribe(
        str(stitched_mp4),
        initial_prompt=expected,
        word_timestamps=True,
        beam_size=5,
    )
    words: list[dict[str, Any]] = []
    for seg in segments:
        for w in (seg.words or []):
            words.append({
                "word": w.word.strip(),
                "start": float(w.start),
                "end": float(w.end),
            })
    return words


def _clip_time_boundaries(plan: ClipPlan) -> list[tuple[float, float]]:
    """Return [(start_s, end_s)] for each clip, accounting for xfade overlap.

    After stitcher.py's xfade=0.5s, each clip i (for i >= 1) overlaps the
    previous by 0.5s. So clip i starts at sum(durations[:i]) - i*0.5.
    """
    xfade = 0.5
    boundaries = []
    cursor = 0.0
    for i, c in enumerate(plan.clips):
        start = cursor
        end = start + c.duration_s - (0 if i == len(plan.clips) - 1 else xfade)
        boundaries.append((start, end))
        cursor = end
    return boundaries


def _assign_positions(
    cues: list[dict[str, Any]], plan: ClipPlan,
) -> list[dict[str, Any]]:
    """Assign a caption_position to each cue based on which clip it falls in."""
    boundaries = _clip_time_boundaries(plan)
    out = []
    for cue in cues:
        mid = (cue["start"] + cue["end"]) / 2
        # Find the clip whose boundaries contain mid
        position = plan.clips[-1].caption_position
        for i, (s, e) in enumerate(boundaries):
            if s <= mid < e:
                position = plan.clips[i].caption_position
                break
        out.append({**cue, "position": position})
    return out


def burn_captions(
    stitched_mp4: Path, plan: ClipPlan, out_mp4: Path,
    model_size: str = "small",
) -> Path:
    """Full pipeline: align, cue, position, burn."""
    video_w, video_h = _probe_video_dimensions(stitched_mp4)
    words = _words_for_plan(stitched_mp4, plan, model_size=model_size)
    cues = group_words_into_cues(words)
    cues = _assign_positions(cues, plan)
    burn_cues_to_mp4(stitched_mp4, cues, out_mp4, video_w, video_h)
    return out_mp4
```

- [ ] **Step 4: Run tests**

Run: `py -m pytest tests/test_caption_burner.py -v`
Expected: 4 fast tests PASS (the pure functions). The `@pytest.mark.slow` end-to-end test passes if ffmpeg and libass are available. If ffmpeg's subtitle filter errors, check that your ffmpeg build includes `libass` — some Windows builds don't. If yours doesn't, document this in the commit and skip the slow test for now.

Run: `py -m pytest -q`
Expected: whole suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/caption_burner.py tests/test_caption_burner.py
git commit -m "feat(caption_burner): Whisper forced alignment + ASS + ffmpeg burn-in"
```

---

## Task 6: Wire `caption_burner` into `tools/generate.py`

**Files:**
- Modify: `tools/generate.py`

Insert the burn step between `concat_clips` and the final output write.

- [ ] **Step 1: Update the pipeline**

Open `tools/generate.py`. Find the `[5/5] Stitching clips` section. Replace this block:

```python
    print(f"[5/5] Stitching clips")
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}-v2.mp4"
    concat_clips(clip_paths, final)
    print(f"\nDONE: {final}")
    return final
```

with:

```python
    print(f"[5/6] Stitching clips")
    stitched = work_dir / "stitched.mp4"
    concat_clips(clip_paths, stitched)

    print(f"[6/6] Burning on-screen captions (Whisper forced alignment)")
    from src.caption_burner import burn_captions
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}-v2.mp4"
    burn_captions(stitched, plan, final)
    print(f"\nDONE: {final}")
    return final
```

Changes:
- Stages renumbered `[5/5]` → `[5/6]`, new stage `[6/6]` added
- Stitcher now writes to `work/<run>/stitched.mp4` instead of directly to `output/`
- Caption burner reads the stitched intermediate + the in-memory `plan` and writes the final `output/<parsha>-a-v2.mp4`
- Pipeline progress output already shows `[1/5]` through `[4/5]` — grep for those strings and bump to `/6`

Find and replace within `tools/generate.py`:
- `[1/5]` → `[1/6]`
- `[2/5]` → `[2/6]`
- `[3/5]` → `[3/6]`
- `[4/5]` → `[4/6]`

- [ ] **Step 2: Sanity check**

Run: `py -c "import ast; ast.parse(open('tools/generate.py').read()); print('OK')"`
Expected: `OK`.

Run: `py tools/generate.py --help`
Expected: usage printed without import errors.

Run: `py -m pytest -q`
Expected: whole suite still passes.

- [ ] **Step 3: Commit**

```bash
git add tools/generate.py
git commit -m "feat(cli): wire caption_burner into pipeline as stage 6"
```

---

## Task 7: Validate pipeline imports on real Bereishit plan (dry, no paid API)

**Files:** None new.

Before the paid run, confirm the new code loads the existing Bereishit v2.4 plan without crashing. The plan has the old schema (no `captions`, no `caption_position`), so loading should fail cleanly with a Pydantic ValidationError — that's the expected outcome, not a bug.

- [ ] **Step 1: Attempt to load the v2.4 plan.json with v2.5 models**

```bash
cd "c:/Users/yitzym/git/torah tai chi"
py -c "
from src.models import ClipPlan
p = ClipPlan.model_validate_json(open('work/2026-04-15-bereishit-a-v2/plan.json', encoding='utf-8').read())
print(p)
"
```
Expected: a `pydantic.ValidationError` complaining about missing `captions` field. That's GOOD — it confirms the schema changed as intended and the old plan can't accidentally bypass the new rules.

- [ ] **Step 2: Decide how to handle the stale work dir**

The existing `work/2026-04-15-bereishit-a-v2/` has a v2.4-shape plan.json and real Seedance-generated mp4s. Task 9 will delete this dir and fresh-regenerate; for now just leave it in place. If the stale plan blocks any import you didn't expect, the fix is to delete the work dir — no code is broken.

No commit needed for this task.

---

## Task 8: Delete stale v2.4 work dir, regenerate Bereishit v2.5 (PAID)

**Files:** None new. Produces `output/bereishit-a-v2.mp4` (v2.5).

This is the first paid run of v2.5.

- [ ] **Step 1: Clear the stale work dir**

```bash
cd "c:/Users/yitzym/git/torah tai chi"
rm -rf work/2026-04-15-bereishit-a-v2
```

- [ ] **Step 2: Run the pipeline**

```bash
PYTHONUNBUFFERED=1 py -u tools/generate.py --parsha Bereishit
```

Expected stages:
- `[1/6] Loading parsha: Bereishit`
- `[2/6] Transforming draft into ClipPlan via Claude` (~15-30s at Claude)
- Claude output now should: (a) preserve Yonah's wording verbatim, (b) produce 3-8 clips, (c) include `captions`, `caption_position`, `emotive_note` fields
- `[3/6] Uploading reference images to Kie.ai` (~1-2 min)
- `[4/6] Generating N clips via Seedance 2.0` (~8-20 min depending on queue)
- `[5/6] Stitching clips` (ffmpeg xfade, <1 min)
- `[6/6] Burning on-screen captions` (Whisper first run downloads the ~470MB small model; ~1-3 min on CPU; subsequent runs <30s)
- Final file at `output/bereishit-a-v2.mp4`

Estimated cost: ~$5-7 (4-6 clips × $1.20 + Claude call + captions call).

- [ ] **Step 3: Inspect artifacts**

- `work/<date>-bereishit-a-v2/plan.json` — verify:
  - voiceover fields are Yonah's words verbatim
  - `captions` object has all 4 platform variants
  - each clip has `caption_position` and optionally `emotive_note`
  - clip count is 3-8
  - dojo clips come first, outdoor second
- `work/<date>-bereishit-a-v2/stitched.mp4` — plays cleanly, no captions on this intermediate
- `work/<date>-bereishit-a-v2/stitched.ass` — subtitle file produced
- `output/bereishit-a-v2.mp4` — plays with subtle captions burned in, positioned per-clip

- [ ] **Step 4: Subjective review — compare to Bereishit v2.4**

Watch both videos side-by-side:
- v2.4: `git show main~<N>:output/bereishit-a-v2.mp4` (or wherever you saved it before rerun)
- v2.5: `output/bereishit-a-v2.mp4`

Check specifically that v2.5:
- Fixes the v2.4 choppy/incomprehensible speech — content should land cleanly
- Voiceover matches Yonah's draft verbatim (run: `py -c "import json; print(json.load(open('work/.../plan.json'))['full_script'])"` to compare)
- On-screen captions readable but subtle
- Caption positioning adapts per clip (bottom for close-ups, top for wides)
- Character + dojo consistency holds (v2.4 was good on these; make sure v2.5 didn't regress)
- Pacing feels natural — variance between clips, not uniform

If any issues, note them and decide: re-regenerate with prompt tweaks, or proceed to Task 9 for a second parsha to widen the sample.

- [ ] **Step 5: Commit artifacts (optional)**

If you want to preserve this run:

```bash
git add work/2026-04-15-bereishit-a-v2/plan.json output/bereishit-a-v2.mp4
git commit -m "v2.5 poc: Bereishit first-run artifacts"
```

---

## Task 9: Second parsha drift check — Noach v2.5 (PAID)

**Files:** None new. Produces `output/noach-a-v2.mp4`.

A second parsha validates that the direction philosophy holds across different content. Noach has an obvious outdoor archetype fit (`RIVERSIDE_GROVE` for the flood / water / ark themes), which will let us see whether Claude still picks cleanly.

- [ ] **Step 1: Run the pipeline**

```bash
PYTHONUNBUFFERED=1 py -u tools/generate.py --parsha Noach
```

Expected cost: ~$5-7 again.

- [ ] **Step 2: Inspect the plan**

```bash
py -c "
import json
p = json.load(open('work/<date>-noach-a-v2/plan.json', encoding='utf-8'))
print('archetype:', p['outdoor_archetype_id'])
print('clips:', len(p['clips']))
print('total:', sum(c['duration_s'] for c in p['clips']), 's')
for c in p['clips']:
    w = len(c['voiceover'].split())
    print(f'  clip {c[\"index\"]} [{c[\"setting_id\"]}] {c[\"duration_s\"]}s, {w}w, pos={c[\"caption_position\"]}')
"
```

Check:
- Archetype makes sense for Noach (RIVERSIDE_GROVE or similar water-themed pick)
- Clip count between 3 and 8
- Total 28-90s
- Each clip has caption_position set

- [ ] **Step 3: Watch the video**

`output/noach-a-v2.mp4`.

Compare dojo consistency across Bereishit and Noach (different videos, week over week):
- Rav Eli looks like the same character in both videos?
- The dojo (when in dojo block) reads as the same room in both videos?
- Outdoor settings (Eden garden vs river grove) feel distinct per parsha while character identity stays constant?

If yes → pipeline is ready for weekly production. Move to CMS Slice 1.

If character or dojo drift → note specifics; may need to bump reference-image strategy in a follow-on spec. Don't iterate further on this plan.

- [ ] **Step 4: Commit artifacts (optional)**

```bash
git add work/<date>-noach-a-v2/plan.json output/noach-a-v2.mp4
git commit -m "v2.5 poc: Noach drift-check run artifacts"
```

---

## Deferred / Nice-to-Have (NOT in this plan)

- Voice cloning via `reference_audio_urls` or external TTS — defer until we observe week-to-week voice drift across 3+ parshiot
- Caption font customization (user-selectable styles in the dashboard)
- Silent-beat detection from `emotive_note` keywords (currently we rely on Whisper's natural silence handling — if it captions over silent breath moments incorrectly, revisit)
- Whisper model size tuning (currently `small`; if Hebrew phonetic accuracy isn't good enough, try `medium`)
- Caching of uploaded reference URLs (still re-uploads every run; worth adding once we hit rate limits)
