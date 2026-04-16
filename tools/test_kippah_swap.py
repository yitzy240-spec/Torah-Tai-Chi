"""Test swapping Rav Eli's brown leather kippah for a navy knitted kippah sruga
on ONE existing character ref. If it looks right we regenerate all 12.

Uses nano-banana-pro with the existing ref as image_input.
Cost: ~$0.05.
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

SOURCE_REF = ROOT / "references" / "01_front_neutral.png"
KIPPAH_REF = ROOT / "references" / "modern orthodox kippa size.jpeg"
OUT = ROOT / "references" / "_kippah_test" / "01_front_neutral_sruga.png"


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    for p in (SOURCE_REF, KIPPAH_REF):
        if not p.exists():
            raise SystemExit(f"Missing: {p}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    kie = KieClient(api_key=kie_key, poll_timeout_s=600)

    print(f"Uploading character ref: {SOURCE_REF.name}")
    src_url = await kie.upload_file(SOURCE_REF, remote_dir="torah-tai-chi/kippah-test")
    print(f"Uploading kippah ref: {KIPPAH_REF.name}")
    kippah_url = await kie.upload_file(KIPPAH_REF, remote_dir="torah-tai-chi/kippah-test")

    prompt = (
        "TWO REFERENCE IMAGES PROVIDED:\n"
        "- Image 1 is the CHARACTER REFERENCE: preserve his face, salt-and-"
        "pepper beard, navy mandarin-collar shirt with the Torah Tai Chi "
        "yin-yang logo on the chest, same pose, same composition, same "
        "lighting, same background. Everything about him stays IDENTICAL "
        "except for the kippah. CRITICALLY: KEEP HIS HAIR EXACTLY AS IT IS — "
        "same hairline, same natural comb-over/fringe flowing across the top "
        "and front of his head. Do NOT push his hair back to make room for "
        "the kippah.\n"
        "- Image 2 is the KIPPAH SIZE AND FIT REFERENCE: match the SIZE, "
        "SCALE-ON-HEAD, SHAPE, and POSITION of the kippah in image 2 exactly.\n\n"
        "KIPPAH POSITIONING RULES (critical for the result to look right):\n"
        "- The kippah sits on the BACK / BACK-TOP of the crown, NOT on the "
        "front of his head.\n"
        "- His FRONT HAIR (the natural comb-over / fringe at the front of "
        "his head) FLOWS OVER the front edge of the kippah — meaning from "
        "a FRONT-facing view of his face, the kippah is mostly HIDDEN by "
        "his hair. Only a small sliver of the kippah might peek out from "
        "behind the hair at the top of the head, if that.\n"
        "- From the FRONT, the viewer should see mostly his hair, with the "
        "kippah barely visible (behind and above the hairline, tucked in at "
        "the back).\n"
        "- From BACK/TOP angles, the full kippah pattern would be visible "
        "(as in image 2) — but image 1 is a front portrait, so the kippah "
        "should be MOSTLY CONCEALED by his hair in this output.\n"
        "- Think of the kippah like a small crocheted patch resting at the "
        "back of the crown, with his forward-combed hair draping over it. "
        "The hair owns the front and top of the head; the kippah lives "
        "behind the hair.\n\n"
        "STYLE: navy-blue crocheted yarn with a cream-colored geometric "
        "knitted pattern (concentric bands similar to image 2 but navy "
        "instead of black). No Star of David, no letters. Single-figure "
        "portrait, no split composition — just the front-facing character.\n\n"
        "Keep every other aspect of image 1 unchanged. Soft Pixar-style "
        "3D render, 4K, high detail."
    )

    payload = {
        "prompt": prompt,
        "image_input": [src_url, kippah_url],
        "output_format": "png",
        "image_size": "1:1",
    }
    print("Calling nano-banana-pro...")
    task_id = await kie.create_task("nano-banana-pro", payload)
    urls = await kie.poll_task(task_id)
    await kie.download(urls[0], OUT)
    print(f"\nDONE: {OUT}")


if __name__ == "__main__":
    asyncio.run(run())
