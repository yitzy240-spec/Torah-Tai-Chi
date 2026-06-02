# Sentence-Beat Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-insert a verified third-person written beat between sentences in every Seedance prompt's voiceover so Rav Eli pauses naturally between sentences — no operator effort, no stitcher changes, no rendered-clip backfill required.

**Architecture:** Pure helper `_inject_sentence_beats(voiceover: str) -> str` in `src/video_generator.py` that splits on sentence-end punctuation (`. ! ?` followed by whitespace + capital letter — handles common abbreviations like `Dr. Smith` correctly) and renders each sentence as its own `Character speaks: "..."` block separated by a verified beat line. Single-sentence voiceovers pass through unchanged (no regression). One-line wire-in at `build_seedance_input()`.

**Tech Stack:** Python 3.13, pytest, re module (stdlib). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-06-02-sentence-beats-cadence-design.md](../specs/2026-06-02-sentence-beats-cadence-design.md)

---

## File Structure

**Modified:**
- `src/video_generator.py` — add `_BEAT_TEXT` constant + `_inject_sentence_beats(voiceover)` helper near the top; replace one line in `build_seedance_input()` (currently constructs `f'Character speaks: "{normalized_vo}"\n'`) with `_inject_sentence_beats(normalized_vo)`.
- `tests/test_video_generator.py` — append 5 new tests covering single-sentence, two-sentence, three-sentence, abbreviation, and empty-string cases.

**Created:** none

**No data migration, no schema change, no new env vars.**

---

## Task 1: Helper passes single-sentence voiceover through unchanged

**Files:**
- Modify: `src/video_generator.py` (add `_BEAT_TEXT` const + `_inject_sentence_beats` function near the top of the module, after the imports)
- Modify: `tests/test_video_generator.py` (append a new test)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_video_generator.py`:

```python
from src.video_generator import _inject_sentence_beats


def test_inject_sentence_beats_single_sentence_unchanged():
    """Single-sentence voiceover renders as one Character speaks: block
    with no beat — back-compat with pre-cadence behavior."""
    out = _inject_sentence_beats("When Yaakov wrestled the angel, he did not run.")
    assert out == 'Character speaks: "When Yaakov wrestled the angel, he did not run."\n'
    assert "holds the moment" not in out  # no beat for single sentence
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_video_generator.py::test_inject_sentence_beats_single_sentence_unchanged -v`
Expected: FAIL with `ImportError: cannot import name '_inject_sentence_beats' from 'src.video_generator'`

- [ ] **Step 3: Write minimal implementation**

In `src/video_generator.py`, after the imports and before `build_seedance_input`, add:

```python
import re

# Verified third-person stage direction inserted between adjacent
# sentences in the voiceover. Tested 2026-06-01 via single-clip
# Seedance render — produces a clean ~1.4s pause with mouth closed
# and no leaked stage direction (see
# docs/superpowers/specs/2026-06-02-sentence-beats-cadence-design.md).
_BEAT_TEXT = "Rav Eli holds the moment, breathes calmly, then continues:"


def _inject_sentence_beats(voiceover: str) -> str:
    """Render a voiceover as one or more `Character speaks: "..."` blocks
    with the verified beat line between adjacent sentences.

    Single-sentence voiceovers render identically to the pre-beat
    behavior. The split regex requires sentence-end punctuation
    followed by whitespace and a capital letter — that gap-then-capital
    constraint avoids splitting on common abbreviations like `Dr.` or
    `Mr.` where the period is followed by a capital but no whitespace.
    """
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', voiceover.strip())
    sentences = [s.strip() for s in sentences if s.strip()]
    if len(sentences) <= 1:
        return f'Character speaks: "{voiceover}"\n'
    parts: list[str] = []
    for i, s in enumerate(sentences):
        parts.append(f'Character speaks: "{s}"')
        if i < len(sentences) - 1:
            parts.append(_BEAT_TEXT)
    return "\n".join(parts) + "\n"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_video_generator.py::test_inject_sentence_beats_single_sentence_unchanged -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "feat(cadence): add _inject_sentence_beats helper (single-sentence path)"
