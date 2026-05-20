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

    For DOJO clips: dojo refs FIRST with guaranteed seats (up to
    MAX_DOJO_REFS), then jewish refs (clip-specific), then chars
    fill remainder. Dojo first because the room is what Seedance
    drifts on — without an anchor it invents a different studio
    every clip. We had 12 char refs and MAX_REFS=9, which under
    a chars-first ordering literally starved dojo refs to ZERO,
    plus dropped the last 3 chars by alphabetical sort. That
    regression shipped 2026-04-30 (commit 3336672 + 53ad4d3) and
    surfaced as Yonah complaining "the dojo isn't respected" and
    "the kippah keeps changing" — restored to pre-regression order
    here.

    For non-DOJO clips: chars + jewish (no scene refs available
    for outdoor archetypes; the archetype text in the prompt
    carries the setting).
    """
    jewish_ref_urls = jewish_ref_urls or []
    chars = list(character_ref_urls)
    if setting_id == "DOJO":
        dojos = dojo_ref_urls[:MAX_DOJO_REFS]
        char_room = max(0, MAX_REFS - len(dojos) - len(jewish_ref_urls))
        return (dojos + jewish_ref_urls + chars[:char_room])[:MAX_REFS]
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
    override_ref_urls: Optional[list[str]] = None,
) -> dict:
    voice_clause = "Voice matches @Audio1 in timbre and delivery. " if audio_url else ""
    # Per-clip delivery direction. Seedance is multimodal — the prompt
    # text influences BOTH the visual generation and the TTS delivery,
    # so a tone note like "speaks with rising warmth" or "measured,
    # patient teacher cadence" actually shifts the speech, not just the
    # visuals. Without this line, Seedance defaults to its flat reading
    # voice and Yonah's audience hears the same monotone every clip.
    # The note also tells the model to vary delivery across the video
    # so adjacent clips don't sound identical.
    emotive_clause = (
        f'Delivery: {clip.emotive_note.strip()}. '
        f'Speak with natural rise and fall — not a flat reading voice.\n'
        if getattr(clip, "emotive_note", None) and clip.emotive_note.strip()
        else 'Speak with natural rise and fall, like a teacher who cares about the words — not a flat reading voice.\n'
    )
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
        f"{emotive_clause}"
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
    # Seedance has two mutex pairs that share first_frame_url:
    #   first_frame_url ↔ reference_image_urls
    #   first_frame_url ↔ reference_video_urls
    # When a motion ref is supplied for this clip, the user explicitly
    # opted into that move — it wins over the auto-attached chain frame.
    # Identity falls back to reference_image_urls; the next clip's chain
    # picks up from this clip's last frame as usual.
    chain_frame = first_frame_url if not reference_video_url else None
    if chain_frame:
        payload["first_frame_url"] = chain_frame
    elif override_ref_urls:
        # Operator picked specific refs in Phase 2 — honor exactly.
        # Bypasses _select_refs's DOJO priority / category logic.
        payload["reference_image_urls"] = override_ref_urls[:MAX_REFS]
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
    override_ref_urls: Optional[list[str]] = None,
) -> tuple[Path, dict]:
    """Same as generate_clip but also returns Kie's task metadata so the
    caller can extract real cost (credits_consumed / costCredits / etc).

    If override_ref_urls is non-empty, it bypasses the char/dojo/jewish
    selection and goes directly into Seedance's reference_image_urls.
    Used to honor the operator's per-clip ref picks from Phase 2.
    """
    payload = build_seedance_input(
        clip, character_ref_urls, dojo_ref_urls,
        first_frame_url, audio_url, resolution,
        reference_video_url=reference_video_url,
        jewish_ref_urls=jewish_ref_urls,
        override_ref_urls=override_ref_urls,
    )
    task_id = await client.create_task(model, payload)
    urls, meta = await client.poll_task(task_id)
    await client.download(urls[0], dest)
    return dest, meta
