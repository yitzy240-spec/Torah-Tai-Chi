"""
Generate Rav Eli character reference images via Kie.ai Nano Banana Pro.

Pipeline:
  1. Upload the canonical source image to Kie's file host to get a URL.
  2. For each of the 13 shot prompts, POST to createTask with the source
     image URL as image_input + the prompt, targeting model "nano-banana-pro"
     at 4K resolution, png output.
  3. Poll recordInfo until state == "success" or "fail".
  4. Download the returned resultUrls[0] to references/<slug>.png.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

ROOT = Path(r"c:/Users/yitzym/git/torah tai chi")
ENV_PATH = ROOT / ".env"
SOURCE_IMAGE = ROOT / "Gemini_Generated_Image_enjb7yenjb7yenjb.png"
REF_DIR = ROOT / "references"
REF_DIR.mkdir(parents=True, exist_ok=True)

UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload"
UPLOAD_STREAM_URL = "https://kieai.redpandaai.co/api/file-stream-upload"
CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask"
RECORD_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"

MODEL = "nano-banana-pro"
RESOLUTION = "4K"
OUTPUT_FORMAT = "png"

STYLE_LOCK = (
    "Same character as reference image. Pixar-style 3D animation, mid-50s "
    "Jewish man, salt-and-pepper hair and trimmed beard, brown leather kippah, "
    "navy blue mandarin-collar athletic shirt with Torah Tai Chi yin-yang "
    "logo on chest. Soft 3D render, warm cinematic lighting, neutral light "
    "gray studio background, high detail, character identity must match "
    "reference exactly."
)

SHOTS = [
    ("01_front_neutral", "1:1",
     "Front-facing portrait, head and shoulders, neutral relaxed expression, "
     "direct eye contact with camera."),
    ("02_front_speaking", "1:1",
     "Front-facing portrait, head and shoulders, warm smile mid-speech, one "
     "hand raised gesturing naturally."),
    ("03_threequarter_right_speaking", "1:1",
     "Three-quarter view from his right side, speaking with animated "
     "open-hand gesture, engaged teacher expression."),
    ("04_threequarter_left_speaking", "1:1",
     "Three-quarter view from his left side, speaking with animated "
     "open-hand gesture, engaged teacher expression."),
    ("05_profile_right", "1:1",
     "Full right-side profile, head and shoulders, brown leather kippah "
     "clearly visible on top of head, calm expression."),
    ("06_fullbody_ready_stance", "9:16",
     "Full body, front-facing, standing in neutral tai chi ready stance, "
     "arms relaxed at sides, feet shoulder-width apart."),
    ("07_fullbody_yinyang_pose", "9:16",
     "Full body, three-quarter view, hands in the yin-yang tai chi pose "
     "from the reference image - one hand above and one below, palms facing "
     "each other as if holding an invisible sphere. This is the continuity "
     "anchor - must look visually near-identical in character identity to "
     "the source reference."),
    ("08_fullbody_flowing_pose", "9:16",
     "Full body, mid tai chi flowing form, arms extended in a wave-like "
     "sweeping motion, one leg slightly forward, peaceful concentration."),
    ("09_seated_teaching", "1:1",
     "Seated cross-legged on a low cushion, hands animated in mid-teaching "
     "gesture, looking warmly toward camera."),
    ("10_closeup_thoughtful", "1:1",
     "Close-up, head fills the frame, thoughtful contemplative expression, "
     "eyes looking slightly off-camera, head tilted slightly."),
    ("11_walking_forward", "9:16",
     "Full body, walking forward toward camera, mid-stride, natural relaxed "
     "gait, slight smile."),
    ("12_meditation_pose", "9:16",
     "Full body, hands at chest level in prayer or meditation pose with "
     "palms pressed together, eyes softly lowered, serene expression."),
    ("13_overshoulder_back", "9:16",
     "Over-the-shoulder three-quarter back view, showing back of head and "
     "brown leather kippah and shoulders, facing slightly away from camera, "
     "for b-roll use."),
]


def load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("KIE_AI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("KIE_AI_API_KEY not found in .env")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def http_json(url: str, method: str, headers: dict,
              body: Optional[bytes] = None, timeout: int = 60) -> dict:
    headers = {"User-Agent": UA, "Accept": "*/*", **headers}
    req = urllib.request.Request(url, data=body, method=method,
                                 headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def upload_source_image(api_key: str, path: Path) -> str:
    """Upload using base64 endpoint (avoids multipart quirks)."""
    import base64
    file_bytes = path.read_bytes()
    b64 = base64.b64encode(file_bytes).decode("ascii")
    payload = {
        "base64Data": f"data:image/png;base64,{b64}",
        "uploadPath": "torah-tai-chi/refs",
        "fileName": "rav-eli-source.png",
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    log(f"Uploading source image base64 ({len(file_bytes)} bytes) -> "
        f"{UPLOAD_URL}")
    try:
        resp = http_json(UPLOAD_URL, "POST", headers, body, timeout=120)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        raise SystemExit(f"Upload failed HTTP {e.code}: {err_body}")

    log(f"Upload response: {json.dumps(resp)[:400]}")
    data = resp.get("data") or {}
    url = data.get("downloadUrl") or data.get("fileUrl")
    if not url:
        raise SystemExit(f"No fileUrl in upload response: {resp}")
    return url


def create_task(api_key: str, prompt: str, aspect_ratio: str,
                image_url: str) -> str:
    payload = {
        "model": MODEL,
        "input": {
            "prompt": prompt,
            "image_input": [image_url],
            "aspect_ratio": aspect_ratio,
            "resolution": RESOLUTION,
            "output_format": OUTPUT_FORMAT,
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = json.dumps(payload).encode("utf-8")
    resp = http_json(CREATE_URL, "POST", headers, body, timeout=60)
    if resp.get("code") != 200:
        raise RuntimeError(f"createTask error: {resp}")
    task_id = (resp.get("data") or {}).get("taskId")
    if not task_id:
        raise RuntimeError(f"No taskId in response: {resp}")
    return task_id


def poll_task(api_key: str, task_id: str,
              timeout_sec: int = 420) -> list[str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    deadline = time.time() + timeout_sec
    delay = 5
    while time.time() < deadline:
        url = f"{RECORD_URL}?taskId={task_id}"
        try:
            resp = http_json(url, "GET", headers, timeout=30)
        except urllib.error.HTTPError as e:
            log(f"  poll HTTP {e.code}, retrying...")
            time.sleep(delay)
            continue
        data = resp.get("data") or {}
        state = data.get("state")
        if state == "success":
            rj = data.get("resultJson") or "{}"
            try:
                parsed = json.loads(rj) if isinstance(rj, str) else rj
            except json.JSONDecodeError:
                parsed = {}
            urls = parsed.get("resultUrls") or []
            if not urls:
                raise RuntimeError(f"success but no resultUrls: {data}")
            return urls
        if state == "fail":
            raise RuntimeError(
                f"task failed: {data.get('failCode')} "
                f"{data.get('failMsg')}"
            )
        log(f"  state={state}, waiting {delay}s...")
        time.sleep(delay)
    raise RuntimeError(f"poll timeout for task {task_id}")


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        dest.write_bytes(r.read())


def build_prompt(shot_desc: str) -> str:
    return f"{STYLE_LOCK}\n\nShot: {shot_desc}"


def process_shot(api_key: str, image_url: str, slug: str,
                 aspect: str, shot_desc: str,
                 attempts: int = 3) -> tuple[bool, str]:
    prompt = build_prompt(shot_desc)
    dest = REF_DIR / f"{slug}.png"
    if dest.exists():
        log(f"[SKIP] {slug} already exists")
        return True, "skip"
    for attempt in range(1, attempts + 1):
        try:
            log(f"[{slug}] attempt {attempt} createTask ({aspect})")
            tid = create_task(api_key, prompt, aspect, image_url)
            log(f"[{slug}] taskId={tid}, polling...")
            urls = poll_task(api_key, tid)
            log(f"[{slug}] got {len(urls)} url(s), downloading")
            download(urls[0], dest)
            log(f"[{slug}] SAVED -> {dest}")
            return True, "ok"
        except Exception as e:
            log(f"[{slug}] attempt {attempt} failed: {e}")
            if attempt < attempts:
                time.sleep(8 * attempt)
    return False, "exhausted retries"


def main() -> int:
    api_key = load_api_key()
    log(f"API key loaded (len={len(api_key)})")
    if not SOURCE_IMAGE.exists():
        raise SystemExit(f"Source image missing: {SOURCE_IMAGE}")

    image_url = upload_source_image(api_key, SOURCE_IMAGE)
    log(f"Source hosted at: {image_url}")

    results = []
    for slug, aspect, shot in SHOTS:
        ok, note = process_shot(api_key, image_url, slug, aspect, shot)
        results.append((slug, ok, note))

    log("=" * 60)
    log("SUMMARY")
    for slug, ok, note in results:
        log(f"  {'OK ' if ok else 'FAIL'} {slug} ({note})")
    fails = [r for r in results if not r[1]]
    log(f"Completed {len(results) - len(fails)}/{len(results)} shots")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
