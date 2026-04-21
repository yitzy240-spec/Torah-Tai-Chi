# Tai Chi Move Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an optional "Add tai chi move" picker on the script card and compose page so Yonah can feature one of the 27 library moves in a generated video; plumb the selection through the pipeline so Claude directs one DOJO clip around the move and Seedance receives the reference video for that clip.

**Architecture:** Picker is a reusable client sheet (`<TaiChiMovePicker>`) that reads from a new `tai_chi_moves` Supabase table (one-time synced from `references/tai_chi_moves/`). Selection persists on `scripts.motion_ref_slug` (parsha path) or directly on `jobs.motion_ref_slug` (topic path). Modal pipeline reads `jobs.motion_ref_slug`, passes the full move sidecar to the clip-plan generator, and routes the reference video URL to exactly one clip's Seedance call. Voiceover is preserved on the ref'd clip via a motion-study-only prompt addendum.

**Tech Stack:** Python 3.12 + pydantic + pytest (pipeline); Next.js 16 + Supabase + React 19 + TypeScript (dashboard); Seedance 2.0 via Kie.ai; ffprobe for duration validation.

**Spec:** [docs/superpowers/specs/2026-04-21-tai-chi-move-picker-design.md](../specs/2026-04-21-tai-chi-move-picker-design.md)

---

## File Structure

**Created:**
- `tools/sync_moves_to_supabase.py` — one-time filesystem → Supabase sync
- `dashboard/supabase/migrations/20260421_tai_chi_moves.sql` — new table + three new nullable columns
- `dashboard/src/app/api/tai-chi-moves/route.ts` — GET route returning the library to the picker
- `dashboard/src/app/actions/add-move-to-script.ts` — server action to persist a script's move pick
- `dashboard/src/components/tai-chi-move-picker.tsx` — reusable picker sheet

**Modified:**
- `src/models.py` — add `Clip.motion_ref_slug`; add ClipPlan validator for "at most one"
- `src/video_generator.py` — accept `reference_video_url` on `build_seedance_input` and `generate_clip`
- `src/script_generator.py` — accept `selected_move` param and append system-prompt block
- `modal_app.py` — read `jobs.motion_ref_slug`, pass through, set `clips.motion_ref_url`
- `tools/test_seedance_ref.py` — add `--with-voiceover` mode for risk validation
- `tests/test_models.py` — tests for new `motion_ref_slug` field + validator
- `tests/test_video_generator.py` — tests for `reference_video_url` parameter
- `tests/test_script_generator.py` — test the new system-prompt block
- `dashboard/src/app/actions/trigger-generation.ts` — copy `scripts.motion_ref_slug` → `jobs.motion_ref_slug`
- `dashboard/src/app/api/compose/generate-video/route.ts` — accept + persist optional `moveSlug`
- `dashboard/src/components/script-carousel.tsx` — wire `[Add tai chi move]` action on ScriptCard
- `dashboard/src/app/compose/ai-video-panel.tsx` — wire picker above topic generate button
- `dashboard/src/app/page.tsx` — include `motion_ref_slug` in the scripts Supabase select
- `dashboard/src/app/videos/[slug]/page.tsx` — include `motion_ref_slug` in the scripts Supabase select

---

## Phase 0 — De-risk the voiceover + motion-reference interaction

The test harness (`tools/test_seedance_ref.py`) validated reference videos with a **silent** style lock. Production clips have voiceover. We must confirm that adding `reference_video_urls` to a voice-enabled Seedance call does not produce lip-sync artifacts or mute the character before building the rest of the feature. Cost: ~$1 per run.

### Task 1: Extend the standalone harness with voiceover mode

**Files:**
- Modify: `tools/test_seedance_ref.py`

- [ ] **Step 1: Add `--voiceover TEXT` CLI flag to `parse_args`**

```python
p.add_argument("--voiceover", type=str, default=None,
               help="When set, use the production-style voice-enabled prompt "
                    "and have Rav Eli speak this line while performing the move. "
                    "Validates that reference_video_urls does not break lip sync.")
```

- [ ] **Step 2: Branch `build_prompt` on voiceover presence**

Replace the existing `build_prompt` signature with:

```python
def build_prompt(sidecar: dict, voiceover: str | None = None) -> str:
    english = sidecar["english"]
    pinyin = sidecar.get("pinyin", "")
    visual = sidecar["visual"]
    motion = sidecar["motion_description"]

    if voiceover is None:
        # Original silent-demo path
        style = TAI_CHI_STYLE_LOCK
        voice_line = ""
    else:
        # Production-style: import and reuse the voice-enabled lock
        from src.settings import STYLE_LOCK
        style = STYLE_LOCK
        voice_line = (
            f'\nCharacter speaks: "{voiceover}"\n'
            f"Rav Eli speaks this line naturally while performing the move. "
            f"Mouth moves with the words; facial expression warm and engaged. "
            f"The reference video is a silent motion study — use it for tempo, "
            f"trajectory, and stance only. Do NOT mute the character or freeze "
            f"his face.\n"
        )

    return (
        f"Rav Eli performs the tai chi move {english} ({pinyin}) in a quiet "
        f"dojo with warm morning light. The posture: {visual} The motion: "
        f"{motion} Slow, deliberate, meditative pace. Upright spine, relaxed "
        f"shoulders.\n\n"
        f"{voice_line}"
        f"Use the reference video to mirror the tempo, trajectory, and "
        f"stance of the core motion precisely, adapted to Rav Eli's body. "
        f"IMPORTANT: the reference video may cut before the move fully "
        f"resolves. Continue the motion past that cutoff and complete the "
        f"move -- bring the body back to a centered, balanced stance with "
        f"weight evenly distributed and arms settling to a natural resting "
        f"position. Over the full 10 seconds the clip should show the move "
        f"begin, complete its core motion, and settle cleanly. No freeze "
        f"mid-motion at the end.\n\n"
        f"{style}\n\n"
        f"Composition: 9:16 vertical, full body framed head to foot with a "
        f"touch of headroom."
    )
```

- [ ] **Step 3: Thread `voiceover` through `run_test` and `main`**

Change the `run_test` signature and body:

```python
async def run_test(slug: str, resolution: str = "480p",
                   duration: int = 10,
                   output_dir: Optional[Path] = None,
                   voiceover: Optional[str] = None) -> Path:
    # ... existing setup ...
    prompt = build_prompt(sidecar, voiceover=voiceover)
    # ... rest unchanged, but change output filename if voiceover is set:
    suffix = "_with_voiceover" if voiceover else ""
    out = output_dir / f"ref_test_{slug}{suffix}.mp4"
```

In `main`:

```python
out = asyncio.run(run_test(
    slug=args.slug,
    resolution=args.resolution,
    duration=args.duration,
    output_dir=args.output_dir,
    voiceover=args.voiceover,
))
```

- [ ] **Step 4: Commit**

```bash
git add tools/test_seedance_ref.py
git commit -m "feat(tai-chi-refs): add --voiceover mode for ref+voice validation"
```

- [ ] **Step 5: Run the validation generation**

Use a realistic production-style voiceover line in English plus a Hebrew phonetic — that's the case most likely to break. The `white_crane_spreads_wings` clip has clean open motion, good for watching.

```bash
python -m tools.test_seedance_ref \
  --slug white_crane_spreads_wings \
  --duration 10 \
  --resolution 480p \
  --voiceover "Like the white crane spreading its wings, we rise rooted, grounded in what does not move."
```

Expected: ~3-minute wait, one MP4 in `work/seedance_ref_tests/ref_test_white_crane_spreads_wings_with_voiceover.mp4`.

