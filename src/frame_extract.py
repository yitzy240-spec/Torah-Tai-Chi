"""Extract the last frame of an mp4 as a PNG via ffmpeg.

Used by the orchestrator to feed clip N's tail into clip N+1's
first_frame_url for visual continuity within a setting block.
"""
from __future__ import annotations
import subprocess
from pathlib import Path


def extract_last_frame(in_mp4: Path, out_png: Path) -> Path:
    if not in_mp4.exists():
        raise FileNotFoundError(f"input mp4 not found: {in_mp4}")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    # -sseof -1 seeks into the final second; -frames:v 1 grabs one frame.
    # An earlier 50ms window passed solid-color test fixtures but produced
    # empty output files for real Seedance clips.
    subprocess.run([
        "ffmpeg", "-y", "-sseof", "-1", "-i", str(in_mp4),
        "-update", "1", "-frames:v", "1", "-f", "image2", str(out_png),
    ], check=True, capture_output=True)
    if not out_png.exists() or out_png.stat().st_size == 0:
        raise RuntimeError(
            f"ffmpeg produced no output PNG for {in_mp4}; check seek window"
        )
    return out_png
