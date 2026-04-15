# Torah Tai Chi — Direction v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Phase 1 pipeline to produce 30-45s videos with frame-chained continuity, image-locked dojo, parsha-driven outdoor settings, and evidence-based Seedance guardrails.

**Architecture:** Builds on existing Phase 1 modules. Adds `src/settings.py` (single source of direction-language truth), `src/frame_extract.py` (ffmpeg helper), and `tools/generate_dojo_refs.py` (one-shot). Modifies `models.py` (new fields/validators), `script_generator.py` (new SYSTEM prompt + structured output), `video_generator.py` (setting-aware ref selection + first_frame_url), and `tools/generate.py` (block orchestration + frame chaining).

**Tech Stack:** Existing Phase 1 stack — Python 3.11+, anthropic, httpx, pydantic, ffmpeg-python (unused at runtime), python-dotenv, pytest, respx, pytest-asyncio. System ffmpeg binary required.

**Spec:** [docs/superpowers/specs/2026-04-15-torah-tai-chi-direction-v2-design.md](../specs/2026-04-15-torah-tai-chi-direction-v2-design.md)

---

## Prerequisites

- [ ] Phase 1 pipeline runs end-to-end (already proven on Vayikra clips 0-2)
- [ ] ffmpeg + ffprobe on PATH (already installed in `~/bin/`)
- [ ] Existing `references/` character pack (10-13 PNGs)

---

## Task 1: `src/settings.py` — Direction Constants

**Files:**
- Create: `src/settings.py`
- Create: `tests/test_settings.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_settings.py
from src.settings import (
    DOJO_ANCHOR_TEXT, OUTDOOR_ARCHETYPES, STYLE_LOCK, GUARDRAILS_TEXT,
)


def test_dojo_anchor_text_non_empty():
    assert isinstance(DOJO_ANCHOR_TEXT, str)
    assert len(DOJO_ANCHOR_TEXT) > 50


def test_outdoor_archetypes_at_least_eight():
    assert len(OUTDOOR_ARCHETYPES) >= 8
    for key, val in OUTDOOR_ARCHETYPES.items():
        assert key.isupper(), f"archetype id {key} must be UPPER_SNAKE"
        assert isinstance(val, str) and len(val) > 30


def test_outdoor_archetypes_required_ids_present():
    required = {
        "MOUNTAIN_RIDGE", "GARDEN_PATH", "RIVERSIDE_GROVE", "DESERT_OUTCROP",
        "FOREST_CLEARING", "SEASHORE", "ORCHARD", "HILLTOP_MEADOW",
    }
    assert required <= set(OUTDOOR_ARCHETYPES.keys())


def test_style_lock_mentions_character_and_voice():
    assert "Pixar" in STYLE_LOCK
    assert "yin-yang" in STYLE_LOCK
    assert "voice" in STYLE_LOCK.lower() or "timbre" in STYLE_LOCK.lower()


def test_guardrails_forbids_text_in_frame():
    text = GUARDRAILS_TEXT.lower()
    assert "text" in text
    assert "letters" in text or "letter" in text
```

- [ ] **Step 2: Run tests, confirm import failure**

Run: `py -m pytest tests/test_settings.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.settings'`.

- [ ] **Step 3: Implement `src/settings.py`**

```python
# src/settings.py
"""Single source of truth for video direction language.

Constants here are injected into Claude's system prompt and into Seedance
visual prompts. Keep them stable across runs — week-over-week consistency
depends on the same text appearing in every prompt.
"""
from __future__ import annotations


DOJO_ANCHOR_TEXT = (
    "A traditional Torah Tai Chi dojo: warm cypress floor, rice-paper screens, "
    "single low cedar table with a small ceramic teacup, soft morning light "
    "filtering through bamboo blinds. Empty of all other people."
)


OUTDOOR_ARCHETYPES: dict[str, str] = {
    "MOUNTAIN_RIDGE": (
        "Alpine ridge at golden hour, stone footpath underfoot, distant peaks "
        "beyond a wide valley, low pine scrub catching warm light."
    ),
    "GARDEN_PATH": (
        "Walled stone garden with flowering vines along the wall, a worn stone "
        "bench off the path, dappled afternoon light through a fig tree."
    ),
    "RIVERSIDE_GROVE": (
        "A gentle bend of a slow river, smooth river stones at the bank, "
        "silver-leafed olive trees overhead, soft midday sun glinting on water."
    ),
    "DESERT_OUTCROP": (
        "Sandstone outcrop overlooking a wide dry valley, sparse hardy desert "
        "shrubs, late-afternoon shadows long across the rock."
    ),
    "FOREST_CLEARING": (
        "Sunlit clearing in ancient pines, moss-covered fallen log to one side, "
        "shafts of light cutting through the high canopy."
    ),
    "SEASHORE": (
        "Quiet rocky shore at low tide, tide pools between dark stones, gentle "
        "morning waves, a wide horizon."
    ),
    "ORCHARD": (
        "Old fruit orchard in spring bloom, soft breeze rippling tall grass "
        "between the rows of trees."
    ),
    "HILLTOP_MEADOW": (
        "A wide wildflower meadow at dawn, mist still lifting off the grass, "
        "gentle rolling hills behind."
    ),
}


STYLE_LOCK = (
    "Same character as in reference images: Pixar-style 3D animation, "
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, brown leather "
    "kippah, navy blue mandarin-collar athletic shirt with Torah Tai Chi "
    "yin-yang logo on chest. Soft 3D render, warm cinematic lighting. "
    "Character identity must match references exactly. "
    "Voice timbre: warm and weathered, an experienced elder teacher in his "
    "late 50s, calm authority not booming, the patient cadence of a sage "
    "who has said this thousands of times."
)


GUARDRAILS_TEXT = """\
HARD GENERATION RULES (the model fails on these — enforce strictly):

FORBIDDEN in every visual_prompt:
- Any in-frame rendered text: letters, words, numbers, signs, plaques,
  scrolls with readable text, screens with content. (The model produces
  garbled text every time.)
- Intricate repeating patterns expected to stay sharp under motion
  (decorative borders, complex weaves, fine-print fabric).
- Multiple speaking characters in one shot. (Multi-person lip-sync fails.)
- Held objects with intricate specific shape (a labeled bottle, a tool with
  visible mechanism, an instrument with detailed parts).

PERMITTED (the model is reliable here — use freely):
- Single-character close-ups with speaking. Lean into these for emotional beats.
- Background characters who do NOT speak, used as silent narrative presence
  (a child watching from a distance, two figures walking far behind).
- Simple held objects with smooth shapes (teacup, smooth river stone, walking
  stick, folded cloth).

REQUIRED in every visual_prompt:
- Exactly one camera direction phrase from this list: "dolly in", "dolly out",
  "pan left", "pan right", "tilt up", "tilt down", "push in", "slow orbit",
  "crane up", "lateral tracking shot".
- Either a clear subject action (Rav Eli is doing X) OR a clear environmental
  motion (wind through grass, water flowing). Never a fully static shot.
- A lighting cue ("golden hour", "soft morning light", "dappled afternoon",
  "low warm sunlight", etc.).
"""
```

- [ ] **Step 4: Run tests, confirm 5 pass**

Run: `py -m pytest tests/test_settings.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/settings.py tests/test_settings.py
git commit -m "feat(settings): direction constants — dojo, outdoor archetypes, style, guardrails"
```

---

## Task 2: `src/models.py` — Extend `Clip` and `ClipPlan`

**Files:**
- Modify: `src/models.py`
- Modify: `tests/test_models.py`

- [ ] **Step 1: Extend `tests/test_models.py` with new failing tests**

Add these tests to the existing file (do NOT delete the existing 4 tests):

```python
import pytest
from pydantic import ValidationError
from src.models import Clip, ClipPlan


def _dojo_clip(idx: int, duration: int = 8) -> Clip:
    return Clip(index=idx, voiceover="x", visual_prompt="y",
                duration_s=duration, setting_id="DOJO")


def _outdoor_clip(idx: int, archetype: str, duration: int = 8) -> Clip:
    return Clip(index=idx, voiceover="x", visual_prompt="y",
                duration_s=duration, setting_id=archetype)


def test_clip_setting_id_required():
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=6)


def test_clip_motion_ref_url_defaults_none():
    c = _dojo_clip(0)
    assert c.motion_ref_url is None


def test_clipplan_requires_exactly_four_clips():
    with pytest.raises(ValidationError):
        ClipPlan(parsha="X", hook="x", full_script="x",
                 outdoor_archetype_id="MOUNTAIN_RIDGE",
                 clips=[_dojo_clip(0), _dojo_clip(1), _outdoor_clip(2, "MOUNTAIN_RIDGE")])


def test_clipplan_block_structure_dojo_then_outdoor():
    plan = ClipPlan(
        parsha="Vayikra", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        clips=[
            _dojo_clip(0, 8), _dojo_clip(1, 9),
            _outdoor_clip(2, "GARDEN_PATH", 9), _outdoor_clip(3, "GARDEN_PATH", 8),
        ],
    )
    assert plan.total_duration_s == 34


def test_clipplan_rejects_wrong_block_ordering():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _outdoor_clip(0, "GARDEN_PATH"), _outdoor_clip(1, "GARDEN_PATH"),
                _dojo_clip(2), _dojo_clip(3),
            ],
        )


def test_clipplan_rejects_outdoor_archetype_mismatch():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0), _dojo_clip(1),
                _outdoor_clip(2, "MOUNTAIN_RIDGE"), _outdoor_clip(3, "MOUNTAIN_RIDGE"),
            ],
        )


def test_clipplan_rejects_unknown_archetype():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="MARS_BASE",
            clips=[
                _dojo_clip(0), _dojo_clip(1),
                _outdoor_clip(2, "MARS_BASE"), _outdoor_clip(3, "MARS_BASE"),
            ],
        )


def test_clipplan_rejects_total_under_28s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0, 5), _dojo_clip(1, 5),
                _outdoor_clip(2, "GARDEN_PATH", 5), _outdoor_clip(3, "GARDEN_PATH", 5),
            ],
        )


def test_clipplan_rejects_total_over_45s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0, 15), _dojo_clip(1, 12),
                _outdoor_clip(2, "GARDEN_PATH", 12), _outdoor_clip(3, "GARDEN_PATH", 8),
            ],
        )
```

- [ ] **Step 2: Run tests, confirm new ones fail**

Run: `py -m pytest tests/test_models.py -v`
Expected: existing 4 PASS, new 9 FAIL (validation errors not raised because new fields/validators don't exist yet).

- [ ] **Step 3: Update `src/models.py`**

Replace the entire file with:

```python
# src/models.py
from __future__ import annotations
from pydantic import BaseModel, Field, model_validator
from src.settings import OUTDOOR_ARCHETYPES


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str = Field(min_length=1)
    motion_ref_url: str | None = None


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    outdoor_archetype_id: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=4, max_length=4)

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
        if self.clips[0].setting_id != "DOJO" or self.clips[1].setting_id != "DOJO":
            raise ValueError("clips 0 and 1 must have setting_id == 'DOJO'")
        if (self.clips[2].setting_id != self.outdoor_archetype_id
                or self.clips[3].setting_id != self.outdoor_archetype_id):
            raise ValueError(
                f"clips 2 and 3 must have setting_id == outdoor_archetype_id "
                f"({self.outdoor_archetype_id!r})"
            )
        total = self.total_duration_s
        if not (28 <= total <= 45):
            raise ValueError(f"total_duration_s {total} not in [28, 45]")
        return self
```

- [ ] **Step 4: Run tests, confirm all 13 pass**

Run: `py -m pytest tests/test_models.py -v`
Expected: 13 passed (4 original + 9 new).

- [ ] **Step 5: Commit**

```bash
git add src/models.py tests/test_models.py
git commit -m "feat(models): setting blocks, archetype lock, duration window validators"
```

---

## Task 3: `src/frame_extract.py` — ffmpeg Last-Frame Helper

**Files:**
- Create: `src/frame_extract.py`
- Create: `tests/test_frame_extract.py`

- [ ] **Step 1: Write failing test (marked slow because it shells out to ffmpeg)**

```python
# tests/test_frame_extract.py
import pytest
import subprocess
from pathlib import Path
from src.frame_extract import extract_last_frame


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_extract_last_frame_writes_png(tmp_path):
    clip = tmp_path / "in.mp4"
    out = tmp_path / "last.png"
    _make_test_clip(clip, seconds=2, color="green")

    result = extract_last_frame(clip, out)

    assert result == out
    assert out.exists()
    assert out.stat().st_size > 0
    # Verify it's a real PNG (starts with PNG signature)
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.slow
def test_extract_last_frame_raises_when_input_missing(tmp_path):
    out = tmp_path / "x.png"
    with pytest.raises(FileNotFoundError):
        extract_last_frame(tmp_path / "nope.mp4", out)
```

- [ ] **Step 2: Run tests, confirm import failure**

Run: `py -m pytest tests/test_frame_extract.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.frame_extract'`.

- [ ] **Step 3: Implement `src/frame_extract.py`**

```python
# src/frame_extract.py
"""Extract the last frame of an mp4 as a PNG via ffmpeg.

Used by the orchestrator to feed clip N's tail into clip N+1's
first_frame_url for visual continuity within a setting block.
"""
from __future__ import annotations
import subprocess
from pathlib import Path


def extract_last_frame(in_mp4: Path, out_png: Path) -> Path:
    if not in_mp4.exists():
        raise FileNotFoundError(f"input mp4 not found: {in_mp4}")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    # -sseof -0.05 seeks 50ms before EOF; -update 1 + -frames:v 1 grabs one frame.
    subprocess.run([
        "ffmpeg", "-y", "-sseof", "-0.05", "-i", str(in_mp4),
        "-update", "1", "-frames:v", "1", "-f", "image2", str(out_png),
    ], check=True, capture_output=True)
    return out_png
```

- [ ] **Step 4: Run tests, confirm 2 pass**

Run: `py -m pytest tests/test_frame_extract.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/frame_extract.py tests/test_frame_extract.py
git commit -m "feat(frame_extract): ffmpeg helper for last-frame PNG extraction"
```

---

## Task 4: `src/script_generator.py` — New SYSTEM Prompt + Structured Output

**Files:**
- Modify: `src/script_generator.py`
- Modify: `tests/test_script_generator.py`

- [ ] **Step 1: Replace `tests/test_script_generator.py` (one new structural test, one updated end-to-end)**

```python
# tests/test_script_generator.py
import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from src.script_generator import transform_draft_to_clip_plan, build_prompt
from src.models import ClipPlan


def test_build_prompt_includes_archetypes_and_guardrails():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.\n[TEACHING]\nListen first.",
    )
    assert "Vayikra" in prompt
    assert "[HOOK]" in prompt
    assert "He called." in prompt
    # Archetype menu and guardrails are in the SYSTEM prompt, NOT build_prompt;
    # build_prompt is just the user message. Just check it carries the draft and
    # asks for the structured output.
    assert "outdoor_archetype_id" in prompt or "DOJO" in prompt


@pytest.mark.asyncio
async def test_transform_draft_returns_valid_v2_plan():
    fake_plan = {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "outdoor_archetype_id": "GARDEN_PATH",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "Rav Eli sits, dolly in, soft morning light",
             "duration_s": 8, "setting_id": "DOJO"},
            {"index": 1, "voiceover": "b", "visual_prompt": "Rav Eli rises, push in, soft morning light",
             "duration_s": 9, "setting_id": "DOJO"},
            {"index": 2, "voiceover": "c", "visual_prompt": "Rav Eli walks the path, lateral tracking shot, dappled afternoon",
             "duration_s": 9, "setting_id": "GARDEN_PATH"},
            {"index": 3, "voiceover": "d", "visual_prompt": "Rav Eli pauses, slow orbit, dappled afternoon",
             "duration_s": 8, "setting_id": "GARDEN_PATH"},
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_plan))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    plan = await transform_draft_to_clip_plan(
        parsha_name="Vayikra", book="Leviticus", option="A",
        style_note="modern", title="t",
        draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
        client=mock_client,
    )
    assert isinstance(plan, ClipPlan)
    assert plan.outdoor_archetype_id == "GARDEN_PATH"
    assert plan.clips[0].setting_id == "DOJO"
    assert plan.clips[3].setting_id == "GARDEN_PATH"
    assert 28 <= plan.total_duration_s <= 45


@pytest.mark.asyncio
async def test_transform_draft_propagates_validation_error_on_bad_block():
    fake_plan = {
        "parsha": "Vayikra", "hook": "x", "full_script": "x",
        "outdoor_archetype_id": "GARDEN_PATH",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "p", "duration_s": 8, "setting_id": "GARDEN_PATH"},
            {"index": 1, "voiceover": "b", "visual_prompt": "p", "duration_s": 8, "setting_id": "GARDEN_PATH"},
            {"index": 2, "voiceover": "c", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
            {"index": 3, "voiceover": "d", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_plan))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="x", title="t", draft="x",
            client=mock_client,
        )
```

- [ ] **Step 2: Run tests, confirm failures**

Run: `py -m pytest tests/test_script_generator.py -v`
Expected: FAIL — old prompt and shape don't match new tests.

- [ ] **Step 3: Replace `src/script_generator.py`**

```python
# src/script_generator.py
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


SYSTEM_TEMPLATE = """You transform approved Torah Tai Chi draft scripts into structured
ClipPlans for video generation. Output ONLY valid JSON matching the schema at the end.

VIDEO STRUCTURE — ALWAYS exactly 4 clips, total 28-45 seconds:
- Clips 0 and 1: setting_id = "DOJO" (the recurring branded space)
- Clips 2 and 3: setting_id = the chosen outdoor archetype id (same id on both)

CHOOSING THE OUTDOOR ARCHETYPE:
Pick ONE archetype id from the menu below whose tonal fit best matches the
parsha's themes. The full anchor description is locked — DO NOT rewrite it.
You may add 1-2 sentences of parsha-specific sensory detail INSIDE the
visual_prompt for clips 2 and 3, but always start the visual_prompt with the
locked anchor first.

OUTDOOR ARCHETYPE MENU:
{archetype_menu}

DOJO ANCHOR (always use as the base for clips 0 and 1):
{dojo_anchor}

VOICEOVER RULES:
- The draft script is by Yonah (brand voice, already approved). DO NOT rewrite,
  paraphrase, or add content. Only split exact words across the 4 clips.
- Preserve order. Do not skip content.
- The 4 clips together should cover the whole draft.

VISUAL PROMPT RULES per clip (composed from parts, in this order):
1. The setting anchor (DOJO_ANCHOR_TEXT for clips 0-1, the chosen archetype's
   anchor for clips 2-3). Verbatim.
2. (Clips 2-3 only) Optional 1-2 sentences of parsha-specific sensory detail.
3. Subject action: what Rav Eli is doing this clip (or environmental motion if
   he is briefly off-frame).
4. Exactly one camera direction phrase from the allowed list.
5. The lighting cue from the anchor (carry it forward; do not contradict).
6. The STYLE_LOCK is appended later by the system — DO NOT include it.

{guardrails}

OUTPUT SCHEMA (JSON only — no markdown fences, no commentary):
{{
  "parsha": "<name>",
  "hook": "<first sentence of draft's [HOOK] section>",
  "full_script": "<original draft with section markers stripped>",
  "outdoor_archetype_id": "<one key from the menu above>",
  "clips": [
    {{"index": 0, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "DOJO"}},
    {{"index": 1, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "DOJO"}},
    {{"index": 2, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "<archetype id>"}},
    {{"index": 3, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "<archetype id>"}}
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
        f"DRAFT SCRIPT (preserve wording exactly):\n---\n{draft}\n---\n\n"
        "Produce the ClipPlan JSON now. Remember: 4 clips total, "
        "first 2 in DOJO, last 2 in the outdoor_archetype_id you picked. "
        "Total duration 28-45 seconds."
    )


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    client, model: str = "claude-opus-4-6",
) -> ClipPlan:
    prompt = build_prompt(parsha_name, book, option, style_note, title, draft)
    msg = await client.messages.create(
        model=model,
        max_tokens=4000,
        system=SYSTEM_TEMPLATE,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    data = json.loads(raw)
    return ClipPlan(**data)
```

- [ ] **Step 4: Run tests, confirm 3 pass**

Run: `py -m pytest tests/test_script_generator.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(script_generator): v2 system prompt — block structure, archetypes, guardrails"
```

---

## Task 5: `src/video_generator.py` — Setting-Aware Refs + first_frame_url

**Files:**
- Modify: `src/video_generator.py`
- Modify: `tests/test_video_generator.py`

- [ ] **Step 1: Replace `tests/test_video_generator.py`**

```python
# tests/test_video_generator.py
import pytest
from src.video_generator import build_seedance_input
from src.models import Clip
from src.settings import STYLE_LOCK


def _dojo_clip() -> Clip:
    return Clip(index=0, voiceover="Hello.", visual_prompt="Rav Eli sits, dolly in, soft morning light",
                duration_s=8, setting_id="DOJO")


def _outdoor_clip() -> Clip:
    return Clip(index=2, voiceover="Hi.", visual_prompt="Rav Eli walks, lateral tracking shot, dappled afternoon",
                duration_s=9, setting_id="GARDEN_PATH")


def test_build_seedance_input_dojo_includes_dojo_refs():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png", "https://x/c.png"],
        dojo_ref_urls=["https://x/dojo1.png", "https://x/dojo2.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert payload["reference_image_urls"][0] == "https://x/dojo1.png"
    assert payload["reference_image_urls"][1] == "https://x/dojo2.png"
    # Then character refs fill remaining slots up to 9
    assert "https://x/a.png" in payload["reference_image_urls"]
    assert len(payload["reference_image_urls"]) <= 9
    assert "first_frame_url" not in payload
    assert STYLE_LOCK in payload["prompt"]
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_outdoor_excludes_dojo_refs():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png"],
        dojo_ref_urls=["https://x/dojo1.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "https://x/dojo1.png" not in payload["reference_image_urls"]
    assert payload["reference_image_urls"] == ["https://x/a.png", "https://x/b.png"]


def test_build_seedance_input_with_first_frame_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"],
        dojo_ref_urls=[],
        first_frame_url="https://x/last.png",
        audio_url=None, resolution="720p",
    )
    assert payload["first_frame_url"] == "https://x/last.png"


def test_build_seedance_input_caps_refs_at_nine():
    clip = _dojo_clip()
    chars = [f"https://x/c{i}.png" for i in range(20)]
    dojos = [f"https://x/d{i}.png" for i in range(5)]
    payload = build_seedance_input(
        clip,
        character_ref_urls=chars,
        dojo_ref_urls=dojos,
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    refs = payload["reference_image_urls"]
    assert len(refs) == 9
    # Dojo refs first, capped at 3
    assert refs[:3] == ["https://x/d0.png", "https://x/d1.png", "https://x/d2.png"]
    # Then 6 character refs
    assert refs[3:] == [f"https://x/c{i}.png" for i in range(6)]


def test_build_seedance_input_with_audio_ref():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url="https://a/v.mp3", resolution="720p",
    )
    assert payload["reference_audio_urls"] == ["https://a/v.mp3"]
    assert "@Audio1" in payload["prompt"]


def test_build_seedance_input_resolution_normalized_lowercase():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720P",
    )
    assert payload["resolution"] == "720p"
```

- [ ] **Step 2: Run tests, confirm failures**

Run: `py -m pytest tests/test_video_generator.py -v`
Expected: FAIL — old `build_seedance_input` signature doesn't match.

- [ ] **Step 3: Replace `src/video_generator.py`**

```python
# src/video_generator.py
from __future__ import annotations
from pathlib import Path
from typing import Optional
from src.kie_client import KieClient
from src.models import Clip
from src.settings import STYLE_LOCK


SEEDANCE_MODEL = "bytedance/seedance-2"
MAX_REFS = 9
MAX_DOJO_REFS = 3


def _select_refs(character_ref_urls: list[str], dojo_ref_urls: list[str],
                 setting_id: str) -> list[str]:
    if setting_id == "DOJO":
        dojos = dojo_ref_urls[:MAX_DOJO_REFS]
        remaining = MAX_REFS - len(dojos)
        return dojos + character_ref_urls[:remaining]
    return character_ref_urls[:MAX_REFS]


def build_seedance_input(
    clip: Clip,
    character_ref_urls: list[str],
    dojo_ref_urls: list[str],
    first_frame_url: Optional[str],
    audio_url: Optional[str],
    resolution: str = "720p",
) -> dict:
    voice_clause = "Voice matches @Audio1 in timbre and delivery. " if audio_url else ""
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f'Character speaks: "{clip.voiceover}"\n'
        f"{voice_clause}"
        f"{STYLE_LOCK}"
    )
    payload: dict = {
        "prompt": prompt,
        "reference_image_urls": _select_refs(character_ref_urls, dojo_ref_urls, clip.setting_id),
        "duration": clip.duration_s,
        "resolution": resolution.lower(),
        "aspect_ratio": "9:16",
        "web_search": False,
    }
    if first_frame_url:
        payload["first_frame_url"] = first_frame_url
    if audio_url:
        payload["reference_audio_urls"] = [audio_url]
    return payload


async def generate_clip(
    client: KieClient, clip: Clip,
    character_ref_urls: list[str], dojo_ref_urls: list[str],
    dest: Path,
    first_frame_url: Optional[str] = None,
    audio_url: Optional[str] = None,
    resolution: str = "720p",
) -> Path:
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
    )
    task_id = await client.create_task(SEEDANCE_MODEL, payload)
    urls = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest
```

- [ ] **Step 4: Run tests, confirm 6 pass**

Run: `py -m pytest tests/test_video_generator.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "feat(video_generator): setting-aware ref selection + first_frame_url support"
```

---

## Task 6: `tools/generate_dojo_refs.py` — One-Shot Dojo Reference Generator

**Files:**
- Create: `tools/generate_dojo_refs.py`
- Modify: `.gitignore` (ensure `references/dojo/` is tracked, not ignored)

This is a one-time tool. Pattern follows existing `tools/generate_references.py`. Generates 2 canonical dojo PNGs via Kie.ai nano-banana-pro and saves to `references/dojo/`. Not unit-tested — smoke tested manually.

- [ ] **Step 1: Write `tools/generate_dojo_refs.py`**

```python
"""Generate canonical Torah Tai Chi dojo reference images via Kie.ai
Nano Banana Pro.

Run once. Output: 2 PNGs in references/dojo/. These are passed alongside
character refs in every dojo clip so the dojo looks visually identical
across episodes.
"""
from __future__ import annotations
import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient
from src.settings import DOJO_ANCHOR_TEXT

REF_DIR = ROOT / "references" / "dojo"
MODEL = "nano-banana-pro"

SHOTS = [
    ("dojo_wide_morning",
     f"{DOJO_ANCHOR_TEXT} Wide establishing shot from the doorway looking in, "
     "the room empty, soft Pixar-style 3D render, warm cinematic lighting, "
     "high detail, 4K. Aspect ratio 9:16."),
    ("dojo_three_quarter_floor",
     f"{DOJO_ANCHOR_TEXT} Three-quarter view from the floor level showing the "
     "low cedar table with teacup in the foreground, screens behind, "
     "soft Pixar-style 3D render, warm cinematic lighting, high detail, 4K. "
     "Aspect ratio 9:16."),
]


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    kie = KieClient(api_key=kie_key)

    for slug, prompt in SHOTS:
        dest = REF_DIR / f"{slug}.png"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  SKIP {dest.name} (already exists)")
            continue
        print(f"  generating {slug}...")
        payload = {
            "prompt": prompt,
            "output_format": "png",
            "image_size": "9:16",
        }
        task_id = await kie.create_task(MODEL, payload)
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], dest)
        print(f"  saved {dest}")


if __name__ == "__main__":
    asyncio.run(run())
```

- [ ] **Step 2: Verify syntax + --help-style invocation**

Run: `py -c "import ast; ast.parse(open('tools/generate_dojo_refs.py').read()); print('syntax OK')"`
Expected: `syntax OK`.

- [ ] **Step 3: Ensure `references/dojo/` is tracked in git**

Check `.gitignore`. If `references/` is gitignored OR `references/dojo/` is gitignored, add an exception. If neither is gitignored, no change needed.

Run: `cd "$(git rev-parse --show-toplevel)" && git check-ignore -v references/dojo/.gitkeep 2>&1 || echo "not ignored"`

If output says "not ignored", create a placeholder so the empty dir survives committing the script:

```bash
mkdir -p references/dojo
touch references/dojo/.gitkeep
```

If output shows the directory IS ignored, add to `.gitignore`:

```
!references/dojo/
```

- [ ] **Step 4: Commit**

```bash
git add tools/generate_dojo_refs.py references/dojo/.gitkeep .gitignore
git commit -m "feat(tools): generate_dojo_refs.py one-shot canonical dojo image generator"
```

- [ ] **Step 5: Run the generator (manual, costs ~2 nano-banana-pro credits)**

Run: `py tools/generate_dojo_refs.py`
Expected: 2 PNGs appear in `references/dojo/`.

Inspect each PNG. If they don't match the brand vibe, edit the prompts in `SHOTS`, delete the bad PNGs, and re-run (the SKIP logic preserves good ones).

- [ ] **Step 6: Commit the canonical dojo refs**

```bash
git add references/dojo/*.png
git commit -m "feat(refs): canonical dojo reference images"
```

---

## Task 7: `tools/generate.py` — Block Orchestration + Frame Chaining

**Files:**
- Modify: `tools/generate.py`

This is integration glue between all the modules above. No new unit tests — exercised end-to-end in Task 8.

- [ ] **Step 1: Replace `tools/generate.py`**

```python
"""Torah Tai Chi video generator CLI (v2: block orchestration + frame chaining).

Usage:
  py tools/generate.py --parsha Vayikra
"""
from __future__ import annotations
import argparse
import asyncio
import json as _json
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.parsha_data import get_parsha_script
from src.script_generator import transform_draft_to_clip_plan
from src.video_generator import generate_clip
from src.stitcher import concat_clips
from src.kie_client import KieClient
from src.frame_extract import extract_last_frame
from src.models import ClipPlan

REFS_DIR = ROOT / "references"
DOJO_REFS_DIR = ROOT / "references" / "dojo"
PARSHIOT_PATH = ROOT / "parshiot.json"


async def _upload_dir_pngs(kie: KieClient, dir_path: Path,
                           remote_dir: str, label: str) -> list[str]:
    urls: list[str] = []
    for img in sorted(dir_path.glob("*.png")):
        print(f"  uploading {label}: {img.name}")
        url = await kie.upload_file(img, remote_dir=remote_dir)
        urls.append(url)
    return urls


async def upload_character_references(kie: KieClient) -> list[str]:
    # REFS_DIR.glob("*.png") only matches top-level PNGs; references/dojo/*.png
    # is handled separately by upload_dojo_references.
    urls = await _upload_dir_pngs(
        kie, REFS_DIR, "torah-tai-chi/refs", "char ref",
    )
    if not urls:
        raise SystemExit(f"No character reference PNGs in {REFS_DIR}")
    return urls


async def upload_dojo_references(kie: KieClient) -> list[str]:
    if not DOJO_REFS_DIR.exists():
        return []
    return await _upload_dir_pngs(
        kie, DOJO_REFS_DIR, "torah-tai-chi/refs/dojo", "dojo ref",
    )


def _is_first_in_block(idx: int) -> bool:
    """Block boundaries: clips 0 and 2 are first-in-block; 1 and 3 are chained."""
    return idx % 2 == 0


async def _ensure_first_frame_url(
    kie: KieClient, work_dir: Path, prev_clip_path: Path,
) -> str:
    """Extract last frame of prev_clip_path, upload, return URL.

    Cached on disk: <prev_clip>.lastframe.png and <prev_clip>.lastframe.url.
    """
    png_path = prev_clip_path.with_suffix(".lastframe.png")
    url_path = prev_clip_path.with_suffix(".lastframe.url")
    if url_path.exists():
        cached = url_path.read_text(encoding="utf-8").strip()
        if cached:
            return cached
    if not png_path.exists() or png_path.stat().st_size == 0:
        extract_last_frame(prev_clip_path, png_path)
    url = await kie.upload_file(png_path, remote_dir="torah-tai-chi/lastframes")
    url_path.write_text(url, encoding="utf-8")
    return url


async def run(parsha_name: str, option: str, resolution: str) -> Path:
    from anthropic import AsyncAnthropic

    load_dotenv(ROOT / ".env")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        raise SystemExit("ERROR: ANTHROPIC_API_KEY not set (add to .env)")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    run_slug = f"{time.strftime('%Y-%m-%d')}-{parsha_name.lower()}-{option.lower()}-v2"
    work_dir = ROOT / "work" / run_slug
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Loading parsha: {parsha_name} (option {option})")
    parshiot = _json.loads(PARSHIOT_PATH.read_text(encoding="utf-8"))["parshiot"]
    match = next((p for p in parshiot if p["name"].lower() == parsha_name.lower()), None)
    if not match:
        raise SystemExit(f"Parsha not found: {parsha_name}")
    book = match["book"]
    script = get_parsha_script(parsha_name, option, PARSHIOT_PATH)

    plan_path = work_dir / "plan.json"
    if plan_path.exists():
        print(f"[2/5] Reusing cached ClipPlan at {plan_path}")
        plan = ClipPlan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    else:
        print(f"[2/5] Transforming draft into ClipPlan via Claude")
        anthropic = AsyncAnthropic(api_key=anthropic_key)
        plan = await transform_draft_to_clip_plan(
            parsha_name=parsha_name, book=book, option=option,
            style_note=script["style_note"], title=script["title"],
            draft=script["draft"], client=anthropic,
        )
        plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
    print(f"      {len(plan.clips)} clips, total {plan.total_duration_s}s, "
          f"outdoor archetype: {plan.outdoor_archetype_id}")

    print(f"[3/5] Uploading reference images to Kie.ai")
    kie = KieClient(api_key=kie_key)
    char_refs = await upload_character_references(kie)
    dojo_refs = await upload_dojo_references(kie)
    print(f"      {len(char_refs)} char refs, {len(dojo_refs)} dojo refs uploaded")

    print(f"[4/5] Generating {len(plan.clips)} clips via Seedance 2.0")
    clip_paths: list[Path] = []
    for clip in plan.clips:
        dest = work_dir / f"clip_{clip.index:02d}.mp4"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"      clip {clip.index}: SKIP (already generated)")
            clip_paths.append(dest)
            continue

        first_frame_url = None
        if not _is_first_in_block(clip.index):
            prev = work_dir / f"clip_{(clip.index - 1):02d}.mp4"
            if not prev.exists():
                raise SystemExit(
                    f"Cannot chain clip {clip.index}: previous clip {prev} missing. "
                    "Generate clips in order."
                )
            print(f"      clip {clip.index}: chaining from clip {clip.index - 1} last frame")
            first_frame_url = await _ensure_first_frame_url(kie, work_dir, prev)

        print(f"      clip {clip.index}: {clip.duration_s}s [{clip.setting_id}] — "
              f"{clip.voiceover[:50]}...")
        try:
            await generate_clip(
                kie, clip,
                character_ref_urls=char_refs,
                dojo_ref_urls=dojo_refs,
                dest=dest,
                first_frame_url=first_frame_url,
                resolution=resolution,
            )
        except Exception as e:
            if first_frame_url is None:
                raise
            # Spec §10: if a chained clip fails, fall back to a clean cut
            # (omit first_frame_url) and retry once before giving up.
            print(f"      clip {clip.index}: chained generation failed ({e}); "
                  "retrying without first_frame_url (clean cut fallback)")
            await generate_clip(
                kie, clip,
                character_ref_urls=char_refs,
                dojo_ref_urls=dojo_refs,
                dest=dest,
                first_frame_url=None,
                resolution=resolution,
            )
        clip_paths.append(dest)

    print(f"[5/5] Stitching clips")
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}-v2.mp4"
    concat_clips(clip_paths, final)
    print(f"\nDONE: {final}")
    return final


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsha", required=True)
    ap.add_argument("--option", default="A", choices=["A", "B", "C"],
                    help="Which of Yonah's 3 script options to use")
    ap.add_argument("--resolution", default="720p", choices=["480p", "720p"])
    args = ap.parse_args()
    asyncio.run(run(args.parsha, args.option, args.resolution))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Sanity checks**

Run: `py -c "import ast; ast.parse(open('tools/generate.py').read()); print('OK')"`
Expected: `OK`.

Run: `py tools/generate.py --help`
Expected: prints usage with `--parsha`, `--option`, `--resolution`.

Run: `py -m pytest -q`
Expected: All previous tests still pass (count varies but should be ≥ 23 passed).

- [ ] **Step 3: Commit**

```bash
git add tools/generate.py
git commit -m "feat(cli): v2 orchestration — setting blocks, frame chaining, dojo refs"
```

---

## Task 8: First v2 Real Run (Vayikra)

**Files:** None created. This is end-to-end validation.

- [ ] **Step 1: Verify prerequisites**

```bash
ls references/*.png | head        # character refs present
ls references/dojo/*.png          # dojo refs present (from Task 6)
grep -E "^(KIE_AI|ANTHROPIC)" .env   # both keys present
ffmpeg -version | head -1         # ffmpeg available
ffprobe -version | head -1        # ffprobe available
```

If anything is missing, fix before proceeding.

- [ ] **Step 2: Run the v2 pipeline**

Run: `py tools/generate.py --parsha Vayikra`

Expected: progress through all 5 stages. Total ~10-15 minutes for 4 clips at 720p (faster than Phase 1 because half the clips). Final line: `DONE: output/vayikra-a-v2.mp4`.

- [ ] **Step 3: Inspect artifacts**

- `work/<date>-vayikra-a-v2/plan.json` — confirm 4 clips, structure correct, outdoor archetype makes sense for Vayikra
- `work/<date>-vayikra-a-v2/clip_*.mp4` — each clip plays
- `work/<date>-vayikra-a-v2/clip_00.lastframe.png` and `clip_02.lastframe.png` — frames extracted for chaining
- `output/vayikra-a-v2.mp4` — full stitched video, 28-45s

- [ ] **Step 4: Side-by-side review with Yonah**

Compare `output/vayikra-a-v2.mp4` with `output/vayikra-a-partial-3clips.mp4` (the v1 partial). Notes from Yonah on:
- Did dojo → outdoor cut feel intentional vs jarring?
- Did frame-chained clips 0→1 and 2→3 actually flow as one continuous shot, or still feel cut?
- Did the outdoor archetype fit the parsha's themes?
- Did Rav Eli stay consistent across all 4 clips?
- Any guardrail violations (text in frame, multi-character speaking, etc.)?

- [ ] **Step 5: Commit run artifacts (optional, only if good enough to keep)**

```bash
git add work/<date>-vayikra-a-v2/plan.json output/vayikra-a-v2.mp4
git commit -m "v2 poc: Vayikra direction-v2 first run artifacts"
```

---

## Task 9: Second Parsha (Bereishit or Noach) — Drift Check

**Files:** None created.

- [ ] **Step 1: Pick a parsha with a clear archetype fit**

Bereishit → likely `GARDEN_PATH`. Noach → likely `RIVERSIDE_GROVE`. Pick one.

- [ ] **Step 2: Run pipeline**

```bash
py tools/generate.py --parsha Bereishit  # or Noach
```

- [ ] **Step 3: Side-by-side dojo consistency check**

Open `output/vayikra-a-v2.mp4` and `output/<other>-a-v2.mp4`. Pause both at the dojo clips. Compare:
- Is the dojo recognizably the same room? (image-locked dojo refs are working)
- Is Rav Eli the same person across both videos?
- Did Claude pick a sensible outdoor archetype for the second parsha?

- [ ] **Step 4: Decision point — Phase 2 done OR iterate**

- All consistency holds → Phase 2 done. Discuss social-post automation (Phase 3).
- Dojo drifts across videos → narrow `references/dojo/` to the single strongest shot, or regenerate.
- Outdoor archetype feels stale → expand `OUTDOOR_ARCHETYPES` in `src/settings.py`.
- Rav Eli drifts → revisit character references (separate concern, predates v2).

---

## Deferred / Nice-to-Have (NOT in this plan)

- `--no-resume` flag to force fresh runs.
- Reference image upload caching across runs (currently re-uploads every run; uploads are free on Kie but slow).
- Per-archetype minimum-cooldown logic (don't pick the same outdoor archetype two weeks in a row).
- A/B testing motion reference videos (`reference_video_urls`).
- `@Audio1` voice locking once we observe drift across 3+ parshiot.
- Web-search-driven setting hint (Claude looks up current events tied to the parsha).
