# Torah Tai Chi — Phase 1 POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Python CLI that takes a parsha name and produces a finished 60-90 second Rav Eli video (MP4 on disk) by orchestrating Claude (script) + Kie.ai Seedance 2.0 (clips) + FFmpeg (stitch).

**Architecture:** Single-process Python pipeline. Four modules (`parsha_data`, `script_generator`, `video_generator`, `stitcher`) orchestrated by `tools/generate.py`. Shared `kie_client` module handles Kie.ai HTTP. Pydantic `ClipPlan` is the contract between Claude output and Seedance input. Sequential clip generation, local `work/` and `output/` directories. No framework, no DB, no UI.

**Tech Stack:** Python 3.11+, `anthropic`, `httpx`, `pydantic`, `ffmpeg-python`, `python-dotenv`, `pytest`, `respx` (HTTP mocking). System FFmpeg binary required.

**Spec:** [docs/superpowers/specs/2026-04-14-torah-tai-chi-poc-design.md](../specs/2026-04-14-torah-tai-chi-poc-design.md)

---

## Prerequisites (do before Task 1)

- [ ] Reference image generation complete (`tools/generate_references.py` has finished; `references/` has 10-13 PNG files)
- [ ] Canonical reference subset selected: 6-9 best shots chosen; others moved to `references/_candidates/`. The canonical set stays in `references/` root.
- [ ] `parshiot.json` created at project root by running `py tools/import_parshiot.py` (reads `Torah_Tai_Chi_Parsha_Scripts.xlsx`, emits schema `{"parshiot": [{"order": int, "name": str, "book": str, "scripts": [{"option": "A|B|C", "style_note": str, "title": str, "draft": str}, ...]}]}`).
- [ ] Anthropic API key added to `.env` as `ANTHROPIC_API_KEY=sk-ant-...`
- [ ] FFmpeg installed and on PATH: `ffmpeg -version` works in bash

---

## Task 1: Project Scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `src/__init__.py`
- Create: `tests/__init__.py`
- Create: `pytest.ini`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "torah-tai-chi"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "anthropic>=0.40.0",
    "httpx>=0.27.0",
    "pydantic>=2.8.0",
    "ffmpeg-python>=0.2.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "respx>=0.21.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

- [ ] **Step 2: Create empty package markers**

Create `src/__init__.py` with content: `""` (empty).
Create `tests/__init__.py` with content: `""` (empty).

- [ ] **Step 3: Install dependencies**

Run: `py -m venv .venv && .venv/Scripts/pip install -e ".[dev]"`
Expected: installs cleanly, no errors.

- [ ] **Step 4: Verify pytest runs**

Run: `.venv/Scripts/pytest --collect-only`
Expected: `collected 0 items` (no tests yet) — scaffolding valid.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml src/__init__.py tests/__init__.py
git commit -m "chore: project scaffolding (pyproject, pytest, src/tests layout)"
```

---

## Task 2: `ClipPlan` Pydantic Models

**Files:**
- Create: `src/models.py`
- Create: `tests/test_models.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_models.py
import pytest
from pydantic import ValidationError
from src.models import Clip, ClipPlan


def test_clip_valid():
    c = Clip(index=0, voiceover="hello", visual_prompt="Rav Eli waves", duration_s=6)
    assert c.duration_s == 6


def test_clip_rejects_duration_out_of_range():
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=20)
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=3)


def test_clipplan_valid():
    plan = ClipPlan(
        parsha="Vayikra",
        hook="opening",
        full_script="full",
        clips=[Clip(index=0, voiceover="a", visual_prompt="b", duration_s=6)],
    )
    assert plan.parsha == "Vayikra"
    assert len(plan.clips) == 1


def test_clipplan_total_duration():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        clips=[
            Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8),
            Clip(index=1, voiceover="c", visual_prompt="d", duration_s=10),
        ],
    )
    assert plan.total_duration_s == 18
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/pytest tests/test_models.py -v`
Expected: FAIL with "No module named 'src.models'" or similar.

- [ ] **Step 3: Implement models**

```python
# src/models.py
from pydantic import BaseModel, Field


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=1)

    @property
    def total_duration_s(self) -> int:
        return sum(c.duration_s for c in self.clips)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/pytest tests/test_models.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/models.py tests/test_models.py
git commit -m "feat(models): ClipPlan + Clip pydantic models"
```

---

## Task 3: `parsha_data` Module

**Files:**
- Create: `src/parsha_data.py`
- Create: `tests/test_parsha_data.py`
- Create: `tests/fixtures/parshiot_sample.json`

- [ ] **Step 1: Create test fixture**

```json
// tests/fixtures/parshiot_sample.json
{
  "parshiot": [
    {
      "order": 25,
      "name": "Vayikra",
      "book": "Leviticus",
      "scripts": [
        {"option": "A", "style_note": "practical modern lens", "title": "The Call Behind the Call",
         "draft": "[HOOK]\nGod calls quietly.\n[TEACHING]\nVayikra opens with a whisper...\n[APPLICATION]\nListen before you move.\n[CTA]\nFollow for more."}
      ]
    },
    {
      "order": 1,
      "name": "Bereishit",
      "book": "Genesis",
      "scripts": [
        {"option": "A", "style_note": "modern", "title": "The First Breath", "draft": "[HOOK]\nBreathe.\n[TEACHING]\nIn the beginning...\n[APPLICATION]\nStart now.\n[CTA]\nFollow."}
      ]
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

```python
# tests/test_parsha_data.py
import pytest
from pathlib import Path
from src.parsha_data import load_parshiot, get_parsha, get_parsha_script

FIXTURE = Path(__file__).parent / "fixtures" / "parshiot_sample.json"


def test_load_parshiot_returns_dict():
    parshiot = load_parshiot(FIXTURE)
    assert "Vayikra" in parshiot
    assert parshiot["Vayikra"]["book"] == "Leviticus"


def test_get_parsha_hit():
    p = get_parsha("Vayikra", FIXTURE)
    assert p["name"] == "Vayikra"
    assert p["order"] == 25


def test_get_parsha_miss_raises():
    with pytest.raises(KeyError):
        get_parsha("DoesNotExist", FIXTURE)


def test_get_parsha_case_insensitive():
    p = get_parsha("vayikra", FIXTURE)
    assert p["name"] == "Vayikra"


def test_get_parsha_script_option_a():
    s = get_parsha_script("Vayikra", "A", FIXTURE)
    assert s["title"] == "The Call Behind the Call"
    assert "[HOOK]" in s["draft"]


def test_get_parsha_script_missing_option_raises():
    with pytest.raises(KeyError):
        get_parsha_script("Vayikra", "Z", FIXTURE)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/pytest tests/test_parsha_data.py -v`
Expected: FAIL with import error.

- [ ] **Step 4: Implement module**

```python
# src/parsha_data.py
import json
from pathlib import Path
from typing import Any


def load_parshiot(path: Path) -> dict[str, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {p["name"]: p for p in data["parshiot"]}


def get_parsha(name: str, path: Path) -> dict[str, Any]:
    parshiot = load_parshiot(path)
    for key, value in parshiot.items():
        if key.lower() == name.lower():
            return value
    raise KeyError(f"Parsha not found: {name}")


def get_parsha_script(name: str, option: str, path: Path) -> dict[str, Any]:
    parsha = get_parsha(name, path)
    for s in parsha.get("scripts", []):
        if s["option"].upper() == option.upper():
            return s
    raise KeyError(f"Option {option} not found for parsha {name}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/pytest tests/test_parsha_data.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/parsha_data.py tests/test_parsha_data.py tests/fixtures/parshiot_sample.json
git commit -m "feat(parsha_data): load and lookup parshiot by name"
```

---

## Task 4: `kie_client` — Shared Kie.ai HTTP Client

**Files:**
- Create: `src/kie_client.py`
- Create: `tests/test_kie_client.py`

Rationale: both reference gen and Seedance use Kie.ai's same createTask/recordInfo pattern. Abstract it once. The existing `tools/generate_references.py` stays as-is (it works), but new code uses this client.

- [ ] **Step 1: Write failing tests (using respx for HTTP mocking)**

```python
# tests/test_kie_client.py
import pytest
import respx
from httpx import Response
from src.kie_client import KieClient, KieTaskFailed


@pytest.mark.asyncio
async def test_create_task_returns_task_id():
    pytest.importorskip("respx")
    async with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.kie.ai/api/v1/jobs/createTask").mock(
            return_value=Response(200, json={"code": 200, "data": {"taskId": "t-123"}})
        )
        client = KieClient(api_key="k", timeout_s=5)
        tid = await client.create_task(model="seedance-2-0", input_payload={"prompt": "hi"})
        assert tid == "t-123"


@pytest.mark.asyncio
async def test_poll_until_success_returns_result_urls():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r"https://api\.kie\.ai/api/v1/jobs/recordInfo\?taskId=t-1").mock(
            side_effect=[
                Response(200, json={"code": 200, "data": {"state": "waiting"}}),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/v.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0)
        urls = await client.poll_task("t-1")
        assert urls == ["https://cdn/v.mp4"]


@pytest.mark.asyncio
async def test_poll_raises_on_fail_state():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*").mock(
            return_value=Response(200, json={"code": 200, "data": {
                "state": "fail", "failCode": "X", "failMsg": "bad prompt"
            }})
        )
        client = KieClient(api_key="k", poll_interval_s=0)
        with pytest.raises(KieTaskFailed):
            await client.poll_task("t-2")
```

- [ ] **Step 2: Install pytest-asyncio**

Add to pyproject.toml dev deps: `"pytest-asyncio>=0.23.0"`. Re-run `pip install -e ".[dev]"`. Add `asyncio_mode = "auto"` to `[tool.pytest.ini_options]`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/pytest tests/test_kie_client.py -v`
Expected: FAIL with import error.

- [ ] **Step 4: Implement kie_client**

```python
# src/kie_client.py
from __future__ import annotations
import asyncio
import json
from pathlib import Path
from typing import Any
import httpx


class KieTaskFailed(Exception):
    pass


class KieClient:
    CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask"
    RECORD_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"

    def __init__(self, api_key: str, timeout_s: int = 60,
                 poll_interval_s: float = 5.0, poll_timeout_s: int = 600):
        self._key = api_key
        self._timeout = timeout_s
        self._poll_interval = poll_interval_s
        self._poll_timeout = poll_timeout_s

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json"}

    async def create_task(self, model: str, input_payload: dict[str, Any]) -> str:
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.post(self.CREATE_URL, headers=self._headers(),
                             json={"model": model, "input": input_payload})
            r.raise_for_status()
            data = r.json()
            if data.get("code") != 200:
                raise RuntimeError(f"createTask error: {data}")
            return data["data"]["taskId"]

    async def poll_task(self, task_id: str) -> list[str]:
        deadline = asyncio.get_event_loop().time() + self._poll_timeout
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            while asyncio.get_event_loop().time() < deadline:
                r = await c.get(f"{self.RECORD_URL}?taskId={task_id}",
                                headers=self._headers())
                r.raise_for_status()
                d = r.json().get("data") or {}
                state = d.get("state")
                if state == "success":
                    rj = d.get("resultJson") or "{}"
                    parsed = json.loads(rj) if isinstance(rj, str) else rj
                    urls = parsed.get("resultUrls") or []
                    if not urls:
                        raise RuntimeError(f"success without urls: {d}")
                    return urls
                if state == "fail":
                    raise KieTaskFailed(
                        f"{d.get('failCode')}: {d.get('failMsg')}"
                    )
                await asyncio.sleep(self._poll_interval)
        raise TimeoutError(f"poll timeout for task {task_id}")

    async def download(self, url: str, dest: Path) -> None:
        async with httpx.AsyncClient(timeout=self._timeout * 3) as c:
            r = await c.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)

    async def upload_file(self, path: Path, remote_dir: str = "torah-tai-chi") -> str:
        """Upload via base64 endpoint, return downloadUrl."""
        import base64
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        mime = "image/png" if path.suffix == ".png" else "application/octet-stream"
        payload = {
            "base64Data": f"data:{mime};base64,{b64}",
            "uploadPath": remote_dir,
            "fileName": path.name,
        }
        url = "https://kieai.redpandaai.co/api/file-base64-upload"
        async with httpx.AsyncClient(timeout=self._timeout * 2) as c:
            r = await c.post(url, headers=self._headers(), json=payload)
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"upload failed: {data}")
            return data["data"]["downloadUrl"]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/pytest tests/test_kie_client.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/kie_client.py tests/test_kie_client.py pyproject.toml pytest.ini
git commit -m "feat(kie_client): shared async Kie.ai HTTP client (create/poll/upload/download)"
```

---

## Task 5: `script_generator` — Claude → ClipPlan

**Files:**
- Create: `src/script_generator.py`
- Create: `tests/test_script_generator.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_script_generator.py
import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from src.script_generator import transform_draft_to_clip_plan, build_prompt
from src.models import ClipPlan


def test_build_prompt_includes_parsha_and_draft():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.\n[TEACHING]\nListen first.",
        target_duration=75, clip_count=8,
    )
    assert "Vayikra" in prompt
    assert "[HOOK]" in prompt
    assert "He called." in prompt
    assert "75" in prompt


@pytest.mark.asyncio
async def test_transform_draft_parses_claude_response():
    fake_json = {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "clips": [
            {"index": 0, "voiceover": "hi", "visual_prompt": "Rav Eli", "duration_s": 8}
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_json))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    plan = await transform_draft_to_clip_plan(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="modern", title="t",
        draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
        client=mock_client,
    )
    assert isinstance(plan, ClipPlan)
    assert plan.parsha == "Vayikra"
    assert plan.clips[0].duration_s == 8
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/pytest tests/test_script_generator.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement module**

```python
# src/script_generator.py
from __future__ import annotations
import json
from src.models import ClipPlan


SYSTEM = """You transform approved Torah Tai Chi draft scripts into structured
ClipPlans for video generation.

HARD RULES:
- The draft script is written by Yonah (brand voice, already approved). DO NOT
  rewrite, paraphrase, or add content. Only split the exact words into clip-sized
  voiceover beats and add visual prompts.
- The draft uses section markers like [HOOK], [TEACHING], [APPLICATION], [CTA].
  Use them as natural clip boundaries, but you may split a long section into
  multiple clips if needed to respect the 4-10s per-clip guidance.
- Preserve the order of the draft. Do not skip content.

VISUAL DIRECTION per clip:
- Subject is always Rav Eli (Pixar-style 3D animated character; reference images
  lock his appearance — do NOT describe him in prompts).
- Vary angle/pose/setting across clips: garden, dojo, hillside, wooden room, close-up.
- Prefer motion over static: walking, gesturing, mid-tai-chi form.
- Match the visual to the voiceover's mood (contemplative, energetic, practice-oriented).
- Each clip 4-10 seconds. Aim for 6-9 clips total. Sum to ~60-90s.

OUTPUT: JSON only, no commentary, no markdown fences, matching this schema exactly:
{
  "parsha": "<name>",
  "hook": "<first line of draft's [HOOK] section>",
  "full_script": "<the original draft with section markers stripped>",
  "clips": [
    {"index": 0, "voiceover": "<exact words from draft>", "visual_prompt": "<scene>", "duration_s": <int 4-15>}
  ]
}
"""


def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str,
                 target_duration: int = 75, clip_count: int = 8) -> str:
    return (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n"
        f"TARGET DURATION: {target_duration}s\n"
        f"CLIP COUNT: {clip_count} (±1)\n\n"
        f"DRAFT SCRIPT (preserve wording exactly):\n---\n{draft}\n---\n\n"
        "Produce the ClipPlan JSON now."
    )


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    client, target_duration: int = 75, clip_count: int = 8,
    model: str = "claude-opus-4-6",
) -> ClipPlan:
    prompt = build_prompt(parsha_name, book, option, style_note,
                          title, draft, target_duration, clip_count)
    msg = await client.messages.create(
        model=model,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    # Claude may wrap in ```json fences; strip if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    data = json.loads(raw)
    return ClipPlan(**data)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/pytest tests/test_script_generator.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(script_generator): Claude → ClipPlan with schema validation"
