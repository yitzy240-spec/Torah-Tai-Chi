"""Generate canonical Torah Tai Chi dojo reference images via Kie.ai
Nano Banana Pro.

Run once. Output: 2 PNGs in references/dojo/. These are passed alongside
character refs in every dojo clip so the dojo looks visually identical
across episodes.
"""
from __future__ import annotations
import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient
from src.settings import DOJO_ANCHOR_TEXT

REF_DIR = ROOT / "references" / "dojo"
MODEL = "nano-banana-pro"

SHOTS = [
    ("dojo_wide_morning",
     f"{DOJO_ANCHOR_TEXT} Wide establishing shot from the doorway looking in, "
     "the room empty. The brass seven-branched menorah on the side-wall shelf "
     "is clearly visible at left, and the Star of David carved into the back "
     "wall panel is centered in the frame. Soft Pixar-style 3D render, warm "
     "cinematic lighting, high detail, 4K. Aspect ratio 9:16."),
    ("dojo_three_quarter_yinyang",
     f"{DOJO_ANCHOR_TEXT} Three-quarter view facing the wall with the circular "
     "wooden yin-yang plaque centered, the olive-wood low table with teacup "
     "and a small wooden bowl of pomegranates in the foreground, the indigo-"
     "striped wool runner stretching across the floor toward the wall. Soft "
     "Pixar-style 3D render, warm cinematic lighting, high detail, 4K. "
     "Aspect ratio 9:16."),
]


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    kie = KieClient(api_key=kie_key)

    for slug, prompt in SHOTS:
        dest = REF_DIR / f"{slug}.png"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  SKIP {dest.name} (already exists)")
            continue
        print(f"  generating {slug}...")
        payload = {
            "prompt": prompt,
            "output_format": "png",
            "image_size": "9:16",
        }
        task_id = await kie.create_task(MODEL, payload)
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], dest)
        print(f"  saved {dest}")


if __name__ == "__main__":
    asyncio.run(run())
