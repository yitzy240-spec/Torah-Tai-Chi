"""Generate a dojo walkthrough video starting from the approved wide shot.

Uses dojo_wide_morning.png as the FIRST FRAME of the Seedance clip (locks
the exact room visual from that approved still), then pans around the room.
The resulting video is used directly as a reference_video_url in future
Seedance production runs — no frame extraction needed.

Important: first_frame_url is incompatible with reference_image_urls in
Seedance 2.0, so we rely on the first frame + text prompt only. The
approved image carries the room geometry; the prompt drives the pan.

Cost: ~$1.20 for one 10s Seedance clip.
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

WIDE_REF = ROOT / "references" / "dojo" / "dojo_wide_morning.png"
WORK_DIR = ROOT / "work" / "dojo_walkthrough"
SEEDANCE_MODEL = "bytedance/seedance-2"
DURATION_S = 10

WALKTHROUGH_PROMPT = (
    "ARCHITECTURAL REFERENCE VIDEO — NO CHARACTERS, NO NARRATIVE, NO "
    "NEW CONTENT. The first frame IS the room. Preserve EVERYTHING in "
    "the first frame exactly: walls, iconography, furniture, floor, "
    "runner, lighting. Do NOT invent any new objects, doors, decorations, "
    "or features. Do NOT pan the camera past the walls shown in the "
    "first frame — the camera stays INSIDE the visible scene at all "
    "times. Do NOT show the south doorway / lattice screens (they are "
    "behind the camera and stay out of frame). "
    "MOTION: Over 10 seconds, the camera performs a VERY SUBTLE, SLOW "
    "forward push-in plus a gentle sideways drift — minimal movement. "
    "Think: a slow dolly toward the low olive-wood table in the center "
    "of the room, with a slight lateral float. The viewer stays inside "
    "the same visible space from the first frame the entire time. At "
    "the end, the camera is still looking at the same room from roughly "
    "the same general direction, just a little closer and slightly "
    "shifted. "
    "NO CUTS, no transitions, no zooming past walls, no rotating to "
    "show unseen rooms or hallways. The room shown is the ONLY room "
    "that exists. "
    "No wind, no ambient motion beyond the camera itself. No people. "
    "Soft cinematic lighting, silent audio."
)


async def run() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    if not WIDE_REF.exists():
        raise SystemExit(f"Missing: {WIDE_REF}")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    out_mp4 = WORK_DIR / "walkthrough.mp4"

    kie = KieClient(api_key=kie_key, poll_timeout_s=1800)

    print(f"Uploading approved wide shot as first frame: {WIDE_REF.name}")
    wide_url = await kie.upload_file(WIDE_REF, remote_dir="torah-tai-chi/walkthrough")

    payload = {
        "prompt": WALKTHROUGH_PROMPT,
        "first_frame_url": wide_url,
        "duration": DURATION_S,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "web_search": False,
    }
    print(f"Creating Seedance walkthrough task ({DURATION_S}s @ 720p)...")
    task_id = await kie.create_task(SEEDANCE_MODEL, payload)
    print(f"  task_id: {task_id}")
    urls = await kie.poll_task(task_id)
    await kie.download(urls[0], out_mp4)
    print(f"\nDONE: {out_mp4}")
    print(f"Use this file's uploaded URL as reference_video_url in future Seedance runs.")


if __name__ == "__main__":
    asyncio.run(run())
