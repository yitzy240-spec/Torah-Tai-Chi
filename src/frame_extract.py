"""Extract the last frame of an mp4 as a PNG via ffmpeg.

Used for first-frame chaining: clip N's tail becomes clip N+1's
first_frame_url for visual continuity within a setting block.

History: a 50ms -sseof window passed solid-color test fixtures but
produced EMPTY output (ffmpeg exit 0, no file) for real Seedance clips,
whose audio stream outlasts the video stream — the container duration
exceeds the last video frame's PTS, so a tail seek can land past the
final frame. bf95c8e widened the window to 1s here, but modal_app's
duplicated copy kept the 50ms window and every prod chain silently
degraded to no-chain until 2026-07-28 (Eikev continuity break).
modal_app now delegates here — do not re-duplicate this logic.
"""
from __future__ import annotations
import subprocess
from pathlib import Path


def _run(args: list[str]) -> None:
    subprocess.run(args, check=True, timeout=60, capture_output=True)


def _empty(p: Path) -> bool:
    return (not p.exists()) or p.stat().st_size == 0


def extract_last_frame(in_mp4: Path, out_png: Path) -> Path:
    if not in_mp4.exists():
        raise FileNotFoundError(f"input mp4 not found: {in_mp4}")
    out_png.parent.mkdir(parents=True, exist_ok=True)

    # Decode only the final second; -update 1 overwrites the file per
    # frame, so it ends holding the TRUE last frame. (No -frames:v 1 —
    # that grabbed the FIRST frame of the window, a full second early,
    # which defeats frame-perfect continuity at the cut.)
    _run([
        "ffmpeg", "-y", "-sseof", "-1", "-i", str(in_mp4),
        "-update", "1", "-q:v", "1", "-f", "image2", str(out_png),
    ])

    if _empty(out_png):
        # A windowed seek can still decode zero frames (video stream ends
        # >1s before container EOF) while ffmpeg exits 0. Full decode is
        # bulletproof and cheap for our ≤15s clips.
        _run([
            "ffmpeg", "-y", "-i", str(in_mp4),
            "-update", "1", "-q:v", "1", "-f", "image2", str(out_png),
        ])

    if _empty(out_png):
        raise RuntimeError(
            f"ffmpeg produced no output PNG for {in_mp4} "
            f"(no decodable video frames?)"
        )
    return out_png
