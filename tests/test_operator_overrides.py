"""Unit tests for `src.operator_overrides._overlay_edits_onto_plan`.

The overlay logic was extracted from `modal_app._apply_operator_overrides`
specifically so it could be tested in isolation — no Supabase mock
required. See src/operator_overrides.py for the why-this-exists block.
"""
from __future__ import annotations

import pytest

from src.operator_overrides import _overlay_edits_onto_plan


def _plan(*clips: dict) -> dict:
    """Minimal plan dict shaped like a clip_plans.plan_json snapshot."""
    return {"clips": list(clips)}


def _clip(
    index: int,
    voiceover: str = "ai-vo",
    visual_prompt: str = "ai-vp",
    duration_s: float = 6.0,
) -> dict:
    return {
        "index": index,
        "voiceover": voiceover,
        "visual_prompt": visual_prompt,
        "duration_s": duration_s,
    }


def test_empty_edits_dict_leaves_plan_unchanged():
    plan = _plan(_clip(0), _clip(1))
    original = [dict(c) for c in plan["clips"]]
    result = _overlay_edits_onto_plan(plan, {})
    assert result is plan  # returned for chaining, mutated in place
    assert plan["clips"] == original


def test_edit_with_non_empty_voiceover_is_applied():
    plan = _plan(_clip(0, voiceover="ai-vo"))
    edits = {0: {"voiceover": "operator override", "visual_prompt": None, "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "operator override"
    # Untouched fields stay on the plan value.
    assert plan["clips"][0]["visual_prompt"] == "ai-vp"
    assert plan["clips"][0]["duration_s"] == 6.0


def test_edit_with_whitespace_only_voiceover_falls_back_to_plan():
    plan = _plan(_clip(0, voiceover="ai-vo"))
    edits = {0: {"voiceover": "   \n\t  ", "visual_prompt": None, "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    # Whitespace-only is treated as "operator cleared it by accident":
    # fall back to the AI text rather than silently mute the clip.
    assert plan["clips"][0]["voiceover"] == "ai-vo"


def test_edit_with_empty_string_voiceover_falls_back_to_plan():
    plan = _plan(_clip(0, voiceover="ai-vo"))
    edits = {0: {"voiceover": "", "visual_prompt": None, "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "ai-vo"


def test_duration_zero_is_applied_not_skipped():
    # `if edit_dur is not None` semantics: 0 is a valid edit value.
    plan = _plan(_clip(0, duration_s=8.0))
    edits = {0: {"voiceover": None, "visual_prompt": None, "duration_s": 0}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["duration_s"] == 0


def test_edit_for_index_not_in_plan_is_silently_skipped():
    plan = _plan(_clip(0))
    edits = {99: {"voiceover": "ghost", "visual_prompt": "ghost", "duration_s": 7}}
    # Must not raise.
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "ai-vo"
    assert len(plan["clips"]) == 1


def test_none_voiceover_and_visual_prompt_fall_back_to_plan():
    plan = _plan(_clip(0, voiceover="ai-vo", visual_prompt="ai-vp"))
    edits = {0: {"voiceover": None, "visual_prompt": None, "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "ai-vo"
    assert plan["clips"][0]["visual_prompt"] == "ai-vp"
    assert plan["clips"][0]["duration_s"] == 6.0


def test_visual_prompt_edit_is_applied():
    plan = _plan(_clip(0, visual_prompt="ai-vp"))
    edits = {0: {"voiceover": None, "visual_prompt": "operator vp", "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["visual_prompt"] == "operator vp"


def test_partial_edits_applied_per_field():
    # Mixed: voiceover edited, visual_prompt cleared (whitespace), duration set.
    plan = _plan(_clip(0, voiceover="ai-vo", visual_prompt="ai-vp", duration_s=6.0))
    edits = {0: {"voiceover": "new vo", "visual_prompt": "   ", "duration_s": 9.5}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "new vo"
    assert plan["clips"][0]["visual_prompt"] == "ai-vp"  # whitespace → fallback
    assert plan["clips"][0]["duration_s"] == 9.5


def test_multiple_clips_only_matching_indexes_overlaid():
    plan = _plan(_clip(0), _clip(1), _clip(2))
    edits = {
        0: {"voiceover": "edit-0", "visual_prompt": None, "duration_s": None},
        2: {"voiceover": None, "visual_prompt": "edit-vp-2", "duration_s": 7},
    }
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "edit-0"
    # Clip 1 has no edit row — untouched.
    assert plan["clips"][1]["voiceover"] == "ai-vo"
    assert plan["clips"][1]["visual_prompt"] == "ai-vp"
    assert plan["clips"][2]["visual_prompt"] == "edit-vp-2"
    assert plan["clips"][2]["duration_s"] == 7


def test_plan_with_no_clips_key_returns_unchanged():
    plan: dict = {}
    edits = {0: {"voiceover": "x", "visual_prompt": "y", "duration_s": 6}}
    result = _overlay_edits_onto_plan(plan, edits)
    assert result is plan
    assert plan == {}


def test_plan_with_empty_clips_list_returns_unchanged():
    plan = _plan()
    edits = {0: {"voiceover": "x", "visual_prompt": "y", "duration_s": 6}}
    result = _overlay_edits_onto_plan(plan, edits)
    assert result is plan
    assert plan["clips"] == []


def test_non_dict_plan_raises_typeerror():
    with pytest.raises(TypeError, match="expects a dict plan"):
        _overlay_edits_onto_plan("not a dict", {})  # type: ignore[arg-type]


def test_clip_with_no_index_is_skipped():
    # Defensive: a malformed clip dict missing "index" shouldn't crash
    # the overlay loop. It just gets left alone.
    plan = _plan({"voiceover": "x", "visual_prompt": "y", "duration_s": 6})
    edits = {0: {"voiceover": "edit", "visual_prompt": None, "duration_s": None}}
    _overlay_edits_onto_plan(plan, edits)
    assert plan["clips"][0]["voiceover"] == "x"
