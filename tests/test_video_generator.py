import pytest
from pathlib import Path
from src.video_generator import build_seedance_input, STYLE_LOCK
from src.models import Clip


def test_build_seedance_input_includes_voiceover_quoted():
    clip = Clip(index=0, voiceover="He called.", visual_prompt="Rav Eli in a garden.", duration_s=6)
    payload = build_seedance_input(clip, ref_urls=["https://x/a.png", "https://x/b.png"],
                                   audio_url=None, resolution="720p")
    assert '"He called."' in payload["prompt"]
    assert "Rav Eli in a garden" in payload["prompt"]
    assert STYLE_LOCK in payload["prompt"]
    assert payload["reference_image_urls"] == ["https://x/a.png", "https://x/b.png"]
    assert payload["duration"] == 6
    assert payload["resolution"] == "720p"
    assert payload["web_search"] is False


def test_build_seedance_input_with_audio_ref():
    clip = Clip(index=0, voiceover="x", visual_prompt="y", duration_s=5)
    payload = build_seedance_input(clip, ref_urls=["u"], audio_url="https://a/v.mp3",
                                   resolution="720p")
    assert payload["reference_audio_urls"] == ["https://a/v.mp3"]
    assert "@Audio1" in payload["prompt"]


def test_build_seedance_input_accepts_uppercase_resolution():
    clip = Clip(index=0, voiceover="x", visual_prompt="y", duration_s=5)
    payload = build_seedance_input(clip, ref_urls=["u"], audio_url=None, resolution="720P")
    assert payload["resolution"] == "720p"
