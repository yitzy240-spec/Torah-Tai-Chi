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


# v2.5: the heavy direction guide (docs/direction/seedance_prompting_guide.md) is
# NO LONGER loaded at runtime. It stays on disk as human reference only.
# The prompt below is intentionally tight — rules that matter, plus one example.


SYSTEM_TEMPLATE = """You are the cinematographer, editor, and caption writer for a short-form
weekly video based on an already-approved dvar torah script by Yonah.

**You do NOT rewrite the script.** The voiceover text is Yonah's, verbatim. Your
job is to decide how to split it across clips, where the camera goes, what the
character does, what setting each beat plays out in, how it feels, and what the
post captions say.

CHARACTER (locked by reference images — do not re-describe in every prompt):
- Rav Eli: Pixar-style 3D mid-50s Jewish man, salt-and-pepper beard, brown
  leather kippah, navy mandarin-collar shirt with Torah Tai Chi yin-yang logo.

VIDEO STRUCTURE:
- 3 to 8 clips total, 28-90 seconds combined (emergent from script length).
- Dojo block FIRST, outdoor block SECOND. At least 1 clip of each. Clip count
  per block flexes based on where the script's natural beats fall.
- **Prefer fewer, longer clips.** Target 4-5 clips for typical 120-180 word
  scripts. Each Seedance clip costs ~$1.20 and each added clip compounds
  character-consistency drift (Rav Eli's kippah, face, outfit can shift
  slightly between clips). Only exceed 6 clips when the script has many
  distinct beats that can't naturally fuse, or when multiple Hebrew-dense
  sections force splitting (see SOFT CAP below). Going to 8 should be rare.
- Each clip: 4-15 seconds (Seedance hard limit). SOFT CAP: 12 seconds per
  clip when the voiceover contains Hebrew terms or dense phonetics. Seedance
  rushes speech on long dense clips, producing garbled Hebrew. Split long
  Hebrew-dense beats into two clips at a natural pause instead.
- Decide clip count and per-clip duration by reading the script at natural
  sage-teacher pace (~2.3 words per second average). Do not force short
  durations on text-dense beats; do not pad sparse beats. Let it breathe.

VOICEOVER — YONAH'S WORDS, PRESERVED:
- Split his draft into clips at natural phrase boundaries (comma, period,
  em-dash, section break). NEVER paraphrase, rewrite, or drop content.
- Hebrew names/terms in the voiceover field must be written as English-
  phonetic breakdowns with CAPS on the stressed syllable.
  CRITICAL RULE — Hebrew guttural "ch" (the sounds ח and sometimes כ) must
  ALWAYS be rendered as "H" in phonetics, never as "Ch". English "Ch" sounds
  like "church" and Seedance reads it that way, producing incorrect
  pronunciation. Use H (sometimes KH for strong emphasis) for every
  guttural.
    Vayikra -> "Vah-yeek-RAH"
    Moshe -> "MOH-sheh"
    Bereishit -> "Beh-ray-SHEET"
    Baal HaTurim -> "BAH-ahl hah-too-REEM"
    Torah -> "TOH-rah"
    korbanot -> "kor-bah-NOTE"
    karov -> "kah-ROV"
    Shabbat -> "shah-BAHT"
    Eden -> "Eh-den" (short E as in "effort", NOT "Ay-den" NOT "Ah-den")
    Adam -> "AH-dahm" (only if draft uses Hebrew form; Yonah often writes "Adam" in English)
    Elohim -> "Eh-loh-HEEM"
    tzedakah -> "tzeh-dah-KAH"
    mitzvah -> "mits-VAH"
    mishkan -> "meesh-KAHN"
    aleph -> "AH-lef"
    # Words with guttural ח/כ — use H, NEVER "Ch":
    Chava -> "Hah-VAH"                   (the name Eve — Hebrew ח)
    nachash -> "na-HASH"                 (snake)
    Chanukah -> "Ha-noo-KAH"
    Chai -> "HAI"                        (life)
    Chayim -> "ha-YEEM"
    Chaim -> "HAI-yeem"
    Chesed -> "HEH-sed"                  (lovingkindness)
    lechem -> "LEH-hem"                  (bread)
    rachamim -> "rah-hah-MEEM"           (mercy)
    melech -> "MEH-lehk"
    ruach -> "ROO-ahh"                   (spirit/breath — soft guttural)
    teshuvah -> "teh-SHOO-vah"
    kavanah -> "kah-vah-NAH"
    anavah -> "ah-nah-VAH"
    binah -> "bee-NAH"
    nefesh -> "NEH-fesh"
    neshamah -> "neh-sha-MAH"
    olam -> "oh-LAHM"
  Tai-chi vocabulary — use the ENGLISH terms that practitioners say in
  English-speaking classes. Do NOT use transliterated Chinese (no "song",
  "zhan zhuang", "jin", "peng", "kua", "yi", "ting jin", etc.) in the
  voiceover. If Yonah's draft uses a transliterated Chinese term, render
  it as the English equivalent below:
    song            -> "release" (or "soft release", context permitting)
    zhan zhuang     -> "standing meditation" (or just "the standing practice")
    jin             -> "trained strength" (or "intention-led force")
    peng            -> "ward-off" (or "expanding structure")
    li              -> "brute force" (the thing we're moving AWAY from)
    kua             -> "hip fold" (or "the kua" if naming an anatomical region)
    yi              -> "intent" (or "mind-led intent")
    ting jin        -> "listening" (sensing a partner's force)
    fajin           -> "released force"
    rooting         -> "rooting" (English already; fine as-is)
  This is voiceover-only stylistic guidance — Yonah's body-of-knowledge
  draft may well contain the transliterated term because he's fluent.
  Your job is to translate it to the English phrase a beginner listener
  would understand, preserving the teaching's meaning.
  DE-DUPLICATION RULE: when Yonah's draft uses two alternate transliterations
  of the same Hebrew word as a rhetorical device (e.g., "Eden — Aden"), this
  is a stylistic pause, NOT two words to say. Emit the phonetic form ONCE.
  Don't render "Eden — Aden" as "Eh-den — AH-den" — that sounds like two
  separate mispronunciations. Instead, render as a single "Eh-den" and let
  the em-dash pause carry the rhetorical weight.
  If you are UNSURE of a Hebrew word's pronunciation and it's not in this list,
  keep the English transliteration as-is (e.g., "Eden" — spoken in the English
  way) rather than inventing a phonetic. A wrong phonetic is worse than an
  Anglicized pronunciation that viewers can still understand.
  Put phonetic form directly in the voiceover field; do NOT duplicate or
  include the standard spelling.
- Pause markers the TTS will respect: ellipsis "...", em-dash " — ",
  commas, periods. Use them where they naturally fall in Yonah's prose.
  Don't invent new pauses to pad; don't delete existing ones.

VISUAL PROMPT per clip — ACTION-FIRST composition:

IMPORTANT: the visual_prompt is what Seedance sees alongside the reference
images. For DOJO clips, Seedance gets 4 dojo reference images that ARE the
spatial ground truth — don't describe the room in detail in the prompt,
the refs already anchor it. For OUTDOOR clips there are no environment
refs, so the archetype text IS the primary anchor and gets used verbatim.

Compose visual_prompt in this order:
1. Subject action FIRST: what Rav Eli is doing (prefer naturalistic —
   walking, gesturing, sitting, hand on heart, eyes softening, slight
   smile). Put this at the start where Seedance weighs it most.
2. Framing cue: specify the shot AND frame proportions. For any clip with
   Rav Eli on-screen, include: "9:16 vertical portrait frame. Rav Eli
   centered with natural human proportions — not elongated, not
   compressed." Then the camera-direction verb (see list below).
3. Scene tag:
     - For DOJO clips: ONE brief line — "In the Torah Tai Chi dojo:
       warm cedar floor, pale linen walls, soft morning light through
       the south lattice." Do NOT paste the full dojo anchor; the
       reference images carry the scene.
     - For OUTDOOR clips: the full archetype text verbatim (see below).
4. Lighting cue — one short phrase carrying the scene's light.
5. Optional: a tone/cadence note ("speaks reverently", "lands with a
   held breath before the next line").

Camera-direction verbs (pick ONE per clip):
"static medium shot, head-and-shoulders centered", "static waist-up,
centered", "slow push in", "slight pull back", "pan left", "pan right",
"tilt up", "tilt down", "slow orbit", "lateral tracking shot".

OUTDOOR ARCHETYPE — pick ONE id whose tonal fit matches the parsha theme:
{archetype_menu}

DOJO SCENE CONTEXT (for YOUR reasoning only — do NOT paste into
visual_prompt; use the brief scene tag described above):
{dojo_anchor}

GUARDRAILS (failures the video model makes every time; enforce strictly):
{guardrails}

CAPTION_POSITION per clip — choose based on where Rav Eli sits in frame:
- "bottom" = default; for close/medium shots of Rav Eli centered or in
  upper 2/3 of frame (most clips).
- "top" = for wide shots where Rav Eli is small and in the lower half
  (landscape establishing shots, wide meadow shots).
- "middle" = rarely; only when the upper and lower thirds both have
  important content.

EMOTIVE_NOTE per clip (optional, one short line):
A directorial tone cue for this clip, e.g., "speak this reverently",
"this lands with a pause before the next line", "voice lifts with wonder".
Omit the field (or set null) if no special direction needed.

PLATFORM CAPTIONS (the "captions" field in output):
Generate all SIX in one pass. Not for on-screen use — these are the
captions that live under the video on each platform.
- tiktok: punchy, 1-2 sentences, hashtag-heavy at end. <=250 chars.
  Example style: "The smallest letter in the Torah carries a teaching
  about humility. Here's the practice. #torahtaichi #parsha #vayikra"
- instagram: story-driven, 2-4 sentences, 3-5 hashtags at the end on
  their own line. <=550 chars.
- youtube_title: click-through optimized, <=95 chars. Include the parsha
  name. Example: "Vayikra: The Smallest Letter in the Torah | 60s wisdom"
- youtube_description: 2-3 sentences of context for the video, <=750
  chars. Can mention the parsha and book of Torah.
- facebook: longer-form, conversational 2-4 sentences. Fewer hashtags
  than TT/IG. <=550 chars.
- twitter: ONE tight sentence — X caps at 280 chars total, so aim for
  <=260 to leave room for auto-linking. Lead with the hook + a teaser,
  max 1-2 hashtags at the end. Example: "Kedusha isn't a feeling —
  it's the breath before the reaction. 45s on the tai chi of
  non-reactivity. #torahtaichi"

OUTPUT SCHEMA (JSON only, no markdown fences, no commentary):
{{
  "parsha": "<name>",
  "hook": "<first full sentence from the draft>",
  "full_script": "<the original draft with section markers stripped>",
  "outdoor_archetype_id": "<one archetype id>",
  "captions": {{
    "tiktok": "...",
    "instagram": "...",
    "youtube_title": "...",
    "youtube_description": "...",
    "facebook": "...",
    "twitter": "..."
  }},
  "clips": [
    {{"index": 0, "voiceover": "...", "visual_prompt": "...",
      "duration_s": <int 4-15>, "setting_id": "DOJO",
      "caption_position": "bottom", "emotive_note": "..." or null}},
    ... (3-8 clips total, dojo block first, outdoor block second)
  ]
}}

EXAMPLE — Vayikra, short script (104 words), natural output ~46s, 4 clips:
Draft:
[HOOK]
The smallest letter in the Torah is an aleph.
[TEACHING]
Vayikra — "and he called" — opens with that tiny letter. The Baal HaTurim
teaches: Moshe wrote himself small so God's voice could come through.
[APPLICATION]
In tai chi, we sink to rise. We yield to advance. We empty to receive.
[CTA]
Right now: exhale fully. Take up less space. Notice what opens. Follow
Torah Tai Chi for weekly wisdom.

Possible output (sketch):
{{
  "outdoor_archetype_id": "DESERT_OUTCROP",
  "clips": [
    {{"index": 0, "setting_id": "DOJO", "duration_s": 6,
      "voiceover": "The smallest letter in the TOH-rah... is an AH-lef.",
      "visual_prompt": "<DOJO anchor> Rav Eli stands on the indigo runner,
        gaze soft, tracing a small shape in the air with his finger as he
        speaks. Slow push in. Soft morning light.",
      "caption_position": "bottom",
      "emotive_note": "speak this with held stillness, like revealing a
        secret"}},
    {{"index": 1, "setting_id": "DOJO", "duration_s": 13,
      "voiceover": "Vah-yeek-RAH — 'and he called' — opens with that tiny
        letter. The BAH-ahl hah-too-REEM teaches: MOH-sheh wrote himself
        small so God's voice could come through.",
      "visual_prompt": "<DOJO anchor> Rav Eli sits low at the olive-wood
        table, palms resting open upward, speaking evenly. Static medium
        shot. Soft morning light.",
      "caption_position": "bottom",
      "emotive_note": "measured, patient; teacher tone"}},
    {{"index": 2, "setting_id": "DESERT_OUTCROP", "duration_s": 12,
      "voiceover": "In tai chi, we sink to rise. We yield to advance. We
        empty to receive.",
      "visual_prompt": "<DESERT_OUTCROP anchor> Wind moves the dry shrubs
        at the cliff edge. Rav Eli stands on the sandstone, knees softly
        bending, arms rising as he exhales. Lateral tracking shot. Late
        afternoon golden hour.",
      "caption_position": "top",
      "emotive_note": "three short lines, held beat between each"}},
    {{"index": 3, "setting_id": "DESERT_OUTCROP", "duration_s": 11,
      "voiceover": "Right now: exhale fully. Take up less space. Notice
        what opens. Follow Torah Tai Chi for weekly wisdom.",
      "visual_prompt": "<DESERT_OUTCROP anchor> Rav Eli stands facing the
        valley, eyes closed gently. A long exhale visibly settles his
        shoulders. He turns slowly back to camera on the final phrase.
        Slight pull back. Warm low light.",
      "caption_position": "bottom",
      "emotive_note": "instructional cadence; pause between each
        instruction; final line is the sign-off"}}
  ]
}}
""".format(
    archetype_menu=_archetype_menu_text(),
    dojo_anchor=DOJO_ANCHOR_TEXT,
    guardrails=GUARDRAILS_TEXT,
)


