import pytest
from pydantic import ValidationError
from src.models import Clip, ClipPlan, PlatformCaptions


def _captions() -> PlatformCaptions:
    return PlatformCaptions(
        tiktok="t", instagram="i", youtube_title="y",
        youtube_description="d", facebook="f", twitter="tw",
    )


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
        captions=_captions(),
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
        captions=_captions(),
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


def test_clipplan_requires_at_least_three_clips():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="MOUNTAIN_RIDGE",
            captions=_captions(),
            clips=[_dojo_clip(0), _dojo_clip(1)],
        )


def test_clipplan_block_structure_dojo_then_outdoor():
    plan = ClipPlan(
        parsha="Vayikra", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        captions=_captions(),
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
            captions=_captions(),
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
            captions=_captions(),
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
            captions=_captions(),
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
            captions=_captions(),
            clips=[
                _dojo_clip(0, 5), _dojo_clip(1, 5),
                _outdoor_clip(2, "GARDEN_PATH", 5), _outdoor_clip(3, "GARDEN_PATH", 5),
            ],
        )


def test_clipplan_rejects_total_over_90s():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            captions=_captions(),
            clips=[
                _dojo_clip(0, 15), _dojo_clip(1, 15), _dojo_clip(2, 15),
                _outdoor_clip(3, "GARDEN_PATH", 15),
                _outdoor_clip(4, "GARDEN_PATH", 15),
                _outdoor_clip(5, "GARDEN_PATH", 15),
                _outdoor_clip(6, "GARDEN_PATH", 15),
                _outdoor_clip(7, "GARDEN_PATH", 15),
            ],
        )


def test_clipplan_rejects_more_than_eight_clips():
    with pytest.raises(ValidationError):
        ClipPlan(
            parsha="X", hook="x", full_script="x",
            outdoor_archetype_id="GARDEN_PATH",
            captions=_captions(),
            clips=[_dojo_clip(i, 4) for i in range(4)] +
                  [_outdoor_clip(i, "GARDEN_PATH", 4) for i in range(4, 9)],
        )


def test_clipplan_accepts_three_clips():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        captions=_captions(),
        clips=[
            _dojo_clip(0, 10),
            _outdoor_clip(1, "GARDEN_PATH", 10),
            _outdoor_clip(2, "GARDEN_PATH", 10),
        ],
    )
    assert len(plan.clips) == 3


def test_clipplan_accepts_six_clips():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        outdoor_archetype_id="GARDEN_PATH",
        captions=_captions(),
        clips=[
            _dojo_clip(0, 10), _dojo_clip(1, 10), _dojo_clip(2, 10),
            _outdoor_clip(3, "GARDEN_PATH", 10),
            _outdoor_clip(4, "GARDEN_PATH", 10),
            _outdoor_clip(5, "GARDEN_PATH", 10),
        ],
    )
    assert plan.total_duration_s == 60


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
