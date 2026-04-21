"""One-time sync of references/tai_chi_moves/ into Supabase.

Walks every *.json sidecar. For each sidecar:
  1. Confirms the paired *.mp4 exists.
  2. Probes the mp4 duration with ffprobe; skip if > 15s.
  3. Uploads the mp4 to the `videos` bucket at tai_chi_moves/<slug>.mp4 (upsert).
  4. Upserts a tai_chi_moves row with sidecar fields + storage path + duration.

Usage:
    python -m tools.sync_moves_to_supabase

Re-run whenever new moves land. Idempotent.

Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
(service role because we're uploading to storage from outside auth).
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"
BUCKET = "videos"
STORAGE_PREFIX = "tai_chi_moves"


def probe_duration_seconds(mp4: Path) -> float:
    """Return duration of an mp4 in seconds, via ffprobe."""
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(mp4),
        ],
        text=True,
    )
    return float(out.strip())


def sync_one(sb, sidecar_path: Path) -> tuple[str, str]:
    """Sync one sidecar + its paired mp4. Returns (slug, outcome_label)."""
    slug = sidecar_path.stem
    mp4 = sidecar_path.with_suffix(".mp4")
    if not mp4.exists():
        return slug, "skipped: no mp4"

    duration = probe_duration_seconds(mp4)
    if duration > 15.0:
        return slug, f"skipped: duration {duration:.1f}s > 15s"
    duration_s = max(1, int(round(duration)))

    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    # sidecar requires: english, pinyin, section, visual, motion_description
    for key in ("english", "pinyin", "section", "visual", "motion_description"):
        if key not in sidecar:
            return slug, f"skipped: sidecar missing '{key}'"

    storage_path = f"{STORAGE_PREFIX}/{slug}.mp4"

    with open(mp4, "rb") as f:
        sb.storage.from_(BUCKET).upload(
            storage_path, f.read(),
            file_options={"content-type": "video/mp4", "upsert": "true"},
        )

    sb.table("tai_chi_moves").upsert({
        "slug": slug,
        "english": sidecar["english"],
        "pinyin": sidecar["pinyin"],
        "section": sidecar["section"],
        "visual": sidecar["visual"],
        "motion_description": sidecar["motion_description"],
        "mp4_storage_path": storage_path,
        "duration_s": duration_s,
        "updated_at": "now()",
    }).execute()

    return slug, f"synced ({duration_s}s)"


def main() -> int:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    sidecars = sorted(LIBRARY_ROOT.glob("*.json"))
    if not sidecars:
        print(f"No sidecars in {LIBRARY_ROOT}", file=sys.stderr)
        return 1

    print(f"Syncing {len(sidecars)} sidecar(s)...")
    synced = 0
    skipped = 0
    for sidecar in sidecars:
        slug, outcome = sync_one(sb, sidecar)
        print(f"  {slug:40s}  {outcome}")
        if outcome.startswith("synced"):
            synced += 1
        else:
            skipped += 1

    print(f"\nDone: {synced} synced, {skipped} skipped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
