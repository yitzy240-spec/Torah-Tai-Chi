import pytest
from pydantic import ValidationError
from src.models import Clip, ClipPlan


def test_clip_valid():
    c = Clip(index=0, voiceover="hello", visual_prompt="Rav Eli waves", duration_s=6,
             setting_id="DOJO")
    assert c.duration_s == 6


def test_clip_rejects_duration_out_of_range():
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=20, setting_id="DOJO")
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=3, setting_id="DOJO")


def test_clipplan_valid():
    plan = ClipPlan(
        parsha="Vayikra",
        hook="opening",
        full_script="full",
        outdoor_archetype_id="MOUNTAIN_RIDGE",
        clips=[
            Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8, setting_id="DOJO"),
            Clip(index=1, voiceover="c", visual_prompt="d", duration_s=8, setting_id="DOJO"),
            Clip(index=2, voiceover="e", visual_prompt="f", duration_s=8, setting_id="MOUNTAIN_RIDGE"),
            Clip(index=3, voiceover="g", visual_prompt="h", duration_s=8, setting_id="MOUNTAIN_RIDGE"),
        ],
    )
    assert plan.parsha == "Vayikra"
    assert len(plan.clips) == 4


def test_clipplan_total_duration():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        clips=[
            Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8, setting_id="DOJO"),
            Clip(index=1, voiceover="c", visual_prompt="d", duration_s=10, setting_id="DOJO"),
            Clip(index=2, voiceover="e", visual_prompt="f", duration_s=8, setting_id="GARDEN_PATH"),
            Clip(index=3, voiceover="g", visual_prompt="h", duration_s=8, setting_id="GARDEN_PATH"),
        ],
    )
    assert plan.total_duration_s == 34


def _dojo_clip(idx: int, duration: int = 8) -> Clip:
    return Clip(index=idx, voiceover="x", visual_prompt="y",
                duration_s=duration, setting_id="DOJO")


def _outdoor_clip(idx: int, archetype: str, duration: int = 8) -> Clip:
    return Clip(index=idx, voiceover="x", visual_prompt="y",
                duration_s=duration, setting_id=archetype)


def test_clip_setting_id_required():
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=6)


def test_clip_motion_ref_url_defaults_none():
    c = _dojo_clip(0)
    assert c.motion_ref_url is None


def test_clipplan_requires_exactly_four_clips():
    with pytest.raises(ValidationError):
        ClipPlan(parsha="X", hook="x", full_script="x",
                 outdoor_archetype_id="MOUNTAIN_RIDGE",
                 clips=[_dojo_clip(0), _dojo_clip(1), _outdoor_clip(2, "MOUNTAIN_RIDGE")])


def test_clipplan_block_structure_dojo_then_outdoor():
    plan = ClipPlan(
        parsha="Vayikra", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        clips=[
            _dojo_clip(0, 8), _dojo_clip(1, 9),
            _outdoor_clip(2, "GARDEN_PATH", 9), _outdoor_clip(3, "GARDEN_PATH", 8),
        ],
    )
    assert plan.total_duration_s == 34


def test_clipplan_rejects_wrong_block_ordering():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _outdoor_clip(0, "GARDEN_PATH"), _outdoor_clip(1, "GARDEN_PATH"),
                _dojo_clip(2), _dojo_clip(3),
            ],
        )


def test_clipplan_rejects_outdoor_archetype_mismatch():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0), _dojo_clip(1),
                _outdoor_clip(2, "MOUNTAIN_RIDGE"), _outdoor_clip(3, "MOUNTAIN_RIDGE"),
            ],
        )


def test_clipplan_rejects_unknown_archetype():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="MARS_BASE",
            clips=[
                _dojo_clip(0), _dojo_clip(1),
                _outdoor_clip(2, "MARS_BASE"), _outdoor_clip(3, "MARS_BASE"),
            ],
        )


def test_clipplan_rejects_total_under_28s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0, 5), _dojo_clip(1, 5),
                _outdoor_clip(2, "GARDEN_PATH", 5), _outdoor_clip(3, "GARDEN_PATH", 5),
            ],
        )


def test_clipplan_rejects_total_over_45s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            clips=[
                _dojo_clip(0, 15), _dojo_clip(1, 12),
                _outdoor_clip(2, "GARDEN_PATH", 12), _outdoor_clip(3, "GARDEN_PATH", 8),
            ],
        )
