"""Single source of truth for video direction language.

Constants here are injected into Claude's system prompt and into Seedance
visual prompts. Keep them stable across runs — week-over-week consistency
depends on the same text appearing in every prompt.
"""
from __future__ import annotations


DOJO_ANCHOR_TEXT = (
    "The Torah Tai Chi dojo — a single rectangular teaching room, roughly 8 "
    "meters deep (south to north) by 5 meters wide (east to west), with a 3-"
    "meter ceiling. One floor, no windows, no interior partitions or dividers. "
    "No adjacent rooms or hallways visible from inside. "
    "FLOOR: Warm cedar planks (cedar of Lebanon) running north-to-south. "
    "WALLS: The south wall (where the viewer enters) has a SINGLE centered "
    "lattice-screen doorway in warm cedar framing with pale rice-paper panels. "
    "The other three walls — NORTH, EAST, WEST — are all solid pale linen from "
    "floor to ceiling, with NO doors, NO lattice screens, NO windows, NO "
    "partitions, NO openings of any kind. Just flat continuous pale linen "
    "surfaces. "
    "NORTH wall (opposite the south doorway): a single cedar Star of David "
    "plaque, approximately two feet across, mounted centered on the linen at "
    "standing-eye height. Darker cedar than the floor, clearly a discrete "
    "wooden object on the pale linen — not carved into it. "
    "EAST wall (to the viewer's right when entering from the south): "
    "The east wall is divided into two display zones. "
    "SOUTHERN HALF (the half CLOSER to the south doorway, so the first "
    "thing visible when looking at the east wall from inside the room): a "
    "tall brass seven-branched menorah standing on a simple wooden shelf "
    "at chest height. The menorah is the FIRST item you see on the east "
    "wall as you look toward the right from the doorway. "
    "NORTHERN HALF (the half FURTHER from the doorway, closer to the north "
    "wall's Star of David): seven authentic Chinese tai chi weapons, each "
    "MOUNTED INDIVIDUALLY ON THE PALE LINEN WALL — NO rack frame, NO "
    "free-standing stand, NO ladder structure, NO vertical wooden posts. "
    "Each weapon has its own small discreet cedar wall bracket / peg "
    "holding it against the linen. The weapons arrange vertically down "
    "the wall in a clean column, spaced evenly: "
    "(1) a tai chi jian (straight single-edge sword with red silk tassel) "
    "at the top, mounted vertically; (2) a second tai chi jian in lighter-"
    "wood practice finish, mounted vertically beside the first; "
    "(3) a tai chi dao (curved broadsword with a white and red silk scarf "
    "tied near the handle) vertical, upper-middle; (4) a Chinese spear / "
    "qiang (long wooden shaft with a small spearhead and a red silk "
    "tassel at the tip) vertical in the middle; (5) a bo staff / gun "
    "(long smooth polished wooden stick) vertical, lower-middle; (6) a "
    "folded tai chi fan (black fabric with red trim) on a small peg "
    "lower-right; (7) a second folded tai chi fan (white fabric with gold "
    "trim) on a matching peg beside it. These seven items, all authentic "
    "Chinese tai chi weapons — no Japanese or Okinawan weapons, no "
    "structural wooden rack frame or posts. Just the weapons on the wall. "
    "Nothing else on this wall beyond the menorah (south half) and the "
    "wall-mounted tai chi weapons (north half). "
    "WEST wall (to the viewer's left when entering from the south): the Torah "
    "Tai Chi logo wall display, centered at standing-eye height. The display "
    "has three separate cedar pieces mounted directly on the pale linen: "
    "(1) a round cedar disc carved with a yin-yang spiral in shallow relief, "
    "with a small Star of David inset inside one of the yin-yang lobes; "
    "(2) standalone cedar letter-shapes spelling 'TORAH' arced above the disc; "
    "(3) standalone cedar letter-shapes spelling 'TAI CHI' in a straight line "
    "below the disc. Same layout as the logo on Rav Eli's chest, just larger. "
    "Nothing else on this wall. "
    "CENTER of the room, on the cedar floor: a low olive-wood table with a "
    "small ceramic teacup and a wooden bowl of pomegranates on top. A single "
    "woven wool runner with subtle indigo stripes runs north-to-south on the "
    "floor, from the south doorway toward the north-wall Star of David, "
    "passing under the low table. "
    "LIGHTING: Soft morning light enters only through the south lattice "
    "doorway, casting warm angled light across the interior. The three solid "
    "walls have no other light sources. "
    "The room is empty of all other people and has no other furniture, "
    "decorations, or objects."
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
    "mid-50s Jewish man, salt-and-pepper hair and trimmed beard, wearing a "
    "navy blue knitted kippah sruga with a subtle cream-colored decorative "
    "band around the outer rim (visible crocheted yarn texture, sits flat on "
    "the crown of his head), navy blue mandarin-collar athletic shirt with "
    "Torah Tai Chi yin-yang logo on chest. Soft 3D render, warm cinematic "
    "lighting. Character identity must match references exactly. "
    "Voice timbre: warm and weathered, an experienced elder teacher in his "
    "late 50s, calm authority not booming. "
    # Speech cadence: the previous version was "measured and contemplative,
    # never rushed, each phrase lands then a small breath then the next" —
    # which produced exactly the monotone meditation-tape voice Yonah's
    # audience complained about. Replaced with brisker, varied delivery
    # guidance. The per-clip emotive_note (added 2026-05-11) layers on
    # top of this baseline for per-beat tone shifts.
    "SPEECH CADENCE: brisk and engaging — a confident teacher mid-class, "
    "not a meditation guide. Natural rise and fall in pitch, energy in "
    "the voice, varying pace within a phrase (slowing on the weighty word, "
    "moving through the connectives). Keep it warm and human, never flat "
    "or sing-songy. Pauses only where punctuation demands them; otherwise "
    "the line flows. This is a teacher who's excited about what they're "
    "teaching."
)


