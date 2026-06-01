"""One-off recurate from a specific YouTube URL when the user already
picked a clip and we just need to download + trim it to the right
Seedance-compatible window.

Usage:
    python -m tools.recurate_from_url --slug wave_hands_like_clouds \\
        --url "https://youtu.be/qkyKgkThMBk"

What it does:
    1. Downloads the URL via yt-dlp at <=720p (gives an mp4 inside the
       Seedance reference_video_urls pixel window [409600, 927408]).
    2. Verifies the downloaded file's pixel count is inside the window —
       fails loudly otherwise (no silent low-res repeat of the 2026-06-01
       wave_hands_like_clouds incident).
    3. Runs the same Gemini reviewer the bulk curation pipeline uses to
       pick the best 10-15s window of a complete move execution.
    4. Trims/re-encodes to references/tai_chi_moves/<slug>.mp4.
    5. Leaves the .candidates/<slug>/raw.mp4 + review.md behind for audit.

After this, run:
    python -m tools.download_moves --slug <slug> --describe   # refresh sidecar
    python -m tools.sync_moves_to_supabase                    # push to Supabase
"""
from __future__ import annotations
import argparse
import subprocess
import sys
from pathlib import Path

from tools.move_library import (
    load_moves,
    download_candidate,
    review_candidate,
    trim_and_encode,
)


REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"

# Seedance 2.0 reference_video_urls pixel window per Kie.ai docs:
# https://docs.kie.ai/market/bytedance/seedance-2
MIN_PIXELS = 409_600
MAX_PIXELS = 927_408


def probe_pixels(path: Path) -> tuple[int, int, int]:
    """Return (width, height, pixel_count) for the given mp4."""
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    w_str, h_str = res.stdout.strip().split(",")
    w, h = int(w_str), int(h_str)
    return w, h, w * h


def main() -> int:
    ap = argparse.ArgumentParser(prog="recurate_from_url")
    ap.add_argument("--slug", required=True, help="Move slug from moves.yaml")
    ap.add_argument("--url", required=True, help="YouTube URL to download")
    ap.add_argument("--model", default="google/gemini-3.1-pro-preview",
                    help="OpenRouter model for video review")
    ap.add_argument("--min-quality", type=int, default=7,
                    help="Minimum Gemini quality score to accept (1-10)")
    args = ap.parse_args()

    moves = load_moves(LIBRARY_ROOT / "moves.yaml")
    matches = [m for m in moves if m.slug == args.slug]
    if not matches:
        print(f"ERROR: slug {args.slug!r} not found in moves.yaml", file=sys.stderr)
        return 1
    move = matches[0]

    candidates_dir = LIBRARY_ROOT / ".candidates" / move.slug
    candidates_dir.mkdir(parents=True, exist_ok=True)
    raw_path = candidates_dir / "raw.mp4"

    print(f"[1/4] Downloading {args.url} -> {raw_path}")
    downloaded = download_candidate(args.url, raw_path)
    print(f"    -> got {downloaded.name}")

    print(f"[2/4] Verifying pixel count is in Seedance window "
          f"[{MIN_PIXELS}, {MAX_PIXELS}]")
    w, h, px = probe_pixels(downloaded)
    print(f"    -> {w}x{h} = {px} px")
    if px < MIN_PIXELS or px > MAX_PIXELS:
        print(f"ERROR: {px} px is outside Seedance window. yt-dlp picked "
              f"the wrong format. Inspect available formats with "
              f"`yt-dlp -F {args.url}` and adjust download_candidate's "
              f"format selector.", file=sys.stderr)
        return 2

    print(f"[3/4] Gemini reviewing {downloaded.name} for best 10-15s window")
    review = review_candidate(move, downloaded, model=args.model)
    print(f"    -> matches={review.matches} fits_in_15s={review.fits_in_15s} "
          f"quality={review.quality}")
    print(f"    -> window [{review.best_start_sec}s, +{review.best_duration_sec}s]")
    print(f"    -> reason: {review.reason}")

    if not (review.matches and review.fits_in_15s
            and review.quality >= args.min_quality):
        print(f"ERROR: candidate failed acceptance (need matches AND "
              f"fits_in_15s AND quality>={args.min_quality}). "
              f"Keeping raw clip at {raw_path} for inspection; not "
              f"overwriting {move.slug}.mp4.", file=sys.stderr)
        return 3

    final_clip = LIBRARY_ROOT / f"{move.slug}.mp4"
    print(f"[4/4] Trimming to {final_clip}")
    trim_and_encode(downloaded, final_clip,
                    start_sec=review.best_start_sec,
                    duration_sec=review.best_duration_sec)

    # Verify the FINAL output is also in window (trim_and_encode preserves
    # resolution, but assert it anyway).
    w, h, px = probe_pixels(final_clip)
    print(f"    -> final clip {w}x{h} = {px} px")
    if px < MIN_PIXELS or px > MAX_PIXELS:
        print(f"ERROR: trimmed clip is OUTSIDE Seedance window. "
              f"This is a bug in trim_and_encode.", file=sys.stderr)
        return 4

    print()
    print(f"SUCCESS — {final_clip} is ready.")
    print(f"Next steps:")
    print(f"  python -m tools.download_moves --slug {move.slug} --describe")
    print(f"  SUPABASE_URL=... python -m tools.sync_moves_to_supabase")
    return 0


if __name__ == "__main__":
    sys.exit(main())
