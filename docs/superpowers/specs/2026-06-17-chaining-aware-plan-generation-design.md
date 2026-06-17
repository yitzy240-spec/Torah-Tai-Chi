# Chaining-Aware Plan Generation — Design

_Design approved 2026-06-17 (Yitzy). Fixes the "scene direction ignored on chained clips" bug Yonah hit on the Korach video (clip 2)._

## Problem

When the pipeline renders a multi-clip video, consecutive clips in the same setting are **chained**: clip N+1 is generated with clip N's last frame as its `first_frame_url`, so Seedance does image-to-video *continuation* for seamless intra-scene transitions ([clip chaining invariant](../../../src/video_generator.py)). This is correct for continuity, but it has two failure modes that combined to break Korach clip 2:

**Layer 1 — chaining is composition-blind.** `modal_app.py::_can_chain()` chains any two clips that share a `setting_id` (and aren't motion-ref/ritual clips). It never checks whether the *shots* are compatible. Korach clip 1 (a head-and-shoulders close-up intro) and clip 2 (a full-body "one foot planted, pressing through the sole, light pooling on the floor around his feet" grounding shot) are both `DOJO`, so they chained — locking clip 2 into clip 1's close-up. Image-to-video can't cut to a new full-body composition mid-continuous-shot, so clip 2 rendered as the same static close-up and **the entire scene direction (movement, framing, full-body staging) was thrown away.** Verified: clip 1's last frame = chest-up close-up; clip 2 V1/V2 = the same chest-up close-up; `chain_broken=False`.

**Layer 2 — the plan wrote a self-contradictory shot.** Clip 2's scene direction contained both *"one foot planted… pressing downward through the sole… light pooling on the floor around his feet"* (full-body) **and** *"Static medium shot, head-and-shoulders centered"* (close-up) in the same paragraph. You can't see feet in head-and-shoulders. So even with the chain broken, that direction fights itself — Claude is writing full-body *actions* into close-up *framing*.

The brain that produces both the compositions and the chain boundaries is **plan generation** (`src/script_generator.py` → `ClipPlan`). That is where the fix belongs.

## Goal / success criteria

- Each clip's scene direction is **internally consistent**: framing matches the action (full-body actions ⇒ a wide/full shot; never "see his feet" + "head-and-shoulders").
- Each clip boundary carries an **explicit, plan-authored decision**: `continue` (chained, composition flows — with an in-clip transition written when the framing shifts) or `cut` (fresh composition, chain broken, clean fade).
- The render **honors the plan's decision** instead of inferring chainability from `setting_id`.
- Re-rendering the Korach clip 1→2 boundary produces either a bridged pull-back or a clean wide-shot cut — **not** a stuck close-up.

## Architecture

Three coordinated changes; the plan decides, the render executes.

### 1. Schema — carry the boundary decision (`src/models.py`)

Add to `Clip`:

```python
transition_from_prev: Literal["continue", "cut"] = "cut"
```

- Semantics: for clip `index == 0` the value is ignored (a video always starts fresh). For `index > 0`, `continue` ⇒ chain from the previous clip's last frame; `cut` ⇒ render fresh from refs + scene direction, with a fade.
- Default `"cut"` is the safe choice: a wrong cut is a clean edit; a wrong continue is the silent-override bug we're fixing.
- No change to `ClipPlan`'s structural validators (DOJO-contiguity, motion-ref-count, duration bounds all stand). Add one validator: `clips[0].transition_from_prev` is not meaningful — leave unvalidated, documented.

### 2. Plan-generation prompt — author composition + boundaries (`src/script_generator.py` `SYSTEM_TEMPLATE`)

Add a **"COMPOSITION & CONTINUITY"** section instructing the director model to:

- **One shot per clip.** Choose a single framing (close-up / medium / wide / full-body) and make every visual detail consistent with it. If the action needs the feet, floor, or whole body, it is a wide or full-body shot — do **not** also say "head-and-shoulders" or "medium close-up." This rule alone prevents Layer 2.
- **Decide each boundary** (every clip after the first) and emit `transition_from_prev`:
  - `continue` — the shot flows from the previous clip's ending. If the framing shifts (e.g. close-up → wider), **write the camera move into the scene direction**: e.g. *"The camera pulls back from the close-up to reveal his full stance as he plants one foot firmly…"* The clip must visually *begin* where the previous clip ended.
  - `cut` — the shot can't flow from the previous ending (different framing that can't be bridged, or a setting change). Write a fresh, self-contained shot. The render starts it clean with a fade.
