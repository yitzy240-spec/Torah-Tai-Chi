from __future__ import annotations
import json
from src.models import ClipPlan


SYSTEM = """You transform approved Torah Tai Chi draft scripts into structured
ClipPlans for video generation.

HARD RULES:
- The draft script is written by Yonah (brand voice, already approved). DO NOT
  rewrite, paraphrase, or add content. Only split the exact words into clip-sized
  voiceover beats and add visual prompts.
- The draft uses section markers like [HOOK], [TEACHING], [APPLICATION], [CTA].
  Use them as natural clip boundaries, but you may split a long section into
  multiple clips if needed to respect the 4-10s per-clip guidance.
- Preserve the order of the draft. Do not skip content.

VISUAL DIRECTION per clip:
- Subject is always Rav Eli (Pixar-style 3D animated character; reference images
  lock his appearance — do NOT describe him in prompts).
- Vary angle/pose/setting across clips: garden, dojo, hillside, wooden room, close-up.
- Prefer motion over static: walking, gesturing, mid-tai-chi form.
- Match the visual to the voiceover's mood (contemplative, energetic, practice-oriented).
- Each clip 4-10 seconds. Aim for 6-9 clips total. Sum to ~60-90s.

OUTPUT: JSON only, no commentary, no markdown fences, matching this schema exactly:
{
  "parsha": "<name>",
  "hook": "<first line of draft's [HOOK] section>",
  "full_script": "<the original draft with section markers stripped>",
  "clips": [
    {"index": 0, "voiceover": "<exact words from draft>", "visual_prompt": "<scene>", "duration_s": <int 4-15>}
  ]
}
"""


def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str,
                 target_duration: int = 75, clip_count: int = 8) -> str:
    return (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n"
        f"TARGET DURATION: {target_duration}s\n"
        f"CLIP COUNT: {clip_count} (±1)\n\n"
        f"DRAFT SCRIPT (preserve wording exactly):\n---\n{draft}\n---\n\n"
        "Produce the ClipPlan JSON now."
    )


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    client, target_duration: int = 75, clip_count: int = 8,
    model: str = "claude-opus-4-6",
) -> ClipPlan:
    prompt = build_prompt(parsha_name, book, option, style_note,
                          title, draft, target_duration, clip_count)
    msg = await client.messages.create(
        model=model,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    # Claude may wrap in ```json fences; strip if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    data = json.loads(raw)
    return ClipPlan(**data)
