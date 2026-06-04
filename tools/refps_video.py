"""Re-encode a Supabase-stored mp4 to 30 fps and upload it back.

For a one-off fix on videos that pre-date the stitcher's `-r 30` change
(commit 89c8d13). Use when Facebook/Instagram Reels reject a video with
"frame rate must be between 24 and 60 fps" — Seedance outputs 23.976,
their preflight rounds down to 23, then 429s it.

Usage:
    SUPABASE_URL=https://<project>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<key> \
    python -m tools.refps_video <storage_path>

    # Example:
    python -m tools.refps_video jobs/a62c7b37-065e-417d-a83d-cc7119fb16d5/final.mp4

The file is overwritten in place (same bucket, same path) so any URL
already cached by Buffer/the dashboard still resolves to the fixed
version on the next refetch.

Bundles its own ffmpeg via imageio-ffmpeg (no separate install).
"""
from __future__ import annotations
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

BUCKET = "videos"
TARGET_FPS = 30


def get_ffmpeg() -> str:
    """Return the path to a usable ffmpeg binary. Tries PATH first,
    falls back to imageio-ffmpeg's bundled static binary."""
    try:
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)
        return "ffmpeg"
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        print(
            "ffmpeg not in PATH and imageio-ffmpeg not installed.\n"
            "Run: pip install imageio-ffmpeg",
            file=sys.stderr,
        )
        sys.exit(1)


def main(storage_path: str) -> int:
    ff = get_ffmpeg()
    print(f"Using ffmpeg: {ff}")

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        orig = td_path / "orig.mp4"
        fixed = td_path / "fixed.mp4"

        print(f"Downloading {storage_path} ...")
        try:
            blob = sb.storage.from_(BUCKET).download(storage_path)
        except Exception as e:
            print(f"download failed: {e}", file=sys.stderr)
            return 1
        orig.write_bytes(blob)
        print(f"  {orig.stat().st_size:,} bytes")

        print(f"Re-encoding at {TARGET_FPS} fps ...")
        result = subprocess.run(
            [
                ff, "-y", "-i", str(orig),
                "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-r", str(TARGET_FPS),
                "-c:a", "copy",
                str(fixed),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            tail = result.stderr.decode("utf-8", errors="replace")[-800:]
            print(f"ffmpeg failed:\n{tail}", file=sys.stderr)
            return 1
        print(f"  {fixed.stat().st_size:,} bytes")

        print(f"Uploading back to {storage_path} ...")
        try:
            sb.storage.from_(BUCKET).upload(
                storage_path, fixed.read_bytes(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )
        except Exception as e:
            print(f"upload failed: {e}", file=sys.stderr)
            return 1

    print(f"\nDone. {storage_path} now serves a {TARGET_FPS} fps mp4.")
    print("Refresh Buffer's compose page; the preflight will re-check and accept.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(
            "Usage: python -m tools.refps_video <storage_path>\n"
            "Example: python -m tools.refps_video "
            "jobs/a62c7b37-065e-417d-a83d-cc7119fb16d5/final.mp4",
            file=sys.stderr,
        )
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
