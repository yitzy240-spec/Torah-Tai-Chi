"""Add the embroidered chest crest to the Facebook banner using OpenAI's
GPT Image 2 (image-to-image) via Kie — its text rendering + instruction-
following is far better than nano-banana at both keeping the tai-chi pose AND
stitching a legible "Torah" crest.

Model: gpt-image-2-image-to-image (Kie market model, existing KIE key).

Run:  python tools/fb_banner_gptimage.py
"""
from __future__ import annotations

import asyncio
import glob
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient  # noqa: E402

_matches = sorted(glob.glob(str(ROOT / "references" / "_brand" / "fb_banner_input.*")))
BANNER_SRC = Path(_matches[0]) if _matches else \
    ROOT / "references" / "_brand" / "fb_banner_input.png"
# 2026-07-29: was _canonical/rav_eli_chest_crest.png — that image is cropped
# right below the logo (no "Tai Chi"), which is why the banner shipped with
# an incomplete crest (Yonah). The 07 crest crop shows the full design.
CREST_REF = ROOT / "references" / "_char_fix" / "crest_target_from_07.png"
OUT_DIR = ROOT / "references" / "_brand"
MODEL = "gpt-image-2-image-to-image"

_PROMPT = """\
Edit the FIRST image — a finished wide dojo banner (Star of David wall hanging, \
shoji window, menorah, open Torah scroll, pomegranates, weapon racks) with ONE \
man doing a calm tai-chi pose on the right in a navy Chinese-cut linen outfit \
and blue kippah.

Add ONE thing: a small EMBROIDERED crest on the LEFT CHEST of his shirt, over \
the heart. The crest has THREE parts, all required: the word "Torah" arced in \
cream stitching on top, a tonal cream-and-grey yin-yang with a small navy Star \
of David in the pale lobe in the middle, and the words "Tai Chi" in cream \
stitching beneath it — low-contrast thread embroidery in the shirt's own colour \
family (cream + navy, no bright colours, no wooden ring, not a badge or disc). \
About the size of his fist, sitting naturally in the fabric at his body angle. \
The SECOND image is the exact crest to match — spelling must be exactly \
"Torah" and "Tai Chi", with "Tai Chi" fully visible below the circle.

Keep everything else identical: his tai-chi pose, face, beard, kippah, hands, \
the entire room and every prop, the lighting, colours, framing and aspect \
ratio. Do not add any second person, portrait, floating shirt or new object. \
Only add the small chest crest.\
"""


async def _gen(kie: KieClient, name: str, input_urls: list[str], dest: Path) -> None:
    payload = {
        "prompt": _PROMPT,
        "input_urls": input_urls,
        # Force the wide banner shape (21:9 ~ 2.33, closest to the original
        # 2.40) — "auto" reframed to 4:3.
        "aspect_ratio": "21:9",
        # 2026-07-29: "2K" started returning 500 from Kie on this model;
        # 1K/21:9 works and comfortably exceeds FB's 820x312 cover display.
        "resolution": "1K",
    }
    try:
        task_id = await kie.create_task(MODEL, payload)
        urls, _meta = await kie.poll_task(task_id)
        await kie.download(urls[0], dest)
        print(f"  OK   {dest.name}")
    except Exception as exc:
        print(f"  FAIL {name}: {exc}")


async def main() -> None:
    load_dotenv(ROOT / ".env")
    if not os.environ.get("KIE_AI_API_KEY"):
        raise SystemExit("KIE_AI_API_KEY not set")
    if not BANNER_SRC.exists() or not CREST_REF.exists():
        raise SystemExit("banner or crest reference missing")

    # gpt-image-2 wants clean PNG inputs — convert the jpg banner.
    banner_png = OUT_DIR / "fb_banner_input_rgb.png"
    Image.open(BANNER_SRC).convert("RGB").save(banner_png)

    kie = KieClient(os.environ["KIE_AI_API_KEY"], poll_timeout_s=600)
    print("Uploading banner + crest ...")
    banner_url = await kie.upload_file(banner_png)
    crest_url = await kie.upload_file(CREST_REF)

    await asyncio.gather(
        _gen(kie, "full-crest-a", [banner_url, crest_url],
             OUT_DIR / "fb_banner_gptimage_v3.png"),
        _gen(kie, "full-crest-b", [banner_url, crest_url],
             OUT_DIR / "fb_banner_gptimage_v4.png"),
    )
    print("Done → references/_brand/fb_banner_gptimage_v3.png + v4.png")


if __name__ == "__main__":
    asyncio.run(main())
