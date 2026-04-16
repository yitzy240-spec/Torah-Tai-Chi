"""Generate N variants of a canonical kippah-sruga reference image in parallel.

Uses multiple ORIGINAL brown-kippah character refs as identity anchors (to
prevent face drift) plus the kippah size/style reference. Submits N Seedance
tasks in parallel so we get N variants at once to compare.

Cost: ~$0.05 per variant. Default N=4 → ~$0.20 per iteration round.

Usage:
  py tools/iterate_canonical_kippah.py [--variants N] [--extra "extra instruction"]

Outputs:
  references/_canonical/rav_eli_sruga-<iter>-var-<v>.png
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient

KIPPAH_REF = ROOT / "references" / "modern orthodox kippa size.jpeg"
CANONICAL_DIR = ROOT / "references" / "_canonical"
BACKUP_DIR = ROOT / "references" / "_backup_brown_kippah"

# Multiple ORIGINAL brown-kippah refs as identity anchors (prevents face drift).
ANCHOR_SOURCES = [
    BACKUP_DIR / "01_front_neutral.png",
    BACKUP_DIR / "10_closeup_thoughtful.png",
    BACKUP_DIR / "03_threequarter_right_speaking.png",
]


def _prompt(extra: str) -> str:
    base = (
        "FOUR REFERENCE IMAGES PROVIDED:\n"
        "- Images 1, 2, 3 are CANONICAL RAV ELI reference shots — three "
        "different angles of the SAME character. His face must match these "
        "exactly in your output: same eye shape, same eye color, same "
        "nose, same mouth, same eyebrow thickness, same beard (salt-and-"
        "pepper, same shape and density), same hairline, same hair color. "
        "He is the SAME man in all three. Do NOT make him younger, thinner-"
        "browed, more cartoony, or differently proportioned.\n"
        "- Image 4 is the KIPPAH SIZE AND STYLE reference — the small dati "
        "leumi kippah sruga target.\n\n"
        "GOAL: Generate a SINGLE clean front portrait of Rav Eli — chest "
        "up, 1:1 aspect ratio, neutral studio background (matching image "
        "1's background). NOT a split panel, NOT multiple views, NOT a "
        "back-of-head detail shot attached. Just one clean front portrait.\n\n"
        "KIPPAH: Replace his brown leather kippah with a small navy-blue "
        "crocheted kippah sruga. The new kippah must be APPROXIMATELY 30% "
        "SMALLER than the brown leather kippah visible in images 1-3. "
        "Sits on the back-top of the crown. Navy yarn with a cream-colored "
        "geometric band pattern around the edge (like image 4). NO Star "
        "of David on the kippah, NO letters, NO emblems — just the knit "
        "pattern.\n\n"
        "CRITICAL: his face must match images 1-3 exactly. Same shirt "
        "(navy mandarin-collar with Torah Tai Chi yin-yang logo on chest), "
        "same pose as image 1 (front-facing, chest up).\n\n"
        "Soft Pixar-style 3D render, 4K, high detail.\n\n"
    )
    if extra:
        base += f"ADDITIONAL INSTRUCTION: {extra}\n\n"
    base += "Output: one clean front portrait, single panel, no split composition."
    return base


async def _generate_variant(
    kie: KieClient, image_urls: list[str], prompt: str, out_path: Path,
) -> None:
    payload = {
        "prompt": prompt,
        "image_input": image_urls,
        "output_format": "png",
        "image_size": "1:1",
    }
    task_id = await kie.create_task("nano-banana-pro", payload)
    urls = await kie.poll_task(task_id)
    await kie.download(urls[0], out_path)
    print(f"  saved {out_path.name}")


async def run(variants: int, extra: str) -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    for p in ANCHOR_SOURCES + [KIPPAH_REF]:
        if not p.exists():
            raise SystemExit(f"Missing: {p}")

    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)

    # Next iteration round number (group of variants)
    existing = sorted(CANONICAL_DIR.glob("rav_eli_sruga-*-var-*.png"))
    if existing:
        last_iter = max(
            int(p.name.split("-")[2]) for p in existing if p.name.count("-") >= 3
        )
        iter_num = last_iter + 1
    else:
        iter_num = 1

    kie = KieClient(api_key=kie_key, poll_timeout_s=600)

    print(f"Uploading {len(ANCHOR_SOURCES)} anchor refs + kippah ref...")
    anchor_urls: list[str] = []
    for p in ANCHOR_SOURCES:
        u = await kie.upload_file(p, remote_dir="torah-tai-chi/canonical")
        anchor_urls.append(u)
        print(f"  uploaded {p.name}")
    kippah_url = await kie.upload_file(KIPPAH_REF, remote_dir="torah-tai-chi/canonical")
    print(f"  uploaded {KIPPAH_REF.name}")

    all_urls = anchor_urls + [kippah_url]
    prompt = _prompt(extra)

    print(f"\nLaunching {variants} variants in parallel (iter {iter_num})...")
    tasks = []
    for v in range(1, variants + 1):
        out_path = CANONICAL_DIR / f"rav_eli_sruga-{iter_num:02d}-var-{v:02d}.png"
        tasks.append(_generate_variant(kie, all_urls, prompt, out_path))
    await asyncio.gather(*tasks)
    print(f"\nDONE. {variants} variants in {CANONICAL_DIR}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", type=int, default=4,
                    help="Number of parallel variants to generate (default: 4)")
    ap.add_argument("--extra", default="",
                    help="Extra instruction appended to the prompt")
    args = ap.parse_args()
    asyncio.run(run(args.variants, args.extra))
    return 0


if __name__ == "__main__":
    sys.exit(main())
