"""Generate a 360° architectural walkthrough of the Torah Tai Chi dojo via
Seedance 2.0, then extract evenly-spaced frames as setting reference images.

Why: independent nano-banana generations of dojo angles drift — each one is a
separate interpretation of the room. One Seedance generation = one consistent
3D environment rendered once, so frames extracted from that video are
literally the same room from different angles. Better setting consistency
than 4 independent stills.

Flow:
  1. Upload the 2 nano-banana dojo refs to Kie as visual anchors
  2. Call Seedance with an architectural-pan prompt + both refs
  3. Download the resulting mp4
  4. Extract 4 frames at 2s intervals as new setting refs

Output: references/dojo/walkthrough_01.png ... walkthrough_04.png
        work/dojo_walkthrough/walkthrough.mp4 (kept for inspection)

Cost: 1 Seedance clip at 720p ~ $1.20. Frame extraction is free.
"""
from __future__ import annotations
import asyncio
import os
import subprocess
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient
from src.settings import DOJO_ANCHOR_TEXT

REF_DIR = ROOT / "references" / "dojo"
WORK_DIR = ROOT / "work" / "dojo_walkthrough"
SEEDANCE_MODEL = "bytedance/seedance-2"

INPUT_REFS = [
    REF_DIR / "dojo_wide_morning.png",
    REF_DIR / "dojo_three_quarter_yinyang.png",
]

DURATION_S = 10
FRAME_TIMES_S = [1.5, 4.0, 6.5, 9.0]  # grab 4 evenly-spaced frames

WALKTHROUGH_PROMPT = (
    f"{DOJO_ANCHOR_TEXT}\n\n"
    "ARCHITECTURAL REFERENCE CLIP — purpose of this video is to generate a "
    "3D model walkthrough of the dojo room. This is NOT a narrative clip. "
    "It is a reference tool. No people, no characters, no narrative, no "
    "storytelling. The ONLY motion in this video is a smooth, continuous, "
    "clockwise 360° camera rotation around the interior of the room.\n\n"
    "Camera is positioned in the center of the room at standing-eye height, "
    "rotating in place at a steady constant speed. Over 10 seconds it turns "
    "smoothly through approximately 360 degrees.\n\n"
    "CAMERA PATH (clockwise rotation from center):\n"
    "- 0-2.5s: camera faces SOUTH — the lattice-screen doorway is centered\n"
    "  in frame. Warm morning light streams through.\n"
    "- 2.5-5.0s: camera has rotated to face WEST — the Torah Tai Chi logo\n"
    "  wall display (round cedar yin-yang disc with magen david inset,\n"
    "  'TORAH' in separate cedar letters arced above, 'TAI CHI' in separate\n"
    "  cedar letters straight below) is centered in frame.\n"
    "- 5.0-7.5s: camera faces NORTH — the darker-cedar Star of David plaque\n"
    "  on the solid pale linen wall is centered in frame.\n"
    "- 7.5-10s: camera faces EAST — the brass seven-branched menorah on its\n"
    "  wooden shelf is centered in frame.\n\n"
    "ROOM STAYS COMPLETELY FIXED across the entire rotation: the walls, "
    "wall-mounted iconography (logo, star, menorah), olive-wood low table "
    "with teacup and pomegranate bowl in the center, indigo-striped wool "
    "runner on the cedar floor, lighting, and materials all remain identical. "
    "Only the camera angle changes. No objects move, no people appear, no "
    "wind, no ambient motion — pure architectural traversal.\n\n"
    "SOLID WALLS: Only the south wall has the lattice doorway. The north, "
    "east, and west walls are solid pale linen with NO doors, NO lattice "
    "screens, NO openings other than the items described above.\n\n"
    "No camera cuts, no transitions, no fade. One continuous take. Warm "
    "cinematic lighting. Soft Pixar-style 3D architectural rendering. No "
    "characters. No speech. Silent."
)


async def generate_and_extract() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ.get("KIE_AI_API_KEY")
    if not kie_key:
        raise SystemExit("ERROR: KIE_AI_API_KEY not set (add to .env)")

    for ref in INPUT_REFS:
        if not ref.exists():
            raise SystemExit(f"Missing input ref: {ref}. Run generate_dojo_refs.py first.")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    walkthrough_mp4 = WORK_DIR / "walkthrough.mp4"

    kie = KieClient(api_key=kie_key, poll_timeout_s=1800)

    if walkthrough_mp4.exists() and walkthrough_mp4.stat().st_size > 0:
        print(f"  SKIP Seedance call (walkthrough mp4 already exists: {walkthrough_mp4})")
    else:
        print("  Uploading input refs to Kie...")
        ref_urls: list[str] = []
        for r in INPUT_REFS:
            url = await kie.upload_file(r, remote_dir="torah-tai-chi/refs/dojo-source")
            ref_urls.append(url)
            print(f"    uploaded {r.name}")

        payload = {
            "prompt": WALKTHROUGH_PROMPT,
            "reference_image_urls": ref_urls,
            "duration": DURATION_S,
            "resolution": "720p",
            "aspect_ratio": "16:9",  # wider for architectural view
            "web_search": False,
        }
        print(f"  Calling Seedance for {DURATION_S}s walkthrough ({payload['aspect_ratio']}, {payload['resolution']})...")
        task_id = await kie.create_task(SEEDANCE_MODEL, payload)
        print(f"    task id: {task_id}")
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], walkthrough_mp4)
        print(f"    saved {walkthrough_mp4} ({walkthrough_mp4.stat().st_size} bytes)")

    print(f"\n  Extracting {len(FRAME_TIMES_S)} frames from walkthrough...")
    for idx, t_s in enumerate(FRAME_TIMES_S, start=1):
        out_png = REF_DIR / f"walkthrough_{idx:02d}.png"
        subprocess.run([
            "ffmpeg", "-y", "-ss", f"{t_s}", "-i", str(walkthrough_mp4),
            "-frames:v", "1", "-update", "1", str(out_png),
        ], check=True, capture_output=True)
        if not out_png.exists() or out_png.stat().st_size == 0:
            raise RuntimeError(f"ffmpeg produced no output for frame at {t_s}s")
        print(f"    frame {idx} at t={t_s}s -> {out_png.name}")

    print(f"\nDONE. {len(FRAME_TIMES_S)} walkthrough frames in {REF_DIR}")
    print(f"Inspect {walkthrough_mp4} to see the full pan.")


if __name__ == "__main__":
    asyncio.run(generate_and_extract())
