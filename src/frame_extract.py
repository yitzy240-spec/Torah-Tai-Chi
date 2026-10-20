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


# Noach 2026-10-20 (job a5689b42): a chained clip opens on the previous
# clip's 720p last frame, where the chest logo is a few pixels, and Seedance
# redrew it as the camera pushed in. Upscale the chain frame before upload
# so the model starts from a sharper logo. Long side target 1920 (9:16
# 720x1280 -> 1080x1920).
CHAIN_FRAME_LONG_SIDE = 1920


def probe_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x",
         str(path)],
        check=True, timeout=30, capture_output=True, text=True,
    ).stdout.strip()
    w, h = out.splitlines()[0].split("x")[:2]
    return int(w), int(h)


def upscaled_size(w: int, h: int, long_side: int = CHAIN_FRAME_LONG_SIDE):
    """Target (w, h) with the exact same aspect ratio, or None when the
    frame is already that big or no exact even-sized upscale exists."""
    if max(w, h) >= long_side:
        return None
    if w >= h:
        nw, nh = long_side, long_side * h / w
    else:
        nw, nh = long_side * w / h, long_side
    if nw != int(nw) or nh != int(nh):
        return None  # would distort the aspect ratio
    nw, nh = int(nw), int(nh)
    if nw % 2 or nh % 2:
        return None
    return nw, nh


def upscale_chain_frame(png: Path, long_side: int = CHAIN_FRAME_LONG_SIDE) -> Path:
    """Upscale png in place (lanczos + mild unsharp) if it is smaller than
    long_side. Returns png. On any ffmpeg failure the original is kept."""
    w, h = probe_size(png)
    target = upscaled_size(w, h, long_side)
    if target is None:
        return png
    tmp = png.with_name(png.stem + "_up.png")
    try:
        _run([
            "ffmpeg", "-y", "-i", str(png),
            "-vf", f"scale={target[0]}:{target[1]}:flags=lanczos,"
                   "unsharp=5:5:0.6:5:5:0.0",
            "-frames:v", "1", str(tmp),
        ])
        if _empty(tmp):
            raise RuntimeError("upscale produced no output")
        tmp.replace(png)
    except Exception as e:
        print(f"[firstframe] upscale failed, using original frame: {e}")
        if tmp.exists():
            tmp.unlink()
    return png
