"""Fix the cropped chest crest on character refs via GPT Image 2 (Kie).

Three of the five character refs Seedance actually receives on DOJO clips
are missing the "Tai Chi" line under the chest logo (frame crops it), so
the model improvises that area per roll — Yonah kept seeing shirts
without "Tai Chi". Regenerate those refs with the crest redrawn complete
(slightly smaller/higher so the whole crest fits in-frame), using 07's
correct crest as the style target.

Outputs go to references/_char_fix/fixed/ for review — production refs
in references/ are NOT touched by this script.

Run:  python tools/fix_char_crest_gptimage.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient  # noqa: E402

SRC_DIR = ROOT / "references" / "_char_fix"
OUT_DIR = SRC_DIR / "fixed"
MODEL = "gpt-image-2-image-to-image"

# (filename, variants) — priority order from _char_fix/README.md.
TARGETS = [
    ("01_front_neutral.png", 2),
    ("10_closeup_thoughtful.png", 2),
    ("03_threequarter_right_speaking.png", 1),
]

_PROMPT = """\
Edit the FIRST image — a Pixar-style 3D render of a middle-aged Jewish \
tai chi teacher (gray-streaked beard, navy knit kippah, navy linen \
Chinese-cut shirt) used as a character consistency reference.

Change ONE thing only: the embroidered crest on the chest of his shirt. \
Redraw it so the COMPLETE crest is visible inside the frame: the word \
"Torah" arced on top, the cream-and-grey yin-yang circle with a small \
Star of David in the pale lobe in the middle, and the words "Tai Chi" \
beneath it — exactly matching the SECOND image, which shows the correct \
finished crest on the same shirt. If the current crest is partly cut off \
by the edge of the frame, make the crest slightly smaller and move it \
slightly up/inward ON THE SHIRT so that ALL of it, including "Tai Chi", \
fits fully inside the frame. Low-contrast cream thread embroidery, no \
badge, no disc, no bright colors.

Everything else must stay pixel-faithful to the first image: same face, \
same beard, same kippah, same pose, same hands, same shirt folds, same \
lighting, same plain background, same framing and aspect ratio. Do not \
add objects or people. The spelling must be exactly "Torah" and \
"Tai Chi".\
"""


def _make_crest_target() -> Path:
    """Crop 07's complete crest as the style reference."""
    src = SRC_DIR / "07_fullbody_yinyang_pose.png"
    im = Image.open(src).convert("RGB")
    w, h = im.size
    crop = im.crop((int(0.30 * w), int(0.45 * h), int(0.80 * w), int(0.95 * h)))
    dest = SRC_DIR / "crest_target_from_07.png"
    crop.save(dest)
    return dest


async def _gen(kie: KieClient, input_urls: list[str], dest: Path) -> None:
    payload = {
        "prompt": _PROMPT,
        "input_urls": input_urls,
        "aspect_ratio": "1:1",
        "resolution": "1K",
    }
    try:
        task_id = await kie.create_task(MODEL, payload)
        urls, _meta = await kie.poll_task(task_id)
        await kie.download(urls[0], dest)
        print(f"  OK   {dest.name}")
    except Exception as exc:
        print(f"  FAIL {dest.name}: {exc}")


async def main() -> None:
    load_dotenv(ROOT / ".env")
    if not os.environ.get("KIE_AI_API_KEY"):
        raise SystemExit("KIE_AI_API_KEY not set")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    crest = _make_crest_target()
    kie = KieClient(os.environ["KIE_AI_API_KEY"], poll_timeout_s=600)
    print("Uploading crest target + source refs ...")
    crest_url = await kie.upload_file(crest)

    jobs = []
    for name, variants in TARGETS:
        src_url = await kie.upload_file(SRC_DIR / name)
        for v in range(1, variants + 1):
            dest = OUT_DIR / f"{Path(name).stem}_fix_v{v}.png"
            jobs.append(_gen(kie, [src_url, crest_url], dest))
    await asyncio.gather(*jobs)
    print(f"Done -> {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
