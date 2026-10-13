"""Noach 2026-10-13 regression: chained clip 2 changed to a short-sleeved
outfit and Rav Eli's voice played over a closed mouth."""
from src.models import Clip
from src.settings import (
    CHAIN_CONTINUITY_LOCK, LIP_SYNC_LOCK, STYLE_LOCK, WARDROBE_LOCK,
)
from src.video_generator import build_seedance_input

NOACH_CLIP_2 = Clip(
    index=1,
    voiceover=("When God tells Noah a flood will destroy humanity, he was "
               "silent. Is one's own personal righteousness really enough? "
               "In tai chi, we don't only grow in isolation."),
    visual_prompt=("Rav Eli remains standing on the indigo runner... his "
                   "expression becoming grave and still as he speaks."),
    duration_s=11, setting_id="DOJO",
)


def _payload(first_frame_url=None, clip=NOACH_CLIP_2, **kw):
    return build_seedance_input(
        clip, character_ref_urls=["https://x/c.png"],
        dojo_ref_urls=["https://x/d.png"], first_frame_url=first_frame_url,
        audio_url=None, resolution="720p", **kw,
    )


def test_wardrobe_lock_pins_sleeves_and_lower_body():
    t = WARDROBE_LOCK.lower()
    assert "long sleeves" in t
    assert "never short sleeves" in t
    assert "trousers" in t and "shoes" in t
    assert WARDROBE_LOCK in STYLE_LOCK


def test_wardrobe_lock_reaches_chained_clip_without_refs():
    p = _payload(first_frame_url="https://x/last_frame.png")
    assert "reference_image_urls" not in p  # Seedance mutex, unchanged
    assert p["first_frame_url"] == "https://x/last_frame.png"
    assert WARDROBE_LOCK in p["prompt"]
    assert CHAIN_CONTINUITY_LOCK in p["prompt"]


def test_unchained_clip_has_refs_and_no_continuity_clause():
    p = _payload()
    assert p["reference_image_urls"]
    assert WARDROBE_LOCK in p["prompt"]
    assert CHAIN_CONTINUITY_LOCK not in p["prompt"]


def test_motion_ref_clip_is_not_treated_as_chained():
    p = _payload(first_frame_url="https://x/f.png",
                 reference_video_url="https://x/move.mp4")
    assert "first_frame_url" not in p
    assert CHAIN_CONTINUITY_LOCK not in p["prompt"]


def test_lip_sync_clause_present_for_dialogue_chained_or_not():
    for ff in (None, "https://x/f.png"):
        prompt = _payload(first_frame_url=ff)["prompt"]
        assert LIP_SYNC_LOCK in prompt
        # Must come before the identity lock, right after the spoken lines.
        assert prompt.index(LIP_SYNC_LOCK) < prompt.index(STYLE_LOCK)
        assert prompt.index('Character speaks:') < prompt.index(LIP_SYNC_LOCK)


def test_lip_sync_clause_neutralises_still_and_silent():
    t = LIP_SYNC_LOCK.lower()
    assert "lips" in t and "in sync" in t
    assert "still" in t and "silent" in t
    assert "never a closed or frozen mouth" in t


def test_no_lip_sync_clause_for_silent_clip():
    silent = NOACH_CLIP_2.model_copy(update={"voiceover": "   "})
    assert LIP_SYNC_LOCK not in _payload(clip=silent)["prompt"]
