from __future__ import annotations
import json
from src.models import ClipPlan
from src.settings import (
    DOJO_ANCHOR_TEXT, OUTDOOR_ARCHETYPES, STYLE_LOCK, GUARDRAILS_TEXT,
)


def _archetype_menu_text() -> str:
    lines = []
    for key, anchor in OUTDOOR_ARCHETYPES.items():
        lines.append(f"  - {key}: {anchor}")
    return "\n".join(lines)


SYSTEM_TEMPLATE = """You transform approved Torah Tai Chi draft scripts into structured
ClipPlans for video generation. Output ONLY valid JSON matching the schema at the end.

VIDEO STRUCTURE — ALWAYS exactly 4 clips, total 28-45 seconds:
- Clips 0 and 1: setting_id = "DOJO" (the recurring branded space)
- Clips 2 and 3: setting_id = the chosen outdoor archetype id (same id on both)

CHOOSING THE OUTDOOR ARCHETYPE:
Pick ONE archetype id from the menu below whose tonal fit best matches the
parsha's themes. The full anchor description is locked — DO NOT rewrite it.
You may add 1-2 sentences of parsha-specific sensory detail INSIDE the
visual_prompt for clips 2 and 3, but always start the visual_prompt with the
locked anchor first.

OUTDOOR ARCHETYPE MENU:
{archetype_menu}

DOJO ANCHOR (always use as the base for clips 0 and 1):
{dojo_anchor}

VOICEOVER RULES:
- The draft script is by Yonah (brand voice, already approved). DO NOT rewrite,
  paraphrase, or add content. Only split exact words across the 4 clips.
- Preserve order. Do not skip content.
- The 4 clips together should cover the whole draft.
- For ANY Hebrew name, term, book of Torah, or Jewish concept in the voiceover,
  write it as an English-phonetic breakdown (see the HEBREW PRONUNCIATION
  section of the guardrails below). The TTS reads standard transliterations
  incorrectly; phonetic spellings make it say the words the way a Hebrew
  reader would.

VISUAL PROMPT RULES per clip (composed from parts, in this order):
1. The setting anchor (DOJO_ANCHOR_TEXT for clips 0-1, the chosen archetype's
   anchor for clips 2-3). Verbatim.
2. (Clips 2-3 only) Optional 1-2 sentences of parsha-specific sensory detail.
3. Subject action: what Rav Eli is doing this clip. Prefer NATURALISTIC
   actions (walking, gesturing while speaking, observing surroundings,
   breathing visibly, sitting/rising, hand on heart, tracing a slow shape
   in air). Avoid named tai chi forms — the model can't render them
   convincingly. Tai chi sensibility comes through pace and presence,
   not specific martial forms.
4. Exactly one camera direction phrase from the allowed list in the
   guardrails. Note: large-range moves (wide-to-close dollies) are
   forbidden — they break character physics across the zoom.
5. The lighting cue from the anchor (carry it forward; do not contradict).
6. The STYLE_LOCK is appended later by the system — DO NOT include it.

CLIP 0 SPECIAL RULE:
- Clip 0 is the social-video hook. The first 0.5 seconds decide if a
  viewer keeps watching. Open with a CLOSE or MEDIUM-CLOSE framing of
  Rav Eli (head-and-shoulders to waist-up). Never open with a wide
  establishing shot. Camera may use "static medium shot", "slow push in",
  or "slight pull back" — never a big wide-to-close dolly.
- DOJO POSITIONING: when Rav Eli is in the dojo, he stands on the indigo
  runner between the south doorway and the olive-wood table, facing the
  camera. NEVER standing directly at, on, or overlapping the table — the
  table must remain a separate object visible as foreground or midground
  depending on camera angle, not a surface Rav Eli is leaning against.

WITHIN-BLOCK CONTINUITY (clips 0→1 and clips 2→3):
- Consecutive clips in the same setting must feel like the same moment
  continuing. The second clip in a block should START with a composition
  CLOSE to how the first clip ENDED — same general framing size, same
  approximate character position, compatible camera motion. This lets
  the visible crossfade between clips blend gently instead of cutting.
- Example (dojo block): if clip 0 ends with Rav Eli at medium-close
  framing having just pushed in on his face, clip 1 should START near
  that framing (don't jump to a wide establishing shot of the room).
- Example (outdoor block): if clip 2 ends zoomed out with Rav Eli small
  in the landscape, clip 3 should START at a similar scale, not cut to
  a sudden close-up.

EMBODIMENT CLIP VO RULE (clips showing breathing / silent action):
- When the visual calls for Rav Eli to physically embody something
  silent (exhaling, holding stillness, eyes closed, slow movement without
  speech), the voiceover should be SHORTER than the clip's duration by
  1-3 seconds, giving the final moments of the clip silent embodiment
  without the character being shown mid-speech.
- In the visual_prompt for such clips, explicitly note: "voiceover ends
  at roughly <N>s; remaining <M>s is silent embodiment." The model uses
  this to pace the generated audio so the last beat of the clip is
  quiet breath rather than mid-sentence speech.
- Clip 3 (the final CTA/application clip) almost always benefits from
  this treatment — the viewer should feel the breath land before the
  "Follow Torah Tai Chi" sign-off, not be talked over through it.

{guardrails}

OUTPUT SCHEMA (JSON only — no markdown fences, no commentary):
{{
  "parsha": "<name>",
  "hook": "<first sentence of draft's [HOOK] section>",
  "full_script": "<original draft with section markers stripped>",
  "outdoor_archetype_id": "<one key from the menu above>",
  "clips": [
    {{"index": 0, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "DOJO"}},
    {{"index": 1, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "DOJO"}},
    {{"index": 2, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "<archetype id>"}},
    {{"index": 3, "voiceover": "...", "visual_prompt": "...", "duration_s": <int 4-15>, "setting_id": "<archetype id>"}}
  ]
}}
""".format(
    archetype_menu=_archetype_menu_text(),
    dojo_anchor=DOJO_ANCHOR_TEXT,
    guardrails=GUARDRAILS_TEXT,
)


def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str) -> str:
    return (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n\n"
        f"DRAFT SCRIPT (preserve wording exactly):\n---\n{draft}\n---\n\n"
        "Produce the ClipPlan JSON now. Remember: 4 clips total, "
        "first 2 in DOJO, last 2 in the outdoor_archetype_id you picked. "
        "Total duration 28-45 seconds."
    )


ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    api_key: str, model: str = "claude-opus-4-6",
    timeout_s: float = 180.0,
) -> ClipPlan:
    """Transform a draft script into a structured ClipPlan via Claude.

    Uses httpx directly rather than the anthropic SDK because the SDK hangs
    on this environment (see 2026-04-15 session logs). Same payload shape.
    """
    import httpx
    prompt = build_prompt(parsha_name, book, option, style_note, title, draft)
    async with httpx.AsyncClient(timeout=timeout_s) as http:
        r = await http.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 4000,
                "system": SYSTEM_TEMPLATE,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        r.raise_for_status()
        data = r.json()
    raw = data["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    parsed = json.loads(raw)
    return ClipPlan(**parsed)