- [ ] **Step 6: Watch the output and decide gate**

Open the MP4. Confirm ALL four properties:

1. Rav Eli speaks the voiceover line audibly.
2. His mouth moves in sync with the words (no mute + motion, no talking + frozen face).
3. The white-crane motion is recognizable against the reference clip at `references/tai_chi_moves/white_crane_spreads_wings.mp4`.
4. The motion resolves (body settles, no freeze mid-motion).

If all four pass → proceed to Task 2.

If ANY fail → iterate on the `voice_line` wording in `build_prompt` (Step 2) and re-run until all four pass before proceeding. Do not build the rest of the picker on a broken foundation.

- [ ] **Step 7: Record the validation outcome in the spec**

Append to `docs/superpowers/specs/2026-04-21-tai-chi-move-picker-design.md` under "Risks":

```markdown
## Validation notes

**Task 1 outcome ({{DATE}}):** Ran voiceover + reference test with "{{voiceover line used}}" on {{slug}}. Result: {{PASS / iterated N times}}. Final `voice_line` wording now lives in `src/video_generator.py`'s addendum. Output at `work/seedance_ref_tests/ref_test_{{slug}}_with_voiceover.mp4`.
```

Fill the double-brace placeholders with the actual outcome. Commit:

```bash
git add docs/superpowers/specs/2026-04-21-tai-chi-move-picker-design.md
git commit -m "docs(tai-chi-picker): record voiceover+ref validation outcome"
```

---

## Phase 1 — Data infrastructure

### Task 2: Supabase migration — `tai_chi_moves` table + new columns

**Files:**
- Create: `dashboard/supabase/migrations/20260421_tai_chi_moves.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Tai chi reference-library table: mirrors references/tai_chi_moves/ on disk.
-- Populated via tools/sync_moves_to_supabase.py — the filesystem is the
-- source of truth; this table is a Supabase-accessible cache for the
-- dashboard picker and the Modal pipeline.
create table if not exists tai_chi_moves (
  slug               text primary key,
  english            text not null,
  pinyin             text not null,
  section            text not null,
  visual             text not null,
  motion_description text not null,
  mp4_storage_path   text not null,
  duration_s         int not null check (duration_s > 0 and duration_s <= 15),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists tai_chi_moves_section_idx on tai_chi_moves(section);

-- Yonah's optional pick persists on the script row so it survives reloads
-- and is reused across regenerations of the same script.
alter table scripts
  add column if not exists motion_ref_slug text references tai_chi_moves(slug)
    on delete set null;

-- Copied onto the job at trigger time (parsha path) or set directly by the
-- compose route (topic path). Single source of truth for the Modal worker.
alter table jobs
  add column if not exists motion_ref_slug text references tai_chi_moves(slug)
    on delete set null;

-- Set by the pipeline on the ONE clip that actually consumed the reference
-- video — provides an audit trail of which clip got the demo.
alter table clips
  add column if not exists motion_ref_url text;

-- RLS: match the pattern used in 0001_slice1_schema.sql. Reference-data
-- table, authenticated-read-only. tools/sync_moves_to_supabase.py runs
-- with the service-role key, which bypasses RLS.
alter table tai_chi_moves enable row level security;

create policy "authed read tai_chi_moves" on tai_chi_moves
  for select using (auth.role() = 'authenticated');

-- FK-side indexes so ON DELETE SET NULL and reverse lookups don't seq-scan
-- scripts/jobs. Partial on NOT NULL because the column is null for most rows.
create index if not exists scripts_motion_ref_slug_idx
  on scripts(motion_ref_slug) where motion_ref_slug is not null;
create index if not exists jobs_motion_ref_slug_idx
  on jobs(motion_ref_slug) where motion_ref_slug is not null;
```

- [ ] **Step 2: Apply the migration**

Local (if Supabase CLI is set up): `supabase db push`.

Remote: paste the SQL into the Supabase SQL editor for the production project and run.

Verify in the SQL editor:

```sql
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'tai_chi_moves';
select column_name from information_schema.columns where table_name = 'scripts' and column_name = 'motion_ref_slug';
select column_name from information_schema.columns where table_name = 'jobs' and column_name = 'motion_ref_slug';
select column_name from information_schema.columns where table_name = 'clips' and column_name = 'motion_ref_url';
```

Expected: `tai_chi_moves` has 10 columns; each of the three ALTER columns reports exactly one row.

- [ ] **Step 3: Commit**

```bash
git add dashboard/supabase/migrations/20260421_tai_chi_moves.sql
git commit -m "feat(db): tai_chi_moves table + motion_ref columns on scripts/jobs/clips"
```

### Task 3: Sync script — filesystem → Supabase

**Files:**
- Create: `tools/sync_moves_to_supabase.py`

- [ ] **Step 1: Write the sync script**

```python
"""One-time sync of references/tai_chi_moves/ into Supabase.

Walks every *.json sidecar. For each sidecar:
  1. Confirms the paired *.mp4 exists.
  2. Probes the mp4 duration with ffprobe; skip if > 15s.
  3. Uploads the mp4 to the `videos` bucket at tai_chi_moves/<slug>.mp4 (upsert).
  4. Upserts a tai_chi_moves row with sidecar fields + storage path + duration.

Usage:
    python -m tools.sync_moves_to_supabase

Re-run whenever new moves land. Idempotent.

Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
(service role because we're uploading to storage from outside auth).
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"
BUCKET = "videos"
STORAGE_PREFIX = "tai_chi_moves"


def probe_duration_seconds(mp4: Path) -> float:
    """Return duration of an mp4 in seconds, via ffprobe."""
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(mp4),
        ],
        text=True,
    )
    return float(out.strip())


def sync_one(sb, sidecar_path: Path) -> tuple[str, str]:
    """Sync one sidecar + its paired mp4. Returns (slug, outcome_label)."""
    slug = sidecar_path.stem
    mp4 = sidecar_path.with_suffix(".mp4")
    if not mp4.exists():
        return slug, "skipped: no mp4"

    duration = probe_duration_seconds(mp4)
    if duration > 15.0:
        return slug, f"skipped: duration {duration:.1f}s > 15s"
    duration_s = max(1, int(round(duration)))

    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    # sidecar requires: english, pinyin, section, visual, motion_description
    for key in ("english", "pinyin", "section", "visual", "motion_description"):
        if key not in sidecar:
            return slug, f"skipped: sidecar missing '{key}'"

    storage_path = f"{STORAGE_PREFIX}/{slug}.mp4"

    with open(mp4, "rb") as f:
        sb.storage.from_(BUCKET).upload(
            storage_path, f.read(),
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )

    sb.table("tai_chi_moves").upsert({
        "slug": slug,
        "english": sidecar["english"],
        "pinyin": sidecar["pinyin"],
        "section": sidecar["section"],
        "visual": sidecar["visual"],
        "motion_description": sidecar["motion_description"],
        "mp4_storage_path": storage_path,
        "duration_s": duration_s,
        "updated_at": "now()",
    }).execute()

    return slug, f"synced ({duration_s}s)"


def main() -> int:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    sidecars = sorted(LIBRARY_ROOT.glob("*.json"))
    if not sidecars:
        print(f"No sidecars in {LIBRARY_ROOT}", file=sys.stderr)
        return 1

    print(f"Syncing {len(sidecars)} sidecar(s)...")
    synced = 0
    skipped = 0
    for sidecar in sidecars:
        slug, outcome = sync_one(sb, sidecar)
        print(f"  {slug:40s}  {outcome}")
        if outcome.startswith("synced"):
            synced += 1
        else:
            skipped += 1

    print(f"\nDone: {synced} synced, {skipped} skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify ffprobe is available**

```bash
ffprobe -version
```

Expected: prints version info. If not installed, install ffmpeg (ffprobe ships with it).

- [ ] **Step 3: Run the sync**

```bash
python -m tools.sync_moves_to_supabase
```

Expected: ~27 "synced" lines, 0 skipped (given the current library state).

- [ ] **Step 4: Verify via SQL**

In the Supabase SQL editor:

```sql
select count(*) from tai_chi_moves;
select slug, section, duration_s from tai_chi_moves order by section, english limit 5;
```

Expected: count matches sidecar count; rows look sensible.

Also verify one storage upload worked:

```sql
select * from storage.objects
  where bucket_id = 'videos'
    and name like 'tai_chi_moves/%'
  limit 5;
