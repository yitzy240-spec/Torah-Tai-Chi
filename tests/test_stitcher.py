import pytest
import subprocess
from pathlib import Path
from src.stitcher import concat_clips


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    """Generate a tiny MP4 using ffmpeg's lavfi source."""
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_concat_clips_produces_expected_duration(tmp_path):
    c1 = tmp_path / "a.mp4"
    c2 = tmp_path / "b.mp4"
    _make_test_clip(c1, seconds=2, color="blue")
    _make_test_clip(c2, seconds=3, color="red")
    out = tmp_path / "out.mp4"

    result = concat_clips([c1, c2], out)

    assert result.exists()
    # Probe duration
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    assert 4.5 <= duration <= 5.5
