"""Generate a single short Seedance clip to test pronunciation variants.

Cheap A/B testing for how Seedance's TTS pronounces different spellings of
the same Hebrew word. Usage:
  py tools/test_pronunciation.py "One Torah. Two TOH-rah. Three Tora. Four Eden. Five Eh-den. Six Eddun."

Output: work/pronunciation_tests/pronounce-<timestamp>.mp4 (480p, 6s).
Cost per run: ~$0.60-0.80 on Kie.ai.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient
from src.settings import DOJO_ANCHOR_TEXT, STYLE_LOCK

OUT_DIR = ROOT / "work" / "pronunciation_tests"
SEEDANCE_MODEL = "bytedance/seedance-2"
REFS_DIR = ROOT / "references"
DOJO_REFS_DIR = ROOT / "references" / "dojo"


async def _upload_refs(kie: KieClient) -> list[str]:
    """Use a minimal ref set — 3 character refs + 2 dojo refs — for the test.

    Full ref set is wasteful for a 6s pronunciation test. Seedance still
    locks character identity well with 3-4 refs.
    """
    urls: list[str] = []
    char_refs = sorted(REFS_DIR.glob("*.png"))[:3]
    dojo_refs = sorted(DOJO_REFS_DIR.glob("*.png"))[:2]
    for img in char_refs + dojo_refs:
        url = await kie.upload_file(img, remote_dir="torah-tai-chi/refs/test")
        urls.append(url)
    return urls


async def run(voiceover: str, duration_s: int) -> Path:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    dest = OUT_DIR / f"pronounce-{timestamp}.mp4"

    kie = KieClient(api_key=kie_key, poll_timeout_s=1800)

    print(f"Uploading 5 refs (3 char + 2 dojo)...")
    ref_urls = await _upload_refs(kie)

    visual_prompt = (
        f"{DOJO_ANCHOR_TEXT}\n\n"
        "Rav Eli stands in the center of the dojo on the indigo runner, "
        "facing camera. He speaks the test words evenly and clearly, one "
        "after another, with a brief pause between each. Static medium shot. "
        "Soft morning light.\n\n"
        f'Character speaks: "{voiceover}"\n'
        f"{STYLE_LOCK}"
    )

    payload = {
        "prompt": visual_prompt,
        "reference_image_urls": ref_urls,
        "duration": duration_s,
        "resolution": "480p",
        "aspect_ratio": "9:16",
        "web_search": False,
    }
    print(f"Creating Seedance task (voiceover: {voiceover!r}, {duration_s}s @ 480p)...")
    task_id = await kie.create_task(SEEDANCE_MODEL, payload)
    print(f"  task_id: {task_id}")
    urls = await kie.poll_task(task_id)
    await kie.download(urls[0], dest)
    print(f"\nDONE: {dest}")
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("voiceover", help="The voiceover text to test (include spelling variants)")
    ap.add_argument("--duration", type=int, default=6, help="Clip duration 4-15s (default 6)")
    args = ap.parse_args()
    if not (4 <= args.duration <= 15):
        raise SystemExit("duration must be 4-15s")
    asyncio.run(run(args.voiceover, args.duration))
    return 0


if __name__ == "__main__":
    sys.exit(main())
