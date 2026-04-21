# Tai Chi Reference Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI utility that auto-curates a local library of short (≤15s) tai chi move demonstration clips by searching YouTube, downloading candidates, and using Gemini 3.1 Pro (via OpenRouter) to review + pick the cleanest demonstration per move.

**Architecture:** Single-project Python CLI. A thin entry script (`tools/download_moves.py`) parses args and orchestrates a library module (`tools/move_library.py`) that owns all logic: yaml loading, yt-dlp search/download, ffmpeg frame extraction and trimming, and OpenRouter/Gemini review. Library is unit-tested (`tools/test_move_library.py`); entry script is smoke-tested manually. Data source: `references/tai_chi_moves/moves.yaml` (committed, 41 entries, no URLs). Output: `references/tai_chi_moves/<slug>.mp4` (gitignored).

**Tech Stack:** Python 3.13, `yt-dlp` (Python API), `ffmpeg` (subprocess), `httpx` (OpenRouter HTTP), `pyyaml`, `python-dotenv`, `pytest`. Gemini 3.1 Pro Preview via OpenRouter for video-frame review.

---

## File Structure

**Created:**
- `tools/download_moves.py` — CLI entry: argparse, dep check, calls into library
- `tools/move_library.py` — all library logic (loader, youtube, ffmpeg, review, pipeline)
- `tools/test_move_library.py` — pytest suite
- `tools/README.md` — usage + curation workflow
- `tools/conftest.py` — pytest fixtures (tiny sample video, mock env)
- `tools/fixtures/sample.mp4` — 2-second dummy video for ffmpeg tests (generated via ffmpeg in Task 1)
- `references/tai_chi_moves/moves.yaml` — 41-entry canonical seed list

**Modified:**
- `.gitignore` — append `references/tai_chi_moves/*.mp4`, `references/tai_chi_moves/.candidates/`, `references/tai_chi_moves/.downloads/`

---

## Task 1: Scaffolding

**Files:**
- Create: `tools/download_moves.py` (empty stub)
- Create: `tools/move_library.py` (empty module docstring)
- Create: `tools/test_move_library.py` (empty)
- Create: `tools/conftest.py`
- Create: `tools/fixtures/.gitkeep`
- Create: `tools/fixtures/sample.mp4` (generated)
- Create: `tools/README.md` (placeholder)
- Create: `references/tai_chi_moves/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create directories and empty files**

```bash
mkdir -p tools/fixtures references/tai_chi_moves
touch tools/download_moves.py tools/move_library.py tools/test_move_library.py tools/conftest.py tools/fixtures/.gitkeep references/tai_chi_moves/.gitkeep
```

- [ ] **Step 2: Write `tools/move_library.py` module docstring**

```python
"""Tai chi reference library — yt-dlp search, ffmpeg extraction, Gemini review.

Entry point: tools/download_moves.py.
Spec: docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md
"""
```

- [ ] **Step 3: Write `tools/README.md` placeholder**

```markdown
# Tai Chi Reference Library Tools

Populated in a later task. See spec at `docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md`.
```

- [ ] **Step 4: Write `tools/conftest.py`**

```python
import pytest
from pathlib import Path


@pytest.fixture
def sample_video(tmp_path):
    """Path to the 2-second fixture video used for ffmpeg tests."""
    src = Path(__file__).parent / "fixtures" / "sample.mp4"
    assert src.exists(), f"Missing fixture at {src}. Generate via Task 1."
    return src
