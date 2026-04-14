from __future__ import annotations
from pathlib import Path
from typing import Optional
from src.kie_client import KieClient
from src.models import Clip


STYLE_LOCK = (
    "Same character as in reference images: Pixar-style 3D animation, "
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, brown leather "
    "kippah, navy blue mandarin-collar athletic shirt with Torah Tai Chi "
    "yin-yang logo on chest. Soft 3D render, warm cinematic lighting. "
    "Character identity must match references exactly."
)

SEEDANCE_MODEL = "bytedance/seedance-2"


def build_seedance_input(clip: Clip, ref_urls: list[str],
                         audio_url: Optional[str], resolution: str = "720p") -> dict:
    voice_clause = (
        f'Voice matches @Audio1 in timbre and delivery. '
        if audio_url else ""
    )
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f'Character speaks: "{clip.voiceover}"\n'
        f"{voice_clause}"
        f"{STYLE_LOCK}"
    )
    payload: dict = {
        "prompt": prompt,
        "reference_image_urls": ref_urls[:9],  # Seedance hard limit
        "duration": clip.duration_s,
        "resolution": resolution.lower(),
        "aspect_ratio": "9:16",
        "web_search": False,
    }
    if audio_url:
        payload["reference_audio_urls"] = [audio_url]
    return payload


async def generate_clip(client: KieClient, clip: Clip, ref_urls: list[str],
                        dest: Path, audio_url: Optional[str] = None,
                        resolution: str = "720p") -> Path:
    payload = build_seedance_input(clip, ref_urls, audio_url, resolution)
    task_id = await client.create_task(SEEDANCE_MODEL, payload)
    urls = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest
