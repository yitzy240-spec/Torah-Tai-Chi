import pytest
from pathlib import Path
from src.caption_burner import (
    group_words_into_cues,
    build_ass_file,
    ass_position_tag,
)


def test_ass_position_tag_bottom():
    tag = ass_position_tag("bottom", video_w=720, video_h=1280)
    assert "pos(" in tag or "an2" in tag.lower() or tag == ""


def test_ass_position_tag_top():
    tag = ass_position_tag("top", video_w=720, video_h=1280)
    assert tag.startswith("{")
    assert "pos(" in tag or "an8" in tag.lower()


def test_group_words_into_cues_breaks_on_punctuation():
    words = [
        {"word": "The", "start": 0.0, "end": 0.2},
        {"word": "smallest", "start": 0.2, "end": 0.7},
        {"word": "letter...", "start": 0.7, "end": 1.2},
        {"word": "is", "start": 1.4, "end": 1.6},
        {"word": "an", "start": 1.6, "end": 1.8},
        {"word": "aleph.", "start": 1.8, "end": 2.3},
    ]
    cues = group_words_into_cues(words, max_words=6)
    assert len(cues) == 2
    assert "letter" in cues[0]["text"] or cues[0]["text"].strip().endswith("...")
    assert "aleph" in cues[1]["text"] or cues[1]["text"].strip().endswith(".")


def test_group_words_into_cues_respects_max_words():
    words = [
        {"word": f"w{i}", "start": i * 0.2, "end": (i + 1) * 0.2}
        for i in range(10)
    ]
    cues = group_words_into_cues(words, max_words=4)
    assert all(len(c["text"].split()) <= 4 for c in cues)
    assert cues[0]["start"] == pytest.approx(0.0)
    assert cues[-1]["end"] == pytest.approx(2.0)


def test_build_ass_file_writes_valid_header(tmp_path):
    cues = [
        {"text": "Hello world", "start": 0.0, "end": 1.5, "position": "bottom"},
        {"text": "Another line", "start": 1.6, "end": 3.0, "position": "top"},
    ]
    out = tmp_path / "subs.ass"
    build_ass_file(cues, out, video_w=720, video_h=1280)
    content = out.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "[V4+ Styles]" in content
    assert "[Events]" in content
    assert "Hello world" in content
    assert "Another line" in content


@pytest.mark.slow
def test_burn_captions_end_to_end(tmp_path):
    """Slow integration test: uses ffmpeg subtitle burning."""
    import subprocess
    from src.caption_burner import burn_cues_to_mp4

    in_mp4 = tmp_path / "in.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=black:s=720x1280:d=2",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        str(in_mp4),
    ], check=True, capture_output=True)

    cues = [
        {"text": "Test caption", "start": 0.3, "end": 1.5, "position": "bottom"},
    ]
    out_mp4 = tmp_path / "out.mp4"
    burn_cues_to_mp4(in_mp4, cues, out_mp4, video_w=720, video_h=1280)
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 0
