"""Post-render check: did Seedance actually open on the chain frame?

Noach 2026-10-13: a chained clip logged has_first_frame=true but its
frame 0 was a completely different shot, and nothing flagged it. Compare
the rendered clip's first frame to the PNG we sent as first_frame_url.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

# Portrait 9:16 thumbnail; small enough to ignore compression noise.
_SIZE = (64, 114)
# Calibrated on Noach 2026-10-13: honoured chains scored 0.970/0.971; the
# two that opened on a different wide shot scored 0.838/0.850.
HONORED_THRESHOLD = 0.92


def frame_similarity(png_a: Path, png_b: Path) -> float:
    """1 - mean absolute grayscale difference / 255, on 64x114 thumbnails.

    1.0 = identical; a different shot of the same room typically lands
    well below HONORED_THRESHOLD.
    """
    from PIL import Image, ImageChops, ImageStat

    with Image.open(png_a) as a, Image.open(png_b) as b:
        ga = a.convert("L").resize(_SIZE)
        gb = b.convert("L").resize(_SIZE)
    mean_diff = ImageStat.Stat(ImageChops.difference(ga, gb)).mean[0]
    return 1.0 - mean_diff / 255.0


def extract_first_frame(in_mp4: Path, out_png: Path) -> Path:
    if not in_mp4.exists():
        raise FileNotFoundError(f"input mp4 not found: {in_mp4}")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(in_mp4), "-frames:v", "1",
         "-q:v", "1", "-f", "image2", str(out_png)],
        check=True, timeout=60, capture_output=True,
    )
    if not out_png.exists() or out_png.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg produced no first frame for {in_mp4}")
    return out_png