GUARDRAILS_TEXT = """\
FORBIDDEN (Seedance fails on these):
- In-frame rendered text of any kind: letters, words, numbers, signs, scrolls
  with readable text, screens with content. Exception: the Torah Tai Chi logo
  carved on the dojo wall and on Rav Eli's shirt — those render cleanly
  because they are locked by reference images.
- Intricate repeating patterns expected to stay sharp in motion.
- Multiple speaking characters in a shot (multi-person lip-sync fails).
- Held objects with intricate mechanisms (labeled bottles, complex tools).
- Prescriptive named tai chi forms ("push hands", "rooting posture",
  "white crane", etc.) — they render awkward and fake. Use naturalistic
  action instead.
- Wide-to-close dolly moves or long-to-close zooms — character physics
  drifts across the zoom (stands then kneels, etc.).
- Compound camera directions ("push in while panning") — one motion only.
- "Slow orbit" when Rav Eli's face is the focus; face geometry breaks as
  the camera rotates. OK for landscape or full-body-small shots.

PERMITTED (reliable):
- Single-character close-ups speaking, including micro-expressions
  ("eyes close gently", "slight smile, lips together", "brow softens").
- Silent background presence (a child watching from a distance, two
  figures walking far behind) — they must not speak.
- Simple held objects with smooth shapes (teacup, smooth stone, walking
  stick, folded cloth).
- Naturalistic action: walking, gesturing, observing, breathing visibly,
  sitting or rising, hand on heart, tracing slow shapes in the air.

CAMERA — one verb per clip from this list only:
"static medium shot", "slow push in", "slight pull back", "pan left",
"pan right", "tilt up", "tilt down", "slow orbit", "lateral tracking shot".

REQUIRED in every visual_prompt:
- Either a clear subject action OR a clear environmental motion (wind in
  grass, water flowing). Never a fully static shot.
- A lighting cue ("golden hour", "soft morning light", "dappled afternoon",
  "low warm sunlight").
- Clip 0 opens close or medium-close (head-and-shoulders to waist-up). Never
  a wide establishing shot at clip 0 — the first 0.5s of social video decides
  retention.
"""
