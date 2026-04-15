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
    "viewer enters. The NORTH wall (opposite the door) holds a single darker-"
    "cedar Star of David plaque, approximately two feet across, mounted "
    "directly on the pale linen wall — the warm cedar wood clearly contrasts "
    "against the cool pale-cream linen background, making the six-pointed "
    "star read as a discrete wooden object ON the wall, not carved into it. "
    "Same cedar wood and carving style as the logo wall on the opposite side. "
    "The EAST wall (to the viewer's right when entering) holds a tall brass "
    "seven-branched menorah standing on a wooden shelf at chest height. "
    "The WEST wall (to the viewer's left "
    "when entering) holds the large wooden Torah Tai Chi logo wall display. "
    "The display is composed of three separate wooden pieces mounted on the "
    "pale linen wall: (1) a round cedar disc in the center carved with a "
    "yin-yang spiral in shallow relief, with a small Star of David (magen "
    "david) set as the inset mark inside one of the yin-yang lobes; (2) "
    "standalone cedar letter-shapes spelling 'TORAH' mounted in a gentle "
    "upward arc along the top curve of the disc; (3) standalone cedar "
    "letter-shapes spelling 'TAI CHI' mounted in a straight horizontal line "
    "below the disc. Each letter is its own individual wooden piece, mounted "
    "directly on the wall. The overall composition mirrors the yin-yang-and-"
    "text logo on Rav Eli's chest — same 'TORAH' curved on top, 'TAI CHI' "
    "straight below — so the dojo wall and his shirt share the same brand "
    "mark at different scales. "
    "In the center of the room: a low olive-wood table with a small ceramic "
    "teacup and a wooden bowl of pomegranates on top. A woven wool runner "
    "with subtle indigo stripes runs along the floor from south doorway "
    "toward the north wall. Soft morning light filters through the wooden "
    "lattice screens. The room is empty of all other people."
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
    "late 50s, calm authority not booming. "
    "SPEECH CADENCE: measured and contemplative, with natural pauses between "
    "phrases like a meditation teacher in mid-thought. Never rushed. Each "
    "phrase lands, then a small breath, then the next. This is wisdom being "
    "shared, not information being delivered."
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
- Prescriptive named tai chi forms — "push hands", "rooting posture",
  "white crane spreads wings", "grasping the bird's tail", "cloud hands",
  etc. The model CANNOT render specific martial-arts forms convincingly;
  they come out awkward and obviously fake. Tai chi sensibility comes
  through pace and presence, not named forms.
- Large camera moves that force the character to appear at multiple
  distances in a single shot — "wide-to-close dolly in" or "zoom from
  long shot to close-up". The character's pose and scale drift across
  the zoom, breaking physics (e.g., appears kneeling at distance, then
  standing when close). Keep framing within one size class per shot.
- Compound camera directions in a single clip — "push in while panning
  right", "tilt up and orbit". One motion verb per clip, always. Combining
  verbs produces chaotic, unstable motion.
- "Slow orbit" when Rav Eli's face is the focus of the shot. Orbiting
  stylized 3D faces breaks the geometry as it rotates (facial features
  interpolate incorrectly). Slow orbit is permitted ONLY for landscape
  or environmental clips where Rav Eli is small in the frame or absent.

PERMITTED (the model is reliable here — use freely):
- Single-character close-ups with speaking. Lean into these for emotional beats.
- Background characters who do NOT speak, used as silent narrative presence
  (a child watching from a distance, two figures walking far behind).
- Simple held objects with smooth shapes (teacup, smooth river stone, walking
  stick, folded cloth).
- Naturalistic movement: walking along a path, gesturing while speaking,
  observing surroundings, breathing visibly, sitting or rising slowly,
  hand on heart, tracing a slow shape in the air, picking up or setting
  down a simple object. Prefer these over prescriptive forms.
- Micro-expression cues on the face: "eyes close gently", "slight smile,
  lips together", "brow softens", "eyes open on a long exhale". These
  render reliably and reinforce the meditation-teacher register.

REQUIRED in every visual_prompt:
- Exactly one camera direction phrase from this list: "static medium shot",
  "slow push in", "slight pull back", "pan left", "pan right", "tilt up",
  "tilt down", "slow orbit", "lateral tracking shot". Large-range camera
  moves are forbidden above; these smaller-range moves are safe.
- Either a clear naturalistic subject action (Rav Eli is walking, gesturing,
  observing, breathing) OR a clear environmental motion (wind through grass,
  water flowing). Never a fully static shot.
- A lighting cue ("golden hour", "soft morning light", "dappled afternoon",
  "low warm sunlight", etc.).
- For CLIP 0 ONLY: opening framing MUST be close or medium-close (head and
  shoulders to waist-up). Never open with a wide establishing shot. Social
  video retention depends on the first 0.5s showing the character up-close.

HEBREW PRONUNCIATION:
- The voiceover TTS reads Hebrew words with an English-speaker accent unless
  you write them phonetically. For ANY Hebrew name, term, book of Torah, or
  Jewish concept in the voiceover field, replace the standard English
  transliteration with an English-phonetic breakdown using hyphens and
  CAPITAL letters to mark the stressed syllable. Examples:
    Vayikra → "Vah-yeek-RAH"
    Bereishit → "Beh-ray-SHEET"
    Baal HaTurim → "BAH-ahl hah-too-REEM"
    korbanot → "kor-bah-NOTE"
    karov → "kah-ROV"
    Moshe → "MOH-sheh" (not "Moses" — keep the Hebrew name)
    Torah → "TOH-rah"
    parsha → "PAR-shah"
    Shabbat → "shah-BAHT"
    mishkan → "meesh-KAHN"
  Put the phonetic spelling directly in the voiceover field — do NOT include
  the standard spelling alongside it. The goal is that the TTS reads the
  phonetic form and produces the correct pronunciation.
"""
