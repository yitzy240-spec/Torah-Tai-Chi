"""Pure helpers for overlaying operator-edited clip fields onto a
plan_json dict.

Why this module exists:
    The dashboard writes operator edits (voiceover / visual_prompt /
    duration_s tweaks made in Phase 2) to the `clips` table, but the
    `clip_plans.plan_json` snapshot is never rewritten when an operator
    edits a clip. Regen entrypoints in modal_app.py fetch plan_json and
    hand it to Claude or Seedance — so without an overlay step those
    edits get silently dropped.

    The Supabase fetch + overlay used to live inline in
    `_apply_operator_overrides` (modal_app.py:1504). The pure overlay
    logic was extracted here so it can be unit-tested in isolation,
    without standing up a Supabase mock.

Empty / whitespace-only operator values fall back to the plan value
intentionally: an operator who accidentally cleared a field shouldn't
end up with a silent silent-clip — the AI text is at least *some*
voiceover. This matches the behavior of the original overlay loop in
clips_only_job (modal_app.py:5886).
"""
from __future__ import annotations


def _overlay_edits_onto_plan(
    plan: dict,
    edits_by_index: dict[int, dict],
) -> dict:
    """Overlay operator edits onto matching clips in `plan` in place.

    Pure function: no Supabase calls, no I/O, no globals. Safe to
    unit-test without external services. The Supabase fetch that
    builds `edits_by_index` lives in modal_app._apply_operator_overrides.

    Args:
        plan: dict with a "clips" key (list of clip dicts). Mutated in
            place. Each clip dict is expected to have an "index" key.
        edits_by_index: dict keyed by clip index, where each value is a
            dict that may have "voiceover", "visual_prompt", and/or
            "duration_s" keys (mirroring the `clips` table columns).

    Returns:
        The same `plan` dict (returned for chaining convenience).

    Behavior:
        - Clips whose index is not in `edits_by_index` are left alone.
        - Empty-string or whitespace-only `voiceover` / `visual_prompt`
          falls back to the plan value (see module docstring).
        - `duration_s = 0` is treated as a valid edit (not falsy-skipped).
        - `duration_s = None` falls back to the plan value.
    """
    if not isinstance(plan, dict):
        raise TypeError(
            "_overlay_edits_onto_plan expects a dict plan, got "
            f"{type(plan).__name__}"
        )
    clips = plan.get("clips") or []
    if not clips or not edits_by_index:
        return plan

    for clip in clips:
        idx = clip.get("index")
        if idx is None or idx not in edits_by_index:
            continue
        edit = edits_by_index[idx]
        edit_vo = edit.get("voiceover")
        edit_vp = edit.get("visual_prompt")
        edit_dur = edit.get("duration_s")
        # Empty-string semantics are load-bearing — see module docstring.
        if edit_vo and edit_vo.strip():
            clip["voiceover"] = edit_vo
        if edit_vp and edit_vp.strip():
            clip["visual_prompt"] = edit_vp
        if edit_dur is not None:
            clip["duration_s"] = edit_dur

    return plan
