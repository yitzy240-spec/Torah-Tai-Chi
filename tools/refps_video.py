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

Uses Supabase's REST API directly via httpx (no supabase-py dependency,
which requires C extensions that don't build on Python 3.14 Windows).
Bundles its own ffmpeg via imageio-ffmpeg if needed.
"""
from __future__ import annotations
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

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


def download(supabase_url: str, key: str, storage_path: str, dest: Path) -> int:
    """Download a public-bucket file via the storage REST endpoint.
    Returns the byte count written."""
    url = f"{supabase_url}/storage/v1/object/public/{BUCKET}/{storage_path}"
    with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as r:
        r.raise_for_status()
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                f.write(chunk)
                n += len(chunk)
    return n


def upload(supabase_url: str, key: str, storage_path: str, src: Path) -> None:
    """Upload (upsert) a file to the storage REST endpoint.
    Service-role key required for write."""
    url = f"{supabase_url}/storage/v1/object/{BUCKET}/{storage_path}"
    with open(src, "rb") as f:
        data = f.read()
    r = httpx.post(
        url,
        content=data,
        headers={
            "Authorization": f"Bearer {key}",
            "apikey": key,
            "Content-Type": "video/mp4",
            "x-upsert": "true",
        },
        timeout=300.0,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"upload {r.status_code}: {r.text[:400]}")


def main(storage_path: str) -> int:
    ff = get_ffmpeg()
    print(f"Using ffmpeg: {ff}")

    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        orig = td_path / "orig.mp4"
        fixed = td_path / "fixed.mp4"

        print(f"Downloading {storage_path} ...")
        try:
            n = download(supabase_url, key, storage_path, orig)
        except Exception as e:
            print(f"download failed: {e}", file=sys.stderr)
            return 1
        print(f"  {n:,} bytes")

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
            upload(supabase_url, key, storage_path, fixed)
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