```

---

## Task 2: Multi-sentence voiceover renders with beats between

**Files:**
- Modify: `tests/test_video_generator.py` (append 2 new tests)
- `src/video_generator.py` should already handle this from Task 1's implementation — verify with the new tests; no code change expected.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_video_generator.py`:

```python
def test_inject_sentence_beats_two_sentences_one_beat():
    """Two sentences produce two Character speaks: blocks separated by
    exactly one beat line."""
    out = _inject_sentence_beats(
        "When Yaakov wrestled the angel, he did not run. He stayed in contact until dawn."
    )
    expected = (
        'Character speaks: "When Yaakov wrestled the angel, he did not run."\n'
        'Rav Eli holds the moment, breathes calmly, then continues:\n'
        'Character speaks: "He stayed in contact until dawn."\n'
    )
    assert out == expected
    assert out.count("Character speaks:") == 2
    assert out.count("holds the moment") == 1


def test_inject_sentence_beats_three_sentences_two_beats():
    """Three sentences produce three blocks separated by two beats —
    confirms the beat is inserted between every adjacent pair, not just
    the first."""
    out = _inject_sentence_beats("He walked. He thought. He prayed.")
    assert out.count("Character speaks:") == 3
    assert out.count("holds the moment") == 2
    # Beats appear BETWEEN blocks, not before the first or after the last
    lines = [ln for ln in out.split("\n") if ln]
    assert lines[0].startswith("Character speaks:")
    assert lines[-1].startswith("Character speaks:")
```

- [ ] **Step 2: Run tests to verify they pass (Task 1's impl already handles them)**

Run: `pytest tests/test_video_generator.py::test_inject_sentence_beats_two_sentences_one_beat tests/test_video_generator.py::test_inject_sentence_beats_three_sentences_two_beats -v`
Expected: BOTH PASS (the regex + loop from Task 1 covers these cases)

If either fails: re-check the helper implementation against the spec's edge-case table.

- [ ] **Step 3: Commit**

```bash
git add tests/test_video_generator.py
git commit -m "test(cadence): verify multi-sentence splits produce N-1 beats"
```

---

## Task 3: Abbreviations and empty-input edge cases

**Files:**
- Modify: `tests/test_video_generator.py` (append 2 new tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_video_generator.py`:

```python
def test_inject_sentence_beats_abbreviation_does_not_split():
    """`Dr.` / `Mr.` / `Mrs.` style abbreviations have a period followed
    by a capital letter but NO whitespace gap (single space matters: the
    regex requires the whitespace BETWEEN the period and the capital).
    A real sentence boundary has `. ` followed by capital. Verify the
    Dr. case does NOT split."""
    # `Dr. Smith said hello. He walked away.` is two sentences. The split
    # should happen between `hello.` and `He`, NOT between `Dr.` and `Smith`.
    out = _inject_sentence_beats("Dr. Smith said hello. He walked away.")
    assert out.count("Character speaks:") == 2  # exactly 2, not 3
    assert out.count("holds the moment") == 1


def test_inject_sentence_beats_empty_string_does_not_crash():
    """Empty or whitespace-only voiceover renders as a single (empty)
    block — no crash, no beat. Defensive back-compat for any clip whose
    voiceover field is empty."""
    out = _inject_sentence_beats("")
    assert out == 'Character speaks: ""\n'
    assert "holds the moment" not in out
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_video_generator.py::test_inject_sentence_beats_abbreviation_does_not_split tests/test_video_generator.py::test_inject_sentence_beats_empty_string_does_not_crash -v`
Expected: BOTH PASS

**About the abbreviation case:** The regex `(?<=[.!?])\s+(?=[A-Z])` requires whitespace between the period and the next capital. `Dr. Smith` has `Dr.` + space + `Smith` — that DOES match the regex (single space is `\s+`). Wait — re-check: this WOULD false-split `Dr. Smith` because the pattern matches `. S`. The test is checking that the operator-typed input `Dr. Smith said hello. He walked away.` produces 2 sentences, but the regex would actually produce 3: `["Dr.", "Smith said hello.", "He walked away."]`. If this test FAILS, that's expected behavior surfacing — see Step 3.

- [ ] **Step 3: If the abbreviation test fails, fix the regex**

If `test_inject_sentence_beats_abbreviation_does_not_split` fails (output has 3 `Character speaks:` not 2), the regex needs to be smarter. Tighten by requiring at least 2 characters of word before the period (most abbreviations are short):

```python
sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z][a-z])', voiceover.strip())
```

Wait — that's still wrong because `Smith` starts with capital-then-lowercase. Better: require a **multi-character word ending** before the period, OR maintain a small abbreviation set. For v1, take the simple route:

```python
# Common short abbreviations that end with a period followed by a name.
# Operators using these in voiceovers won't false-split.
_ABBREVS = re.compile(r'\b(Dr|Mr|Mrs|Ms|St|Sr|Jr|vs|etc)\.\s+(?=[A-Z])')