```

- [ ] **Step 5: Commit**

```bash
git add tools/sync_moves_to_supabase.py
git commit -m "feat(tai-chi-refs): one-time sync of move library into Supabase"
```

---

## Phase 2 — Python pipeline plumbing

### Task 4: `Clip.motion_ref_slug` + ClipPlan "at most one" validator

**Files:**
- Modify: `src/models.py`
- Modify: `tests/test_models.py`

- [ ] **Step 1: Write failing tests in `tests/test_models.py`**

Append to the existing file:

```python
def test_clip_motion_ref_slug_defaults_none():
    c = _dojo_clip(0)
    assert c.motion_ref_slug is None


def test_clip_accepts_motion_ref_slug():
    c = Clip(index=0, voiceover="x", visual_prompt="y", duration_s=6,
             setting_id="DOJO", motion_ref_slug="white_crane_spreads_wings")
    assert c.motion_ref_slug == "white_crane_spreads_wings"


def test_clipplan_allows_exactly_one_motion_ref_clip():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        captions=_captions(),
        clips=[
            Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8,
                 setting_id="DOJO", motion_ref_slug="white_crane_spreads_wings"),
            _dojo_clip(1),
            _outdoor_clip(2, "GARDEN_PATH"),
            _outdoor_clip(3, "GARDEN_PATH"),
        ],
    )
    refs = [c.motion_ref_slug for c in plan.clips if c.motion_ref_slug]
    assert refs == ["white_crane_spreads_wings"]


def test_clipplan_rejects_two_motion_ref_clips():
    with pytest.raises(ValidationError, match="motion_ref_slug"):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            captions=_captions(),
            clips=[
                Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8,
                     setting_id="DOJO", motion_ref_slug="white_crane_spreads_wings"),
                Clip(index=1, voiceover="c", visual_prompt="d", duration_s=8,
                     setting_id="DOJO", motion_ref_slug="brush_knee_and_push"),
                _outdoor_clip(2, "GARDEN_PATH"),
                _outdoor_clip(3, "GARDEN_PATH"),
            ],
        )


def test_clipplan_allows_zero_motion_ref_clips():
    # Sanity: none of the existing tests broke — a plan with no motion_ref is fine.
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        captions=_captions(),
        clips=[
            _dojo_clip(0), _dojo_clip(1),
            _outdoor_clip(2, "GARDEN_PATH"), _outdoor_clip(3, "GARDEN_PATH"),
        ],
    )
    assert all(c.motion_ref_slug is None for c in plan.clips)
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pytest tests/test_models.py -v -k "motion_ref"
```

Expected: 4 failures ("motion_ref_slug" not a valid field, validator not present).

- [ ] **Step 3: Add the field and validator in `src/models.py`**

In the `Clip` class, right after the existing `motion_ref_url` field, add:

```python
    motion_ref_slug: str | None = None
```

In `ClipPlan._check_structure` (after the existing body structure checks, before the total-duration check), insert:

```python
        n_motion_refs = sum(1 for c in self.clips if c.motion_ref_slug is not None)
        if n_motion_refs > 1:
            raise ValueError(
                f"ClipPlan has {n_motion_refs} clips with motion_ref_slug set; "
                f"at most one clip may carry a motion reference"
            )
```

- [ ] **Step 4: Run the full models test suite**

```bash
pytest tests/test_models.py -v
```

Expected: all pass, including the 4 new cases and all prior ones.

- [ ] **Step 5: Commit**

```bash
git add src/models.py tests/test_models.py
git commit -m "feat(models): add Clip.motion_ref_slug + ClipPlan 'at most one' validator"
```

### Task 5: `generate_clip` accepts a reference video URL

**Files:**
- Modify: `src/video_generator.py`
- Modify: `tests/test_video_generator.py`

- [ ] **Step 1: Write failing tests in `tests/test_video_generator.py`**

Append to the file:

```python
def test_build_seedance_input_with_reference_video_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=["https://x/d0.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
        reference_video_url="https://supabase/videos/tai_chi_moves/x.mp4",
    )
    assert payload["reference_video_urls"] == [
        "https://supabase/videos/tai_chi_moves/x.mp4"
    ]
    assert "motion study" in payload["prompt"].lower()
    assert "silent" in payload["prompt"].lower()
    assert "do not mute" in payload["prompt"].lower() or "do not freeze" in payload["prompt"].lower()
    # Voiceover must still be in the prompt — the ref does not replace speech.
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_without_reference_video_url_omits_field():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "reference_video_urls" not in payload
    assert "motion study" not in payload["prompt"].lower()
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
pytest tests/test_video_generator.py -v -k "reference_video"
```

Expected: 1 failure (parameter not accepted); 1 pass if it only asserts absence. Both should fail or one may error — proceed either way.

- [ ] **Step 3: Modify `build_seedance_input` and `generate_clip` in `src/video_generator.py`**

Replace the existing `build_seedance_input` function with:

```python
def build_seedance_input(
    clip: Clip,
    character_ref_urls: list[str],
    dojo_ref_urls: list[str],
    first_frame_url: Optional[str],
    audio_url: Optional[str],
    resolution: str = "720p",
    reference_video_url: Optional[str] = None,
) -> dict:
    voice_clause = "Voice matches @Audio1 in timbre and delivery. " if audio_url else ""
    motion_addendum = (
        "\n\nUse the reference video as a motion study — mirror the tempo, "
        "trajectory, and stance of the core tai chi motion precisely, adapted "
        "to Rav Eli's body. The reference is silent; Rav Eli continues to "
        "speak the voiceover line naturally throughout — do not mute him or "
        "freeze his face. If the reference video cuts before the move "
        "resolves, continue past that cutoff and settle the body back to "
        "center.\n"
        if reference_video_url else ""
    )
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f'Character speaks: "{clip.voiceover}"\n'
        f"{voice_clause}"
        f"{STYLE_LOCK}"
        f"{motion_addendum}"
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
    if reference_video_url:
        payload["reference_video_urls"] = [reference_video_url]
    return payload
```

Replace the existing `generate_clip` signature + payload call with:

```python
async def generate_clip(
    client: KieClient, clip: Clip,
    character_ref_urls: list[str], dojo_ref_urls: list[str],
    dest: Path,
    first_frame_url: Optional[str] = None,
    audio_url: Optional[str] = None,
    resolution: str = "720p",
    model: str = SEEDANCE_MODEL,
    reference_video_url: Optional[str] = None,
) -> Path:
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
        reference_video_url=reference_video_url,
    )
    task_id = await client.create_task(model, payload)
    urls = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest
