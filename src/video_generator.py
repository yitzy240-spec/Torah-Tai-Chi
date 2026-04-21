from __future__ import annotations
from pathlib import Path
from typing import Optional
from src.kie_client import KieClient
from src.models import Clip
from src.settings import STYLE_LOCK


SEEDANCE_MODEL = "bytedance/seedance-2"
MAX_REFS = 9
MAX_DOJO_REFS = 4  # was 3; bumped to improve dojo setting consistency
                   # (previous 2 dojo + 7 char ratio let dojo drift across clips)


def _select_refs(character_ref_urls: list[str], dojo_ref_urls: list[str],
                 setting_id: str) -> list[str]:
    if setting_id == "DOJO":
        dojos = dojo_ref_urls[:MAX_DOJO_REFS]
        remaining = MAX_REFS - len(dojos)
        return dojos + character_ref_urls[:remaining]
    return character_ref_urls[:MAX_REFS]


def build_seedance_input(
    clip: Clip,
    character_ref_urls: list[str],
    dojo_ref_urls: list[str],
    first_frame_url: Optional[str],
    audio_url: Optional[str],
    resolution: str = "720p",
    reference_video_url: Optional[str] = None,
) -> dict:
    voice_clause = "Voice matches @Audio1 in timbre and delivery. " if audio_url else ""
    motion_addendum = (
        "\n\nUse the reference video as a motion study — mirror the tempo, "
        "trajectory, and stance of the core tai chi motion precisely, adapted "
        "to Rav Eli's body. The reference is silent; Rav Eli continues to "
        "speak the voiceover line naturally throughout — do not mute him or "
        "freeze his face. If the reference video cuts before the move "
        "resolves, continue past that cutoff and settle the body back to "
        "center.\n"
        if reference_video_url else ""
    )
    prompt = (
        f"{clip.visual_prompt}\n\n"
        f'Character speaks: "{clip.voiceover}"\n'
        f"{voice_clause}"
        f"{STYLE_LOCK}"
        f"{motion_addendum}"
    )
    payload: dict = {
        "prompt": prompt,
        "reference_image_urls": _select_refs(character_ref_urls, dojo_ref_urls, clip.setting_id),
        "duration": clip.duration_s,
        "resolution": resolution.lower(),
        "aspect_ratio": "9:16",
        "web_search": False,
    }
    if first_frame_url:
        payload["first_frame_url"] = first_frame_url
    if audio_url:
        payload["reference_audio_urls"] = [audio_url]
    if reference_video_url:
        payload["reference_video_urls"] = [reference_video_url]
    return payload


async def generate_clip(
    client: KieClient, clip: Clip,
    character_ref_urls: list[str], dojo_ref_urls: list[str],
    dest: Path,
    first_frame_url: Optional[str] = None,
    audio_url: Optional[str] = None,
    resolution: str = "720p",
    model: str = SEEDANCE_MODEL,
    reference_video_url: Optional[str] = None,
) -> Path:
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
        reference_video_url=reference_video_url,
    )
    task_id = await client.create_task(model, payload)
    urls = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest
