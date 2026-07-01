# Adaptive, per-join stitch transitions with operator presets

- **Date:** 2026-06-24 (control UX revised 2026-07-01)
- **Status:** Phase 1 (engine / adaptive Auto) BUILT + tested on real clips,
  pending deploy. Phase 2–3 (Auto/Tighter/Looser controls + per-cut) speccing → build.
- **Author:** Yitzy + Claude
- **Area:** `src/stitcher.py`, `modal_app.py` stitch paths, dashboard video page

## Problem

Every clip-to-clip join is stitched with a **single, fixed ~900 ms gap**
(`_FADE_OUT_S` 400 ms fade-to-black + silence, then `_STILL_FRAME_PRE_S`
500 ms silent still-frame fading in — see `src/stitcher.py`). That value
was tuned on 2026-06-02 for the *worst case*: narration running right to
the edge of a clip, where the gap is needed to keep two utterances from
colliding.

But where Seedance places speech inside each clip **varies every week and
every join**. When a clip already ends with a clean pause, the fixed
900 ms lands *on top of* existing silence → dead air → the "video keeps
stopping and starting" choppiness Yonah reported on the latest published
video. Last week the same 900 ms was load-bearing; this week it's too
much. One fixed value cannot fit clips whose speech timing changes per
join.

A naive "let the operator set the transition length" toggle treats the
symptom and pushes a per-week (or per-join) judgment call onto a
non-technical, mobile-first operator — the same complexity creep that
makes us wary of turning the dashboard into video-editing software.

## Goals

- Each join's pause **self-corrects** to the clip's actual speech timing,
  with zero operator input in the common case.
- Give the operator a **simple aesthetic intent** control (overall feel),
  not a mechanical per-cut editor.
- Preserve everything the current stitcher already gets right: no audio
  bleed (still-frame structure, no overlap), lip-sync intact, the de-tone
  notch, the trailing-artifact tail fade, forced 30 fps for Reels.
- Backward-compatible: the 10+ existing `concat_clips` call sites must keep
  working unchanged; they simply get adaptive-Standard transitions for free.

## Non-goals

- No embedded/timeline video editor. Explicitly rejected: wrong product
  fit (mobile-first "press the weekly button" operator), large maintenance
  surface for one user, and it wouldn't solve what is fundamentally an
  audio-timing problem.
- No per-join *finer-than-preset* control (no millisecond sliders). The
  override vocabulary is the same three presets.
- Not a fix for the root cause (Seedance choosing speech placement). That
  is the separate decoupled-audio / dub-track track of work; this design
  is correct and useful before, during, and after that lands.

## The three-layer model

1. **Automatic per-join tuning (always on, invisible).** At each boundary,
   measure the real trailing silence of clip N and leading silence of
   clip N+1, and insert only enough breath to reach a *target pause*.
   Computed independently per join — this is what absorbs per-clip pacing
   variance.
2. **Global preset (one control, default Standard).** *Tight / Standard /
   Breathing room*. Sets the target pause the tuning aims for across the
   whole video. The common-case, one-tap control.
3. **Per-join override (progressive disclosure, rarely needed).** If one
   specific cut still feels wrong, the operator can override just that join
   to a different preset. Same three words; surfaced only on demand.

Default operator experience: **do nothing → every join auto-tuned to
Standard.** The preset and per-join knobs stay out of the way until summoned.

## Layer 1 — automatic per-join tuning

