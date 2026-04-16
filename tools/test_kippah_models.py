"""A/B test kippah-swap across 4 Kie.ai image models with a SHORT prompt.

Motivation: nano-banana-pro has fought us for days on kippah size. The Gemini
front-end UI produced a smaller kippah from a 4-word prompt on the same base
image — so model choice and prompt brevity matter more than elaborate
engineering. This script submits the same simple prompt + same single ref
image to 4 different models in parallel so we can pick a winner.

Models under test (all on Kie.ai):
- qwen/image-edit       — purpose-built edit model, param `image_url`
- nano-banana-2         — Gemini 3.1 Flash Image, param `image_input[]`
- flux-kontext-pro      — purpose-built edit with strong prompt adherence,
                          param `inputImage` (note camelCase)
- nano-banana-pro       — current baseline, param `image_input[]`

Input: references/_backup_brown_kippah/01_front_neutral.png (original, pre-
regen character ref — the cleanest starting point).

Output: references/_canonical/kippah_model_test_<model>.png

Cost: ~$0.20 total (one generation per model).
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient

FLUX_CREATE_URL = "https://api.kie.ai/api/v1/flux/kontext/generate"
FLUX_POLL_URL = "https://api.kie.ai/api/v1/flux/kontext/record-info"

SRC = ROOT / "references" / "_backup_brown_kippah" / "01_front_neutral.png"
OUT_DIR = ROOT / "references" / "_canonical"

# Deliberately SHORT. The Gemini-UI insight: 4-word prompts beat 500-word
# prompts on purpose-built edit models. Keep it to a single clear directive.
PROMPT = (
    "Replace the brown leather kippah with a smaller navy-blue knitted "
    "kippah sruga (about 30% smaller). Keep the face, hair, beard, "
    "shirt, pose, and background identical."
)


async def _qwen(kie: KieClient, src_url: str) -> str:
    payload = {
        "prompt": PROMPT,
        "image_url": src_url,
        "output_format": "png",
        "image_size": "square_hd",
    }
    return await _run(kie, "qwen/image-edit", payload, "qwen_image_edit")


async def _nb2(kie: KieClient, src_url: str) -> str:
    payload = {
        "prompt": PROMPT,
        "image_input": [src_url],
        "aspect_ratio": "1:1",
        "resolution": "1K",
        "output_format": "png",
    }
    return await _run(kie, "nano-banana-2", payload, "nano_banana_2")


async def _flux(kie: KieClient, src_url: str) -> str:
    """Flux Kontext uses its OWN dedicated endpoints, not /jobs/createTask."""
    out = OUT_DIR / "kippah_model_test_flux_kontext_pro.png"
    headers = {"Authorization": f"Bearer {kie._key}",
               "Content-Type": "application/json"}
    payload = {
        "prompt": PROMPT,
        "inputImage": src_url,
        "aspectRatio": "1:1",
        "outputFormat": "png",
        "model": "flux-kontext-pro",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(FLUX_CREATE_URL, headers=headers, json=payload)
            r.raise_for_status()
            d = r.json()
            if d.get("code") != 200:
                raise RuntimeError(f"flux createTask: {d}")
            task_id = d["data"]["taskId"]

            deadline = time.monotonic() + 600
            result_url = None
            while time.monotonic() < deadline:
                rr = await c.get(
                    f"{FLUX_POLL_URL}?taskId={task_id}", headers=headers,
                )
                rr.raise_for_status()
                data = rr.json().get("data") or {}
                flag = data.get("successFlag")
                if flag == 1:
                    resp = data.get("response") or {}
                    if isinstance(resp, str):
                        resp = json.loads(resp)
                    result_url = resp.get("resultImageUrl")
                    break
                if flag in (2, 3):
                    raise RuntimeError(f"flux task failed: {data}")
                await asyncio.sleep(5)
            if not result_url:
                raise TimeoutError("flux poll timeout")

            dl = await c.get(result_url)
            dl.raise_for_status()
            out.write_bytes(dl.content)
        print(f"  OK   {'flux_kontext_pro':20s} -> {out.name}")
        return str(out)
    except Exception as e:
        print(f"  FAIL {'flux_kontext_pro':20s} : {e}")
        return ""


async def _nbpro(kie: KieClient, src_url: str) -> str:
    payload = {
        "prompt": PROMPT,
        "image_input": [src_url],
        "output_format": "png",
        "image_size": "1:1",
    }
    return await _run(kie, "nano-banana-pro", payload, "nano_banana_pro")


async def _run(kie: KieClient, model: str, payload: dict, slug: str) -> str:
    out = OUT_DIR / f"kippah_model_test_{slug}.png"
    try:
        task_id = await kie.create_task(model, payload)
        urls = await kie.poll_task(task_id)
        await kie.download(urls[0], out)
        print(f"  OK   {slug:20s} -> {out.name}")
        return str(out)
    except Exception as e:
        print(f"  FAIL {slug:20s} : {e}")
        return ""


async def main() -> None:
    load_dotenv(ROOT / ".env")
    kie_key = os.environ["KIE_AI_API_KEY"]
    if not SRC.exists():
        raise SystemExit(f"Missing source ref: {SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    kie = KieClient(api_key=kie_key, poll_timeout_s=600)
    print(f"Uploading source ref: {SRC.name}")
    src_url = await kie.upload_file(SRC, remote_dir="torah-tai-chi/model-test")

    print(f"\nPrompt: {PROMPT}\n")
    print("Launching 4 models in parallel...")
    await asyncio.gather(
        _qwen(kie, src_url),
        _nb2(kie, src_url),
        _flux(kie, src_url),
        _nbpro(kie, src_url),
    )
    print(f"\nDONE. Compare outputs in {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
