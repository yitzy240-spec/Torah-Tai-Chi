"""Topic → Rav Eli script generator.

Entry point for the "compose a video from a freeform topic" flow. Instead
of starting from a parsha + Yonah's pre-approved draft, the user types a
topic (e.g. "the discipline of slowing down before you speak") and Claude
writes a ~45s Rav-Eli-voiced script in Yonah's A-tight style.

The output of `generate_draft_from_topic` is a plain string (the draft
text). The Modal pipeline then feeds it to `script_generator.transform_
draft_to_clip_plan`, which splits it into clips, does the phonetic
rendering of Hebrew, picks camera directions, etc. — exactly the same
downstream as a parsha job.

Style target: 95-110 words, fuses Jewish wisdom with tai chi / internal-
arts principles, sagely voice, concrete embodied moment, no filler. See
tools/rewrite_scripts_tight.py for the companion offline tool used to
generate A-tight variants for the 52 parshiot; this module uses the same
SYSTEM prompt so voice stays consistent.

IMPORTANT: the Chinese-term de-transliteration happens DOWNSTREAM in
script_generator.transform_draft_to_clip_plan — that prompt converts
"song"/"zhan zhuang"/"jin" etc. into the English equivalents for the
Seedance voiceover. The draft here CAN use the Chinese terms; they'll
be translated in the clip-plan step.
"""
from __future__ import annotations

import httpx

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-opus-4-6"


# This SYSTEM prompt is aligned 1:1 with tools/rewrite_scripts_tight.py's
# SYSTEM prompt. Same voice, same length rules, same named-principle
# requirement — so topic-driven videos feel like they come from the same
# teacher as the parsha videos.
SYSTEM = """You write SHORT-FORM dvar torah scripts — 45 seconds of video —
that fuse Torah and broader Jewish wisdom (parsha, kabbalah, chassidus,
mussar) with tai chi and Chinese internal-martial-arts principles. The
fusion is the whole point. Each tradition illuminates the other. A truth
emerges neither articulates alone.

**HARD LENGTH: 95-110 words. Over 115 is a failure. Over 130 is a disaster.**
This is short-form social video. It plays in 45 seconds. Every word is
real estate.

SHORT DOES NOT MEAN WATERED-DOWN. Pack density, don't dilute. Every
sentence earns its place by doing real work. No filler, no restatement,
no meandering. A single razor-sharp image beats five abstractions.

VOICE:
Deep, intelligent, sagely, coherent. An elder teacher who has lived in
both worlds. Measured. Contemplative. Authoritative without volume. This
is Rav Eli speaking — a mid-50s Jewish teacher who also trained decades
in Chinese internal arts.

YOU MUST INCLUDE:
- One specific tai chi / internal-arts principle — named (song 松, jin 勁,
  peng 掤, zhan zhuang, rooting, yielding, yi 意, li vs jin, etc.). NOT
  generic "flow" / "balance" / "harmony."
- A real Jewish wisdom anchor — a parsha teaching, a chassidic insight, a
  mussar principle, a kabbalistic image, or a specific Hebrew concept
  (teshuvah, kavanah, bittul, chesed, etc.) — tied directly to the topic.
- One concrete embodied moment — the body doing something real, not
  "feel the flow." A breath. A weight shift. A softening of the kua. A
  dropping of the shoulders before speaking.
- An opening line that grips in one sentence; a landing that completes
  the teaching and gently points the viewer back into their own life.

FREEDOM:
You are writing from the user's topic prompt, not from an existing draft.
You choose the Jewish anchor and the tai-chi principle that best illuminate
the topic. Don't hedge. Pick one pair and let them speak.

AVOID:
- Generic metaphors without a named principle behind them.
- Listing abstract qualities.
- Mystical throat-clearing.
- Teaching two ideas when one is enough.
- Any sentence that doesn't advance the teaching.
- Calling the viewer "friend" or "dear one" or similar — Rav Eli doesn't
  address them; he teaches, and they overhear.

Return ONLY the rewritten script. No preamble, no word count, no quotes,
no headers, no "here is". Count your words before returning. If over 110,
cut."""


async def generate_draft_from_topic(
    topic: str,
    api_key: str,
    *,
    model: str = MODEL,
    timeout_s: float = 120.0,
) -> str:
    """Generate a ~45s Rav-Eli-voiced script draft from a freeform topic.

    Args:
        topic: The user-supplied topic prompt (e.g. "slowing down before
            you speak", "the kabbalistic idea of tzimtzum as yielding").
        api_key: Anthropic API key.
        model: Override for the Claude model (defaults to Opus 4.6).
        timeout_s: HTTP timeout.

    Returns:
        The draft text — a single string of ~95-110 words. Call
        `script_generator.transform_draft_to_clip_plan` on this next.
    """
    topic = topic.strip()
    if not topic:
        raise ValueError("topic must not be empty")

    user_msg = (
        f"Topic: {topic}\n\n"
        "Write a 95-110 word script in Rav Eli's voice. Pick ONE Jewish "
        "wisdom anchor and ONE named tai-chi principle that illuminate "
        "this topic together. Return ONLY the script."
    )
    payload = {
        "model": model,
        "max_tokens": 1024,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user_msg}],
    }

    async with httpx.AsyncClient(timeout=timeout_s) as http:
        r = await http.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=payload,
        )
        r.raise_for_status()
        data = r.json()
    return data["content"][0]["text"].strip()
