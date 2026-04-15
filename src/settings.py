"""Single source of truth for video direction language.

Constants here are injected into Claude's system prompt and into Seedance
visual prompts. Keep them stable across runs — week-over-week consistency
depends on the same text appearing in every prompt.
"""
from __future__ import annotations


DOJO_ANCHOR_TEXT = (
    "The Torah Tai Chi dojo — a single rectangular teaching space blending "
    "martial-wisdom and Jewish sage traditions. Warm cedar floor (the cedar "
    "of Lebanon), pale linen panels along the walls. "
    "ROOM LAYOUT (this layout is fixed and identical in every shot): "
    "The doorway with wooden lattice screens is on the SOUTH wall, where the "
    "viewer enters. The NORTH wall (opposite the door) holds a Star of David "
    "carved in shallow relief into a single wooden panel, centered — clean "
    "six-pointed geometric form, no text. The EAST wall (to the viewer's "
    "right when entering) holds a tall brass seven-branched menorah standing "
    "on a wooden shelf at chest height. The WEST wall (to the viewer's left "
    "when entering) holds a large circular wooden plaque carved with a "
    "stylized yin-yang spiral, the two lobes flowing into each other like "
    "waves. In the center of the room: a low olive-wood table with a small "
    "ceramic teacup and a wooden bowl of pomegranates on top. A woven wool "
    "runner with subtle indigo stripes runs along the floor from south "
    "doorway toward the north wall. Soft morning light filters through the "
    "wooden lattice screens. The room is empty of all other people."
)


OUTDOOR_ARCHETYPES: dict[str, str] = {
    "MOUNTAIN_RIDGE": (
        "Alpine ridge at golden hour, stone footpath underfoot, distant peaks "
        "beyond a wide valley, low pine scrub catching warm light."
    ),
    "GARDEN_PATH": (
        "Walled stone garden with flowering vines along the wall, a worn stone "
        "bench off the path, dappled afternoon light through a fig tree."
    ),
    "RIVERSIDE_GROVE": (
        "A gentle bend of a slow river, smooth river stones at the bank, "
        "silver-leafed olive trees overhead, soft midday sun glinting on water."
    ),
    "DESERT_OUTCROP": (
        "Sandstone outcrop overlooking a wide dry valley, sparse hardy desert "
        "shrubs, late-afternoon shadows long across the rock."
    ),
    "FOREST_CLEARING": (
        "Sunlit clearing in ancient pines, moss-covered fallen log to one side, "
        "shafts of light cutting through the high canopy."
    ),
    "SEASHORE": (
        "Quiet rocky shore at low tide, tide pools between dark stones, gentle "
        "morning waves, a wide horizon."
    ),
    "ORCHARD": (
        "Old fruit orchard in spring bloom, soft breeze rippling tall grass "
        "between the rows of trees."
    ),
    "HILLTOP_MEADOW": (
        "A wide wildflower meadow at dawn, mist still lifting off the grass, "
        "gentle rolling hills behind."
    ),
}


STYLE_LOCK = (
    "Same character as in reference images: Pixar-style 3D animation, "
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, brown leather "
    "kippah, navy blue mandarin-collar athletic shirt with Torah Tai Chi "
    "yin-yang logo on chest. Soft 3D render, warm cinematic lighting. "
    "Character identity must match references exactly. "
    "Voice timbre: warm and weathered, an experienced elder teacher in his "
    "late 50s, calm authority not booming, the patient cadence of a sage "
    "who has said this thousands of times."
)


GUARDRAILS_TEXT = """\
HARD GENERATION RULES (the model fails on these — enforce strictly):

FORBIDDEN in every visual_prompt:
- Any in-frame rendered text: letters, words, numbers, signs, plaques,
  scrolls with readable text, screens with content. (The model produces
  garbled text every time.)
- Intricate repeating patterns expected to stay sharp under motion
  (decorative borders, complex weaves, fine-print fabric).
- Multiple speaking characters in one shot. (Multi-person lip-sync fails.)
- Held objects with intricate specific shape (a labeled bottle, a tool with
  visible mechanism, an instrument with detailed parts).

PERMITTED (the model is reliable here — use freely):
- Single-character close-ups with speaking. Lean into these for emotional beats.
- Background characters who do NOT speak, used as silent narrative presence
  (a child watching from a distance, two figures walking far behind).
- Simple held objects with smooth shapes (teacup, smooth river stone, walking
  stick, folded cloth).

REQUIRED in every visual_prompt:
- Exactly one camera direction phrase from this list: "dolly in", "dolly out",
  "pan left", "pan right", "tilt up", "tilt down", "push in", "slow orbit",
  "crane up", "lateral tracking shot".
- Either a clear subject action (Rav Eli is doing X) OR a clear environmental
  motion (wind through grass, water flowing). Never a fully static shot.
- A lighting cue ("golden hour", "soft morning light", "dappled afternoon",
  "low warm sunlight", etc.).
"""
