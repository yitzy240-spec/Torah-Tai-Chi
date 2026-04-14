from __future__ import annotations
import subprocess
import tempfile
from pathlib import Path


def concat_clips(clips: list[Path], dest: Path) -> Path:
    """Concatenate MP4 clips using ffmpeg concat demuxer.

    Assumes all clips share codec/dimensions (Seedance output is consistent).
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False,
                                     encoding="utf-8") as f:
        for c in clips:
            # ffmpeg concat demuxer needs forward slashes + escaped quotes
            path_str = str(c.resolve()).replace("\\", "/")
            f.write(f"file '{path_str}'\n")
        list_file = f.name
    try:
        subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", list_file, "-c", "copy", str(dest),
        ], check=True, capture_output=True)
    finally:
        Path(list_file).unlink(missing_ok=True)
    return dest
