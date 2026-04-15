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
            "Camera at the SOUTH doorway looking NORTH into the room. Very "
            "wide establishing shot, full room visible end-to-end so the "
            "spatial layout reads clearly. The darker-cedar Star of David "
            "plaque mounted on the pale linen north wall is centered ahead. "
            "The brass seven-branched menorah on its shelf is visible on the "
            "east wall (camera right). The Torah Tai Chi logo wall display "
            "(cedar yin-yang disc with magen david inset, 'TORAH' arced above "
            "in standalone wooden letters, 'TAI CHI' straight below in "
            "standalone wooden letters) is visible on the west wall (camera "
            "left). The olive-wood low table sits mid-room. Soft Pixar-style "
            "3D render, warm cinematic lighting, high detail, 4K. Wide "
            "cinematic 16:9 framing."
        ),
    },
    {
        "slug": "dojo_three_quarter_star",
        "reference_shot": "dojo_wide_morning",
        "prompt": (
            f"{DOJO_ANCHOR_TEXT} "
            "This is the SAME ROOM as the reference image, just shot from a "
            "different camera angle. Match the furniture placement, wall "
            "positions, materials, lighting, and visual style of the "
            "reference image exactly. "
            "Camera now positioned in the SOUTHWEST corner of the room "
            "looking NORTHEAST toward the Star of David plaque on the north "
            "wall — the darker-cedar Star of David on pale linen is centered "
            "in the frame. The brass seven-branched menorah on its shelf "
            "along the east wall is visible on the right side of the frame. "
            "The olive-wood low table with teacup and wooden bowl of "
            "pomegranates sits in the mid-ground. The indigo-striped wool "
            "runner runs diagonally across the cedar floor. "
            "Wide three-quarter angle, full room depth visible. "
            "Soft Pixar-style 3D render, warm cinematic lighting, high "
            "detail, 4K. Wide cinematic 16:9 framing."
        ),
    },
    {
        "slug": "dojo_interior_detail",
        "reference_shot": "dojo_wide_morning",
        "prompt": (
            f"{DOJO_ANCHOR_TEXT} "
            "This is the SAME ROOM as the reference image, just a tighter "
            "framing. Match the furniture placement, wall positions, "
            "materials, lighting, and visual style of the reference image "
            "exactly. "
            "Medium close-up from mid-room height, facing northwest, showing "
            "the olive-wood low table in the foreground with the ceramic "
            "teacup and wooden bowl of pomegranates clearly visible on top, "
            "a slice of the indigo-striped wool runner crossing the cedar "
            "floor below, and part of the Torah Tai Chi logo wall display "
            "visible on the back wall behind the table. Establishes the "
            "material palette — cedar, olive wood, indigo wool, brass, "
            "pale linen. "
            "Soft Pixar-style 3D render, warm cinematic lighting, high "
            "detail, 4K. Wide cinematic 16:9 framing."
        ),
    },
    {
        "slug": "dojo_three_quarter_yinyang",
        "reference_shot": "dojo_wide_morning",
        "prompt": (
            f"{DOJO_ANCHOR_TEXT} "
            "This is the SAME ROOM as the reference image, just shot from a "
            "different camera angle. Match the furniture placement, wall "
            "positions, materials, lighting, and visual style of the "
            "reference image exactly. "
            "Camera now positioned in the SOUTHEAST corner of the room "
            "looking NORTHWEST toward the west wall — the Torah Tai Chi logo "
            "wall display (cedar yin-yang disc with magen david inset, "
            "'TORAH' arced above, 'TAI CHI' straight below — all standalone "
            "wooden letters) is centered in the frame. The darker-cedar Star "
            "of David plaque mounted on the pale linen north wall is visible "
            "on the right side of the frame — rendered with the same wooden "
            "material and style as the logo wall, clearly a wooden object "
            "mounted on the wall. The olive-wood low table with teacup and "
            "wooden bowl of pomegranates sits in the mid-ground. The indigo-"
            "striped wool runner runs across the cedar floor. Wide three-"
            "quarter angle, full room depth visible. "
            "Soft Pixar-style 3D render, warm cinematic lighting, high "
            "detail, 4K. Wide cinematic 16:9 framing."
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
