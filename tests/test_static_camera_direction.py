"""Yonah clip 4 ('V3', static camera) pushed in to a chest close-up and
the logo morphed. Static directions now drop the handoff lock, no lock
primes a push-in, and the scene direction is authoritative."""
import pytest

from src.models import Clip
from src.settings import (
    HANDOFF_FRAMING_LOCK, LOGO_LOCK, SCENE_DIRECTION_AUTHORITY,
)
from src.video_generator import build_seedance_input, is_static_camera_direction

CHARS = [f"https://x/c{i}.png" for i in range(12)]
DOJOS = [f"https://x/d{i}.png" for i in range(4)]


def _prompt(visual_prompt, **kw):
    clip = Clip(index=4, voiceover="Hello there.", visual_prompt=visual_prompt,
                duration_s=8, setting_id="DOJO")
    return build_seedance_input(clip, CHARS, DOJOS, first_frame_url=None,
                                audio_url=None, **kw)["prompt"]


@pytest.mark.parametrize("vp", [
    "V3: Static camera, full body.", "Camera LOCKED off on a tripod.",
    "Still camera, medium shot.", "No zoom. Rav Eli speaks.",
    "No camera movement at all.",
])
def test_static_direction_omits_handoff(vp):
    assert is_static_camera_direction(vp)
    assert HANDOFF_FRAMING_LOCK not in _prompt(vp, followed_by_chained=True)


def test_normal_direction_keeps_handoff():
    vp = "Slow orbit around Rav Eli."
    assert not is_static_camera_direction(vp)
    assert HANDOFF_FRAMING_LOCK in _prompt(vp, followed_by_chained=True)


@pytest.mark.parametrize("chained", [False, True])
def test_no_push_in_instruction(chained):
    vp = "Rav Eli speaks warmly."
    p = _prompt(vp, followed_by_chained=chained).lower()
    for bad in ("push-in", "push in", "pushes in", "zoom in"):
        assert bad not in p
    assert "pushes in" not in LOGO_LOCK.lower()


def test_scene_direction_present_and_authoritative():
    vp = "V3: Static camera, full body, Rav Eli centered."
    p = _prompt(vp, followed_by_chained=True)
    assert vp in p
    assert p.rstrip().endswith(SCENE_DIRECTION_AUTHORITY)
    assert p.index(vp) < p.index(SCENE_DIRECTION_AUTHORITY)