```

**Important:** the motion-study wording MUST match what Phase 0 validated. If the Task 1 validation ended up with iterated wording, replace the `motion_addendum` string above to match the Phase 0 final wording verbatim.

- [ ] **Step 4: Run the full video_generator test suite**

```bash
pytest tests/test_video_generator.py -v
```

Expected: all pass, including the 2 new cases and all 7 prior ones.

- [ ] **Step 5: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "feat(video-gen): reference_video_url parameter + motion-study addendum"
```

### Task 6: `transform_draft_to_clip_plan` accepts `selected_move`

**Files:**
- Modify: `src/script_generator.py`
- Modify: `tests/test_script_generator.py`

- [ ] **Step 1: Write failing test**

Append to `tests/test_script_generator.py`:

```python
def test_build_prompt_without_selected_move_has_no_featured_block():
    from src.script_generator import build_prompt
    prompt = build_prompt(
        parsha_name="X", book="Y", option="A",
        style_note="", title="t", draft="draft text",
    )
    assert "FEATURED TAI CHI MOVE" not in prompt


def test_build_prompt_with_selected_move_appends_featured_block():
    from src.script_generator import build_prompt
    move = {
        "slug": "white_crane_spreads_wings",
        "english": "White Crane Spreads Its Wings",
        "pinyin": "Báihè Liàngchì",
        "visual": "stands on right leg, left toe touching, right hand above head",
        "motion_description": "torso rotates 90 degrees to the left as weight shifts onto the right leg...",
    }
    prompt = build_prompt(
        parsha_name="X", book="Y", option="A",
        style_note="", title="t", draft="draft text",
        selected_move=move,
    )
    assert "FEATURED TAI CHI MOVE" in prompt
    assert "White Crane Spreads Its Wings" in prompt
    assert "Báihè Liàngchì" in prompt
    assert "torso rotates" in prompt
    assert "motion_ref_slug" in prompt
    assert "white_crane_spreads_wings" in prompt
    assert "exactly ONE" in prompt.lower() or "exactly one" in prompt
```

- [ ] **Step 2: Run the failing tests**

```bash
pytest tests/test_script_generator.py -v -k "selected_move or featured_block"
```

Expected: failures — `build_prompt` doesn't accept `selected_move` yet.

- [ ] **Step 3: Modify `build_prompt` and `transform_draft_to_clip_plan` in `src/script_generator.py`**

Replace `build_prompt` with:

```python
def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str,
                 selected_move: dict | None = None) -> str:
    base = (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n\n"
        f"DRAFT SCRIPT (preserve wording exactly — you split it, you do not rewrite it):\n"
        f"---\n{draft}\n---\n\n"
    )
    featured = ""
    if selected_move is not None:
        featured = (
            "FEATURED TAI CHI MOVE (Yonah selected this):\n"
            f"- Name: {selected_move['english']} ({selected_move['pinyin']})\n"
            f"- Posture: {selected_move['visual']}\n"
            f"- Motion: {selected_move['motion_description']}\n\n"
            "Pick exactly ONE dojo clip whose voiceover best pairs thematically "
            "with this move. In that clip's visual_prompt, write Rav Eli performing "
            "this move as the primary physical action, weaving the motion "
            "description into your scene direction naturally (don't paste it "
            "verbatim — direct the scene with it). Keep the voiceover as Yonah's "
            "words, unchanged. On that clip only, emit an extra field: "
            f'"motion_ref_slug": "{selected_move["slug"]}". All other dojo clips '
            "continue as you'd direct them without a featured move.\n\n"
        )
    tail = (
        "Produce the ClipPlan JSON now. Remember: 3-8 clips, dojo first then "
        "outdoor, total 28-90 seconds based on natural sage pace (~2.3 wps). "
        "Include the full 'captions' object with all six platform variants "
        "(tiktok, instagram, youtube_title, youtube_description, facebook, "
        "twitter)."
    )
    return base + featured + tail
```

Replace `transform_draft_to_clip_plan`'s signature and body to accept `selected_move`:

