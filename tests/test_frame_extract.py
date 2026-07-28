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


def _make_clip_with_audio_tail(path: Path, video_s: float = 2.0, audio_s: float = 2.5) -> None:
    """Mimic real Seedance muxing: the audio stream outlasts the video
    stream, so the container duration exceeds the last video frame's PTS.
    This is the geometry that made a 100ms -sseof window return zero
    frames (exit 0, no output) on every Eikev chain attempt, 2026-07-27."""
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=red:s=320x240:d={video_s}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={audio_s}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        str(path),
    ], check=True, capture_output=True)


@pytest.mark.slow
def test_extract_last_frame_survives_audio_outlasting_video(tmp_path):
    clip = tmp_path / "tail.mp4"
    out = tmp_path / "last.png"
    _make_clip_with_audio_tail(clip)

    result = extract_last_frame(clip, out)

    assert result == out
    assert out.exists() and out.stat().st_size > 0


@pytest.mark.slow
def test_modal_extract_last_frame_matches_src_util(tmp_path):
    """modal_app duplicated this helper and its copy kept the broken 100ms
    window after bf95c8e fixed src/frame_extract.py — every regen chain
    silently degraded to no-chain (Eikev continuity break, 2026-07-27).
    The duplicate must handle the audio-tail geometry too."""
    pytest.importorskip("modal")
    from modal_app import _extract_last_frame

    clip = tmp_path / "tail.mp4"
    out = tmp_path / "last.png"
    _make_clip_with_audio_tail(clip)

    result = _extract_last_frame(clip, out)

    assert result == out
    assert out.exists() and out.stat().st_size > 0


@pytest.mark.slow
def test_extract_last_frame_returns_the_final_frame_not_an_early_one(tmp_path):
    """-frames:v 1 with a 1s window grabbed the FIRST frame of the final
    second — a full second of motion before the cut. The extracted frame
    must come from the very end of the clip: blue for 2s, red for the
    final 0.4s => the PNG must be red."""
    clip = tmp_path / "twotone.mp4"
    out = tmp_path / "last.png"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2.0",
        "-f", "lavfi", "-i", "color=c=red:s=320x240:d=0.4",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-map", "2:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(clip),
    ], check=True, capture_output=True)

    extract_last_frame(clip, out)

    from PIL import Image
    px = Image.open(out).convert("RGB").resize((1, 1)).getpixel((0, 0))
    assert px[0] > 150 and px[2] < 100, f"expected red-dominant last frame, got {px}"
