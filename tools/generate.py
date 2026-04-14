"""Torah Tai Chi video generator CLI.

Usage:
  py tools/generate.py --parsha Vayikra
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.parsha_data import get_parsha_script
from src.script_generator import transform_draft_to_clip_plan
from src.video_generator import generate_clip
from src.stitcher import concat_clips
from src.kie_client import KieClient

REFS_DIR = ROOT / "references"
PARSHIOT_PATH = ROOT / "parshiot.json"


async def upload_references(kie: KieClient) -> list[str]:
    """Upload all canonical reference images, return their Kie hosted URLs."""
    urls = []
    for img in sorted(REFS_DIR.glob("*.png")):
        print(f"  uploading ref: {img.name}")
        url = await kie.upload_file(img, remote_dir="torah-tai-chi/refs")
        urls.append(url)
    if not urls:
        raise SystemExit(f"No reference images in {REFS_DIR}")
    return urls[:9]  # Seedance hard limit


async def run(parsha_name: str, option: str, resolution: str) -> Path:
    from anthropic import AsyncAnthropic
    import json as _json

    load_dotenv(ROOT / ".env")
    anthropic_key = os.environ["ANTHROPIC_API_KEY"]
    kie_key = os.environ["KIE_AI_API_KEY"]

    run_slug = f"{time.strftime('%Y-%m-%d')}-{parsha_name.lower()}-{option.lower()}"
    work_dir = ROOT / "work" / run_slug
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Loading parsha: {parsha_name} (option {option})")
    # Look up parsha metadata (book) + selected script
    parshiot = _json.loads(PARSHIOT_PATH.read_text(encoding="utf-8"))["parshiot"]
    match = next((p for p in parshiot if p["name"].lower() == parsha_name.lower()), None)
    if not match:
        raise SystemExit(f"Parsha not found: {parsha_name}")
    book = match["book"]
    script = get_parsha_script(parsha_name, option, PARSHIOT_PATH)

    print(f"[2/5] Transforming draft into ClipPlan via Claude")
    anthropic = AsyncAnthropic(api_key=anthropic_key)
    plan = await transform_draft_to_clip_plan(
        parsha_name=parsha_name, book=book, option=option,
        style_note=script["style_note"], title=script["title"],
        draft=script["draft"], client=anthropic,
    )
    (work_dir / "plan.json").write_text(plan.model_dump_json(indent=2))
    print(f"      {len(plan.clips)} clips, total {plan.total_duration_s}s")

    print(f"[3/5] Uploading reference images to Kie.ai")
    kie = KieClient(api_key=kie_key)
    ref_urls = await upload_references(kie)
    print(f"      {len(ref_urls)} refs uploaded")

    print(f"[4/5] Generating {len(plan.clips)} clips via Seedance 2.0")
    clip_paths = []
    for clip in plan.clips:
        dest = work_dir / f"clip_{clip.index:02d}.mp4"
        print(f"      clip {clip.index}: {clip.duration_s}s — {clip.voiceover[:50]}...")
        await generate_clip(kie, clip, ref_urls, dest, resolution=resolution)
        clip_paths.append(dest)

    print(f"[5/5] Stitching clips")
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}.mp4"
    concat_clips(clip_paths, final)
    print(f"\nDONE: {final}")
    return final


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsha", required=True)
    ap.add_argument("--option", default="A", choices=["A", "B", "C"],
                    help="Which of Yonah's 3 script options to use")
    ap.add_argument("--resolution", default="720P", choices=["480P", "720P"])
    args = ap.parse_args()
    asyncio.run(run(args.parsha, args.option, args.resolution))
    return 0


if __name__ == "__main__":
    sys.exit(main())
