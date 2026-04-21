"""Standalone test: generate a Rav Eli tai chi clip using a reference video.

Validates the Seedance 2.0 `reference_video_urls` input path end-to-end by:
  1. Uploading 2 character reference images + 1 tai chi motion reference video.
  2. Calling Seedance with prompt + reference_image_urls + reference_video_urls.
  3. Downloading the generated clip to work/.

Usage:
    python -m tools.test_seedance_ref --slug white_crane_spreads_wings

Does NOT touch the production src/video_generator.py pipeline. This is a
throwaway-style validation harness so we can iterate quickly without
risking regressions in the main Torah Tai Chi clip-generation flow.
"""
from __future__ import annotations
import argparse
import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

from src.kie_client import KieClient

load_dotenv()


# Dedicated style lock for silent tai chi demos — intentionally excludes the
# voice/speech-cadence language from src/settings.py STYLE_LOCK, which is
# tuned for parsha videos where Rav Eli speaks. Without this override,
# Seedance generates a voice track while leaving the mouth closed, producing
# an uncanny "speaking without moving lips" artifact.
TAI_CHI_STYLE_LOCK = (
    "Same character as in the reference images: Pixar-style 3D animation, "
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, wearing a "
    "navy blue knitted kippah sruga with a subtle cream-colored decorative "
    "band around the outer rim, navy blue mandarin-collar athletic shirt "
    "with Torah Tai Chi yin-yang logo on chest. Soft 3D render, warm "
    "cinematic lighting. Character identity must match references exactly.\n\n"
    "SILENT CLIP -- no dialogue, no voiceover, no ambient speech. Rav Eli "
    "does not speak. Mouth stays closed and relaxed throughout, facial "
    "expression calm and focused, eyes softly open. Only soft ambient dojo "
    "sound (floor creaks, faint breath). This is a pure physical motion "
    "demonstration, not a teaching moment."
)


REPO_ROOT = Path(__file__).parent.parent
LIBRARY_ROOT = REPO_ROOT / "references" / "tai_chi_moves"

# Character reference images — 9 refs matching the live pipeline's MAX_REFS
# budget. Covers front/profile/back angles so the kippah sruga is locked
# from every direction, plus multiple full-body stances for motion grounding.
CHARACTER_REFS = [
    REPO_ROOT / "references" / "_canonical" / "rav_eli_canonical.png",
    REPO_ROOT / "references" / "01_front_neutral.png",
    REPO_ROOT / "references" / "05_profile_right.png",
    REPO_ROOT / "references" / "13_overshoulder_back.png",
    REPO_ROOT / "references" / "06_fullbody_ready_stance.png",
    REPO_ROOT / "references" / "07_fullbody_yinyang_pose.png",
    REPO_ROOT / "references" / "08_fullbody_flowing_pose.png",
    REPO_ROOT / "references" / "11_walking_forward.png",
    REPO_ROOT / "references" / "12_meditation_pose.png",
]

UPLOAD_ENDPOINT = "https://kieai.redpandaai.co/api/file-base64-upload"


async def upload_with_mime(client: KieClient, path: Path, mime: str,
                           remote_dir: str = "torah-tai-chi") -> str:
    """Upload a local file with an explicit MIME type. Returns downloadUrl.

    The existing KieClient.upload_file defaults non-PNG files to
    application/octet-stream which Seedance may not interpret as video.
    This helper sends the correct MIME for videos / JPEGs / etc.
    """
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    payload = {
        "base64Data": f"data:{mime};base64,{b64}",
        "uploadPath": remote_dir,
        "fileName": path.name,
    }
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.post(UPLOAD_ENDPOINT, headers=client._headers(), json=payload)
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise RuntimeError(f"upload failed for {path.name}: {data}")
        return data["data"]["downloadUrl"]


def load_sidecar(library_root: Path, slug: str) -> dict:
    sidecar = library_root / f"{slug}.json"
    if not sidecar.exists():
        raise FileNotFoundError(f"No sidecar JSON for {slug}; has --describe run?")
    return json.loads(sidecar.read_text(encoding="utf-8"))