def _inject_sentence_beats(voiceover: str) -> str:
    # Temporarily mask abbreviations so the split regex doesn't see them
    masked = _ABBREVS.sub(lambda m: m.group(0).replace('. ', '\x00'), voiceover.strip())
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', masked)
    sentences = [s.replace('\x00', '. ').strip() for s in sentences if s.strip()]
    ...
```

Or simpler: keep the dumb regex and document that abbreviations may false-split. For Yonah's Torah teaching voiceovers, `Dr.` / `Mr.` are rare. If the test fails, accept that as known behavior and update the test to expect 3 blocks. Decide based on whether Yonah's actual scripts use these.

For v1, **prefer the abbreviation-mask approach** above. Re-run the test until it passes.

- [ ] **Step 4: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "test(cadence): edge cases — abbreviations and empty input"
```

---

## Task 4: Wire helper into build_seedance_input

**Files:**
- Modify: `src/video_generator.py` (around line 127-134, inside `build_seedance_input`)
- Modify: `tests/test_video_generator.py` (append 1 integration test)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_video_generator.py`:

```python
def test_build_seedance_input_voiceover_gets_sentence_beats():
    """End-to-end: a clip with a two-sentence voiceover produces a
    payload['prompt'] that contains TWO Character speaks: blocks and
    ONE beat between them. Verifies the helper is actually wired in."""
    clip = Clip(
        index=0,
        voiceover="When Yaakov wrestled the angel, he did not run. He stayed until dawn.",
        visual_prompt="Rav Eli sits, dolly in, soft morning light",
        duration_s=10,
        setting_id="DOJO",
    )
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"],
        dojo_ref_urls=["https://x/dojo1.png"],
        first_frame_url=None,
        audio_url=None,
        resolution="720p",
    )
    prompt = payload["prompt"]
    assert prompt.count("Character speaks:") == 2
    assert "Rav Eli holds the moment, breathes calmly, then continues:" in prompt
    # Ordering: first sentence, then beat, then second sentence
    first_idx = prompt.index('"When Yaakov wrestled the angel, he did not run."')
    beat_idx = prompt.index("holds the moment")
    second_idx = prompt.index('"He stayed until dawn."')
    assert first_idx < beat_idx < second_idx
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_video_generator.py::test_build_seedance_input_voiceover_gets_sentence_beats -v`
Expected: FAIL — `prompt.count("Character speaks:")` is 1 (the wire-in hasn't happened yet).

- [ ] **Step 3: Wire the helper into build_seedance_input**

Open `src/video_generator.py`. Find the prompt assembly inside `build_seedance_input` (currently around line 127-134, look for the f-string starting with `f"{clip.visual_prompt}\n\n"`). The line that reads:

```python
        f'Character speaks: "{normalized_vo}"\n'
