"""Upscale an existing reference clip so its pixel count lands inside the
Seedance reference_video_urls window [409600, 927408]. Use as a fallback
when YouTube has no higher-resolution source for a move and recurate
returns needs_review.

Strategy:
  - Read source dimensions via ffprobe.
  - Pick a target (w, h) that PRESERVES the source aspect ratio AND lands
    pixel count in the middle of the Seedance window (~700K px).
  - Re-encode with ffmpeg lanczos scaler.

For motion-reference use this is acceptable: Seedance reads body
trajectory/tempo/stance from the reference, not visual detail. The
spatial information that matters is preserved.

Usage:
    python -m tools.upscale_to_seedance_window --slug repulse_monkey

In-place: overwrites references/tai_chi_moves/<slug>.mp4 with the
upscaled version. Original is saved to .candidates/<slug>/pre_upscale.mp4
for audit.
"""
from __future__ import annotations
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"

MIN_PIXELS = 409_600
MAX_PIXELS = 927_408
TARGET_PIXELS = 700_000  # mid-window with headroom on both sides
MIN_DIM = 300            # Seedance per-dimension floor
MAX_DIM = 6000           # Seedance per-dimension ceiling


def probe_dims(path: Path) -> tuple[int, int]:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "csv=p=0", str(path)],
        text=True,
    ).strip()
    if not out:
        raise RuntimeError(f"ffprobe found no video stream in {path}")
    w_str, h_str = out.split(",")
    return int(w_str), int(h_str)


def pick_target(src_w: int, src_h: int) -> tuple[int, int]:
    """Choose (target_w, target_h) preserving aspect, near TARGET_PIXELS,
    rounded to even numbers (libx264 requirement), and inside the per-
    dimension constraints. Raises if no valid target exists."""
    aspect = src_w / src_h
    # If aspect is w/h, then w = sqrt(target_px * aspect), h = sqrt(target_px / aspect)
    import math
    target_w = int(round(math.sqrt(TARGET_PIXELS * aspect)))
    target_h = int(round(math.sqrt(TARGET_PIXELS / aspect)))
    # Round to even (libx264)
    target_w -= target_w % 2
    target_h -= target_h % 2

    px = target_w * target_h
    if px < MIN_PIXELS or px > MAX_PIXELS:
        raise RuntimeError(
            f"computed target {target_w}x{target_h}={px}px is outside "
            f"Seedance window [{MIN_PIXELS}, {MAX_PIXELS}] — aspect "
            f"{aspect:.2f} may need manual crop/pad")
    if target_w < MIN_DIM or target_h < MIN_DIM:
        raise RuntimeError(
            f"computed target {target_w}x{target_h} has a dimension "
            f"below Seedance per-dim floor {MIN_DIM}")
    if target_w > MAX_DIM or target_h > MAX_DIM:
        raise RuntimeError(
            f"computed target {target_w}x{target_h} has a dimension "
            f"above Seedance per-dim ceiling {MAX_DIM}")
    return target_w, target_h


def main() -> int:
    ap = argparse.ArgumentParser(prog="upscale_to_seedance_window")
    ap.add_argument("--slug", required=True, help="Move slug to upscale")
    args = ap.parse_args()

    src = LIBRARY_ROOT / f"{args.slug}.mp4"
    if not src.exists():
        print(f"ERROR: {src} does not exist", file=sys.stderr)
        return 1

    src_w, src_h = probe_dims(src)
    src_px = src_w * src_h
    print(f"Source: {src_w}x{src_h} = {src_px}px")

    if MIN_PIXELS <= src_px <= MAX_PIXELS:
        print(f"Already in window — nothing to do.")
        return 0

    target_w, target_h = pick_target(src_w, src_h)
    target_px = target_w * target_h
    print(f"Target: {target_w}x{target_h} = {target_px}px "
          f"(in window: {MIN_PIXELS}<={target_px}<={MAX_PIXELS})")

    # Backup before overwriting
    backup_dir = LIBRARY_ROOT / ".candidates" / args.slug
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / "pre_upscale.mp4"
    shutil.copy2(src, backup)
    print(f"Backed up source to {backup}")

    tmp = src.with_suffix(".upscale.tmp.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
         "-vf", f"scale={target_w}:{target_h}:flags=lanczos",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p",
         "-c:a", "copy",
         "-movflags", "+faststart",
         str(tmp)],
        check=True,
    )
    tmp.replace(src)

    # Verify
    out_w, out_h = probe_dims(src)
    out_px = out_w * out_h
    print(f"Output: {out_w}x{out_h} = {out_px}px")
    if not (MIN_PIXELS <= out_px <= MAX_PIXELS):
        print(f"ERROR: upscaled output {out_px}px is outside Seedance window",
              file=sys.stderr)
        return 2

    print(f"SUCCESS — {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