```python
async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    api_key: str, model: str = "claude-opus-4-6",
    timeout_s: float = 180.0,
    selected_move: dict | None = None,
) -> ClipPlan:
    import httpx
    prompt = build_prompt(
        parsha_name, book, option, style_note, title, draft,
        selected_move=selected_move,
    )
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
                "max_tokens": 8000,
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

- [ ] **Step 4: Run the full script_generator test suite**

```bash
pytest tests/test_script_generator.py -v
```

Expected: all pass, including the 2 new cases.

- [ ] **Step 5: Commit**

```bash
git add src/script_generator.py tests/test_script_generator.py
git commit -m "feat(script-gen): selected_move param + FEATURED TAI CHI MOVE prompt block"
```

### Task 7: Wire `modal_app.py` to read the move and route it

**Files:**
- Modify: `modal_app.py`

Not unit-testable — `run_pipeline` is a full integration path. We verify via a real Modal deploy at the end of Phase 5.

- [ ] **Step 1: Update `run_pipeline` to read `motion_ref_slug` and look up the move row**

Locate the block in `run_pipeline` that reads the job row:

```python
job = (
    sb.table("jobs")
    .select("kind, parsha_id, script_id, topic")
    .eq("id", job_id)
    .single()
    .execute()
    .data
)
```

Change the `.select(...)` to include `motion_ref_slug`:

```python
job = (
    sb.table("jobs")
    .select("kind, parsha_id, script_id, topic, motion_ref_slug")
    .eq("id", job_id)
    .single()
    .execute()
    .data
)
```

- [ ] **Step 2: Add a helper function before `run_pipeline` to load the move**

Just after the `image = (...)` block and before `@app.function` decorators, add:

```python
def _load_selected_move(sb, slug: str | None) -> tuple[dict | None, str | None]:
    """Fetch the tai_chi_moves row for the given slug. Returns (move_dict, mp4_url).

    Returns (None, None) if slug is None or the row doesn't exist.
    """
    if not slug:
        return None, None
    row = (
        sb.table("tai_chi_moves")
        .select("slug, english, pinyin, visual, motion_description, mp4_storage_path")
        .eq("slug", slug)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        return None, None
    base = os.environ["SUPABASE_URL"]
    mp4_url = (
        f"{base}/storage/v1/object/public/videos/"
        f"{row['mp4_storage_path'].lstrip('/')}"
    )
    move_dict = {
        "slug": row["slug"],
        "english": row["english"],
        "pinyin": row["pinyin"],
        "visual": row["visual"],
        "motion_description": row["motion_description"],
    }
    return move_dict, mp4_url
```

- [ ] **Step 3: Load the move after the job row is read**

After the `kind = (job.get("kind") or "parsha").lower()` line and before the `work_dir = ...` line, add:

```python
        selected_move, motion_ref_mp4_url = _load_selected_move(
            sb, job.get("motion_ref_slug")
        )
```

- [ ] **Step 4: Pass `selected_move` to `transform_draft_to_clip_plan`**

Find the call:

```python
plan = asyncio.run(transform_draft_to_clip_plan(
    parsha_name=parsha_name, book=book,
    option=option, style_note=style_note,
    title=title, draft=draft_text,
    api_key=os.environ["ANTHROPIC_API_KEY"],
))
```

Change to:

```python
plan = asyncio.run(transform_draft_to_clip_plan(
    parsha_name=parsha_name, book=book,
    option=option, style_note=style_note,
    title=title, draft=draft_text,
    api_key=os.environ["ANTHROPIC_API_KEY"],
    selected_move=selected_move,
))
```

- [ ] **Step 5: Persist `motion_ref_slug` when inserting clip rows**

In the `for c in plan.clips: sb.table("clips").insert({...}).execute()` block, add `motion_ref_slug` to the insert payload:

```python
for c in plan.clips:
    sb.table("clips").insert({
        "job_id": job_id, "index": c.index, "voiceover": c.voiceover,
        "visual_prompt": c.visual_prompt, "setting_id": c.setting_id,
        "duration_s": c.duration_s,
        "motion_ref_slug": c.motion_ref_slug,
    }).execute()
```

(This requires `clips.motion_ref_slug` as a column — add it. See addendum at the end of Task 7.)

- [ ] **Step 6: Pass `reference_video_url` to the matching clip's `generate_clip` call**

In the `async def _one(clip):` inner function, change the `await generate_clip(...)` call:

```python
async def _one(clip):
    nonlocal completed
    dest = work_dir / f"clip_{clip.index:02d}.mp4"
    clip_ref_video_url = (
        motion_ref_mp4_url if clip.motion_ref_slug else None
    )
    await generate_clip(
        kie, clip,
        character_ref_urls=char_refs, dojo_ref_urls=dojo_refs,
        dest=dest, resolution="720p",
        reference_video_url=clip_ref_video_url,
    )
    async with lock:
        completed += 1
        set_status("generating_clips", f"Generating {completed} of {len(plan.clips)} clips")
    clip_update = {
        "mp4_path": f"internal/{dest.name}",
        "status": "done", "cost_usd": 1.20,
        "completed_at": "now()",
    }
    if clip_ref_video_url:
        clip_update["motion_ref_url"] = clip_ref_video_url
    sb.table("clips").update(clip_update).eq("job_id", job_id).eq("index", clip.index).execute()
    log_cost("clip", "kie", 1.20, f"clip {clip.index}")
    return dest
```

- [ ] **Step 7: Soft-fail warning when Claude ignores the featured move**

After the clip plan is generated and before the uploads block, add:

```python
        if selected_move is not None:
            ref_clips = [c for c in plan.clips if c.motion_ref_slug]
            if len(ref_clips) == 0:
                log_event(
                    sb,
                    actor="modal",
                    level="warn",
                    event="pipeline.motion_ref.ignored",
                    subject_type="job",
                    subject_id=job_id,
                    message=(
                        f"Move '{selected_move['slug']}' was selected but "
                        f"Claude's plan assigned it to zero clips. "
                        f"Video will generate without the reference video."
                    ),
                )
```

- [ ] **Step 8: Addendum migration — add `clips.motion_ref_slug`**

Task 2's migration added `clips.motion_ref_url`. We also need `clips.motion_ref_slug` so the insert in Step 5 doesn't fail. Create:

File: `dashboard/supabase/migrations/20260421_clips_motion_ref_slug.sql`

```sql
alter table clips
  add column if not exists motion_ref_slug text;
```

Apply it the same way as Task 2 (push or SQL editor). Verify:

```sql
select column_name from information_schema.columns
  where table_name = 'clips' and column_name = 'motion_ref_slug';
```

- [ ] **Step 9: Commit**

```bash
git add modal_app.py dashboard/supabase/migrations/20260421_clips_motion_ref_slug.sql
git commit -m "feat(modal): read motion_ref_slug, load move, route reference_video_url per clip"
```

---

## Phase 3 — Dashboard backend

### Task 8: `GET /api/tai-chi-moves` route

**Files:**
- Create: `dashboard/src/app/api/tai-chi-moves/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tai-chi-moves
 *
 * Returns the full tai chi reference library for the dashboard picker.
 * Ordered by section, then English name.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { data, error } = await supabase
    .from('tai_chi_moves')
    .select('slug, english, pinyin, section, mp4_storage_path, duration_s')
    .order('section', { ascending: true })
    .order('english', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const moves = (data ?? []).map((row) => ({
    slug: row.slug as string,
    english: row.english as string,
    pinyin: row.pinyin as string,
    section: row.section as string,
    duration_s: row.duration_s as number,
    mp4_url: `${base}/storage/v1/object/public/videos/${(row.mp4_storage_path as string).replace(/^\/+/, '')}`,
  }));

  return NextResponse.json({ moves });
}
```

- [ ] **Step 2: Smoke test the route**

Start the dev server:

```bash
cd dashboard && npm run dev
```

In another shell, log in via the dashboard UI first (so the auth cookie exists), then hit:

```bash
curl -s http://localhost:3000/api/tai-chi-moves -b "$(cat path-to-your-auth-cookie)" | head -80
```

Or visit the URL directly in the browser where you're logged in and view the JSON response.

Expected: `{"moves":[{"slug":"...", "english":"...", "mp4_url":"https://..."},...]}` with ~27 entries.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/api/tai-chi-moves/route.ts
git commit -m "feat(api): GET /api/tai-chi-moves returns library for picker"
```

### Task 9: `addMoveToScript` server action

**Files:**
- Create: `dashboard/src/app/actions/add-move-to-script.ts`

- [ ] **Step 1: Write the action**

```typescript
'use server';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Persist (or clear) the motion reference slug on a script row.
 *
 * Pass slug=null to remove a selection. Validates the slug against
 * tai_chi_moves so we never persist an orphan.
 */
export async function addMoveToScript({
  scriptId,
  slug,
  parshaSlug,
}: {
  scriptId: string;
  slug: string | null;
  /** Optional — used to revalidate the videos/[slug] detail page. */
  parshaSlug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  if (slug !== null) {
    const { data: move } = await supabase
      .from('tai_chi_moves')
      .select('slug')
      .eq('slug', slug)
      .maybeSingle();
    if (!move) return { ok: false, error: `Unknown move: ${slug}` };
  }

  const { error } = await supabase
    .from('scripts')
    .update({ motion_ref_slug: slug })
    .eq('id', scriptId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/');
  if (parshaSlug) revalidatePath(`/videos/${parshaSlug}`);

  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/actions/add-move-to-script.ts
git commit -m "feat(actions): addMoveToScript server action with tai_chi_moves validation"
```

### Task 10: `triggerGeneration` copies `scripts.motion_ref_slug` to `jobs.motion_ref_slug`

**Files:**
- Modify: `dashboard/src/app/actions/trigger-generation.ts`

- [ ] **Step 1: Read the script's motion_ref_slug before inserting the job**

In `triggerGeneration`, just after the idempotency check (the `.in('status', IN_PROGRESS_STATUSES)` block) and before the monthly-budget check, add:

```typescript
  // Read the script's optional motion reference so we can copy it onto
  // the job — Modal reads jobs.motion_ref_slug as the single source of
  // truth regardless of parsha vs topic origin.
  const { data: scriptRow } = await supabase
    .from('scripts')
    .select('motion_ref_slug')
    .eq('id', scriptId)
    .maybeSingle();
  const motionRefSlug = (scriptRow?.motion_ref_slug ?? null) as string | null;
```

- [ ] **Step 2: Include `motion_ref_slug` in the jobs insert**

Find the `.insert({...})` call and add the field:

```typescript
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      parsha_id: parshaId,
      script_id: scriptId,
      status: 'queued',
      triggered_by: user.id,
      resolution,
      model_tier: modelTier,
      motion_ref_slug: motionRefSlug,
    })
    .select('id').single();
```

- [ ] **Step 3: Typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/app/actions/trigger-generation.ts
git commit -m "feat(actions): triggerGeneration copies scripts.motion_ref_slug to jobs"
```

### Task 11: Compose `generate-video` route accepts optional `moveSlug`

**Files:**
- Modify: `dashboard/src/app/api/compose/generate-video/route.ts`

- [ ] **Step 1: Extend POST body parsing**

Locate this block in the POST handler:

```typescript
let body: { topic?: string };
try {
  body = await request.json();
} catch {
  return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
}
const topic = body.topic?.trim();
if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
if (topic.length > 2000) return NextResponse.json({ error: 'topic too long (max 2000 chars)' }, { status: 400 });
```

Change the body type + parse the optional `moveSlug`, validating it if present:

```typescript
let body: { topic?: string; moveSlug?: string | null };
try {
  body = await request.json();
} catch {
  return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
}
const topic = body.topic?.trim();
if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
if (topic.length > 2000) return NextResponse.json({ error: 'topic too long (max 2000 chars)' }, { status: 400 });

const moveSlugInput = body.moveSlug ?? null;
let validatedMoveSlug: string | null = null;
if (moveSlugInput !== null) {
  const { data: move } = await supabase
    .from('tai_chi_moves')
    .select('slug')
    .eq('slug', moveSlugInput)
    .maybeSingle();
  if (!move) {
    return NextResponse.json({ error: `Unknown move: ${moveSlugInput}` }, { status: 400 });
  }
  validatedMoveSlug = moveSlugInput;
}
```

- [ ] **Step 2: Include `motion_ref_slug` in the jobs insert**

Find the `.insert({ kind: 'topic', ... })` call and add the field:

```typescript
const { data: job, error: insertErr } = await supabase
  .from('jobs')
  .insert({
    kind: 'topic',
    topic,
    status: 'queued',
    triggered_by: user.id,
    resolution,
    model_tier: modelTier,
    motion_ref_slug: validatedMoveSlug,
  })
  .select('id').single();
```

- [ ] **Step 3: Typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/app/api/compose/generate-video/route.ts
git commit -m "feat(api): compose/generate-video accepts optional moveSlug"
```

---

## Phase 4 — Dashboard frontend

### Task 12: `<TaiChiMovePicker>` reusable sheet component

**Files:**
- Create: `dashboard/src/components/tai-chi-move-picker.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface TaiChiMove {
  slug: string;
  english: string;
  pinyin: string;
  section: string;
  duration_s: number;
  mp4_url: string;
}

interface Props {
  open: boolean;
  currentSlug: string | null;
  onSelect: (slug: string | null) => void;
  onClose: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  yang_24_form: 'Yang 24-form',
  basic_stances: 'Basic stances',
  chen_style: 'Chen-style',
  other: 'Other',
};

function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? SECTION_LABELS.other;
}

export function TaiChiMovePicker({ open, currentSlug, onSelect, onClose }: Props) {
  const [moves, setMoves] = useState<TaiChiMove[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(currentSlug);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => { setSelected(currentSlug); }, [currentSlug]);

  useEffect(() => {
    if (!open || moves !== null) return;
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setMoves(data.moves ?? []))
      .catch(() => setMoves([]));
  }, [open, moves]);

  // Lock body scroll when open.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = moves ?? [];
    if (!q) return list;
    return list.filter((m) =>
      m.english.toLowerCase().includes(q) || m.pinyin.toLowerCase().includes(q),
    );
  }, [moves, query]);

  const grouped = useMemo(() => {
    const bySection = new Map<string, TaiChiMove[]>();
    for (const m of filtered) {
      const arr = bySection.get(m.section) ?? [];
      arr.push(m);
      bySection.set(m.section, arr);
    }
    const sectionOrder = ['yang_24_form', 'basic_stances', 'chen_style'];
    const known = sectionOrder
      .filter((s) => bySection.has(s))
      .map((s) => [s, bySection.get(s)!] as const);
    const extras = [...bySection.entries()]
      .filter(([s]) => !sectionOrder.includes(s))
      .sort();
    return [...known, ...extras];
  }, [filtered]);

  const togglePreview = (slug: string) => {
    if (previewing && previewing !== slug) {
      const prev = videoRefs.current.get(previewing);
      if (prev) prev.pause();
    }
    if (previewing === slug) {
      const v = videoRefs.current.get(slug);
      if (v) v.pause();
      setPreviewing(null);
    } else {
      setPreviewing(slug);
      // Play on next tick after the video mounts.
      setTimeout(() => {
        const v = videoRefs.current.get(slug);
        if (v) { v.currentTime = 0; v.play().catch(() => {}); }
      }, 20);
    }
  };

  const commit = () => {
    onSelect(selected);
    onClose();
  };

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 30,
          background: 'rgba(35,27,16,.38)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      {/* Sheet */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-picker-title"
        style={{
          position: 'fixed', zIndex: 31,
          top: 0, right: 0, bottom: 0,
          width: 'min(520px, 100vw)',
          background: 'var(--linen-50)',
          borderLeft: '1px solid var(--ink-200)',
          boxShadow: '-30px 0 80px -30px rgba(35,27,16,.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ padding: '24px 28px 16px', borderBottom: '1px solid var(--ink-100)' }}>
          <h2 id="move-picker-title" style={{
            fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: '24px',
            margin: 0, color: 'var(--ink-900)',
          }}>Add a tai chi move</h2>
          <p style={{
            fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13.5px',
            color: 'var(--ink-500)', margin: '6px 0 16px 0',
          }}>Optional — pick one to feature in one of the dojo beats.</p>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by English name or pinyin…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 14px',
              fontFamily: 'var(--ff-body)', fontSize: '14px',
              border: '1px solid var(--ink-200)', borderRadius: 'var(--r-md)',
              background: 'white', outline: 'none',
            }}
          />
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 24px' }}>
          {moves === null && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)' }}>
              Loading library…
            </p>
          )}
          {moves !== null && filtered.length === 0 && (
            <p style={{ fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)' }}>
              No moves match that search.
            </p>
          )}
          {grouped.map(([section, items]) => (
            <section key={section} style={{ marginTop: '20px' }}>
              <h3 style={{
                fontFamily: 'var(--ff-body)', fontSize: '11px', fontWeight: 600,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--cedar-600)', margin: '0 0 8px 0',
              }}>{sectionLabel(section)}</h3>
              {items.map((move) => {
                const isSelected = selected === move.slug;
                const isPreviewing = previewing === move.slug;
                return (
                  <div key={move.slug} style={{ marginBottom: '6px' }}>
                    <label
                      onClick={() => setSelected(move.slug)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px 1fr auto',
                        gap: '12px', alignItems: 'center',
                        padding: '10px 12px',
                        border: `1px solid ${isSelected ? 'var(--navy-500)' : 'var(--ink-100)'}`,
                        borderRadius: 'var(--r-md)',
                        background: isSelected ? 'var(--navy-wash)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: `1.5px solid ${isSelected ? 'var(--navy-800)' : 'var(--ink-300)'}`,
                        background: 'white',
                        display: 'grid', placeItems: 'center',
                      }}>
                        {isSelected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--navy-800)' }} />}
                      </span>
                      <span>
                        <div style={{
                          fontFamily: 'var(--ff-display)', fontWeight: 500, fontSize: '14.5px',
                          color: 'var(--ink-900)',
                        }}>{move.english}</div>
                        <div style={{
                          fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '12px',
                          color: 'var(--ink-500)', marginTop: 1,
                        }}>{move.pinyin}</div>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePreview(move.slug); }}
                        style={{
                          fontFamily: 'var(--ff-body)', fontSize: '12px',
                          padding: '4px 10px', border: '1px solid var(--ink-200)',
                          borderRadius: '999px', background: 'white', cursor: 'pointer',
                          color: 'var(--ink-700)',
                        }}
                        aria-label={isPreviewing ? `Pause preview for ${move.english}` : `Preview ${move.english}`}
                      >{isPreviewing ? '■' : '▶'} preview</button>
                    </label>
                    {isPreviewing && (
                      <video
                        ref={(el) => { if (el) videoRefs.current.set(move.slug, el); else videoRefs.current.delete(move.slug); }}
                        src={move.mp4_url}
                        muted
                        playsInline
                        loop
                        style={{
                          width: '100%', marginTop: 6,
                          borderRadius: 'var(--r-md)',
                          background: 'black',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <footer style={{
          padding: '14px 28px',
          borderTop: '1px solid var(--ink-100)',
          display: 'flex', gap: 12, justifyContent: 'flex-end',
        }}>
          <button type="button" onClick={onClose} style={{
            fontFamily: 'var(--ff-body)', fontSize: '14px', padding: '10px 20px',
            border: '1px solid var(--ink-200)', borderRadius: 999,
            background: 'transparent', color: 'var(--ink-700)', cursor: 'pointer',
          }}>Cancel</button>
          <button type="button" onClick={commit} disabled={selected === currentSlug} style={{
            fontFamily: 'var(--ff-body)', fontSize: '14px', padding: '10px 20px',
            border: '1px solid var(--navy-800)', borderRadius: 999,
            background: selected === currentSlug ? 'var(--ink-300)' : 'var(--navy-800)',
            color: 'var(--linen-50)',
            cursor: selected === currentSlug ? 'not-allowed' : 'pointer',
          }}>Select</button>
        </footer>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
cd dashboard && npx tsc --noEmit && npm run lint
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/tai-chi-move-picker.tsx
git commit -m "feat(picker): TaiChiMovePicker sheet with grouped list + inline preview"
```

### Task 13: Wire picker into the script card

**Files:**
- Modify: `dashboard/src/components/script-carousel.tsx`
- Modify: `dashboard/src/app/page.tsx`
- Modify: `dashboard/src/app/videos/[slug]/page.tsx`

- [ ] **Step 1: Pull `motion_ref_slug` into the scripts select on both pages**

In `dashboard/src/app/page.tsx`, find `scripts(id, option, title, draft_text)` — there are two occurrences (`getNextParsha`, `getParshaBySlug`). Change each to:

```
scripts(id, option, title, draft_text, motion_ref_slug)
```

Also update the local `Script` interface at the top of the file to include it:

```typescript
interface Script {
  id: string;
  option: string;
  title: string | null;
  draft_text: string | null;
  motion_ref_slug: string | null;
}
```

In `dashboard/src/app/videos/[slug]/page.tsx`, update the query `scripts(id, option, title, tldr, draft_text)` to `scripts(id, option, title, tldr, draft_text, motion_ref_slug)` and the local `Script` interface accordingly.

- [ ] **Step 2: Extend `CarouselScript` interface in `script-carousel.tsx`**

Near the top:

```typescript
export interface CarouselScript {
  id: string;
  option: string;
  title: string | null;
  tldr: string | null;
  draft_text: string | null;
  motion_ref_slug: string | null;
}
```

- [ ] **Step 3: Import the picker and the server action**

At the top of `script-carousel.tsx`:

```typescript
import { TaiChiMovePicker, type TaiChiMove } from '@/components/tai-chi-move-picker';
import { addMoveToScript } from '@/app/actions/add-move-to-script';
```

- [ ] **Step 4: Add move-picker state and a lookup cache inside `ScriptCard`**

In the `ScriptCard` component (client), add hook state and a small fetch for the selected move's display name:

```typescript
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveCache, setMoveCache] = useState<Record<string, TaiChiMove>>({});
  const currentSlug = script.motion_ref_slug ?? null;
  const currentMove = currentSlug ? moveCache[currentSlug] : null;

  useEffect(() => {
    if (!currentSlug || moveCache[currentSlug]) return;
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, TaiChiMove> = {};
        for (const m of (data.moves ?? []) as TaiChiMove[]) map[m.slug] = m;
        setMoveCache(map);
      })
      .catch(() => {});
  }, [currentSlug, moveCache]);

  const handlePick = async (slug: string | null) => {
    const res = await addMoveToScript({
      scriptId: script.id,
      slug,
      parshaSlug,
    });
    if (!res.ok) {
      alert(res.error);
      return;
    }
    router.refresh();
  };
```

Add `useEffect` and `useState` to the existing `react` imports at the top of the file.

- [ ] **Step 5: Render the Add-move button and selection display in the actions row**

Inside the `ScriptCard` `return`, locate the actions block (the `{editing ? (<>...</>) : (<> <GenerateDialog ... /> <button ...>Edit script</button> </>)}` structure). In the else branch — right after the `Edit script` button — insert:

```tsx
            {currentSlug ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px',
                  color: 'var(--ink-700)',
                }}>
                  Move: <strong style={{ fontStyle: 'normal', fontWeight: 500 }}>
                    {currentMove?.english ?? currentSlug}
                  </strong>
                </span>
                <button type="button" onClick={() => setPickerOpen(true)} style={{
                  fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: 'var(--ink-500)',
                  background: 'none', border: 'none', padding: 0,
                  textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                  cursor: 'pointer',
                }}>change</button>
                <span style={{ color: 'var(--ink-300)' }}>·</span>
                <button type="button" onClick={() => handlePick(null)} style={{
                  fontFamily: 'var(--ff-body)', fontSize: '12.5px', color: 'var(--ink-500)',
                  background: 'none', border: 'none', padding: 0,
                  textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                  cursor: 'pointer',
                }}>remove</button>
              </span>
            ) : (
              <button type="button" onClick={() => setPickerOpen(true)} style={{
                fontFamily: 'var(--ff-body)', fontSize: '13px', color: 'var(--ink-500)',
                textDecoration: 'underline', textDecorationColor: 'var(--ink-200)',
                textUnderlineOffset: 4, cursor: 'pointer',
                background: 'none', border: 'none', padding: 0, minHeight: 44,
                display: 'inline-flex', alignItems: 'center',
              }}>Add tai chi move</button>
            )}
            <TaiChiMovePicker
              open={pickerOpen}
              currentSlug={currentSlug}
              onSelect={(slug) => handlePick(slug)}
              onClose={() => setPickerOpen(false)}
            />
```

- [ ] **Step 6: Dev-server smoke test**

```bash
cd dashboard && npm run dev
```

Open the Today page. Confirm:
- `Add tai chi move` button appears in the script card action row.
- Clicking it opens the sheet; sheet loads ~27 moves grouped by section.
- `▶ preview` plays the reference clip inline.
- Selecting a move + `Select` closes the sheet and the card now shows `Move: <name> (change · remove)`.
- Reloading the page preserves the selection.
- `remove` clears it.

- [ ] **Step 7: Typecheck + lint + build**

```bash
cd dashboard && npx tsc --noEmit && npm run lint && npm run build
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/script-carousel.tsx dashboard/src/app/page.tsx dashboard/src/app/videos/[slug]/page.tsx
git commit -m "feat(picker): Add tai chi move action on script card + persist on scripts row"
```

### Task 14: Wire picker into the compose AI video panel

**Files:**
- Modify: `dashboard/src/app/compose/ai-video-panel.tsx`

- [ ] **Step 1: Import the picker and add state**

At the top of the file:

```typescript
import { TaiChiMovePicker, type TaiChiMove } from '@/components/tai-chi-move-picker';
```

Inside `AiVideoPanel`, alongside the existing `useState` calls:

```typescript
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveSlug, setMoveSlug] = useState<string | null>(null);
  const [moveCache, setMoveCache] = useState<Record<string, TaiChiMove>>({});
  const currentMove = moveSlug ? moveCache[moveSlug] : null;

  useEffect(() => {
    // Pre-fetch the library so the card can display the picked move's name.
    fetch('/api/tai-chi-moves', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, TaiChiMove> = {};
        for (const m of (data.moves ?? []) as TaiChiMove[]) map[m.slug] = m;
        setMoveCache(map);
      })
      .catch(() => {});
  }, []);
```

- [ ] **Step 2: Add the UI control near the generate button**

Locate the `<button onClick={startGeneration}>` element. Immediately above it (inside the same container), add:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '12px 0' }}>
  {moveSlug ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--ff-display)', fontStyle: 'italic', fontSize: '13px', color: 'var(--ink-700)' }}>
      Move: <strong style={{ fontStyle: 'normal', fontWeight: 500 }}>{currentMove?.english ?? moveSlug}</strong>
      <button type="button" onClick={() => setPickerOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer' }}>change</button>
      <span style={{ color: 'var(--ink-300)' }}>·</span>
      <button type="button" onClick={() => setMoveSlug(null)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '12.5px', textDecoration: 'underline', cursor: 'pointer' }}>remove</button>
    </span>
  ) : (
    <button type="button" onClick={() => setPickerOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-500)', fontSize: '13px', textDecoration: 'underline', cursor: 'pointer' }}>
      Add tai chi move (optional)
    </button>
  )}
</div>
<TaiChiMovePicker
  open={pickerOpen}
  currentSlug={moveSlug}
  onSelect={(slug) => setMoveSlug(slug)}
  onClose={() => setPickerOpen(false)}
/>
```

- [ ] **Step 3: Include `moveSlug` in the POST body**

Find the `startGeneration` function's `fetch('/api/compose/generate-video', { method: 'POST', ... })` call. Update the body:

```typescript
body: JSON.stringify({ topic, moveSlug }),
```

(If the current body structure is different, merge `moveSlug` into whatever dict is already being stringified.)

- [ ] **Step 4: Dev-server smoke test**

Visit `/compose`. Confirm:
- `Add tai chi move (optional)` link appears above the generate button.
- Clicking it opens the same picker.
- Selecting a move displays `Move: <name>` with change/remove.
- Kicking off a topic generation sends the slug; check `jobs.motion_ref_slug` in Supabase SQL editor.

- [ ] **Step 5: Typecheck + lint + build**

```bash
cd dashboard && npx tsc --noEmit && npm run lint && npm run build
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/app/compose/ai-video-panel.tsx
git commit -m "feat(picker): add move picker above topic-video generate button"
```

---

## Phase 5 — End-to-end validation

### Task 15: Deploy and run an end-to-end parsha video with a picked move

**Files:** none modified

- [ ] **Step 1: Deploy the Modal worker**

```bash
modal deploy modal_app.py
```

Expected: deploy succeeds; worker URL printed (should match `MODAL_WORKER_URL` in Vercel env).

- [ ] **Step 2: Deploy the dashboard**

```bash
cd dashboard && git push
```

(Assumes Vercel auto-deploys on main push. If not, trigger a Vercel deploy manually.)

Expected: build green, live on the dashboard URL.

- [ ] **Step 3: Trigger a real generation with a picked move**

From the Today page:

1. Scroll to the current parsha script card.
2. Click `Add tai chi move` → pick `White Crane Spreads Its Wings` → `Select`.
3. Confirm the card now shows `Move: White Crane Spreads Its Wings (change · remove)`.
4. Click `Approve · generate video`. Use the default `720p fast` tier (~$3 cost).
5. Click `Generate`.

- [ ] **Step 4: Watch the job status**

Navigate to the jobs view (or use Supabase SQL editor to `select id, status, status_message from jobs order by triggered_at desc limit 3`). Wait for `status = 'done'`.

- [ ] **Step 5: Verify the database trail**

```sql
-- Job carries the slug
select id, kind, motion_ref_slug from jobs order by triggered_at desc limit 1;

