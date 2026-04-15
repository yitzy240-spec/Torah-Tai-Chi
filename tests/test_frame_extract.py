import pytest
import subprocess
from pathlib import Path
from src.frame_extract import extract_last_frame


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_extract_last_frame_writes_png(tmp_path):
    clip = tmp_path / "in.mp4"
    out = tmp_path / "last.png"
    _make_test_clip(clip, seconds=2, color="green")

    result = extract_last_frame(clip, out)

    assert result == out
    assert out.exists()
    assert out.stat().st_size > 0
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.slow
def test_extract_last_frame_raises_when_input_missing(tmp_path):
    out = tmp_path / "x.png"
    with pytest.raises(FileNotFoundError):
        extract_last_frame(tmp_path / "nope.mp4", out)