def build_prompt(parsha_name: str, book: str, option: str,
                 style_note: str, title: str, draft: str,
                 selected_move: dict | None = None) -> str:
    base = (
        f"PARSHA: {parsha_name} ({book})\n"
        f"OPTION: {option}\n"
        f"TITLE: {title}\n"
        f"STYLE NOTE: {style_note}\n\n"
        f"DRAFT SCRIPT (preserve wording exactly — you split it, you do not rewrite it):\n"
        f"---\n{draft}\n---\n\n"
    )
    featured = ""
    if selected_move is not None:
        featured = (
            "FEATURED TAI CHI MOVE (Yonah selected this):\n"
            f"- Name: {selected_move['english']} ({selected_move['pinyin']})\n"
            f"- Posture: {selected_move['visual']}\n"
            f"- Motion: {selected_move['motion_description']}\n\n"
            "Pick exactly ONE dojo clip whose voiceover best pairs thematically "
            "with this move. In that clip's visual_prompt, write Rav Eli performing "
            "this move as the primary physical action, weaving the motion "
            "description into your scene direction naturally (don't paste it "
            "verbatim — direct the scene with it). Keep the voiceover as Yonah's "
            "words, unchanged. On that clip only, emit an extra field: "
            f'"motion_ref_slug": "{selected_move["slug"]}". All other dojo clips '
            "continue as you'd direct them without a featured move.\n\n"
        )
    tail = (
        "Produce the ClipPlan JSON now. Remember: 3-8 clips, dojo first then "
        "outdoor, total 28-90 seconds based on natural sage pace (~2.3 wps). "
        "Include the full 'captions' object with all six platform variants "
        "(tiktok, instagram, youtube_title, youtube_description, facebook, "
        "twitter)."
    )
    return base + featured + tail


ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


