"""A/B compare Seedance 2.0 Standard vs Seedance 2.0 Fast on the same parsha.

Runs Bereishit A-tight through both models. Shared:
  - Character + dojo ref uploads (once)
  - Claude ClipPlan (once)
Differs:
  - Seedance model tier
  - Output directory

Produces two stitched mp4s side by side for a true 1:1 quality comparison.

Cost estimate:
  - Standard: 48s x $0.205/s = ~$9.84
  - Fast:     48s x $0.165/s = ~$7.92
  - Total with Claude + uploads: ~$18

Usage:
  py tools/test_seedance_fast.py
"""
from __future__ import annotations
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
DOJO_REFS_DIR = ROOT / "references" / "dojo"
PARSHIOT_PATH = ROOT / "parshiot.json"

PARSHA = "Bereishit"
OPTION = "A-tight"
RESOLUTION = "720p"

MODELS = {
    "standard": "bytedance/seedance-2",
    "fast":     "bytedance/seedance-2-fast",
}

OUT_ROOT = ROOT / "work" / "seedance_fast_test"


async def _upload_refs(kie: KieClient) -> tuple[list[str], list[str]]:
    """Upload character and dojo refs once, reuse for both model runs."""
    char_urls: list[str] = []
    for img in sorted(REFS_DIR.glob("*.png")):
        url = await kie.upload_file(img, remote_dir="torah-tai-chi/fasttest/char")
        char_urls.append(url)
        print(f"    uploaded char {img.name}")

    dojo_urls: list[str] = []
    for img in sorted(DOJO_REFS_DIR.glob("*.png")):
        url = await kie.upload_file(img, remote_dir="torah-tai-chi/fasttest/dojo")
        dojo_urls.append(url)
        print(f"    uploaded dojo {img.name}")

    return char_urls, dojo_urls


async def _run_for_model(
    label: str, model: str, plan, kie: KieClient,
    char_urls: list[str], dojo_urls: list[str],
) -> dict:
    print(f"\n=== {label.upper()} — {model} ===")
    work_dir = OUT_ROOT / label
    work_dir.mkdir(parents=True, exist_ok=True)

    clip_paths: list[Path] = []
    t0 = time.monotonic()
    for clip in plan.clips:
        dest = work_dir / f"clip_{clip.index:02d}.mp4"
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  clip {clip.index}: SKIP (cached)")
            clip_paths.append(dest)
            continue

        print(f"  clip {clip.index}: {clip.duration_s}s [{clip.setting_id}] "
              f"'{clip.voiceover[:48]}...'")
        await generate_clip(
            kie, clip,
            character_ref_urls=char_urls,
            dojo_ref_urls=dojo_urls,
            dest=dest,
            resolution=RESOLUTION,
            model=model,
        )
        clip_paths.append(dest)

    gen_s = time.monotonic() - t0

    print(f"  stitching {len(clip_paths)} clips")
    stitched = work_dir / f"bereishit-{label}.mp4"
    concat_clips(clip_paths, stitched)

    total_s = sum(c.duration_s for c in plan.clips)
    price_per_s = 0.205 if label == "standard" else 0.165
    est_cost = round(total_s * price_per_s, 2)

    return {
        "label": label,
        "model": model,
        "output": str(stitched),
        "clips": len(clip_paths),
        "total_duration_s": total_s,
        "wall_time_s": round(gen_s),
        "est_cost_usd": est_cost,
    }


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    anthropic_key = os.environ["ANTHROPIC_API_KEY"]

    # Load script
    data = json.loads(PARSHIOT_PATH.read_text(encoding="utf-8"))
    script = get_parsha_script(PARSHA, OPTION, PARSHIOT_PATH)
    parsha_entry = next(p for p in data["parshiot"] if p["name"] == PARSHA)
    book = parsha_entry["book"]
    print(f"Parsha: {PARSHA} ({book}), option {OPTION}")
    print(f"Script: {len(script['draft'].split())} words")

    OUT_ROOT.mkdir(parents=True, exist_ok=True)

    # Generate clip plan ONCE (shared across both runs)
    plan_path = OUT_ROOT / "clip_plan.json"
    if plan_path.exists():
        from src.models import ClipPlan
        plan = ClipPlan.model_validate_json(plan_path.read_text(encoding="utf-8"))
        print(f"Loaded cached ClipPlan: {len(plan.clips)} clips, {plan.total_duration_s}s")
    else:
        print("Generating ClipPlan via Claude...")
        plan = await transform_draft_to_clip_plan(
            parsha_name=PARSHA, book=book, option=OPTION,
            style_note=script.get("style_note", ""), title=script["title"],
            draft=script["draft"], api_key=anthropic_key,
        )
        plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        print(f"ClipPlan: {len(plan.clips)} clips, {plan.total_duration_s}s total")

    # Upload refs ONCE
    kie = KieClient(api_key=kie_key, poll_timeout_s=1800)
    refs_marker = OUT_ROOT / "refs_uploaded.json"
    if refs_marker.exists():
        urls = json.loads(refs_marker.read_text(encoding="utf-8"))
        char_urls, dojo_urls = urls["char"], urls["dojo"]
        print(f"Cached refs: {len(char_urls)} char, {len(dojo_urls)} dojo")
    else:
        print("Uploading references...")
        char_urls, dojo_urls = await _upload_refs(kie)
        refs_marker.write_text(json.dumps({"char": char_urls, "dojo": dojo_urls}),
                               encoding="utf-8")

    # Run both models
    results = []
    for label, model in MODELS.items():
        try:
            r = await _run_for_model(label, model, plan, kie, char_urls, dojo_urls)
            results.append(r)
        except Exception as e:
            results.append({"label": label, "model": model, "error": str(e)})

    # Report
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    for r in results:
        if "error" in r:
            print(f"\n{r['label']:10s} FAILED: {r['error']}")
        else:
            print(f"\n{r['label']:10s} ({r['model']})")
            print(f"  output:    {r['output']}")
            print(f"  clips:     {r['clips']} totaling {r['total_duration_s']}s")
            print(f"  wall time: {r['wall_time_s']}s")
            print(f"  est cost:  ${r['est_cost_usd']}")

    (OUT_ROOT / "results.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8",
    )
    print(f"\nResults saved to {OUT_ROOT}/results.json")


if __name__ == "__main__":
    asyncio.run(run())