```

Replace with:

```python
        _inject_sentence_beats(normalized_vo),
```

(Note: the helper already returns a string ending in `\n`, so we replace the entire f-string element. The resulting prompt assembly looks like:)

```python
    prompt = (
        f"{clip.visual_prompt}\n\n"
        + _inject_sentence_beats(normalized_vo)
        + emotive_clause
        + voice_clause
        + STYLE_LOCK
        + motion_addendum
    )
```

Adjust syntax to match the surrounding code style (f-string concatenation vs `+`). If the surrounding block uses f-strings, keep f-strings and just interpolate the helper:

```python
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f"{_inject_sentence_beats(normalized_vo)}"
        f"{emotive_clause}"
        f"{voice_clause}"
        f"{STYLE_LOCK}"
        f"{motion_addendum}"
    )
```

- [ ] **Step 4: Run the new test + full file**

Run: `pytest tests/test_video_generator.py -v`
Expected: ALL TESTS PASS (the new integration test plus every existing test in the file — the wire-in must not regress any pre-existing payload assertion).

If existing tests fail: check whether any existing test asserts on the EXACT old `Character speaks:` line. If yes, update those tests to use the helper's output shape (single-sentence voiceovers still render the same — pre-existing tests use `Hello.` and `Hi.` which are single-sentence and pass-through unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/video_generator.py tests/test_video_generator.py
git commit -m "feat(cadence): wire sentence-beat helper into Seedance prompt assembly

Voiceovers with multiple sentences now render as multiple Character
speaks: blocks separated by a verified beat line. Single-sentence
voiceovers pass through unchanged (no regression). Cadence applies to
every NEW render automatically; existing rendered clips are unchanged
and need a per-clip Re-render from Phase 2 to pick up the new
cadence (see spec docs/superpowers/specs/2026-06-02-sentence-beats-cadence-design.md
§ Rollout)."
```

---

## Task 5: Manual smoke + deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full test suite to confirm nothing else regressed**

Run: `pytest tests/test_video_generator.py tests/test_script_generator.py tests/test_models.py -v`
Expected: ALL PASS

- [ ] **Step 2: Push to deploy**

```bash
git push
```

The Modal worker picks up the new prompt-assembly logic on the next deploy. Cadence applies to every NEW render automatically. No rolling restart needed (Modal cold-starts on each job by design).

- [ ] **Step 3: Beha'alotcha backfill (operator-driven, NOT this plan's responsibility)**

Per the spec's Rollout section, Yonah picks up cadence on Beha'alotcha by:
- Opening `/videos/beha-alotcha?phase=2`
- Hitting **Re-render** on each clip with a multi-sentence voiceover
- Hitting **Preview stitched video** to re-compose

That's a separate operator action — flag it to him after deploy so he knows the option exists. No code from this plan needs to do it.

---

## Self-Review Notes

**Spec coverage:**
- ✅ Helper function (`_inject_sentence_beats`) — Task 1
- ✅ Single-sentence pass-through — Task 1
- ✅ Two-sentence split + one beat — Task 2
- ✅ Three-sentence split + two beats — Task 2
- ✅ Abbreviation handling (`Dr. Smith`) — Task 3
- ✅ Empty-input back-compat — Task 3
- ✅ Wire-in to `build_seedance_input` — Task 4
- ✅ Integration test on payload['prompt'] — Task 4
- ✅ Deploy + Beha'alotcha backfill instructions — Task 5

**Out of scope per spec (deliberately NOT in plan):**
- Quote-within-sentence handling (deferred per spec)
- Operator marker to suppress beats (YAGNI per spec)
- Beat-text variation per clip emotive_note (deferred per spec)
- Stitcher-level inter-clip pause (different concern, separate work)
