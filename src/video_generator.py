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
                 setting_id: str,
                 jewish_ref_urls: Optional[list[str]] = None) -> list[str]:
    """Order references for Seedance, capped at MAX_REFS.

    Priority (highest first): character refs (always preserved) →
    jewish ritual refs (already filtered to this clip) → dojo refs
    (filling the remainder). Dojo refs drop first if MAX_REFS forces
    a cut — character consistency matters more than the room, and
    jewish refs anchor specific Jewish-ritual nouns the prompt
    mentions for THIS clip.
    """
    jewish_ref_urls = jewish_ref_urls or []
    chars = list(character_ref_urls)
    if setting_id == "DOJO":
        # Reserve room for chars + jewish refs first; dojo fills
        # whatever's left. Whole output capped at MAX_REFS so an
        # over-supplied chars list (test edge case, or future
        # change) can't produce a >9 ref bundle that Seedance
        # rejects or truncates unpredictably.
        used = len(chars) + len(jewish_ref_urls)
        dojo_room = max(0, min(MAX_DOJO_REFS, MAX_REFS - used))
        dojos = dojo_ref_urls[:dojo_room]
        return (chars + jewish_ref_urls + dojos)[:MAX_REFS]
    # Non-dojo setting: chars + jewish, capped at MAX_REFS.
    combined = chars + jewish_ref_urls
    return combined[:MAX_REFS]


def build_seedance_input(
    clip: Clip,
    character_ref_urls: list[str],
    dojo_ref_urls: list[str],
    first_frame_url: Optional[str],
    audio_url: Optional[str],
    resolution: str = "720p",
    reference_video_url: Optional[str] = None,
    jewish_ref_urls: Optional[list[str]] = None,
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
        "duration": clip.duration_s,
        "resolution": resolution.lower(),
        "aspect_ratio": "9:16",
        "web_search": False,
    }
    # Seedance constraint: reference_image_urls and first_frame_url are
    # mutually exclusive — sending both returns 422 ("only one scene can
    # be selected"). When the caller provides a first_frame_url (we're
    # chaining within a same-scene clip group), the first frame already
    # encodes character + setting from the previous clip's last frame,
    # so we drop the ref images entirely. When there's no first frame
    # (first clip in a scene), the refs anchor the visual identity.
    if first_frame_url:
        payload["first_frame_url"] = first_frame_url
    else:
        payload["reference_image_urls"] = _select_refs(
            character_ref_urls, dojo_ref_urls, clip.setting_id,
            jewish_ref_urls=jewish_ref_urls,
        )
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
    jewish_ref_urls: Optional[list[str]] = None,
) -> Path:
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
        reference_video_url=reference_video_url,
        jewish_ref_urls=jewish_ref_urls,
    )
    task_id = await client.create_task(model, payload)
    urls, _meta = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest


async def generate_clip_with_meta(
    client: KieClient, clip,
    character_ref_urls: list[str], dojo_ref_urls: list[str],
    dest: Path,
    first_frame_url: Optional[str] = None,
    audio_url: Optional[str] = None,
    resolution: str = "720p",
    model: str = SEEDANCE_MODEL,
    reference_video_url: Optional[str] = None,
    jewish_ref_urls: Optional[list[str]] = None,
) -> tuple[Path, dict]:
    """Same as generate_clip but also returns Kie's task metadata so the
    caller can extract real cost (credits_consumed / costCredits / etc).
    """
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
        reference_video_url=reference_video_url,
        jewish_ref_urls=jewish_ref_urls,
    )
    task_id = await client.create_task(model, payload)
    urls, meta = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest, meta