```

---

## Task 6: `video_generator` — Per-Clip Seedance 2.0

**Files:**
- Create: `src/video_generator.py`
- Create: `tests/test_video_generator.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_video_generator.py
import pytest
from pathlib import Path
from src.video_generator import build_seedance_input, STYLE_LOCK
from src.models import Clip


def test_build_seedance_input_includes_voiceover_quoted():
    clip = Clip(index=0, voiceover="He called.", visual_prompt="Rav Eli in a garden.", duration_s=6)
    payload = build_seedance_input(clip, ref_urls=["https://x/a.png", "https://x/b.png"],
                                   audio_url=None, resolution="720P")
    assert '"He called."' in payload["prompt"]
    assert "Rav Eli in a garden" in payload["prompt"]
    assert STYLE_LOCK in payload["prompt"]
    assert payload["image_input"] == ["https://x/a.png", "https://x/b.png"]
    assert payload["duration"] == 6
    assert payload["resolution"] == "720P"


def test_build_seedance_input_with_audio_ref():
    clip = Clip(index=0, voiceover="x", visual_prompt="y", duration_s=5)
    payload = build_seedance_input(clip, ref_urls=["u"], audio_url="https://a/v.mp3",
                                   resolution="720P")
    assert payload["audio_input"] == ["https://a/v.mp3"]
    assert "@Audio1" in payload["prompt"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/pytest tests/test_video_generator.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement module**

```python
# src/video_generator.py
from __future__ import annotations
from pathlib import Path
from typing import Optional
from src.kie_client import KieClient
from src.models import Clip


STYLE_LOCK = (
    "Same character as in reference images: Pixar-style 3D animation, "
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, brown leather "
    "kippah, navy blue mandarin-collar athletic shirt with Torah Tai Chi "
    "yin-yang logo on chest. Soft 3D render, warm cinematic lighting. "
    "Character identity must match references exactly."
)

SEEDANCE_MODEL = "seedance-2-0"


def build_seedance_input(clip: Clip, ref_urls: list[str],
                         audio_url: Optional[str], resolution: str = "720P") -> dict:
    voice_clause = (
        f'Voice matches @Audio1 in timbre and delivery. '
        if audio_url else ""
    )
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f'Character speaks: "{clip.voiceover}"\n'
        f"{voice_clause}"
        f"{STYLE_LOCK}"
    )
    payload: dict = {
        "prompt": prompt,
        "image_input": ref_urls[:9],  # Seedance hard limit
        "duration": clip.duration_s,
        "resolution": resolution,
        "aspect_ratio": "9:16",
    }
    if audio_url:
        payload["audio_input"] = [audio_url]
    return payload


async def generate_clip(client: KieClient, clip: Clip, ref_urls: list[str],
                        dest: Path, audio_url: Optional[str] = None,
                        resolution: str = "720P") -> Path:
    payload = build_seedance_input(clip, ref_urls, audio_url, resolution)
    task_id = await client.create_task(SEEDANCE_MODEL, payload)
    urls = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/pytest tests/test_video_generator.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "feat(video_generator): Seedance 2.0 per-clip prompt builder + generation"
```

---

## Task 7: `stitcher` — FFmpeg Concat

**Files:**
- Create: `src/stitcher.py`
- Create: `tests/test_stitcher.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_stitcher.py
import pytest
import subprocess
from pathlib import Path
from src.stitcher import concat_clips


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    """Generate a tiny MP4 using ffmpeg's lavfi source."""
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_concat_clips_produces_expected_duration(tmp_path):
    c1 = tmp_path / "a.mp4"
    c2 = tmp_path / "b.mp4"
    _make_test_clip(c1, seconds=2, color="blue")
    _make_test_clip(c2, seconds=3, color="red")
    out = tmp_path / "out.mp4"

    result = concat_clips([c1, c2], out)

    assert result.exists()
    # Probe duration
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    assert 4.5 <= duration <= 5.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/pytest tests/test_stitcher.py -v`
Expected: FAIL with import error.

- [ ] **Step 3: Implement stitcher**

```python
# src/stitcher.py
from __future__ import annotations
import subprocess
import tempfile
from pathlib import Path


def concat_clips(clips: list[Path], dest: Path) -> Path:
    """Concatenate MP4 clips using ffmpeg concat demuxer.

    Assumes all clips share codec/dimensions (Seedance output is consistent).
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as f:
        for c in clips:
            # ffmpeg concat demuxer needs forward slashes + escaped quotes
            path_str = str(c.resolve()).replace("\\", "/")
            f.write(f"file '{path_str}'\n")
        list_file = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", list_file, "-c", "copy", str(dest),
        ], check=True, capture_output=True)
    finally:
        Path(list_file).unlink(missing_ok=True)
    return dest
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/Scripts/pytest tests/test_stitcher.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/stitcher.py tests/test_stitcher.py
git commit -m "feat(stitcher): ffmpeg concat demuxer for clip stitching"
```

---

## Task 8: `tools/generate.py` — CLI Orchestrator

**Files:**
- Create: `tools/generate.py`

This is the end-to-end orchestration. Not TDD'd as a unit — it's integration glue. Smoke-tested manually in Task 9.

- [ ] **Step 1: Write the CLI**

```python
# tools/generate.py
"""Torah Tai Chi video generator CLI.

Usage:
  py tools/generate.py --parsha Vayikra
"""
from __future__ import annotations
import argparse
import asyncio
import json
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

REFS_DIR = ROOT / "references"
PARSHIOT_PATH = ROOT / "parshiot.json"


async def upload_references(kie: KieClient) -> list[str]:
    """Upload all canonical reference images, return their Kie hosted URLs."""
    urls = []
    for img in sorted(REFS_DIR.glob("*.png")):
        print(f"  uploading ref: {img.name}")
        url = await kie.upload_file(img, remote_dir="torah-tai-chi/refs")
        urls.append(url)
    if not urls:
        raise SystemExit(f"No reference images in {REFS_DIR}")
    return urls[:9]  # Seedance hard limit


async def run(parsha_name: str, option: str, resolution: str) -> Path:
    from anthropic import AsyncAnthropic
    import json as _json

    load_dotenv(ROOT / ".env")
    anthropic_key = os.environ["ANTHROPIC_API_KEY"]
    kie_key = os.environ["KIE_AI_API_KEY"]

    run_slug = f"{time.strftime('%Y-%m-%d')}-{parsha_name.lower()}-{option.lower()}"
    work_dir = ROOT / "work" / run_slug
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Loading parsha: {parsha_name} (option {option})")
    # Look up parsha metadata (book) + selected script
    parshiot = _json.loads(PARSHIOT_PATH.read_text(encoding="utf-8"))["parshiot"]
    match = next((p for p in parshiot if p["name"].lower() == parsha_name.lower()), None)
    if not match:
        raise SystemExit(f"Parsha not found: {parsha_name}")
    book = match["book"]
    script = get_parsha_script(parsha_name, option, PARSHIOT_PATH)

    print(f"[2/5] Transforming draft into ClipPlan via Claude")
    anthropic = AsyncAnthropic(api_key=anthropic_key)
    plan = await transform_draft_to_clip_plan(
        parsha_name=parsha_name, book=book, option=option,
        style_note=script["style_note"], title=script["title"],
        draft=script["draft"], client=anthropic,
    )
    (work_dir / "plan.json").write_text(plan.model_dump_json(indent=2))
    print(f"      {len(plan.clips)} clips, total {plan.total_duration_s}s")

    print(f"[3/5] Uploading reference images to Kie.ai")
    kie = KieClient(api_key=kie_key)
    ref_urls = await upload_references(kie)
    print(f"      {len(ref_urls)} refs uploaded")

    print(f"[4/5] Generating {len(plan.clips)} clips via Seedance 2.0")
    clip_paths = []
    for clip in plan.clips:
        dest = work_dir / f"clip_{clip.index:02d}.mp4"
        print(f"      clip {clip.index}: {clip.duration_s}s — {clip.voiceover[:50]}...")
        await generate_clip(kie, clip, ref_urls, dest, resolution=resolution)
        clip_paths.append(dest)

    print(f"[5/5] Stitching clips")
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}.mp4"
    concat_clips(clip_paths, final)
    print(f"\nDONE: {final}")
    return final


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsha", required=True)
    ap.add_argument("--option", default="A", choices=["A", "B", "C"],
                    help="Which of Yonah's 3 script options to use")
    ap.add_argument("--resolution", default="720P", choices=["480P", "720P"])
    args = ap.parse_args()
    asyncio.run(run(args.parsha, args.option, args.resolution))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Commit**

```bash
git add tools/generate.py
git commit -m "feat(cli): tools/generate.py end-to-end orchestrator"
```

---

## Task 9: First Real Run (Vayikra)

**Files:** None created. This is validation.

- [ ] **Step 1: Verify prerequisites**

```bash
ls references/              # should show 6-9 canonical PNGs
cat parshiot.json | head    # should show parshiot array
grep -E "^(KIE_AI|ANTHROPIC)" .env   # both keys present
ffmpeg -version             # ffmpeg on PATH
```

If any fails, address before proceeding.

- [ ] **Step 2: Run the pipeline**

Run: `.venv/Scripts/py tools/generate.py --parsha Vayikra`
Expected: progress output through all 5 stages, final "DONE: output/vayikra.mp4" message. Runtime ~15-25 minutes.

- [ ] **Step 3: Inspect artifacts**

- `work/<date>-vayikra/plan.json` — readable, correct structure, Torah + Tai Chi content makes sense
- `work/<date>-vayikra/clip_*.mp4` — each clip plays, shows Rav Eli, audio present
- `output/vayikra.mp4` — stitched final video plays end-to-end

- [ ] **Step 4: Yonah review**

Send `output/vayikra.mp4` to Yonah. Collect notes on:
- Character consistency across clips
- Voice consistency
- Teaching quality (Torah + Tai Chi content)
- Pacing / transitions

- [ ] **Step 5: Commit the run artifacts (optional)**

If the run is good enough to keep:
```bash
git add work/<date>-vayikra/plan.json output/vayikra.mp4
git commit -m "poc: first Vayikra run artifacts"
```

---

## Task 10: Phase 1 Completion Gate — 3 Parshiot

**Files:** None created.

- [ ] **Step 1: Run two more parshiot**

```bash
py tools/generate.py --parsha Bereshit
py tools/generate.py --parsha Shemot
```

- [ ] **Step 2: Review all three videos together**

Open `output/vayikra.mp4`, `output/bereshit.mp4`, `output/shemot.mp4` side-by-side. Check:
- Rav Eli looks like the same character across *different* videos (week-over-week drift is the real concern)
- Voice stays the same across different videos
- Style stays Pixar-3D, not drifting photorealistic

- [ ] **Step 3: Decision point**

- If all three look good → Phase 1 done. Move to Phase 2 (social post generation) planning.
- If character drifts across videos → revisit reference set (reduce to 6 strongest, or regenerate with different shots).
- If voice drifts → implement Phase 1.5: generate a locked 15-second voice sample, upload to Kie.ai, pass as `@Audio1` on every clip.

---

## Deferred / Nice-to-Have (not in this plan)

- `--only-clip N` resume flag
- `--dry-run` mode that skips API calls and prints the prompt
- Per-clip JSON cache to skip regenerating identical clips
- Parallel clip generation (respect Kie.ai rate limits)
- Structured logging instead of print statements

These add value but aren't required for the POC success criteria. Deferred unless the first runs surface a specific need.