**Silence measurement.** For each clip, run ffmpeg `silencedetect` on the
**de-toned** audio (the existing `_DETONE_FILTER` first, so the 5.5 kHz
whine doesn't read as sound) to derive:

- `trailing_silence(N)` — seconds from the last non-silent sample to clip end.
- `leading_silence(N+1)` — seconds from clip start to the first non-silent sample.

Gotcha to resolve in planning: Seedance bakes a ~−28 dB burst into the last
~100 ms of a clip, which sits *above* a −30 dB silence threshold and would
make the tail read as non-silent. Mitigation options: measure with the
threshold set above the artifact (e.g. −25 dB), and/or ignore the final
~120 ms when computing `trailing_silence`. The plan picks one and verifies
on a real clip.

**Fill-to-target math, per join (clip N → N+1):**

```
existing_breath = trailing_silence(N) + leading_silence(N+1)
deficit         = target_pause - existing_breath
inserted_pause  = clamp(deficit, MIN_PAUSE, MAX_PAUSE)
```

- `inserted_pause` is realized as the **silent still-frame hold** prepended
  to clip N+1 (static frame ⇒ lip-sync safe, no speech to desync).
- A small **fixed visual fade** always stays for polish — a short
  fade-out on clip N (~250 ms) and a short fade-in on the still-frame
  (~250 ms) — independent of `inserted_pause`. This guarantees no join is
  ever a jarring hard cut, even when `existing_breath ≥ target_pause` and
  `inserted_pause` floors to `MIN_PAUSE`.
- `MIN_PAUSE` (e.g. ~150 ms) keeps a hair of breath even on already-spacious
  joins; `MAX_PAUSE` (e.g. ~1200 ms) caps the worst case so a clip with no
  trailing silence can't produce an absurd gap.

This separates **visual polish** (fixed, small) from **breath** (adaptive),
which is the conceptual core of the fix. The still-frame + no-overlap
structure is unchanged, so the 2026-06-02 audio-bleed failure mode cannot
recur.

## Layer 2 — global control: Auto + Tighter/Looser

The operator-facing control is **Auto by default**, with a relative nudge
for the whole video. "Auto" is not a different engine — it's the adaptive
tuning at the Standard target. The nudge shifts that target up/down. This
framing (chosen 2026-07-01) beats named presets because the operator judges
*after* watching and thinks "a bit tighter," not "switch to Breathing."

Discrete levels, stored as a signed integer `level` (−2…+2), mapped to a
target inter-speech pause (provisional, calibrated on a real video):

| Level | Label       | Target pause |
|-------|-------------|--------------|
| −2    | Tighter ××  | ~0.40 ms→s   |
| −1    | Tighter ×   | ~0.55 s      |
|  0    | **Auto**    | ~0.70 s      |
| +1    | Looser ×    | ~0.85 s      |
| +2    | Looser ××   | ~1.00 s      |

Storing the *level* (not raw ms) lets us retune the mapping centrally
without migrating data. Level 0 (Auto) is the default and requires zero
interaction — most videos never leave it.

## Layer 3 — per-cut override

- Stored as a sparse map from join index → `level`. Join index keys on the
  **left** clip (join *i* = clip *i* → clip *i+1*).
- Absent key ⇒ that cut follows the global level. Overrides are sparse; the
  common video stores none.
- Presented in the same Auto/Tighter/Looser vocabulary, one row per cut,
  labelled by position + timestamp (e.g. "Cut 2 · 0:20") so he can match
  the transition he just saw to the row.
- Progressive disclosure: revealed only when the operator opens the
  transition control *and* chooses to fine-tune a specific cut. Never on the
  default review surface.

## Data model

Stitch settings belong to the **video/parsha**, not the job — they must
survive individual clip regens (a regen creates a new job but should not
reset the operator's chosen feel). Proposed shape, stored as JSONB on the
per-video record (exact table — `clip_plans` vs `videos` — confirmed in the
plan):

```json
{
  "level": 0,                // global −2..+2; 0 = Auto (default if absent)
  "joins": { "1": -1 }        // sparse per-cut overrides (left-clip index → level)
}
```

Absent column / null ⇒ Auto everywhere, which is also what every legacy
render and every fresh video produces. No migration of existing rows needed.
The `resolve_stitch_targets` helper maps `level` → `target_pause_s` and the
`joins` map → `join_overrides` for `concat_clips`.

## Stitcher API changes

`concat_clips` gains **backward-compatible optional parameters**:

```python
def concat_clips(
    clips: list[Path],
    dest: Path,
    crossfade_s: float = 0.35,          # retained, still ignored
    target_pause_s: float | None = None, # None ⇒ Standard default
    join_overrides: dict[int, float] | None = None,  # left-clip index → target_pause_s
) -> Path: ...
```

- When both new params are `None`/empty, `concat_clips` runs adaptive
  tuning at the **Standard** target. So **all 10+ existing call sites
  improve for free** with no signature change at the call.
- Only the paths where the operator can set a preset/override (full render,
  regen, compose) need to resolve the stored settings into these params and
  pass them. A single helper (`resolve_stitch_targets(video_settings,
  n_clips) -> (target_pause_s, join_overrides)`) does that resolution so the
  preset→ms mapping lives in one place.
- The fixed `_FADE_OUT_S` / `_STILL_FRAME_PRE_S` constants are replaced by:
  fixed small visual-fade constants (polish) + the computed adaptive pause.

`loudnorm_then_concat` (compose path) forwards the same new params.

## UI / operator flow — auto-first, adjust-after-review

Transitions can only be judged *after* watching, so the flow is: stitch on
Auto → review → optionally nudge → re-stitch → review again. The control
lives directly under the **finished stitched video** at the review step
(exact phase/component pinned in the plan).

1. Operator stitches; the video assembles with **Auto** transitions. No
   control touched — the common path ends here (he posts).
2. Under the player, a single quiet line: `Transitions: Auto ▾`. Collapsed
   by default; demoted (mobile-first, "advanced controls visually demoted").
3. If the *whole video* feels off, he expands it and nudges **Tighter ⟷
   Looser** (Auto centred), then taps **Re-stitch**.
4. If *one cut* is off, he opens the per-cut list (progressive disclosure),
   adjusts that row (labelled "Cut N · m:ss"), and re-stitches.
5. **Re-stitch re-joins the already-rendered clips** — no Seedance
   regeneration. Fast (re-encode + concat only) and free. The action must
   say so explicitly ("re-joins your clips · ~seconds · no re-generation")
   so he doesn't fear it costs a render.

Re-stitch overwrites the same final video in place; he reviews and iterates
until happy. Changing the global level leaves any per-cut overrides intact
(a small "N cuts customised · reset" affordance covers the confusing case).

## Backward compatibility & rollout

- Phase 1 (engine): adaptive tuning + Standard default inside
  `concat_clips`. Ships value immediately to *every* render path, no UI yet.
  This alone fixes the choppy-video complaint.
- Phase 2 (control): store + resolve the global preset; add the demoted UI
  control and the cheap re-stitch action.
- Phase 3 (override): per-join override storage + progressive-disclosure UI.

Each phase is independently shippable and leaves the system correct.

## Calibration plan

The provisional ms targets must be validated on a **real multi-clip video**
(use the clips behind the choppy published video as the reference, plus last
week's where the long gap was needed). Confirm: (a) Standard reads as
natural on both; (b) silence detection correctly measures trailing/leading
silence despite the Seedance tail artifact; (c) Tight/Breathing feel
distinct but never bleed or hard-cut. Record the final numbers in the
stitcher constants with a calibration note, matching the existing
`work/fade_test/...` convention.

## To confirm in the plan (not blockers)

- Exact per-video table/column for `stitch_settings` (`clip_plans` vs `videos`).
- Exact dashboard phase/component for the review-time control.
- The silence-threshold vs trailing-artifact resolution (−25 dB vs trim
  last ~120 ms), decided by measuring a real clip.

## Out of scope

- Embedded/timeline editor (rejected, see Non-goals).
- Millisecond-level manual control.
- Crossfade/overlap transitions (audio-bleed regression risk — stays banned).
- Decoupled-audio / dub-track timing control (separate workstream).
