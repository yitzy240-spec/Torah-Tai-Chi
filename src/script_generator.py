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

VIDEO STRUCTURE — ALWAYS exactly 4 clips, total 28-50 seconds (aim for ~35-45s):
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

VOICEOVER RULES — YOU ARE WRITING FOR VIDEO, NOT READING A BOOK ALOUD:

Your job is NOT to split Yonah's draft verbatim. Your job is to take the
teaching concept and TURN IT INTO a spoken video. That means adapting
phrasing for pacing, emphasis, breath, and dramatic structure — not just
carving up paragraphs.

WHAT TO PRESERVE from the draft:
- The central Torah teaching (the core insight being shared)
- The brand voice: practical, warm, grounded, blending Torah and tai chi
- All Hebrew names, terms, and book titles (in phonetic form — see below)
- The [HOOK] → [TEACHING] → [APPLICATION] → [CTA] narrative arc

WHAT YOU CAN CHANGE:
- Phrasing, sentence structure, word choice
- Drop secondary commentary, examples, or asides to tighten for pacing
- Reorder for dramatic effect (e.g., move a question earlier as a hook)
- Add short transitional phrases or emphasis words for video rhythm
- Add pause markers (ellipses "...", em-dashes " — ", periods at natural
  breath points) — these cue the TTS to slow and breathe

WHAT YOU CANNOT DO:
- Add new Torah content Yonah didn't write (no inventing teachings)
- Paraphrase Hebrew terms (keep them in, phonetically spelled)
- Shift the theological or ethical message of the draft

WORD DENSITY — THE MOST IMPORTANT RULE FOR PACING:
- The Seedance TTS fits the voiceover INTO the clip duration. More words
  = faster, rushed speech. Fewer words = slower, sage-like delivery.
- Target ~1.8 words per second of clip duration for contemplative clips
  (breathing, embodiment, CTA). Cap at 2.0 wps for anything.
- 8s clip → max ~16 words. 10s clip → max ~20 words. 13s clip → max ~26.
- If the draft has more content than fits at this density, TRIM secondary
  lines. Better to deliver the core teaching at sage pace than to cram
  the full commentary at a rushed pace.

PAUSE MARKERS in voiceover text:
- Use ellipsis "..." for a one-beat pause (~0.4s)
- Use em-dash " — " for a shorter breath or emphasis setup
- Use a period between short sentences to let each land
- Example of sage-paced voiceover (19 words, 11s clip, 1.7 wps):
  "The smallest letter in the whole Torah... is an aleph. Tiny. Hidden.
  And only then... does God speak."

HEBREW PRONUNCIATION (critical — see detailed rules in guardrails below):
- Every Hebrew name/term in the voiceover field must be written as an
  English-phonetic breakdown with hyphens and CAPS on the stressed
  syllable. Examples: Vayikra → "Vah-yeek-RAH", Moshe → "MOH-sheh",
  Baal HaTurim → "BAH-ahl hah-too-REEM". Never use standard Hebrew
  transliterations — the TTS reads them as English.

VISUAL PROMPT RULES per clip (composed from parts, in this order):
1. A compact character identity sentence as the VERY FIRST clause:
   "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown
   leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo."
   (The first ~25 words of every prompt carry the most weight; front-load
   the character anchor here to reduce identity drift across clips.)
2. The setting anchor (DOJO_ANCHOR_TEXT for clips 0-1, the chosen archetype's
   anchor for clips 2-3). Verbatim.
3. (Clips 2-3 only) REQUIRED: an explicit environmental motion cue as its
   own sentence — "wind moves through the grass", "light ripples on the
   water's surface", "soft clouds drift across the valley". This prevents
   frozen-background artifacts where the environment looks like a still
   image behind a moving character.
4. Subject action: what Rav Eli is doing this clip. Prefer NATURALISTIC
   actions (walking, gesturing while speaking, observing surroundings,
   breathing visibly, sitting/rising, hand on heart, tracing a slow shape
   in air). Avoid named tai chi forms — the model can't render them
   convincingly. Tai chi sensibility comes through pace and presence,
   not specific martial forms. Micro-expression cues are encouraged:
   "eyes close gently", "slight smile, lips together", "brow softens".
5. For clips ≥8 seconds: use EXPLICIT TEMPORAL MARKERS with second ranges
   to pace speech and action. Seedance respects these markers natively
   (the closest equivalent to SSML/pause tags it supports). Format:
     "0-Xs: [action + speech]. X-Ys: [silent action]. Y-Zs: [action + speech]."
   Include explicit silence cues: "silence holds final 1s", "character
   falls silent after '...'".

   INSTRUCTIONAL / BREATHING CLIPS (when the script says "exhale",
   "breathe", "drop your shoulders", "feel X", etc.): use the
   speech-action-speech rhythm inside a single clip, and use CAMERA
   COVER to hide the face during silent action so the viewer doesn't
   see him silent-with-mouth-closed while audio continues.
   Pattern example for a 10s instructional clip:
     visual_prompt segment: "0-3s: Rav Eli faces camera, speaks
     'Exhale fully...'. 3-6s: camera tilts DOWN to his hands while
     he exhales visibly, shoulders drop, no speech — silence. 6-9s:
     camera pans BACK UP to face, he speaks 'Let yourself take up
     less space.' 9-10s: held beat, eyes close gently, silence holds
     final 1s."
     voiceover: "Exhale fully... Let yourself take up less space."
   Two gains: Seedance times audio-silence-audio correctly via the
   markers, AND the viewer never sees lip-sync mismatch because the
   camera is off the face during the silent beat.

   NON-INSTRUCTIONAL CLIPS (pure teaching, hook, CTA): still use three
   temporal beats for clips ≥8s — "Opens with [X]. By mid-clip [Y].
   Closes with [Z]." — but no speech-action alternation needed.
6. Exactly ONE camera direction phrase from the allowed list in the
   guardrails. NEVER combine two motion verbs (no "slow push in while
   panning"). Caution on "slow orbit": use only for landscape/environmental
   beats, NEVER when Rav Eli's face is the focus (orbiting a stylized
   3D face breaks geometry).
7. The lighting cue from the anchor (carry it forward; do not contradict).
8. Positive-constraint closer at the END of every visual_prompt (verbatim):
   "Character must match all uploaded reference images. Steady framing,
   single speaker only, face fully visible at all times."
9. The STYLE_LOCK is appended later by the system — DO NOT include it.

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
        "Total duration 28-50 seconds; aim for roughly 35-45s."
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