- **Heuristics for the model:** a setting change is always a `cut`. Within a setting, prefer `continue` when the framing is the same or a natural push/pull; choose `cut` (or write an explicit pull-back for `continue`) when going from a tight shot to a full-body action shot — never leave that to chance.
- Keep this section tight and example-led (one good `continue`-with-pullback example, one `cut` example), consistent with the existing v2.5 "rules that matter + one example" prompt style.

### 3. Render — honor the plan's decision (`modal_app.py`)

- **Full render path** (`_can_chain` / `_run_group`, ~lines 694-785): the chain decision becomes the plan's `transition_from_prev`, not `setting_id`. `_can_chain(prev, curr)` returns `True` only when `curr.transition_from_prev == "continue"` **and** the existing safety gates still pass (same `setting_id`, no motion-ref on `curr`, no new ritual keyword — these remain because they are hard Seedance constraints, not heuristics; if any fails while the plan said `continue`, downgrade to `cut` and log it). On `cut`, the clip renders with no `first_frame_url` (fresh from refs + scene direction).
- **Clips-only / regen path** (`_resolve_regen_first_frame`, ~lines 1655-1700): same rule — only resolve a chain first-frame when the clip's `transition_from_prev == "continue"`.
- **`chain_broken` propagation:** the plan's decision is persisted to the existing `clips.chain_broken` column at clip-creation (`transition_from_prev == "cut"` ⇒ `chain_broken = True`). Today `chain_broken` is set only by the operator's manual "Break chain"; this extends it to be **plan-authored by default**. The render reads `chain_broken` as the single source of truth, so operator overrides and plan decisions use the same lever.
- **Fade on cut:** the stitcher already applies fade transitions between clips ([`src/stitcher.py`](../../../src/stitcher.py)). A `cut` boundary uses that existing fade so it reads as an intentional edit, not a jerk. No new fade code needed — verify the stitcher's existing inter-clip fade covers chain-broken boundaries.

## Data flow

```
script_generator (Claude) → ClipPlan.clips[i].transition_from_prev
   → clip-creation writes clips[i].chain_broken = (transition_from_prev == "cut")
   → render: _can_chain / _resolve_regen_first_frame read chain_broken
   → continue ⇒ first_frame_url = prev clip last frame; cut ⇒ no first_frame, fade
   → operator "Break chain" still flips chain_broken = True (forces cut)
```

## Operator override (unchanged surface)

The existing "Break chain" control (`dashboard/.../break-clip-chain.ts`) continues to force `chain_broken = True` (a `cut`). With plan-authored defaults, most clips will already be correct, so the operator override becomes a rare correction rather than the only lever. (A future "Force continue" is out of scope.)

## Out of scope

- A "Force continue" operator control (only "Break chain" exists today; keep it).
- Cross-setting bridges (a setting change is always a `cut`).
- Changing the stitcher's fade shape; we reuse the existing inter-clip fade.
- Re-pipelining already-rendered videos; this affects new plans/renders.

## Testing

- **Unit (`tests/`):**
  - `Clip` round-trips `transition_from_prev`; default is `"cut"`; `clips[0]` value ignored.
  - `_can_chain` honors `chain_broken`/`transition_from_prev`: returns `False` on `cut` even with identical `setting_id`; returns `True` on `continue` only when safety gates pass; downgrades to `cut` + logs when a gate fails on a `continue`.
  - Plan-creation maps `transition_from_prev == "cut"` → `chain_broken = True`.
- **Prompt regression:** a fixture script that previously produced a contradictory clip (full-body action + close-up framing) now yields a consistent shot; a close-up→full-body boundary is marked `cut` or written with an explicit pull-back.
- **Real end-to-end (no shortcuts):** regenerate the Korach clip 1→2 boundary; confirm clip 2 renders the full-body grounding shot (bridged pull-back or clean cut), not the stuck close-up. Eyeball the boundary for a clean fade.
- Gate on the Python suite (`pytest -m "not integration"`) plus the dashboard build if any TS changes (the `chain_broken` write path).

## Constraints / gotchas

- `first_frame_url` is mutually exclusive with `reference_image_urls` and `reference_video_urls` in Seedance — a `cut` (no first-frame) is what lets refs/motion flow; keep that invariant.
- Motion-ref clips already break the chain (mutex) — the plan should mark them `cut` for consistency, but the render's existing motion-ref gate is the hard backstop.
- DOJO clips must stay contiguous at the start (existing validator) — the continuity changes don't touch block ordering.
- Default `cut` means a plan that omits the field renders as clean cuts (safe), never as silent close-up lock-in.
