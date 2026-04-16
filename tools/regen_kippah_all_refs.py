"""Regenerate all character reference images with the new kippah sruga.

Uses the test_kippah_swap.py prompt pattern: upload each existing character
ref + the kippah size/style reference, swap ONLY the kippah, save back.

Operates on references/*.png (top-level only — dojo subdir skipped).
Writes results in place, overwriting the originals.

Cost: ~$0.05 per ref × 12 = ~$0.65.

If any single ref fails or the result looks wrong, re-run this script —
it skips files that don't exist in references/_backup/ so it's safe to
run multiple times after cleaning up specific bad results.
"""
from __future__ import annotations
import asyncio
import os
import shutil
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient

REFS_DIR = ROOT / "references"
BACKUP_DIR = ROOT / "references" / "_backup_brown_kippah"
KIPPAH_REF = ROOT / "references" / "modern orthodox kippa size.jpeg"


def _kippah_prompt() -> str:
    return (
        "TWO REFERENCE IMAGES PROVIDED:\n"
        "- Image 1 is the CHARACTER REFERENCE: preserve his face, salt-and-"
        "pepper beard, navy mandarin-collar shirt with the Torah Tai Chi "
        "yin-yang logo on the chest, same pose, same composition, same "
        "framing, same lighting, same background. Everything about him "
        "stays IDENTICAL except for the kippah. KEEP HIS HAIR EXACTLY AS "
        "IT IS — same hairline, same hairstyle. Do NOT push his hair back.\n"
        "- Image 2 is the KIPPAH SIZE AND FIT REFERENCE: match the SIZE, "
        "SCALE-ON-HEAD, SHAPE, and POSITION of the kippah in image 2.\n\n"
        "REPLACE ONLY the brown leather kippah from image 1 with a kippah "
        "sruga matching the size and fit of image 2, but with navy-blue "
        "crocheted yarn featuring a cream-colored geometric knitted pattern "
        "(concentric bands, similar style to image 2 but navy instead of "
        "black). Small compact patch, sits on the back-top of the crown — "
        "NOT covering the whole head. No Star of David, no letters — just "
        "the knit pattern.\n\n"
        "Single-figure output, no split composition. Keep every other "
        "aspect of image 1 unchanged. Soft Pixar-style 3D render, 4K, "
        "high detail."
    )


async def _swap_one(
    kie: KieClient, kippah_url: str, src_path: Path,
) -> None:
    print(f"  {src_path.name}: uploading, swapping kippah...")
    src_url = await kie.upload_file(src_path, remote_dir="torah-tai-chi/kippah-regen")
    payload = {
        "prompt": _kippah_prompt(),
        "image_input": [src_url, kippah_url],
        "output_format": "png",
        "image_size": "1:1",
    }
    task_id = await kie.create_task("nano-banana-pro", payload)
    urls = await kie.poll_task(task_id)
    await kie.download(urls[0], src_path)  # overwrite original
    print(f"  {src_path.name}: saved")


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    if not KIPPAH_REF.exists():
        raise SystemExit(f"Missing kippah ref: {KIPPAH_REF}")

    # Back up originals once (safety net)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    char_refs = sorted(REFS_DIR.glob("*.png"))  # top-level PNGs only
    if not char_refs:
        raise SystemExit(f"No character refs in {REFS_DIR}")
    for ref in char_refs:
        backup = BACKUP_DIR / ref.name
        if not backup.exists():
            shutil.copy(ref, backup)
    print(f"Backed up {len(char_refs)} originals to {BACKUP_DIR}")

    kie = KieClient(api_key=kie_key, poll_timeout_s=600)
    print(f"Uploading kippah ref once: {KIPPAH_REF.name}")
    kippah_url = await kie.upload_file(KIPPAH_REF, remote_dir="torah-tai-chi/kippah-regen")

    print(f"Regenerating {len(char_refs)} character refs...")
    for ref in char_refs:
        try:
            await _swap_one(kie, kippah_url, ref)
        except Exception as e:
            print(f"  {ref.name}: FAILED ({e}) — original preserved in backup")
    print(f"\nDONE. Originals backed up at {BACKUP_DIR}")


if __name__ == "__main__":
    asyncio.run(run())