```

- [ ] **Step 5: Generate the fixture video**

Run from repo root:

```bash
ffmpeg -y -f lavfi -i color=c=gray:s=640x360:d=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac tools/fixtures/sample.mp4
```

Expected: creates `tools/fixtures/sample.mp4` (~30KB, 2 sec, gray screen with 440Hz tone).

- [ ] **Step 6: Append to `.gitignore`**

```
# Tai chi reference library — clips not committed
references/tai_chi_moves/*.mp4
references/tai_chi_moves/.candidates/
references/tai_chi_moves/.downloads/
```

- [ ] **Step 7: Commit**

```bash
git add tools/ references/tai_chi_moves/.gitkeep .gitignore
git commit -m "scaffold(tai-chi-refs): create tools/ structure + fixture video + gitignore"
```

---

## Task 2: Seed `moves.yaml`

**Files:**
- Create: `references/tai_chi_moves/moves.yaml`

- [ ] **Step 1: Write the full 41-entry seed file**

Create `references/tai_chi_moves/moves.yaml` with this exact content (derived from the research phase):

```yaml
# Tai Chi Move Reference Library — canonical seed
# Sources: Wikipedia 24-form tai chi chuan, IWUF competition manual,
# YMAA publications, Tai Chi Foundation, Chen-style Lao Jia Yi Lu refs.
# URLs are not seeded — they're discovered by the pipeline.

moves:
  # ============================================================
  # Yang-style 24-form (Simplified Tai Chi), canonical order
  # ============================================================
  - slug: commencing_form
    english: "Commencing Form"
    pinyin: "Qǐshì"
    section: yang_24_form
    order: 1
    priority: high
    visual: "Stands feet shoulder-width, arms rise slowly to shoulder height then press down to waist — the opening posture of the form."
    query: null

  - slug: part_wild_horses_mane
    english: "Part the Wild Horse's Mane"
    pinyin: "Yěmǎ Fēnzōng"
    section: yang_24_form
    order: 2
    priority: high
    visual: "Steps forward in a bow stance while the arms separate diagonally, one hand rising to eye level and the other sweeping down past the hip, repeated left and right."
    query: null

  - slug: white_crane_spreads_wings
    english: "White Crane Spreads Its Wings"
    pinyin: "Báihè Liàngchì"
    section: yang_24_form
    order: 3
    priority: high
    visual: "Stands on the right leg with left toe touching, right hand raised above the forehead and left hand settled by the hip, body upright like a crane."
    query: null

  - slug: brush_knee_and_push
    english: "Brush Knee and Push"
    pinyin: "Lōuxī Àobù"
    section: yang_24_form
    order: 4
    priority: high
    visual: "Steps into a bow stance while one hand sweeps across the forward knee and the opposite hand pushes forward at shoulder height, alternating sides."
    query: null

  - slug: playing_the_lute
    english: "Playing the Lute"
    pinyin: "Shǒuhuī Pípá"
    section: yang_24_form
    order: 5
    priority: medium
    visual: "Empty stance with front heel lightly touching the floor, hands held in front of the chest as if cradling a pipa (lute), forward hand higher than the rear."
    query: null

  - slug: repulse_monkey
    english: "Repulse Monkey"
    pinyin: "Dào Juǎn Gōng"
    section: yang_24_form
    order: 6
    priority: medium
    visual: "Steps backward repeatedly while one hand retracts past the ear and pushes forward as the other withdraws to the hip, body rotating with each step."
    query: null

  - slug: grasp_sparrows_tail_left
    english: "Grasp the Sparrow's Tail — Left"
    pinyin: "Zuǒ Lǎn Què Wěi"
    section: yang_24_form
    order: 7
    priority: high
    visual: "A four-part sequence on the left side: ward off, rollback, press, and push, executed in a smooth forward-and-back bow stance transition."
    query: "grasp sparrow tail left tai chi yang"

  - slug: grasp_sparrows_tail_right
    english: "Grasp the Sparrow's Tail — Right"
    pinyin: "Yòu Lǎn Què Wěi"
    section: yang_24_form
    order: 8
    priority: high
    visual: "Mirror of the left-side version — ward off, rollback, press, push — with weight shifting forward and back in a bow stance on the right side."
    query: "grasp sparrow tail right tai chi yang"

  - slug: single_whip
    english: "Single Whip"
    pinyin: "Dān Biān"
    section: yang_24_form
    order: 9
    priority: high
    visual: "Wide bow stance with arms extended laterally, rear hand forming a hooked 'beak' and front hand pushing outward with palm facing away."
    query: "single whip tai chi yang style demonstration"

  - slug: wave_hands_like_clouds
    english: "Wave Hands Like Clouds"
    pinyin: "Yún Shǒu"
    section: yang_24_form
    order: 10
    priority: high
    visual: "Side-stepping laterally while the hands trace continuous circles in front of the torso, one rising as the other falls, waist rotating smoothly."
    query: "cloud hands tai chi yun shou demonstration"

  - slug: single_whip_repeat
    english: "Single Whip (repeat)"
    pinyin: "Dān Biān"
    section: yang_24_form
    order: 11
    priority: low
    visual: "Repeat of move 9 — wide bow stance, hooked rear hand, front palm pushing outward."
    query: "single whip tai chi yang style demonstration"

  - slug: high_pat_on_horse
    english: "High Pat on Horse"
    pinyin: "Gāo Tàn Mǎ"
    section: yang_24_form
    order: 12
    priority: medium
    visual: "Empty stance with weight on the rear leg, forward hand extends palm-up at chest height while the rear hand withdraws to the hip, as if patting a horse's neck."
    query: null

  - slug: right_heel_kick
    english: "Right Heel Kick"
    pinyin: "Yòu Dēng Jiǎo"
    section: yang_24_form
    order: 13
    priority: medium
    visual: "Balances on the left leg and extends the right leg forward with the heel leading, arms opening outward in a cross-hands-to-wide-arms motion."
    query: null

  - slug: strike_ears_with_fists
    english: "Strike Opponent's Ears with Both Fists"
    pinyin: "Shuāng Fēng Guàn Ěr"
    section: yang_24_form
    order: 14
    priority: medium
    visual: "Bow stance with both fists swinging in wide upward arcs to meet at head height, as if striking an opponent's temples."
    query: null

  - slug: turn_body_left_heel_kick
    english: "Turn Body and Left Heel Kick"
    pinyin: "Zhuǎnshēn Zuǒ Dēng Jiǎo"
    section: yang_24_form
    order: 15
    priority: medium
    visual: "Pivots on the supporting leg, arms cross at the chest, then extends the left leg forward heel-first as the arms open wide."
    query: null

  - slug: snake_creeps_down_rooster_left
    english: "Left Snake Creeps Down and Golden Rooster Stands on Left Leg"
    pinyin: "Zuǒ Xià Shì Dúlì"
    section: yang_24_form
    order: 16
    priority: high
    visual: "Drops into a low side stance with one leg extended flat along the floor and hand sweeping along the inside of that leg, then rises onto that leg lifting the opposite knee high with hand raised."
    query: "snake creeps down golden rooster tai chi"

  - slug: snake_creeps_down_rooster_right
    english: "Right Snake Creeps Down and Golden Rooster Stands on Right Leg"
    pinyin: "Yòu Xià Shì Dúlì"
    section: yang_24_form
    order: 17
    priority: medium
    visual: "Mirror of the left-side version — low creeping stance transitioning into a tall one-legged stance with opposite knee and hand raised."
    query: "snake creeps down golden rooster tai chi"

  - slug: fair_lady_works_shuttles
    english: "Fair Lady Works the Shuttles"
    pinyin: "Yùnǚ Chuānsuō"
    section: yang_24_form
    order: 18
    priority: high
    visual: "Steps diagonally into a bow stance with one hand guarding above the forehead palm-out and the other pushing forward at chest height, repeated to alternating corners."
    query: null

  - slug: needle_at_sea_bottom
    english: "Needle at Sea Bottom"
    pinyin: "Hǎidǐ Zhēn"
    section: yang_24_form
    order: 19
    priority: medium
    visual: "Empty stance with the body folding forward, front hand spearing downward with fingers pointed at the floor as if retrieving a needle."
    query: null

  - slug: fan_through_the_back
    english: "Fan Through the Back"
    pinyin: "Shǎn Tōng Bì"
    section: yang_24_form
    order: 20
    priority: medium
    visual: "Rises from the previous posture into a bow stance with one hand raised above the head like a fan and the other pushing forward at shoulder height."
    query: null

  - slug: turn_deflect_parry_punch
    english: "Turn, Deflect, Parry, and Punch"
    pinyin: "Zhuǎnshēn Bān Lán Chuí"
    section: yang_24_form
    order: 21
    priority: medium
    visual: "Pivots the body, deflects with a backfist, parries with an open hand, then steps into a bow stance delivering a straight fist punch at mid-level."
    query: null

  - slug: apparent_close_up
    english: "Apparent Close Up"
    pinyin: "Rúfēng Sìbì"
    section: yang_24_form
    order: 22
    priority: medium
    visual: "Pulls both hands back toward the chest palms-up in a withdrawing motion, then pushes both palms forward in a bow stance."
    query: null

  - slug: cross_hands
    english: "Cross Hands"
    pinyin: "Shízì Shǒu"
    section: yang_24_form
    order: 23
    priority: medium
    visual: "Shoulder-width parallel stance with both arms crossing in front of the chest, wrists stacked, palms facing inward."
    query: null

  - slug: closing_form
    english: "Closing Form"
    pinyin: "Shōushì"
    section: yang_24_form
    order: 24
    priority: high
    visual: "From cross hands, palms turn down and arms press slowly to the sides as feet bring together, returning to a neutral standing posture."
    query: null

  # ============================================================
  # Bonus iconic moves from Yang 108-form and Chen-style
  # ============================================================
  - slug: snake_creeps_down
    english: "Snake Creeps Down"
    pinyin: "Xià Shì"
    section: bonus
    order: 1
    priority: high
    visual: "Drops into a very low side stance with one leg fully extended flat along the floor and hand sweeping along the inside of that leg — the creeping portion isolated from the rooster."
    query: "snake creeps down tai chi xia shi"

  - slug: golden_rooster_stands_one_leg
    english: "Golden Rooster Stands on One Leg"
    pinyin: "Jīnjī Dúlì"
    section: bonus
    order: 2
    priority: high
    visual: "Tall one-legged stance with the raised knee lifted to waist height and the same-side hand raised high with fingers pointing up."
    query: "golden rooster stands on one leg tai chi"

  - slug: step_back_ride_tiger
    english: "Step Back to Ride the Tiger"
    pinyin: "Tuìbù Kuà Hǔ"
    section: bonus
    order: 3
    priority: low
    visual: "Steps back into an empty stance with one hand raised above the head and the other lowered beside the hip, body turned at an angle."
    query: null

  - slug: sweep_lotus_leg
    english: "Sweep Lotus with Leg"
    pinyin: "Bǎi Lián Tuǐ"
    section: bonus
    order: 4
    priority: low
    visual: "Balances on one leg and swings the other leg in a wide outward crescent arc, hands slapping the foot as it crosses the body."
    query: null

  - slug: shoot_tiger_with_bow
    english: "Shoot Tiger with Bow"
    pinyin: "Wān Gōng Shè Hǔ"
    section: bonus
    order: 5
    priority: low
    visual: "Bow stance with both fists raised — one near the temple and one extended forward — as if drawing and releasing a bow."
    query: null

  - slug: punch_down
    english: "Punch Down"
    pinyin: "Zāi Chuí"
    section: bonus
    order: 6
    priority: low
    visual: "Bow stance with the fist driving downward toward the forward knee, body folding slightly forward over the strike."
    query: null

  - slug: white_snake_spits_tongue
    english: "White Snake Spits Tongue"
    pinyin: "Báishé Tǔ Xìn"
    section: bonus
    order: 7
    priority: low
    visual: "Bow stance with a sharp forward thrust of an open hand, fingers extended like a spear, as the rear hand withdraws."
    query: null

  - slug: buddha_warrior_pounds_mortar
    english: "Buddha's Warrior Attendant Pounds Mortar"
    pinyin: "Jīngāng Dǎo Duì"
    section: bonus
    order: 8
    priority: low
    visual: "Raises one knee high as the fist drops vertically into the open palm at waist height, producing an audible clap — the signature opening of Chen-style."
    query: "buddha warrior pounds mortar chen tai chi jingang"

  - slug: lazy_tying_coat
    english: "Lazy About Tying the Coat"
    pinyin: "Lǎn Zhā Yī"
    section: bonus
    order: 9
    priority: low
    visual: "Wide side-facing bow stance with one arm extended out to the side palm-up and the other hand resting at the waist — Chen-style's signature open posture."
    query: "lazy about tying coat chen tai chi lan zha yi"

  - slug: hidden_thrust_punch
    english: "Hidden Thrust Punch"
    pinyin: "Yǎn Shǒu Gōng Quán"
    section: bonus
    order: 10
    priority: low
    visual: "Explosive Chen-style fā jìn release: coils back then launches a fast straight punch from a bow stance with the opposite hand pulling sharply to the hip."
    query: "hidden thrust punch chen tai chi fa jin"

  # ============================================================
  # Warmup, stance, and foundation moves (not part of a form)
  # ============================================================
  - slug: wuji_stance
    english: "Wuji Stance"
    pinyin: "Wújí Zhuāng"
    section: warmups_and_stances
    order: 1
    priority: high
    visual: "Feet parallel shoulder-width apart, arms hanging softly at the sides, body relaxed and upright — the neutral pre-form standing posture."
    query: "wuji stance tai chi posture"

  - slug: horse_stance
    english: "Horse Stance"
    pinyin: "Mǎbù"
    section: warmups_and_stances
    order: 2
    priority: medium
    visual: "Feet wider than shoulders with toes parallel, knees bent deeply as if astride a horse, back straight and arms often held out in front."
    query: "horse stance mabu tai chi"

  - slug: bow_stance
    english: "Bow Stance"
    pinyin: "Gōngbù"
    section: warmups_and_stances
    order: 3
    priority: medium
    visual: "Front leg bent with knee over the ankle, rear leg straight with foot angled outward, roughly 70% of weight on the front leg."
    query: "bow stance gong bu tai chi"

  - slug: empty_stance
    english: "Empty Stance"
    pinyin: "Xūbù"
    section: warmups_and_stances
    order: 4
    priority: medium
    visual: "Nearly all weight on the rear bent leg while the front foot rests lightly with only the toe or heel touching the floor."
    query: "empty stance xu bu tai chi"

  - slug: basic_weight_shift
    english: "Basic Weight Shift"
    pinyin: "Yí Zhòngxīn"
    section: warmups_and_stances
    order: 5
    priority: medium
    visual: "From a shoulder-width stance, weight transfers slowly side to side between the legs, hips settling into each side without the upper body bobbing."
    query: "tai chi weight shift basic warmup"

  - slug: silk_reeling_single_hand
    english: "Silk Reeling — Single Hand"
    pinyin: "Dān Shǒu Chán Sī Jìn"
    section: warmups_and_stances
    order: 6
    priority: low
    visual: "In a horse stance, one hand traces a continuous spiraling circle in front of the body driven by the waist, the palm rotating smoothly throughout."
    query: "silk reeling single hand chan si jin chen tai chi"

  - slug: silk_reeling_double_hand
    english: "Silk Reeling — Double Hand"
    pinyin: "Shuāng Shǒu Chán Sī Jìn"
    section: warmups_and_stances
    order: 7
    priority: low
    visual: "Horse stance with both hands tracing mirrored spiraling circles in front of the torso, driven by continuous waist rotation."
    query: "silk reeling double hand chan si jin chen tai chi"
```

- [ ] **Step 2: Commit**

```bash
git add references/tai_chi_moves/moves.yaml
git commit -m "data(tai-chi-refs): seed moves.yaml with 41 canonical moves"
```

---

## Task 3: Move dataclass + YAML loader

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing test**

Append to `tools/test_move_library.py`:

```python
from pathlib import Path
import pytest
from tools.move_library import Move, load_moves


MOVES_YAML = Path(__file__).parent.parent / "references" / "tai_chi_moves" / "moves.yaml"


def test_load_moves_returns_all_41_entries():
    moves = load_moves(MOVES_YAML)
    assert len(moves) == 41


def test_load_moves_returns_move_instances():
    moves = load_moves(MOVES_YAML)
    assert all(isinstance(m, Move) for m in moves)


def test_move_has_required_fields():
    moves = load_moves(MOVES_YAML)
    single_whip = next(m for m in moves if m.slug == "single_whip")
    assert single_whip.english == "Single Whip"
    assert single_whip.pinyin == "Dān Biān"
    assert single_whip.section == "yang_24_form"
    assert single_whip.priority == "high"
    assert single_whip.visual.startswith("Wide bow stance")
    assert single_whip.query == "single whip tai chi yang style demonstration"


def test_move_query_defaults_to_english_plus_suffix_when_null():
    moves = load_moves(MOVES_YAML)
    wuji = next(m for m in moves if m.slug == "commencing_form")
    assert wuji.query is None  # stored as None in yaml
    assert wuji.effective_query == "Commencing Form tai chi demonstration"


def test_move_effective_query_uses_override_when_set():
    moves = load_moves(MOVES_YAML)
    sw = next(m for m in moves if m.slug == "single_whip")
    assert sw.effective_query == "single whip tai chi yang style demonstration"


def test_slugs_are_unique():
    moves = load_moves(MOVES_YAML)
    slugs = [m.slug for m in moves]
    assert len(slugs) == len(set(slugs)), "Duplicate slugs detected"


def test_priority_values_are_valid():
    moves = load_moves(MOVES_YAML)
    for m in moves:
        assert m.priority in ("high", "medium", "low"), f"Bad priority on {m.slug}: {m.priority}"


def test_section_values_are_valid():
    moves = load_moves(MOVES_YAML)
    for m in moves:
        assert m.section in ("yang_24_form", "bonus", "warmups_and_stances"), f"Bad section on {m.slug}"
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd "c:/Users/yitzym/git/torah tai chi" && python -m pytest tools/test_move_library.py -v
```

Expected: all tests FAIL with `ImportError: cannot import name 'Move'`.

- [ ] **Step 3: Implement `Move` + `load_moves` in `tools/move_library.py`**

Append:

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml


@dataclass(frozen=True)
class Move:
    slug: str
    english: str
    pinyin: str
    section: str         # yang_24_form | bonus | warmups_and_stances
    order: int
    priority: str        # high | medium | low
    visual: str
    query: Optional[str] = None

    @property
    def effective_query(self) -> str:
        if self.query:
            return self.query
        return f"{self.english} tai chi demonstration"


def load_moves(yaml_path: Path) -> list[Move]:
    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    raw_moves = data.get("moves", [])
    return [Move(**raw) for raw in raw_moves]
```

- [ ] **Step 4: Install deps and re-run tests**

```bash
pip install pyyaml pytest
python -m pytest tools/test_move_library.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): Move dataclass + yaml loader with tests"
```

---

## Task 4: CLI argument parsing

**Files:**
- Modify: `tools/download_moves.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing tests for argument parsing**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import parse_args


def test_parse_args_defaults():
    args = parse_args([])
    assert args.slug is None
    assert args.priority is None
    assert args.redo is None
    assert args.candidates == 5
    assert args.min_quality == 7
    assert args.model == "google/gemini-3.1-pro-preview"
    assert args.query_override is None


def test_parse_args_slug():
    args = parse_args(["--slug", "single_whip"])
    assert args.slug == "single_whip"


def test_parse_args_priority():
    args = parse_args(["--priority", "high"])
    assert args.priority == "high"


def test_parse_args_redo():
    args = parse_args(["--redo", "cloud_hands"])
    assert args.redo == "cloud_hands"


def test_parse_args_candidates_and_quality():
    args = parse_args(["--candidates", "10", "--min-quality", "5"])
    assert args.candidates == 10
    assert args.min_quality == 5


def test_parse_args_model():
    args = parse_args(["--model", "google/gemini-2.5-pro"])
    assert args.model == "google/gemini-2.5-pro"


def test_parse_args_query_override():
    args = parse_args(["--query-override", "single_whip=single whip fast tai chi"])
    assert args.query_override == "single_whip=single whip fast tai chi"
```

- [ ] **Step 2: Run tests — confirm FAIL (import error)**

```bash
python -m pytest tools/test_move_library.py::test_parse_args_defaults -v
```

Expected: FAIL.

- [ ] **Step 3: Implement `parse_args` in `tools/move_library.py`**

Append:

```python
import argparse


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="download_moves",
        description="Auto-curate a library of tai chi move reference clips from YouTube.",
    )
    p.add_argument("--slug", help="Process only the move with this slug.")
    p.add_argument("--priority", choices=["high", "medium", "low"], help="Only process moves at this priority tier.")
    p.add_argument("--redo", help="Re-run the pipeline for this slug even if the clip already exists.")
    p.add_argument("--candidates", type=int, default=5, help="How many search candidates per move (default 5).")
    p.add_argument("--min-quality", type=int, default=7, help="Minimum Gemini quality score to accept (1-10, default 7).")
    p.add_argument("--model", default="google/gemini-3.1-pro-preview", help="OpenRouter model ID for video review.")
    p.add_argument("--query-override", help="Per-slug query override in format 'slug=search query'.")
    return p.parse_args(argv)
```

- [ ] **Step 4: Run tests — confirm PASS**

```bash
python -m pytest tools/test_move_library.py -v -k parse_args
```

Expected: all 7 parse_args tests PASS.

- [ ] **Step 5: Wire up `tools/download_moves.py`**

Replace its contents with:

```python
"""CLI entry point for the tai chi reference library.

See docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md
"""
import sys
from tools.move_library import parse_args, main


if __name__ == "__main__":
    sys.exit(main(parse_args(sys.argv[1:])))
```

Also stub `main` in `tools/move_library.py`:

```python
def main(args: argparse.Namespace) -> int:
    """Entry point. Returns exit code."""
    # Filled in by Task 11 (pipeline orchestrator).
    print(f"Parsed args: {args}")
    return 0
```

- [ ] **Step 6: Smoke test the CLI**

```bash
python -m tools.download_moves --help
python -m tools.download_moves --slug single_whip
```

Expected: help text prints; second command prints parsed args namespace.

- [ ] **Step 7: Commit**

```bash
git add tools/download_moves.py tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): argparse CLI scaffold + main() stub"
```

---

## Task 5: Dependency check

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing tests**

Append to `tools/test_move_library.py`:

```python
from unittest.mock import patch
from tools.move_library import check_dependencies, MissingDependencyError


def test_check_dependencies_all_present_returns_none():
    with patch("tools.move_library.shutil.which", return_value="/usr/bin/ffmpeg"), \
         patch("tools.move_library.importlib.util.find_spec", return_value=object()):
        check_dependencies()  # should not raise


def test_check_dependencies_raises_when_ffmpeg_missing():
    with patch("tools.move_library.shutil.which", return_value=None), \
         patch("tools.move_library.importlib.util.find_spec", return_value=object()):
        with pytest.raises(MissingDependencyError) as exc:
            check_dependencies()
        assert "ffmpeg" in str(exc.value)


def test_check_dependencies_raises_when_python_pkg_missing():
    with patch("tools.move_library.shutil.which", return_value="/usr/bin/ffmpeg"), \
         patch("tools.move_library.importlib.util.find_spec", return_value=None):
        with pytest.raises(MissingDependencyError) as exc:
            check_dependencies()
        assert "pip install" in str(exc.value)
```

- [ ] **Step 2: Run tests — FAIL**

```bash
python -m pytest tools/test_move_library.py -v -k dependencies
```

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
import importlib.util
import shutil


class MissingDependencyError(RuntimeError):
    pass


REQUIRED_PYTHON_PKGS = ["yt_dlp", "yaml", "httpx", "dotenv"]
REQUIRED_BINARIES = ["ffmpeg"]


def check_dependencies() -> None:
    missing_bins = [b for b in REQUIRED_BINARIES if shutil.which(b) is None]
    missing_pkgs = [p for p in REQUIRED_PYTHON_PKGS if importlib.util.find_spec(p) is None]
    if missing_bins or missing_pkgs:
        msg_parts = []
        if missing_bins:
            msg_parts.append(f"Missing binaries on PATH: {', '.join(missing_bins)}")
        if missing_pkgs:
            pip_names = {"yt_dlp": "yt-dlp", "yaml": "pyyaml", "dotenv": "python-dotenv"}
            pip_list = " ".join(pip_names.get(p, p) for p in missing_pkgs)
            msg_parts.append(f"Missing Python packages. Install with: pip install {pip_list}")
        raise MissingDependencyError("\n".join(msg_parts))
```

- [ ] **Step 4: Re-run tests — PASS**

```bash
python -m pytest tools/test_move_library.py -v -k dependencies
```

- [ ] **Step 5: Wire `check_dependencies()` into `main()`**

Update `main()` in `tools/move_library.py`:

```python
def main(args: argparse.Namespace) -> int:
    try:
        check_dependencies()
    except MissingDependencyError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"Parsed args: {args}")
    return 0
```

Add `import sys` at top of module if not present.

- [ ] **Step 6: Install the actual deps and smoke test**

```bash
pip install yt-dlp pyyaml httpx python-dotenv
python -m tools.download_moves --slug single_whip
```

Expected: no dependency error; prints parsed args.

- [ ] **Step 7: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): dependency check with clear install guidance"
```

---

## Task 6: YouTube search

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing tests**

Append to `tools/test_move_library.py`:

```python
from unittest.mock import patch, MagicMock
from tools.move_library import search_youtube


def test_search_youtube_returns_list_of_urls():
    fake_response = {
        "entries": [
            {"webpage_url": "https://www.youtube.com/watch?v=A"},
            {"webpage_url": "https://www.youtube.com/watch?v=B"},
            {"webpage_url": "https://www.youtube.com/watch?v=C"},
        ]
    }
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.extract_info.return_value = fake_response
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl):
        urls = search_youtube("cloud hands tai chi", n=3)
    assert urls == [
        "https://www.youtube.com/watch?v=A",
        "https://www.youtube.com/watch?v=B",
        "https://www.youtube.com/watch?v=C",
    ]


def test_search_youtube_skips_entries_without_url():
    fake_response = {
        "entries": [
            {"webpage_url": "https://www.youtube.com/watch?v=A"},
            {},  # broken entry
            {"webpage_url": "https://www.youtube.com/watch?v=C"},
        ]
    }
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.extract_info.return_value = fake_response
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl):
        urls = search_youtube("query", n=3)
    assert len(urls) == 2
```

- [ ] **Step 2: Run tests — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
import yt_dlp


def search_youtube(query: str, n: int = 5, max_duration_sec: int = 120) -> list[str]:
    """Return up to `n` YouTube URLs matching the query. Filters by duration."""
    def duration_filter(info_dict):
        duration = info_dict.get("duration")
        if duration is not None and duration > max_duration_sec:
            return f"Too long: {duration}s > {max_duration_sec}s"
        return None

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "match_filter": duration_filter,
        "skip_download": True,
    }
    search_query = f"ytsearch{n}:{query}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(search_query, download=False)
    entries = result.get("entries", []) if result else []
    return [e["webpage_url"] for e in entries if e and e.get("webpage_url")]
```

- [ ] **Step 4: Re-run tests — PASS**

- [ ] **Step 5: Real smoke test**

```bash
python -c "from tools.move_library import search_youtube; print(search_youtube('single whip tai chi', n=3))"
```

Expected: prints 3 real YouTube URLs. If 0 URLs returned, the duration filter may be too aggressive — bump `max_duration_sec` to 180 and retry.

- [ ] **Step 6: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): YouTube search via yt-dlp with duration filter"
```

---

## Task 7: Video download

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing test**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import download_candidate


def test_download_candidate_calls_ytdlp_with_correct_options(tmp_path):
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.download.return_value = 0
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl) as ctor:
        out = download_candidate("https://youtube.com/watch?v=abc", tmp_path / "x.mp4")
    assert out == tmp_path / "x.mp4"
    opts = ctor.call_args[0][0]
    assert "format" in opts
    assert str(tmp_path / "x.mp4") in opts["outtmpl"] or "%(ext)s" in opts["outtmpl"]
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
def download_candidate(url: str, out_path: Path) -> Path:
    """Download a single YouTube URL to out_path (mp4). Returns the actual written path."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "outtmpl": str(out_path.with_suffix(".%(ext)s")),
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    # yt-dlp may produce .mp4 or .webm — find it
    candidates = list(out_path.parent.glob(f"{out_path.stem}.*"))
    if not candidates:
        raise RuntimeError(f"yt-dlp produced no output for {url}")
    return candidates[0]
```

- [ ] **Step 4: Re-run tests — PASS**

- [ ] **Step 5: Real smoke test**

```bash
python -c "
from pathlib import Path
from tools.move_library import download_candidate
p = Path('references/tai_chi_moves/.downloads/smoke.mp4')
p.parent.mkdir(parents=True, exist_ok=True)
result = download_candidate('https://www.youtube.com/watch?v=jNQXAC9IVRw', p)
print('Downloaded:', result, 'size:', result.stat().st_size)
"
```

Expected: downloads "Me at the zoo" (~1MB), prints path + size > 100KB.

- [ ] **Step 6: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): yt-dlp video download with 720p ceiling"
```

---

## Task 8: Frame extraction

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing test using fixture video**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import extract_frames, FrameSample


def test_extract_frames_returns_n_samples(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=4, out_dir=tmp_path)
    assert len(samples) == 4
    assert all(isinstance(s, FrameSample) for s in samples)


def test_extract_frames_timestamps_evenly_spaced(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=4, out_dir=tmp_path)
    # 2-second video, 4 samples → should be roughly at 0.0, 0.5, 1.0, 1.5 (approx)
    timestamps = [s.timestamp_sec for s in samples]
    assert timestamps[0] < 0.5
    assert timestamps[-1] > 1.0
    assert all(timestamps[i+1] > timestamps[i] for i in range(len(timestamps) - 1))


def test_extract_frames_produces_valid_images(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=2, out_dir=tmp_path)
    for s in samples:
        assert s.image_path.exists()
        assert s.image_path.stat().st_size > 100  # non-trivial JPEG
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
import subprocess
import json


@dataclass
class FrameSample:
    timestamp_sec: float
    image_path: Path


def get_video_duration(video_path: Path) -> float:
    """Get duration in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(video_path)],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def extract_frames(video_path: Path, n: int, out_dir: Path) -> list[FrameSample]:
    """Extract n evenly-spaced frames from the video. Returns FrameSample list."""
    out_dir.mkdir(parents=True, exist_ok=True)
    duration = get_video_duration(video_path)
    # Spacing: sample at (i + 0.5) * duration / n for i in 0..n-1 — stays interior
    timestamps = [(i + 0.5) * duration / n for i in range(n)]
    samples: list[FrameSample] = []
    for i, ts in enumerate(timestamps):
        img_path = out_dir / f"frame_{i:02d}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{ts:.3f}", "-i", str(video_path),
             "-vframes", "1", "-q:v", "4", "-vf", "scale=512:-2",
             str(img_path)],
            capture_output=True, check=True,
        )
        samples.append(FrameSample(timestamp_sec=ts, image_path=img_path))
    return samples
```

Update `REQUIRED_BINARIES` in the dep check to add `ffprobe`:

```python
REQUIRED_BINARIES = ["ffmpeg", "ffprobe"]
```

- [ ] **Step 4: Check for ffprobe**

```bash
where ffprobe
```

If missing, it should be alongside ffmpeg in the same bin directory. Add `"ffprobe"` to `REQUIRED_BINARIES` in the dep check.

- [ ] **Step 5: Re-run tests — PASS**

- [ ] **Step 6: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): ffmpeg frame extraction with even timestamp sampling"
```

---

## Task 9: Gemini review via OpenRouter

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing tests**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import (
    CandidateReview,
    build_review_prompt,
    parse_review_response,
    review_candidate,
)


def test_build_review_prompt_contains_move_info():
    move = Move(
        slug="single_whip",
        english="Single Whip",
        pinyin="Dān Biān",
        section="yang_24_form",
        order=9,
        priority="high",
        visual="Wide bow stance with arms extended...",
    )
    prompt = build_review_prompt(move, timestamps=[0.5, 1.5, 2.5])
    assert "Single Whip" in prompt
    assert "Dān Biān" in prompt
    assert "Wide bow stance" in prompt
    assert "0.5" in prompt
    assert "matches" in prompt
    assert "quality" in prompt
    assert "best_start_sec" in prompt


def test_parse_review_response_valid_json():
    raw = '{"matches": true, "quality": 8, "best_start_sec": 3, "best_duration_sec": 12, "reason": "clean"}'
    r = parse_review_response(raw)
    assert r.matches is True
    assert r.quality == 8
    assert r.best_start_sec == 3
    assert r.best_duration_sec == 12
    assert r.reason == "clean"


def test_parse_review_response_with_surrounding_prose():
    raw = 'Here is my review:\n```json\n{"matches": false, "quality": 3, "best_start_sec": 0, "best_duration_sec": 10, "reason": "wrong move"}\n```\nDone.'
    r = parse_review_response(raw)
    assert r.matches is False
    assert r.quality == 3


def test_parse_review_response_clamps_duration_to_15():
    raw = '{"matches": true, "quality": 9, "best_start_sec": 0, "best_duration_sec": 30, "reason": "ok"}'
    r = parse_review_response(raw)
    assert r.best_duration_sec == 15  # clamped


def test_review_candidate_posts_to_openrouter(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    move = Move(
        slug="x", english="X", pinyin="X", section="bonus", order=1,
        priority="low", visual="V",
    )
    img_path = tmp_path / "f.jpg"
    img_path.write_bytes(b"\xff\xd8\xff\xd9")  # minimal JPEG
    samples = [FrameSample(timestamp_sec=0.5, image_path=img_path)]

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": '{"matches": true, "quality": 8, "best_start_sec": 0, "best_duration_sec": 10, "reason": "ok"}'}}]
    }
    mock_resp.raise_for_status = MagicMock()
    with patch("tools.move_library.httpx.post", return_value=mock_resp) as mock_post:
        r = review_candidate(move, samples, model="google/gemini-3.1-pro-preview")
    assert r.quality == 8
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["headers"]["Authorization"] == "Bearer fake-key"
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
import base64
import os
import re
import httpx
from dotenv import load_dotenv

load_dotenv()  # loads .env once on import


@dataclass
class CandidateReview:
    matches: bool
    quality: int
    best_start_sec: int
    best_duration_sec: int
    reason: str


REVIEW_PROMPT_TEMPLATE = """You are evaluating a YouTube clip as a reference for the tai chi move "{english}" ({pinyin}).

Visually the move looks like: "{visual}"

You are shown {n_frames} frames sampled at these timestamps (seconds): {ts_list}.

Evaluate:
1. Does this clip clearly demonstrate that specific tai chi move? Answer with `matches` (bool).
2. Rate demonstration quality 1-10 (`quality`). Factors that raise the score: full body visible, clean background, minimal text/captions, no talking-head cutaways, single clean execution, instructor filmed flat-on not mid-class.
3. Identify the single cleanest 10-15 second window showing the move. Return `best_start_sec` (int) and `best_duration_sec` (int, 10-15). If the whole clip is the move, start at 0.
4. One-sentence `reason` summarizing your call.

Return JSON only, no surrounding prose. Shape:
{{"matches": bool, "quality": int, "best_start_sec": int, "best_duration_sec": int, "reason": str}}
"""


def build_review_prompt(move: Move, timestamps: list[float]) -> str:
    return REVIEW_PROMPT_TEMPLATE.format(
        english=move.english,
        pinyin=move.pinyin,
        visual=move.visual,
        n_frames=len(timestamps),
        ts_list=", ".join(f"{t:.1f}" for t in timestamps),
    )


def parse_review_response(raw: str) -> CandidateReview:
    """Extract JSON from the model response and parse into a CandidateReview."""
    # Strip markdown fences if present
    m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"No JSON object found in response: {raw[:200]}")
    data = json.loads(m.group(0))
    duration = min(int(data["best_duration_sec"]), 15)
    duration = max(duration, 10)
    return CandidateReview(
        matches=bool(data["matches"]),
        quality=int(data["quality"]),
        best_start_sec=int(data["best_start_sec"]),
        best_duration_sec=duration,
        reason=str(data.get("reason", "")),
    )


def review_candidate(move: Move, frames: list[FrameSample], model: str) -> CandidateReview:
    """Call OpenRouter/Gemini with move metadata + frames, return parsed review."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY missing — add it to .env")

    prompt = build_review_prompt(move, [f.timestamp_sec for f in frames])
    content = [{"type": "text", "text": prompt}]
    for f in frames:
        img_b64 = base64.b64encode(f.image_path.read_bytes()).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
        })

    resp = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/anthropics/torah-tai-chi",
            "X-Title": "Torah Tai Chi reference library",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"},
            "max_tokens": 400,
        },
        timeout=120,
    )
    resp.raise_for_status()
    content_str = resp.json()["choices"][0]["message"]["content"]
    return parse_review_response(content_str)
```

- [ ] **Step 4: Re-run tests — PASS**

```bash
python -m pytest tools/test_move_library.py -v
```

- [ ] **Step 5: Real smoke test with one frame + real API**

```bash
python -c "
from pathlib import Path
from tools.move_library import Move, FrameSample, review_candidate, extract_frames
move = Move(slug='demo', english='Single Whip', pinyin='Dān Biān', section='yang_24_form', order=9, priority='high', visual='Wide bow stance with arms extended laterally.')
frames = extract_frames(Path('tools/fixtures/sample.mp4'), n=4, out_dir=Path('tools/fixtures/_smoke'))
r = review_candidate(move, frames, model='google/gemini-3.1-pro-preview')
print(r)
"
```

Expected: prints a `CandidateReview` with `matches=False` (since the fixture is a gray screen, not tai chi) and low quality score. Confirms the API contract works end-to-end.

- [ ] **Step 6: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): Gemini review via OpenRouter — prompt, API call, parser"
```

---

## Task 10: Video trim + re-encode

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write failing test**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import trim_and_encode


def test_trim_and_encode_produces_output(sample_video, tmp_path):
    out = tmp_path / "trimmed.mp4"
    trim_and_encode(sample_video, out, start_sec=0, duration_sec=1)
    assert out.exists()
    assert out.stat().st_size > 1000


def test_trim_and_encode_duration_enforced(sample_video, tmp_path):
    out = tmp_path / "trimmed.mp4"
    trim_and_encode(sample_video, out, start_sec=0, duration_sec=1)
    # Check duration via ffprobe
    from tools.move_library import get_video_duration
    d = get_video_duration(out)
    assert 0.8 <= d <= 1.2
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
def trim_and_encode(src: Path, dst: Path, start_sec: int, duration_sec: int) -> Path:
    """Trim [start, start+duration] from src, re-encode to 720p H.264 + AAC, write to dst."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    duration_sec = max(10, min(duration_sec, 15))
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start_sec), "-i", str(src),
         "-t", str(duration_sec),
         "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
         "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart",
         str(dst)],
        capture_output=True, check=True,
    )
    return dst
```

- [ ] **Step 4: Re-run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): ffmpeg trim + re-encode to 720p H.264"
```

---

## Task 11: Pipeline orchestrator

**Files:**
- Modify: `tools/move_library.py`
- Modify: `tools/test_move_library.py`

- [ ] **Step 1: Write a focused orchestrator test using mocks**

Append to `tools/test_move_library.py`:

```python
from tools.move_library import process_move, PipelineResult


def test_process_move_picks_highest_quality_above_threshold(tmp_path, monkeypatch):
    move = Move(slug="test", english="Test Move", pinyin="T", section="bonus",
                order=1, priority="high", visual="V")

    lib_root = tmp_path / "tai_chi_moves"

    monkeypatch.setattr("tools.move_library.search_youtube",
                        lambda q, n, max_duration_sec=120: ["url1", "url2"])

    dl_paths = [lib_root / ".candidates" / "test" / "1.mp4",
                lib_root / ".candidates" / "test" / "2.mp4"]
    for p in dl_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"fake")

    monkeypatch.setattr("tools.move_library.download_candidate",
                        lambda url, out_path: out_path)
    monkeypatch.setattr("tools.move_library.extract_frames",
                        lambda v, n, out_dir: [FrameSample(0.5, tmp_path / "f.jpg")])

    reviews = iter([
        CandidateReview(matches=True, quality=5, best_start_sec=0, best_duration_sec=10, reason="ok"),
        CandidateReview(matches=True, quality=9, best_start_sec=2, best_duration_sec=12, reason="great"),
    ])
    monkeypatch.setattr("tools.move_library.review_candidate",
                        lambda m, f, model: next(reviews))
    monkeypatch.setattr("tools.move_library.trim_and_encode",
                        lambda src, dst, start_sec, duration_sec: dst.write_bytes(b"trimmed") or dst)

    result = process_move(move, library_root=lib_root, candidates=2,
                          min_quality=7, model="google/gemini-3.1-pro-preview")

    assert result.status == "completed"
    assert result.chosen_quality == 9
    assert result.final_clip_path.exists()


def test_process_move_leaves_review_md_when_all_fail(tmp_path, monkeypatch):
    move = Move(slug="test", english="Test", pinyin="T", section="bonus",
                order=1, priority="low", visual="V")
    lib_root = tmp_path / "tai_chi_moves"

    monkeypatch.setattr("tools.move_library.search_youtube",
                        lambda q, n, max_duration_sec=120: ["url1", "url2"])
    monkeypatch.setattr("tools.move_library.download_candidate",
                        lambda url, out_path: out_path.parent.mkdir(parents=True, exist_ok=True) or out_path.write_bytes(b"fake") or out_path)
    monkeypatch.setattr("tools.move_library.extract_frames",
                        lambda v, n, out_dir: [FrameSample(0.5, tmp_path / "f.jpg")])
    reviews = iter([
        CandidateReview(matches=False, quality=2, best_start_sec=0, best_duration_sec=10, reason="wrong"),
        CandidateReview(matches=False, quality=3, best_start_sec=0, best_duration_sec=10, reason="nope"),
    ])
    monkeypatch.setattr("tools.move_library.review_candidate",
                        lambda m, f, model: next(reviews))

    result = process_move(move, library_root=lib_root, candidates=2,
                          min_quality=7, model="google/gemini-3.1-pro-preview")

    assert result.status == "needs_review"
    review_md = lib_root / ".candidates" / "test" / "review.md"
    assert review_md.exists()
    assert "quality" in review_md.read_text()
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Append to `tools/move_library.py`:

```python
@dataclass
class PipelineResult:
    move: Move
    status: str  # "completed" | "needs_review" | "skipped"
    chosen_quality: Optional[int] = None
    final_clip_path: Optional[Path] = None
    notes: str = ""


def process_move(
    move: Move,
    library_root: Path,
    candidates: int,
    min_quality: int,
    model: str,
) -> PipelineResult:
    final_clip = library_root / f"{move.slug}.mp4"
    candidates_dir = library_root / ".candidates" / move.slug
    candidates_dir.mkdir(parents=True, exist_ok=True)

    urls = search_youtube(move.effective_query, n=candidates)
    if not urls:
        return PipelineResult(move, status="needs_review",
                              notes="No search results.")

    reviews: list[tuple[int, Path, CandidateReview]] = []
    for i, url in enumerate(urls, start=1):
        cand_path = candidates_dir / f"{i}.mp4"
        try:
            downloaded = download_candidate(url, cand_path)
        except Exception as e:
            reviews.append((i, None, CandidateReview(
                matches=False, quality=0, best_start_sec=0,
                best_duration_sec=10, reason=f"download failed: {e}")))
            continue

        frames_dir = candidates_dir / f"_frames_{i}"
        frames = extract_frames(downloaded, n=15, out_dir=frames_dir)
        try:
            review = review_candidate(move, frames, model=model)
        except Exception as e:
            review = CandidateReview(matches=False, quality=0, best_start_sec=0,
                                     best_duration_sec=10, reason=f"review failed: {e}")
        reviews.append((i, downloaded, review))

    # Write audit trail
    review_md_lines = [f"# Review log for {move.english} (`{move.slug}`)\n",
                       f"Query: `{move.effective_query}`\n"]
    for i, path, r in reviews:
        review_md_lines.append(
            f"## Candidate {i}\n"
            f"- path: `{path}`\n"
            f"- matches: {r.matches}\n"
            f"- quality: {r.quality}\n"
            f"- best_window: [{r.best_start_sec}, +{r.best_duration_sec}s]\n"
            f"- reason: {r.reason}\n"
        )

    acceptable = [(i, p, r) for (i, p, r) in reviews
                  if p is not None and r.matches and r.quality >= min_quality]
    if not acceptable:
        (candidates_dir / "review.md").write_text("\n".join(review_md_lines), encoding="utf-8")
        return PipelineResult(move, status="needs_review",
                              notes=f"No candidate scored >= {min_quality}.")

    acceptable.sort(key=lambda t: -t[2].quality)
    winner_i, winner_path, winner_review = acceptable[0]
    trim_and_encode(winner_path, final_clip,
                    start_sec=winner_review.best_start_sec,
                    duration_sec=winner_review.best_duration_sec)

    # Cleanup all candidate artifacts
    for i, path, _ in reviews:
        if path and path.exists():
            path.unlink()
        frames_dir = candidates_dir / f"_frames_{i}"
        if frames_dir.exists():
            for f in frames_dir.iterdir():
                f.unlink()
            frames_dir.rmdir()
    # Remove candidates_dir if empty (success case)
    try:
        candidates_dir.rmdir()
    except OSError:
        pass

    return PipelineResult(move, status="completed",
                          chosen_quality=winner_review.quality,
                          final_clip_path=final_clip,
                          notes=f"Candidate {winner_i}: {winner_review.reason}")
```

- [ ] **Step 4: Wire into `main()`**

Replace the stub body of `main()`:

```python
def main(args: argparse.Namespace) -> int:
    try:
        check_dependencies()
    except MissingDependencyError as e:
        print(str(e), file=sys.stderr)
        return 1

    yaml_path = Path("references/tai_chi_moves/moves.yaml")
    library_root = Path("references/tai_chi_moves")
    moves = load_moves(yaml_path)

    # Apply filters
    if args.slug:
        moves = [m for m in moves if m.slug == args.slug]
    if args.redo:
        moves = [m for m in moves if m.slug == args.redo]
    if args.priority:
        moves = [m for m in moves if m.priority == args.priority]

    # Apply query override
    if args.query_override:
        slug, _, override = args.query_override.partition("=")
        moves = [Move(**{**m.__dict__, "query": override}) if m.slug == slug else m for m in moves]

    # Sort by priority (high first) then section order
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    moves.sort(key=lambda m: (priority_rank[m.priority], m.section, m.order))

    # Skip existing unless --redo
    if not args.redo:
        moves = [m for m in moves if not (library_root / f"{m.slug}.mp4").exists()]

    if not moves:
        print("Nothing to do — all requested moves already have clips.")
        return 0

    results: list[PipelineResult] = []
    for i, m in enumerate(moves, start=1):
        print(f"[{i}/{len(moves)}] {m.slug} ({m.priority}) — searching…")
        try:
            r = process_move(m, library_root=library_root,
                             candidates=args.candidates,
                             min_quality=args.min_quality,
                             model=args.model)
        except Exception as e:
            r = PipelineResult(m, status="needs_review", notes=f"pipeline error: {e}")
        print(f"    → {r.status}" + (f" (quality {r.chosen_quality})" if r.chosen_quality else ""))
        results.append(r)

    print_report(results)
    return 0


def print_report(results: list[PipelineResult]) -> None:
    done = [r for r in results if r.status == "completed"]
    needs = [r for r in results if r.status == "needs_review"]
    print(f"\n=== Report ===")
    print(f"Completed: {len(done)}")
    print(f"Needs review: {len(needs)}")
    if needs:
        print("\nMoves needing manual review:")
        for r in needs:
            print(f"  - {r.move.slug}: {r.notes}")
        print("\nOpen each folder in references/tai_chi_moves/.candidates/<slug>/review.md "
              "to inspect Gemini's notes on each candidate.")
```

- [ ] **Step 5: Run tests — PASS**

```bash
python -m pytest tools/test_move_library.py -v
```

- [ ] **Step 6: Commit**

```bash
git add tools/move_library.py tools/test_move_library.py
git commit -m "feat(tai-chi-refs): pipeline orchestrator + end-of-run report"
```

---

## Task 12: End-to-end integration smoke test

**Files:** no code changes — validates the pipeline end to end.

- [ ] **Step 1: Pick a single canonical move and run the pipeline**

```bash
cd "c:/Users/yitzym/git/torah tai chi"
python -m tools.download_moves --slug wuji_stance --candidates 3
```

Expected outcome:
- Script prints `[1/1] wuji_stance (high) — searching…` and progresses through downloads.
- Takes ~2-5 minutes.
- Outcome is either:
  - `→ completed (quality N)` with a file at `references/tai_chi_moves/wuji_stance.mp4` — watch it, confirm it shows someone standing in Wuji stance.
  - `→ needs_review` with `references/tai_chi_moves/.candidates/wuji_stance/review.md` populated — read it, confirm Gemini's reasoning is sensible.

- [ ] **Step 2: If the result is "completed", verify the clip manually**

Open `references/tai_chi_moves/wuji_stance.mp4` in a player. Confirm:
- Full body visible
- 10-15 seconds long
- Shows the posture described
- No text overlays obscuring the subject
- Single clean execution

If any of those fail, run `python -m tools.download_moves --redo wuji_stance --candidates 5 --min-quality 8` and retry.

- [ ] **Step 3: If the result is "needs_review", read the review.md**

Confirm Gemini is rejecting for sensible reasons (e.g. "camera mostly on instructor's face" or "crowd in the shot"). If Gemini is rejecting good clips, lower the threshold with `--min-quality 6` and retry.

- [ ] **Step 4: Second test — a Chen-style move (harder case)**

```bash
python -m tools.download_moves --slug buddha_warrior_pounds_mortar --candidates 5
```

This tests the model's ability to identify a less-common Chen-style posture. Expect either completion at lower quality or needs_review with reasonable notes.

- [ ] **Step 5: No commit needed — validation only**

If bugs surface, fix them and commit fixes as their own commits.

---

## Task 13: README + curation workflow docs

**Files:**
- Modify: `tools/README.md`

- [ ] **Step 1: Write the README**

Overwrite `tools/README.md`:

```markdown
# Tai Chi Reference Library Tools

Builds a local library of short tai chi move demonstration clips under `references/tai_chi_moves/` by searching YouTube, downloading candidates, and using Gemini 3.1 Pro (via OpenRouter) to pick the cleanest clip per move.

## Setup

1. Install deps:
   ```bash
   pip install yt-dlp pyyaml httpx python-dotenv pytest
   ```
2. Confirm `ffmpeg` and `ffprobe` are on your PATH.
3. Confirm `.env` has `OPENROUTER_API_KEY` set.

## Commands

### Build the whole library (priority order)
```bash
python -m tools.download_moves
```
Processes all 41 moves in priority order (high → medium → low). Skips any that already have a clip.

### Build just the high-priority moves
```bash
python -m tools.download_moves --priority high
```

### Do a single move
```bash
python -m tools.download_moves --slug single_whip
```

### Redo a move you weren't happy with
```bash
python -m tools.download_moves --redo single_whip --candidates 10 --min-quality 6
```

### Override the search query for one run
```bash
python -m tools.download_moves --redo cloud_hands --query-override "cloud_hands=yun shou tai chi slow demonstration"
```

### Use a different model
```bash
python -m tools.download_moves --slug buddha_warrior_pounds_mortar --model anthropic/claude-opus-4.7
```

## Curation workflow

After a run, check `references/tai_chi_moves/` for the clips that landed. For any move that ended up in the "needs review" list:

1. Open `references/tai_chi_moves/.candidates/<slug>/review.md` to see Gemini's notes on each candidate.
2. Decide whether to:
   - **Lower the threshold**: `python -m tools.download_moves --redo <slug> --min-quality 6`
   - **Try more candidates**: `--redo <slug> --candidates 10`
   - **Fix the search**: edit the move's `query` in `moves.yaml` and `--redo` it
   - **Escalate to Claude Opus**: `--redo <slug> --model anthropic/claude-opus-4.7`
   - **Manually pick**: if one candidate in `.candidates/<slug>/` is actually good, rename it to `<slug>.mp4` in the parent folder

## Files

- `download_moves.py` — CLI entry
- `move_library.py` — all logic (loader, search, download, review, trim, pipeline)
- `test_move_library.py` — unit tests
- `../references/tai_chi_moves/moves.yaml` — canonical move list
- `../docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md` — full spec
```

- [ ] **Step 2: Commit**

```bash
git add tools/README.md
git commit -m "docs(tai-chi-refs): tools/README with commands + curation workflow"
```

---

## Self-review checklist

Before declaring the plan done, the executor should confirm:

- [ ] All 13 tasks committed cleanly
- [ ] `python -m pytest tools/test_move_library.py -v` shows all tests passing
- [ ] `python -m tools.download_moves --help` prints usable help text
- [ ] End-to-end smoke (Task 12) produced at least one good clip OR a sensible review.md
- [ ] `references/tai_chi_moves/moves.yaml` has exactly 41 entries (grep `^  - slug:` should return 41 matches)
- [ ] No secrets committed (`.env` still gitignored, no keys in test files)