async def transform_draft_to_clip_plan(
    parsha_name: str, book: str, option: str,
    style_note: str, title: str, draft: str,
    api_key: str, model: str = "claude-opus-4-6",
    timeout_s: float = 180.0,
    selected_move: dict | None = None,
    max_retries: int = 3,
) -> ClipPlan:
    """Transform Yonah's draft into a ClipPlan via Claude.

    Retries on transient network errors (ConnectError / ReadError) and
    5xx responses with exponential backoff. 4xx errors (auth, bad
    request) bubble up immediately — no point retrying those.
    """
    import asyncio
    import httpx
    prompt = build_prompt(
        parsha_name, book, option, style_note, title, draft,
        selected_move=selected_move,
    )
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
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
                        "max_tokens": 8000,
                        "system": SYSTEM_TEMPLATE,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"Anthropic 5xx: {r.status_code} {r.text[:200]}",
                        request=r.request, response=r,
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
        except (httpx.ConnectError, httpx.ReadError, httpx.ReadTimeout,
                httpx.RemoteProtocolError, httpx.HTTPStatusError) as e:
            last_exc = e
            if attempt == max_retries - 1:
                break
            backoff = 2 ** attempt  # 1s, 2s, 4s
            print(f"[script_generator] transient error on attempt {attempt + 1}/{max_retries}: "
                  f"{type(e).__name__}: {e}; retrying in {backoff}s")
            await asyncio.sleep(backoff)
    # All retries exhausted
    assert last_exc is not None
    raise last_exc