-- Exactly one clip carries both the slug and the resulting URL
select job_id, index, motion_ref_slug, motion_ref_url
  from clips
  where job_id = '<job-id-from-above>'
  order by index;
```

Expected:
- `jobs.motion_ref_slug = 'white_crane_spreads_wings'`.
- Exactly one clip row has both `motion_ref_slug` and `motion_ref_url` set.

- [ ] **Step 6: Watch the finished video**

Open the generated video from the videos page. Confirm ALL:

1. The ref'd clip visibly performs the White Crane motion (arm rises above the head, left leg lifts, body settles to a one-legged stance).
2. Rav Eli speaks Yonah's voiceover on that clip (mouth moves, audio plays).
3. Other clips look like today (no ref side-effects).
4. The video stitched cleanly with no mid-clip freezes.

If all four pass → feature ships.

If any fail → open a debugging task, iterate on the motion-study addendum wording in `src/video_generator.py` Task 5 Step 3, and re-run.

- [ ] **Step 7: Commit a memory/status note**

```bash
git commit --allow-empty -m "chore(tai-chi-picker): v1 ships — e2e validated with white_crane on parsha Kedoshim"
```

(Substitute the actual parsha name used in validation.)

---

## Self-review checklist

### Spec coverage

| Spec section | Implemented by |
|---|---|
| User flow — parsha | Task 13 |
| User flow — topic | Task 14 |
| User flow — IdeaCard custom scripts | Task 13 (inherited via ScriptCarousel rendering all scripts) |
| Picker sheet | Task 12 |
| Data model — `tai_chi_moves` | Task 2 |
| Data model — `scripts.motion_ref_slug` | Task 2 + Task 13 populates |
| Data model — `jobs.motion_ref_slug` | Task 2 + Task 10 + Task 11 populate |
| Data model — `clips.motion_ref_url` | Task 2 + Task 7 populates |
| Data model — `clips.motion_ref_slug` | Task 7 Step 8 (addendum migration) + Task 7 Step 5 populates |
| Data model — sync script | Task 3 |
| Pipeline — Modal reads slug | Task 7 |
| Pipeline — script generator prompt extension | Task 6 |
| Pipeline — video generator reference_video_url | Task 5 |
| Pipeline — per-clip dispatch | Task 7 |
| Pipeline — soft-fail when Claude ignores move | Task 7 Step 7 |
| Unvalidated assumption (voiceover + ref) | Task 1 |
| API route — GET /api/tai-chi-moves | Task 8 |
| API route — addMoveToScript | Task 9 |
| API route — triggerGeneration modification | Task 10 |
| API route — /api/compose/generate-video | Task 11 |
| Scope out: FAB | Deliberately not in plan (consistent with spec) |

### Placeholder scan

No TBDs, no "implement later". The `{{DATE}}` and `{{voiceover line used}}` placeholders in Task 1 Step 7 are doc-template slots resolved when the engineer writes the validation outcome — that's an instruction, not a plan placeholder.

### Type/name consistency

- `motion_ref_slug` (snake_case) is used everywhere in SQL, Pydantic, and Modal. Dashboard uses `moveSlug` on the wire (camelCase API input) and `motionRefSlug` as a local variable in `triggerGeneration`. Consistent within each layer.
- `reference_video_url` (singular, the Python parameter) vs `reference_video_urls` (plural, the Seedance payload key) is deliberate — Seedance accepts an array, we pass one item.
- `TaiChiMove` TypeScript type shape matches the `/api/tai-chi-moves` JSON response shape.
- `SECTION_LABELS` in the picker supports `yang_24_form`, `basic_stances`, `chen_style`, `other`. Any new section from `moves.yaml` falls through to the `other` label, consistent with the spec.
