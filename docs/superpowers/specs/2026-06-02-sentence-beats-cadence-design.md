# Sentence-Beat Cadence — Design

**Date:** 2026-06-02
**Status:** Awaiting plan
**Validation:** Verified via single-clip Seedance render on 2026-06-01 (work/seedance_cadence_test/cadence_written_beat.mp4). Yonah confirmed audible pause, mouth closed during pause, no leaked stage direction.

## Goal

Make Rav Eli's generated voice pause naturally between sentences in every rendered clip — without operator effort, prompt-engineering, or stitch-time silence insertion.

## Why

Yonah and external viewers have reported that stitched videos read as **rushed** because Seedance's TTS gives no breathing room between sentences. Punctuation is treated as written-text grammar, not speech timing.

Prior attempts and why they failed:
- **`...` inside the quoted voiceover (Yonah, 2026-06-01):** Seedance went silent for ~2s but kept Rav Eli's mouth moving. Lip-sync broke visibly.
- **Stitcher-level silence between clips (proposed, rejected 2026-06-01):** introduces 400ms held-frame freezes at every clip join. User rejected the look.
- **"Wait a beat before speaking" inside `visual_prompt` (Yonah, 2026-06-01):** Seedance produced silence-then-speech but didn't hold the mouth still during the silence. Same lip-sync break as the `...` attempt.

What actually works (verified):
- **Third-person written beats outside the quoted speech.** UGC Copilot's audio guide (https://ugccopilot.ai/blog/seedance-2-native-audio-generation-guide/) states: *"Insert a written beat ('She pauses, then continues:') between sentences — Seedance uses written beats as resync anchors."* The test render confirms it: 1.4s pause between sentences, mouth closed, no leaked text.

The key insight: Seedance recognizes a third-person stage direction (present-tense prose ending with a colon) as a director note rather than character speech. It pauses, holds the mouth, then resumes the next quoted line.

## Scope

### In scope

- Per-clip prompt assembly in `src/video_generator.py:build_seedance_input()` splits the operator's voiceover on sentence-end punctuation and inserts a verified beat between adjacent sentences.
- One pure helper function (`_inject_sentence_beats`) wraps the split + beat logic.
- 5 unit tests in `tests/test_video_generator.py` covering the canonical cases.
- Universal default: every clip with multi-sentence voiceover gets beats automatically.

### Out of scope (v1)

- Operator marker to suppress beat insertion at a specific join (`{{no-beat}}` or similar). YAGNI for v1 — re-evaluate after we see real-world output.
- Stitcher-level changes (already rejected by user).
- Backfilling cadence into already-rendered clips. Existing clips have audio baked in; operator manually re-renders the clips they want refreshed via the existing per-clip Re-render flow. No new product surface needed.
- Tuning the beat duration. The test render produced a 1.4s pause from the verified beat text. Operator hasn't asked for shorter/longer. Defer until requested.
- Beat-text variation per clip emotive_note (e.g. faster for excited, slower for solemn). One beat phrasing for now.
- Quote-within-sentence handling (e.g. `"...he asked, 'why?' Then Yaakov replied."`). The inner `?` could false-split. Rare in Torah teaching scripts; defer until it bites.

## Non-goals

- Inter-clip pause (between two adjacent stitched clips). This is a different problem; sentence cadence within a clip is what Yonah and listeners flagged.
- Speech rate control (medium-fast vs slow). Independent dimension; cadence is about pauses, not pace.

## Design

### Where

A single edit to `src/video_generator.py`. The function `build_seedance_input()` currently assembles the per-clip Seedance prompt with one `Character speaks: "..."` line. The new helper splits that single line into multiple `Character speaks:` blocks with beats between them.

### The helper

