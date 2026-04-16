"""Regenerate all 11 other character angles using the NB2 kippah winner as canonical.

Flow:
- Canonical = the NB2 output from the 4-model A/B test (now copied to
  references/_canonical/rav_eli_canonical.png and references/01_front_neutral.png).
- For each of the 11 other angles in references/_backup_brown_kippah/, submit
  to nano-banana-2 with [canonical, target-angle-ref] as image_input.
  Prompt asks for the canonical character in the pose/framing of the
  target angle — i.e., canonical controls identity+kippah, backup controls pose.
- Outputs overwrite the current references/<name>.png files.

Cost: ~$0.05 × 11 = ~$0.55.

Models memory rule: nano-banana-2 is the NEWEST Google Flash image model
(Gemini 3.1 Flash) and won the 2026-04-16 A/B test for the kippah swap.
Use it here for consistency with the canonical.
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
CANONICAL_SRC = ROOT / "references" / "_canonical" / "kippah_model_test_nano_banana_2.png"
CANONICAL_DST = ROOT / "references" / "_canonical" / "rav_eli_canonical.png"
FRONT_NEUTRAL = ROOT / "references" / "01_front_neutral.png"


def _prompt() -> str:
    return (
        "TWO REFERENCE IMAGES:\n"
        "- Image 1 is the CANONICAL character reference. His face, hair, "
        "beard, navy kippah sruga (size, shape, position on the crown), "
        "and navy mandarin-collar shirt with Torah Tai Chi yin-yang logo "
        "must match image 1 EXACTLY. Do not resize or restyle the kippah. "
        "Do not change the face.\n"
        "- Image 2 shows the target pose, camera angle, framing, lighting, "
        "and background for this output. Copy the composition from image 2.\n\n"
        "Generate the canonical character from image 1 in the exact pose, "
        "camera angle, framing, lighting, and background of image 2. "
        "Single-figure output, no split composition. Soft Pixar-style 3D "
        "render, 4K, high detail."
    )


async def _regen_one(
    kie: KieClient, canonical_url: str, angle_url: str, target_path: Path,
) -> None:
    payload = {
        "prompt": _prompt(),
        "image_input": [canonical_url, angle_url],
        "aspect_ratio": "1:1",
        "resolution": "1K",
        "output_format": "png",
    }
    try:
        task_id = await kie.create_task("nano-banana-2", payload)
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], target_path)
        print(f"  OK   {target_path.name}")
    except Exception as e:
        print(f"  FAIL {target_path.name}: {e}")


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    if not CANONICAL_SRC.exists():
        raise SystemExit(f"Missing canonical source: {CANONICAL_SRC}")

    # Lock the canonical and seed the front_neutral ref
    shutil.copy(CANONICAL_SRC, CANONICAL_DST)
    shutil.copy(CANONICAL_SRC, FRONT_NEUTRAL)
    print(f"Canonical locked: {CANONICAL_DST.name}")
    print(f"Front neutral seeded: {FRONT_NEUTRAL.name}")

    # The 11 OTHER angles to regenerate (exclude 01 — already seeded)
    targets = sorted(
        p for p in BACKUP_DIR.glob("*.png") if p.name != "01_front_neutral.png"
    )
    if not targets:
        raise SystemExit(f"No backup angles in {BACKUP_DIR}")

    kie = KieClient(api_key=kie_key, poll_timeout_s=600)
    print(f"\nUploading canonical: {CANONICAL_DST.name}")
    canonical_url = await kie.upload_file(
        CANONICAL_DST, remote_dir="torah-tai-chi/angle-regen"
    )

    print(f"Uploading {len(targets)} angle refs sequentially (Kie upload "
          f"service 503s on parallel uploads)...")
    angle_urls: list[tuple[str, Path]] = []
    for p in targets:
        u = await kie.upload_file(p, remote_dir="torah-tai-chi/angle-regen")
        angle_urls.append((u, p))
        print(f"  uploaded {p.name}")

    print(f"\nRegenerating {len(targets)} angles in parallel via nano-banana-2...")
    await asyncio.gather(*(
        _regen_one(kie, canonical_url, u, REFS_DIR / p.name)
        for u, p in angle_urls
    ))
    print(f"\nDONE. Outputs in {REFS_DIR}/")


if __name__ == "__main__":
    asyncio.run(run())