def build_prompt(sidecar: dict) -> str:
    english = sidecar["english"]
    pinyin = sidecar.get("pinyin", "")
    visual = sidecar["visual"]
    motion = sidecar["motion_description"]

    return (
        f"Rav Eli performs the tai chi move {english} ({pinyin}) in a quiet "
        f"dojo with warm morning light. The posture: {visual} The motion: "
        f"{motion} Slow, deliberate, meditative pace. Upright spine, relaxed "
        f"shoulders.\n\n"
        f"Use the reference video to mirror the tempo, trajectory, and "
        f"stance of the core motion precisely, adapted to Rav Eli's body. "
        f"IMPORTANT: the reference video may cut before the move fully "
        f"resolves. Continue the motion past that cutoff and complete the "
        f"move -- bring the body back to a centered, balanced stance with "
        f"weight evenly distributed and arms settling to a natural resting "
        f"position. Over the full 10 seconds the clip should show the move "
        f"begin, complete its core motion, and settle cleanly. No freeze "
        f"mid-motion at the end.\n\n"
        f"{TAI_CHI_STYLE_LOCK}\n\n"
        f"Composition: 9:16 vertical, full body framed head to foot with a "
        f"touch of headroom."
    )


async def run_test(slug: str, resolution: str = "480p",
                   duration: int = 10,
                   output_dir: Optional[Path] = None) -> Path:
    api_key = os.environ["KIE_AI_API_KEY"]
    client = KieClient(api_key=api_key)

    output_dir = output_dir or (REPO_ROOT / "work" / "seedance_ref_tests")
    output_dir.mkdir(parents=True, exist_ok=True)

    ref_clip = LIBRARY_ROOT / f"{slug}.mp4"
    if not ref_clip.exists():
        raise FileNotFoundError(f"Reference clip not on disk: {ref_clip}")

    sidecar = load_sidecar(LIBRARY_ROOT, slug)
    prompt = build_prompt(sidecar)

    print(f"Slug: {slug}")
    print(f"Reference clip: {ref_clip}  ({ref_clip.stat().st_size / 1024:.0f} KB)")
    print(f"Prompt preview:  {prompt[:200]}...")
    print()

    print("Uploading character reference images...")
    char_upload_tasks = [
        upload_with_mime(client, p, "image/png")
        for p in CHARACTER_REFS if p.exists()
    ]
    char_urls = await asyncio.gather(*char_upload_tasks)
    for p, url in zip(CHARACTER_REFS, char_urls):
        print(f"  {p.name:40s} -> {url}")

    print(f"Uploading reference video ({ref_clip.name})...")
    video_url = await upload_with_mime(client, ref_clip, "video/mp4")
    print(f"  {ref_clip.name:40s} -> {video_url}")

    payload = {
        "prompt": prompt,
        "reference_image_urls": char_urls,
        "reference_video_urls": [video_url],
        "duration": duration,
        "resolution": resolution,
        "aspect_ratio": "9:16",
        "web_search": False,
    }

    print()
    print(f"Creating Seedance task (duration={duration}s, resolution={resolution})...")
    task_id = await client.create_task("bytedance/seedance-2", payload)
    print(f"  task_id: {task_id}")
    print("Polling for completion (this typically takes 2-5 minutes)...")
    urls = await client.poll_task(task_id)
    print(f"  result urls: {urls}")

    out = output_dir / f"ref_test_{slug}.mp4"
    print(f"Downloading to {out}...")
    await client.download(urls[0], out)
    size_kb = out.stat().st_size / 1024
    print(f"  wrote {out}  ({size_kb:.0f} KB)")
    print()
    print("Done. Watch the output and compare against the reference clip at:")
    print(f"  {ref_clip}")
    return out


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="test_seedance_ref",
        description="Generate a Rav Eli tai chi clip using a reference video. "
                    "Standalone validation — does not touch production pipeline.",
    )
    p.add_argument("--slug", required=True,
                   help="Move slug (must have a .mp4 and .json sidecar in the library).")
    p.add_argument("--resolution", default="480p",
                   choices=["480p", "720p", "1080p"],
                   help="Seedance output resolution (default 480p for speed/cost).")
    p.add_argument("--duration", type=int, default=10,
                   help="Output clip duration in seconds (default 10).")
    p.add_argument("--output-dir", type=Path,
                   help="Where to write the output clip (default: work/seedance_ref_tests/).")
    return p.parse_args(argv)


def main(args: argparse.Namespace) -> int:
    try:
        out = asyncio.run(run_test(
            slug=args.slug,
            resolution=args.resolution,
            duration=args.duration,
            output_dir=args.output_dir,
        ))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as e:
        print(f"\nFailed: {e}", file=sys.stderr)
        return 1
    print(f"\nOutput: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(parse_args(sys.argv[1:])))