```python
import re

_BEAT_TEXT = "Rav Eli holds the moment, breathes calmly, then continues:"

def _inject_sentence_beats(voiceover: str) -> str:
    """Render a voiceover as one or more `Character speaks: "..."` blocks
    with a verified written beat between adjacent sentences.

    Single-sentence voiceovers render identically to the pre-beat
    behavior (no beat line) so the change is a no-op for short clips.

    Splits on sentence-end punctuation (. ! ?) followed by whitespace
    and a capital letter — that constraint avoids splitting on common
    abbreviations like `Dr. Smith` or `Mr. Cohen` where the period is
    followed by a capital but no whitespace gap.

    The beat text is the exact verified phrasing from the 2026-06-01
    Seedance test (work/seedance_cadence_test/cadence_written_beat.mp4),
    which produced a clean 1.4s pause with mouth closed and no
    leaked stage direction.
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

### The wire

`build_seedance_input()` line ~129 replaces the single `Character speaks:` line with the helper call:

```python
# before
prompt = (
    f"{clip.visual_prompt}\n\n"
    f'Character speaks: "{normalized_vo}"\n'
    f"{emotive_clause}"
    ...
)
# after
prompt = (
    f"{clip.visual_prompt}\n\n"
    f"{_inject_sentence_beats(normalized_vo)}"
    f"{emotive_clause}"
    ...
)
```

No other call sites change. `normalize_voiceover_for_tts()` runs upstream as before — beat-splitting works on the already-normalized text (Chi → chee, etc.).

### Edge cases handled

| Voiceover | Result | Beats |
|---|---|---|
| `When Yaakov wrestled the angel, he did not run.` | unchanged single block | 0 |
| `He did not run. He stayed.` | two blocks, one beat between | 1 |
| `He walked. He thought. He prayed.` | three blocks, two beats | 2 |
| `Dr. Smith said hello. He walked away.` | two blocks (Dr. doesn't trigger split — no whitespace gap after period) | 1 |
| (empty string) | unchanged single block, no crash | 0 |
| `He went. then he came back.` | one block (lowercase after period, not a sentence boundary) | 0 |

### Edge cases deferred

- **Quotes-within-sentence:** `"... he asked, 'why?' Then Yaakov replied."` — the inner `?` is followed by `Then` (capital after whitespace) so the regex splits there incorrectly. Mitigation: rare in Torah teaching prose; revisit if reported.
- **Run-on sentence with mid-sentence em-dashes:** the operator can express those pauses via the `emotive_note` field or by restructuring the voiceover into shorter sentences (which Seedance handles better anyway per Cutout.pro's 5-10 words/sentence sweet-spot guidance).

## Risks

- **Clip duration overflow.** With 3 sentences and 2 beats at ~1-1.5s each, a 10s clip has ~3s of silence + ~7s of speech. If the operator wrote 8s worth of speech into a 10s clip with 3 sentences, the rendered clip might run long. Seedance is asked to fit the `duration` parameter; behavior under overflow is to compress or truncate.
  - **Mitigation:** post-deploy, watch for clips that come back longer than requested. If it happens, tighten `duration` budget or warn the operator at edit time when voiceover word count is high.
- **Operator confusion about why cadence appeared.** No new UI surface — pauses just "happen." Yonah expects this and will see the improvement immediately. External viewers won't notice anything other than that videos sound less rushed.

## Testing

5 unit tests in `tests/test_video_generator.py` covering:
1. Single sentence → no beat, single block
2. Two sentences → one beat, two blocks
3. Three sentences → two beats, three blocks
4. `Dr. Smith said hello. He walked away.` → one beat only (abbreviation respected)
5. Empty string → no crash, single empty block (back-compat)

Plus visual verification: the 2026-06-01 Seedance render confirms the technique produces a clean pause without lip-sync break or leaked stage direction.

## Rollout

1. Code change ships with the next Modal deploy.
2. Cadence applies to every NEW render automatically.
3. For backfilling Beha'alotcha (or any existing video):
   - Operator opens `/videos/{slug}?phase=2`
   - Hits **Re-render** on each clip with multi-sentence voiceover
   - Each re-render goes through the new prompt-assembly path
   - Operator hits **Preview stitched video** to re-stitch with the refreshed clip
   - Cost: 1 Kie credit per clip (~$0.50-1 at standard tier)
4. No data migration. No schema change. No new env vars.

## Cost

- Implementation: ~30 lines of code + ~30 lines of test.
- Per-clip cost: zero — Seedance call shape is identical (one `prompt` field; the prompt is slightly longer).
- Backfill cost for Beha'alotcha: ~$2-4 depending on how many clips are multi-sentence.

## Decision log

- **Auto-inject vs operator marker:** chose auto. Yonah's complaint was universal ("needs to pause between sentences sometimes") and matches the AI-vibe-coding "zero operator effort" preference.
- **Beat text:** chose the exact phrasing verified in the test render. Will not parameterize unless future tests show variant phrasings produce better results.
- **Splitting regex:** chose `(?<=[.!?])\s+(?=[A-Z])` — the whitespace + capital-letter constraint avoids common abbreviation false-positives without needing an abbreviation dictionary.
