"""Generate + upload still-frame poster WebPs for the Tai Chi move library.

For each .mp4 in references/tai_chi_moves/:
  1. Extract a representative frame at ~1s (via ffmpeg) at 80×142 px WebP.
  2. Upload to Supabase storage at videos/tai_chi_moves/<slug>.webp.
  3. Update tai_chi_moves.thumb_poster_path with the storage path.

Why: see migration 20260604_tai_chi_moves_poster.sql. The MotionPickerSheet
in the dashboard currently downloads + autoplays ~50 MB of full-resolution
MP4s every time the operator opens the picker — unusable over cellular per
the perf audit. Posters replace the autoplay with a static image; the full
video promotes-to-play only on tap.

Usage:
    SUPABASE_URL=https://<project>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<key> \
    python -m tools.generate_move_posters

Idempotent: re-running overwrites existing posters (via upsert).

Requirements:
- ffmpeg in PATH (already required by tools/sync_moves_to_supabase.py)
- supabase-py installed (already in pyproject [dev] extras)
- libwebp built into your ffmpeg (most Homebrew/apt builds include it)
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

REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"
BUCKET = "videos"
STORAGE_PREFIX = "tai_chi_moves"
POSTER_WIDTH = 80
POSTER_HEIGHT = 142  # matches MotionPickerSheet's 40×71 display at 2x DPR
POSTER_SEEK_S = 1.0  # frame from the 1-second mark, avoids title/black-frames


def extract_poster(mp4: Path, out: Path) -> None:
    """Run ffmpeg to extract a single frame at POSTER_SEEK_S into a WebP."""
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(POSTER_SEEK_S),
            "-i", str(mp4),
            "-vframes", "1",
            "-vf", f"scale={POSTER_WIDTH}:{POSTER_HEIGHT}",
            "-c:v", "libwebp",
            "-quality", "80",
            str(out),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def generate_one(sb, mp4: Path) -> tuple[str, str]:
    """Generate + upload poster for a single move's mp4. Returns (slug, outcome)."""
    slug = mp4.stem
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / f"{slug}.webp"
        try:
            extract_poster(mp4, out)
        except subprocess.CalledProcessError as e:
            return slug, f"ffmpeg failed: {e.stderr.decode('utf-8', 'ignore')[:120]}"
        if not out.exists() or out.stat().st_size == 0:
            return slug, "ffmpeg produced no output"

        storage_path = f"{STORAGE_PREFIX}/{slug}.webp"
        try:
            sb.storage.from_(BUCKET).upload(
                storage_path, out.read_bytes(),
                file_options={"content-type": "image/webp", "upsert": "true"},
            )
        except Exception as e:
            return slug, f"upload failed: {e}"

    try:
        sb.table("tai_chi_moves").update(
            {"thumb_poster_path": storage_path, "updated_at": "now()"}
        ).eq("slug", slug).execute()
    except Exception as e:
        return slug, f"db update failed: {e}"

    return slug, f"ok ({out.stat().st_size if False else POSTER_WIDTH}×{POSTER_HEIGHT})"


def main() -> int:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    mp4s = sorted(LIBRARY_ROOT.glob("*.mp4"))
    if not mp4s:
        print(f"No mp4s in {LIBRARY_ROOT}", file=sys.stderr)
        return 1

    print(f"Generating posters for {len(mp4s)} move(s)...")
    ok = 0
    failed = 0
    for mp4 in mp4s:
        slug, outcome = generate_one(sb, mp4)
        print(f"  {slug:40s}  {outcome}")
        if outcome.startswith("ok"):
            ok += 1
        else:
            failed += 1

    print(f"\nDone: {ok} ok, {failed} failed.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
