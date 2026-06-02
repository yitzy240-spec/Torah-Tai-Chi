import pytest
import subprocess
from pathlib import Path
from src.stitcher import concat_clips


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    """Generate a tiny MP4 with silent audio using ffmpeg's lavfi sources."""
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_concat_clips_produces_expected_duration(tmp_path):
    """Two-clip concat duration matches sum-of-sources PLUS one
    still-frame prepend on the second clip. Old crossfade subtracted
    overlap; new still-frame approach ADDS the prepend (no overlap,
    no crossfade). For 2s + 3s sources with a 0.5s prepend on clip 2:
    total ≈ 5.5s."""
    from src.stitcher import _STILL_FRAME_PRE_S
    c1 = tmp_path / "a.mp4"
    c2 = tmp_path / "b.mp4"
    _make_test_clip(c1, seconds=2, color="blue")
    _make_test_clip(c2, seconds=3, color="red")
    out = tmp_path / "out.mp4"

    result = concat_clips([c1, c2], out)

    assert result.exists()
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    expected = 2 + 3 + _STILL_FRAME_PRE_S  # 5.5s
    # ±0.2s tolerance for ffmpeg's frame-boundary rounding.
    assert expected - 0.2 <= duration <= expected + 0.2


@pytest.mark.slow
def test_concat_single_clip_through(tmp_path):
    """Single-clip path detones the audio (re-encodes) and writes to
    dest. Output exists and is roughly the same duration as input —
    file size differs from input because audio is re-encoded."""
    c1 = tmp_path / "only.mp4"
    _make_test_clip(c1, seconds=2, color="green")
    out = tmp_path / "out.mp4"
    concat_clips([c1], out)
    assert out.exists()
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    assert 1.8 <= float(probe.stdout.strip()) <= 2.2


@pytest.mark.slow
def test_concat_four_clips_duration(tmp_path):
    """Four-clip concat: sum-of-sources PLUS still-frame prepends on
    clips 1, 2, 3 (the non-first clips). For 2 + 3 + 2 + 2 = 9s
    source content + 3 × 0.5s prepends = 10.5s total. Loose bound to
    survive prepend-duration tuning."""
    from src.stitcher import _STILL_FRAME_PRE_S
    clips = []
    for i, (sec, color) in enumerate([(2, "blue"), (3, "red"), (2, "green"), (2, "yellow")]):
        p = tmp_path / f"c{i}.mp4"
        _make_test_clip(p, seconds=sec, color=color)
        clips.append(p)
    out = tmp_path / "out.mp4"
    concat_clips(clips, out)
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    expected = 9 + 3 * _STILL_FRAME_PRE_S  # 10.5s for 0.5s prepend
    assert expected - 0.3 <= duration <= expected + 0.3
