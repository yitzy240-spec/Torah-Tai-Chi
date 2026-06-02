"""Single-clip test: does Seedance respect the "written beat" pattern
for inserting natural pauses between sentences?

Background:
  Yonah's stitched videos read as rushed because Seedance's TTS gives
  no breathing room between sentences. Yonah's "..." experiment in
  Scene direction made the character go silent without holding the
  mouth closed (lip-sync broke). Per UGC Copilot's audio guide
  (https://ugccopilot.ai/blog/seedance-2-native-audio-generation-guide/),
  the documented working pattern is a THIRD-PERSON STAGE DIRECTION
  written between dialogue lines — Seedance recognizes it as a
  director note and re-syncs after.

This script renders a single ~10s 480p clip using our production prompt
format (so the test is honest), with two sentences separated by a
written beat. We then listen for:
  1. An audible pause between the two sentences (success criterion).
  2. Rav Eli's mouth closed and body still during the pause (lip-sync
     intact — the failure mode Yonah hit with "...").
  3. Character does NOT literally speak the stage direction text.

If all three pass, we can wire the pattern into the production
pipeline. If any fails, we know the technique doesn't work and we
look elsewhere.

Cost: ~$0.50 per 480p 10s render.

Usage:
    python -m tools.test_seedance_cadence
"""
from __future__ import annotations
import asyncio
import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from src.kie_client import KieClient

load_dotenv()


REPO_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = REPO_ROOT / "work" / "seedance_cadence_test"

# Same canonical character refs the production pipeline locks identity
# against. Subset matched to MAX_REFS = 9 in video_generator.py.
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


async def upload_with_mime(client: KieClient, path: Path, mime: str) -> str:
    """Mirror tools/test_seedance_ref.py:upload_with_mime — uses
    client._headers() so we get any auth params KieClient sets, not just
    bare Bearer."""
    import base64
    import httpx
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    payload = {
        "base64Data": f"data:{mime};base64,{b64}",
        "uploadPath": "torah-tai-chi",
        "fileName": path.name,
    }
    async with httpx.AsyncClient(timeout=180) as http:
        resp = await http.post(
            "https://kieai.redpandaai.co/api/file-base64-upload",
            headers=client._headers(),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"upload failed for {path.name}: {data}")
        return data["data"]["downloadUrl"]


def build_test_prompt() -> str:
    """Production-format prompt with a written beat between two sentences.

    Format mirrors src/video_generator.py:build_seedance_input — same
    visual_prompt block, same `Character speaks: "..."` framing, same
    STYLE_LOCK. The ONLY new thing is the written-beat line between
    two Character-speaks blocks. If Seedance reads it as a director
    note (per the source), it'll hold Rav Eli's pose, breathe, and
    resume speech in sentence two. If it reads it as speech, the
    character will literally say "Rav Eli holds…" — and we'll know.
    """
    from src.settings import STYLE_LOCK

    visual_prompt = (
        "Rav Eli stands in a sunlit Beit Midrash with worn wooden bookshelves "
        "behind him, holding a relaxed teaching stance. Soft afternoon light "
        "from a high window."
    )
    sentence_one = "When Yaakov wrestled the angel, he did not run."
    beat = "Rav Eli holds the moment, breathes calmly, then continues:"
    sentence_two = "He stayed in contact, all night, until dawn broke."
    emotive_clause = (
        "Delivery: measured teaching pace, warm and grounded — not a flat "
        "reading voice.\n"
    )
    return (
        f"{visual_prompt}\n\n"
        f'Character speaks: "{sentence_one}"\n'
        f"{beat}\n"
        f'Character speaks: "{sentence_two}"\n'
        f"{emotive_clause}"
        f"{STYLE_LOCK}\n"
    )


async def run_test() -> Path:
    api_key = os.environ.get("KIE_AI_API_KEY")
    if not api_key:
        print("ERROR: KIE_AI_API_KEY missing in environment.", file=sys.stderr)
        sys.exit(1)
    client = KieClient(api_key=api_key)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    prompt = build_test_prompt()
    print("PROMPT PREVIEW:")
    print("-" * 60)
    print(prompt)
    print("-" * 60)
    print()

    print(f"Uploading {len(CHARACTER_REFS)} character refs...")
    upload_tasks = [
        upload_with_mime(client, p, "image/png")
        for p in CHARACTER_REFS if p.exists()
    ]
    char_urls = await asyncio.gather(*upload_tasks)
    print(f"  -> {len(char_urls)} uploaded")

    payload = {
        "prompt": prompt,
        "reference_image_urls": char_urls,
        "duration": 10,
        "resolution": "480p",
        "aspect_ratio": "9:16",
        "web_search": False,
    }

    print()
    print("Creating Seedance task (480p, 10s, no motion ref)...")
    task_id = await client.create_task("bytedance/seedance-2", payload)
    print(f"  task_id: {task_id}")
    print("Polling for completion (typically 2-5 minutes)...")
    urls, _meta = await client.poll_task(task_id)
    print(f"  result urls: {urls}")

    out = OUTPUT_DIR / "cadence_written_beat.mp4"
    print(f"Downloading to {out}...")
    await client.download(urls[0], out)
    size_kb = out.stat().st_size / 1024
    print(f"  wrote {out}  ({size_kb:.0f} KB)")
    print()
    print("=" * 60)
    print("LISTEN FOR:")
    print("  1. Audible PAUSE between the two sentences.")
    print("  2. Mouth CLOSED during the pause (not still mouthing words).")
    print("  3. Character does NOT speak the stage direction text")
    print("     (i.e. you should NOT hear 'Rav Eli holds the moment').")
    print("=" * 60)
    return out


def main() -> int:
    try:
        asyncio.run(run_test())
        return 0
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
