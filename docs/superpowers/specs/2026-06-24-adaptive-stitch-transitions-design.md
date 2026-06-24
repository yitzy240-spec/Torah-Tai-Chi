# Adaptive, per-join stitch transitions with operator presets

- **Date:** 2026-06-24
- **Status:** Design — approved in brainstorm, pending spec review
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

## Layer 2 — global preset → target pause

| Preset         | Target inter-speech pause (provisional) |
|----------------|------------------------------------------|
| Tight          | ~350 ms                                  |
| Standard (default) | ~700 ms                              |
| Breathing room | ~1000 ms                                 |

Numbers are **provisional** and will be calibrated against a real
multi-clip video (see Calibration). The preset stores an enum, not raw ms,
so we can retune the mapping centrally without touching stored data.

## Layer 3 — per-join override

- Stored as a sparse map from join index → preset enum. Join index keys on
  the **left** clip (join *i* = clip *i* → clip *i+1*).
- Absent key ⇒ that join uses the global preset. So overrides are sparse;
  the common video stores none.
- UI: hidden behind a small "adjust this cut" affordance per join, shown
  only when the operator opens transition controls. Never part of the
  default review surface.

## Data model

Stitch settings belong to the **video/parsha**, not the job — they must
survive individual clip regens (a regen creates a new job but should not
reset the operator's chosen feel). Proposed shape, stored as JSONB on the
per-video record (exact table — `clip_plans` vs `videos` — confirmed in the
plan):

```json
{
  "preset": "standard",            // global; default "standard" if absent
  "joins": { "1": "tight" }         // sparse per-join overrides (left-clip index)
}
```

Absent column / null ⇒ behaves exactly as "standard everywhere," which is
also what every legacy render produces. No migration of existing rows needed.

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

## UI / operator flow

- Lives in the phase where the operator **reviews the stitched video**
  before posting (exact phase/component pinned in the plan — likely the
  plan-review / preview surface, not the post surface).
- Default view shows **no transition controls** — just the video. The
  three-preset global control is one tap behind a clearly-labelled,
  *secondary* affordance (e.g. "Transitions: Standard ▾"). Consistent with
  mobile-first and "destructive/advanced controls are visually demoted."
- Changing the preset (or an override) re-stitches from the already-rendered
  clips — **no Seedance regeneration**, so it's cheap and fast (re-encode +
  concat only).
- Per-join override is revealed only when the operator opens the transition
  control and chooses to adjust an individual cut.

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
