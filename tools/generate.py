"""Torah Tai Chi video generator CLI (v2: block orchestration + frame chaining).

Usage:
  py tools/generate.py --parsha Vayikra
"""
from __future__ import annotations
import argparse
import asyncio
import json as _json
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
from src.frame_extract import extract_last_frame
from src.models import ClipPlan

REFS_DIR = ROOT / "references"
DOJO_REFS_DIR = ROOT / "references" / "dojo"
PARSHIOT_PATH = ROOT / "parshiot.json"


async def _upload_dir_pngs(kie: KieClient, dir_path: Path,
                           remote_dir: str, label: str) -> list[str]:
    urls: list[str] = []
    for img in sorted(dir_path.glob("*.png")):
        print(f"  uploading {label}: {img.name}")
        url = await kie.upload_file(img, remote_dir=remote_dir)
        urls.append(url)
    return urls


async def upload_character_references(kie: KieClient) -> list[str]:
    # REFS_DIR.glob("*.png") only matches top-level PNGs; references/dojo/*.png
    # is handled separately by upload_dojo_references.
    urls = await _upload_dir_pngs(
        kie, REFS_DIR, "torah-tai-chi/refs", "char ref",
    )
    if not urls:
        raise SystemExit(f"No character reference PNGs in {REFS_DIR}")
    return urls


async def upload_dojo_references(kie: KieClient) -> list[str]:
    if not DOJO_REFS_DIR.exists():
        return []
    return await _upload_dir_pngs(
        kie, DOJO_REFS_DIR, "torah-tai-chi/refs/dojo", "dojo ref",
    )


def _is_first_in_block(idx: int) -> bool:
    """Block boundaries: clips 0 and 2 are first-in-block; 1 and 3 are chained."""
    return idx % 2 == 0


async def _ensure_first_frame_url(
    kie: KieClient, work_dir: Path, prev_clip_path: Path,
) -> str:
    """Extract last frame of prev_clip_path, upload, return URL.

    Cached on disk: <prev_clip>.lastframe.png and <prev_clip>.lastframe.url.
    """
    png_path = prev_clip_path.with_suffix(".lastframe.png")
    url_path = prev_clip_path.with_suffix(".lastframe.url")
    if url_path.exists():
        cached = url_path.read_text(encoding="utf-8").strip()
        if cached:
            return cached
    if not png_path.exists() or png_path.stat().st_size == 0:
        extract_last_frame(prev_clip_path, png_path)
    url = await kie.upload_file(png_path, remote_dir="torah-tai-chi/lastframes")
    url_path.write_text(url, encoding="utf-8")
    return url


async def run(parsha_name: str, option: str, resolution: str) -> Path:
    from anthropic import AsyncAnthropic

    load_dotenv(ROOT / ".env")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        raise SystemExit("ERROR: ANTHROPIC_API_KEY not set (add to .env)")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    run_slug = f"{time.strftime('%Y-%m-%d')}-{parsha_name.lower()}-{option.lower()}-v2"
    work_dir = ROOT / "work" / run_slug
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = ROOT / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/5] Loading parsha: {parsha_name} (option {option})")
    parshiot = _json.loads(PARSHIOT_PATH.read_text(encoding="utf-8"))["parshiot"]
    match = next((p for p in parshiot if p["name"].lower() == parsha_name.lower()), None)
    if not match:
        raise SystemExit(f"Parsha not found: {parsha_name}")
    book = match["book"]
    script = get_parsha_script(parsha_name, option, PARSHIOT_PATH)

    plan_path = work_dir / "plan.json"
    if plan_path.exists():
        print(f"[2/5] Reusing cached ClipPlan at {plan_path}")
        plan = ClipPlan.model_validate_json(plan_path.read_text(encoding="utf-8"))
    else:
        print(f"[2/5] Transforming draft into ClipPlan via Claude")
        anthropic = AsyncAnthropic(api_key=anthropic_key)
        plan = await transform_draft_to_clip_plan(
            parsha_name=parsha_name, book=book, option=option,
            style_note=script["style_note"], title=script["title"],
            draft=script["draft"], client=anthropic,
        )
        plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
    print(f"      {len(plan.clips)} clips, total {plan.total_duration_s}s, "
          f"outdoor archetype: {plan.outdoor_archetype_id}")

    print(f"[3/5] Uploading reference images to Kie.ai")
    kie = KieClient(api_key=kie_key)
    char_refs = await upload_character_references(kie)
    dojo_refs = await upload_dojo_references(kie)
    print(f"      {len(char_refs)} char refs, {len(dojo_refs)} dojo refs uploaded")

    print(f"[4/5] Generating {len(plan.clips)} clips via Seedance 2.0")
    clip_paths: list[Path] = []
    for clip in plan.clips:
        dest = work_dir / f"clip_{clip.index:02d}.mp4"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"      clip {clip.index}: SKIP (already generated)")
            clip_paths.append(dest)
            continue

        first_frame_url = None
        if not _is_first_in_block(clip.index):
            prev = work_dir / f"clip_{(clip.index - 1):02d}.mp4"
            if not prev.exists():
                raise SystemExit(
                    f"Cannot chain clip {clip.index}: previous clip {prev} missing. "
                    "Generate clips in order."
                )
            print(f"      clip {clip.index}: chaining from clip {clip.index - 1} last frame")
            first_frame_url = await _ensure_first_frame_url(kie, work_dir, prev)

        print(f"      clip {clip.index}: {clip.duration_s}s [{clip.setting_id}] — "
              f"{clip.voiceover[:50]}...")
        try:
            await generate_clip(
                kie, clip,
                character_ref_urls=char_refs,
                dojo_ref_urls=dojo_refs,
                dest=dest,
                first_frame_url=first_frame_url,
                resolution=resolution,
            )
        except Exception as e:
            if first_frame_url is None:
                raise
            # Spec §10: if a chained clip fails, fall back to a clean cut
            # (omit first_frame_url) and retry once before giving up.
            print(f"      clip {clip.index}: chained generation failed ({e}); "
                  "retrying without first_frame_url (clean cut fallback)")
            await generate_clip(
                kie, clip,
                character_ref_urls=char_refs,
                dojo_ref_urls=dojo_refs,
                dest=dest,
                first_frame_url=None,
                resolution=resolution,
            )
        clip_paths.append(dest)

    print(f"[5/5] Stitching clips")
    final = out_dir / f"{parsha_name.lower()}-{option.lower()}-v2.mp4"
    concat_clips(clip_paths, final)
    print(f"\nDONE: {final}")
    return final


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parsha", required=True)
    ap.add_argument("--option", default="A", choices=["A", "B", "C"],
                    help="Which of Yonah's 3 script options to use")
    ap.add_argument("--resolution", default="720p", choices=["480p", "720p"])
    args = ap.parse_args()
    asyncio.run(run(args.parsha, args.option, args.resolution))
    return 0


if __name__ == "__main__":
    sys.exit(main())
