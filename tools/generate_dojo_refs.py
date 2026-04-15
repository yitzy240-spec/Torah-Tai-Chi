"""Generate canonical Torah Tai Chi dojo reference images via Kie.ai
Nano Banana Pro.

Run once. Output: 2 PNGs in references/dojo/. These are passed alongside
character refs in every dojo clip so the dojo looks visually identical
across episodes.

The second shot uses the first shot as an image_input so the model has a
visual anchor for "this is the same room from a different angle" — text
prompts alone can't keep furniture/wall placement consistent across shots.
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
    {
        "slug": "dojo_wide_morning",
        "reference_shot": None,
        "prompt": (
            f"{DOJO_ANCHOR_TEXT} "
            "SHOT: Camera positioned at the SOUTH doorway looking directly "
            "NORTH into the room. Wide establishing shot; the full rectangular "
            "room is visible, depth from foreground to the north wall at the "
            "back. "
            "IN THIS FRAME: cedar floor extends forward. The olive-wood low "
            "table sits in the center mid-ground with its teacup and bowl of "
            "pomegranates on top. The indigo-striped wool runner runs straight "
            "ahead under the table toward the north wall. The north wall at "
            "the back is SOLID pale linen with ONLY the darker-cedar Star of "
            "David plaque centered on it — no doors, no other openings, no "
            "lattice. The WEST wall on camera-LEFT is SOLID pale linen with "
            "ONLY the Torah Tai Chi logo wall display (round cedar yin-yang "
            "disc with magen david inset, 'TORAH' arced above in separate "
            "cedar letters, 'TAI CHI' straight below in separate cedar "
            "letters) — no doors, no lattice anywhere on this wall. The EAST "
            "wall on camera-RIGHT is SOLID pale linen with ONLY the brass "
            "seven-branched menorah on its wooden shelf — no doors, no lattice. "
            "Only the south wall BEHIND the camera has a lattice doorway; it "
            "is NOT visible in this forward-facing shot. "
            "Soft Pixar-style 3D render, warm cinematic lighting from the "
            "south doorway behind camera, high detail, 4K. Wide cinematic "
            "16:9 framing."
        ),
    },
    {
        "slug": "dojo_three_quarter_yinyang",
        "reference_shot": "dojo_wide_morning",
        "prompt": (
            f"{DOJO_ANCHOR_TEXT} "
            "SHOT: This is the SAME ROOM as the reference image, same "
            "rectangular geometry, same wall placements, same furniture, same "
            "materials, same lighting. DIFFERENT CAMERA ANGLE ONLY. Camera is "
            "now in the southeast corner of the room looking NORTHWEST. "
            "IN THIS FRAME: the WEST wall (camera-center) is SOLID pale linen "
            "with ONLY the Torah Tai Chi logo wall display centered on it — "
            "round cedar yin-yang disc (with magen david inset), 'TORAH' in "
            "separate cedar letters arced above, 'TAI CHI' in separate cedar "
            "letters straight below. No doors, no lattice, no other "
            "decorations on this wall. The NORTH wall is visible on "
            "camera-right, SOLID pale linen with ONLY the darker-cedar Star of "
            "David plaque centered on it — no doors, no lattice. The olive-"
            "wood low table with teacup and pomegranate bowl sits in the "
            "mid-ground in front of the logo wall. The indigo-striped wool "
            "runner crosses the cedar floor diagonally. Do NOT show the south "
            "doorway or any lattice screens; the camera is inside the room "
            "facing away from the south wall. "
            "Soft Pixar-style 3D render, warm cinematic lighting from the "
            "unseen south doorway behind camera, high detail, 4K. Wide "
            "cinematic 16:9 framing."
        ),
    },
]


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    kie = KieClient(api_key=kie_key)

    for shot in SHOTS:
        dest = REF_DIR / f"{shot['slug']}.png"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  SKIP {dest.name} (already exists)")
            continue
        payload: dict = {
            "prompt": shot["prompt"],
            "output_format": "png",
            "image_size": "16:9",
        }
        if shot["reference_shot"]:
            ref_path = REF_DIR / f"{shot['reference_shot']}.png"
            if not ref_path.exists():
                raise SystemExit(
                    f"  cannot generate {shot['slug']}: reference shot "
                    f"{ref_path} does not exist yet (generate it first)"
                )
            print(f"  uploading reference: {ref_path.name}")
            ref_url = await kie.upload_file(ref_path, remote_dir="torah-tai-chi/refs/dojo-source")
            payload["image_input"] = [ref_url]
        print(f"  generating {shot['slug']}...")
        task_id = await kie.create_task(MODEL, payload)
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], dest)
        print(f"  saved {dest}")


if __name__ == "__main__":
    asyncio.run(run())
