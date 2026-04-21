import pytest
from src.video_generator import build_seedance_input
from src.models import Clip
from src.settings import STYLE_LOCK


def _dojo_clip() -> Clip:
    return Clip(index=0, voiceover="Hello.", visual_prompt="Rav Eli sits, dolly in, soft morning light",
                duration_s=8, setting_id="DOJO")


def _outdoor_clip() -> Clip:
    return Clip(index=2, voiceover="Hi.", visual_prompt="Rav Eli walks, lateral tracking shot, dappled afternoon",
                duration_s=9, setting_id="GARDEN_PATH")


def test_build_seedance_input_dojo_includes_dojo_refs():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png", "https://x/c.png"],
        dojo_ref_urls=["https://x/dojo1.png", "https://x/dojo2.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert payload["reference_image_urls"][0] == "https://x/dojo1.png"
    assert payload["reference_image_urls"][1] == "https://x/dojo2.png"
    assert "https://x/a.png" in payload["reference_image_urls"]
    assert len(payload["reference_image_urls"]) <= 9
    assert "first_frame_url" not in payload
    assert STYLE_LOCK in payload["prompt"]
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_outdoor_excludes_dojo_refs():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png"],
        dojo_ref_urls=["https://x/dojo1.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "https://x/dojo1.png" not in payload["reference_image_urls"]
    assert payload["reference_image_urls"] == ["https://x/a.png", "https://x/b.png"]


def test_build_seedance_input_with_first_frame_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"],
        dojo_ref_urls=[],
        first_frame_url="https://x/last.png",
        audio_url=None, resolution="720p",
    )
    assert payload["first_frame_url"] == "https://x/last.png"


def test_build_seedance_input_caps_refs_at_nine():
    clip = _dojo_clip()
    chars = [f"https://x/c{i}.png" for i in range(20)]
    dojos = [f"https://x/d{i}.png" for i in range(5)]
    payload = build_seedance_input(
        clip,
        character_ref_urls=chars,
        dojo_ref_urls=dojos,
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    refs = payload["reference_image_urls"]
    assert len(refs) == 9
    # MAX_DOJO_REFS=4: first four slots are dojo refs, remaining five are char refs
    assert refs[:4] == ["https://x/d0.png", "https://x/d1.png", "https://x/d2.png", "https://x/d3.png"]
    assert refs[4:] == [f"https://x/c{i}.png" for i in range(5)]


def test_build_seedance_input_with_audio_ref():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url="https://a/v.mp3", resolution="720p",
    )
    assert payload["reference_audio_urls"] == ["https://a/v.mp3"]
    assert "@Audio1" in payload["prompt"]


def test_build_seedance_input_resolution_normalized_lowercase():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720P",
    )
    assert payload["resolution"] == "720p"


def test_build_seedance_input_with_reference_video_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=["https://x/d0.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
        reference_video_url="https://supabase/videos/tai_chi_moves/x.mp4",
    )
    assert payload["reference_video_urls"] == [
        "https://supabase/videos/tai_chi_moves/x.mp4"
    ]
    assert "motion study" in payload["prompt"].lower()
    assert "silent" in payload["prompt"].lower()
    assert "do not mute" in payload["prompt"].lower() or "do not freeze" in payload["prompt"].lower()
    # Voiceover must still be in the prompt — the ref does not replace speech.
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_without_reference_video_url_omits_field():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "reference_video_urls" not in payload
    assert "motion study" not in payload["prompt"].lower()
