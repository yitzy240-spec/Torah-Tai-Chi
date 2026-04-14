import pytest
from pydantic import ValidationError
from src.models import Clip, ClipPlan


def test_clip_valid():
    c = Clip(index=0, voiceover="hello", visual_prompt="Rav Eli waves", duration_s=6)
    assert c.duration_s == 6


def test_clip_rejects_duration_out_of_range():
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=20)
    with pytest.raises(ValidationError):
        Clip(index=0, voiceover="x", visual_prompt="y", duration_s=3)


def test_clipplan_valid():
    plan = ClipPlan(
        parsha="Vayikra",
        hook="opening",
        full_script="full",
        clips=[Clip(index=0, voiceover="a", visual_prompt="b", duration_s=6)],
    )
    assert plan.parsha == "Vayikra"
    assert len(plan.clips) == 1


def test_clipplan_total_duration():
    plan = ClipPlan(
        parsha="X", hook="x", full_script="x",
        clips=[
            Clip(index=0, voiceover="a", visual_prompt="b", duration_s=8),
            Clip(index=1, voiceover="c", visual_prompt="d", duration_s=10),
        ],
    )
    assert plan.total_duration_s == 18
