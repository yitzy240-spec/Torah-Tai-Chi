# Torah Tai Chi — Seedance Direction Guide

> **How this guide is used:** `src/script_generator.py` reads this file and prepends
> its full text to the Claude system prompt before every call to
> `transform_draft_to_clip_plan()`. This document is therefore Claude's reference
> manual — not background reading, but active operating instructions. Write ClipPlans
> as though every section below is loaded into working memory.
>
> This guide COMPLEMENTS the rules already hard-coded in `src/settings.py` and
> `src/script_generator.py`. It does not repeat them. It adds DEPTH where the
> existing rules give BREADTH. The existing `SYSTEM_TEMPLATE` rules (word-density
> math, pause markers, phonetic Hebrew, temporal marker syntax, visual_prompt
> component order, guardrails) remain authoritative. When this guide and the
> SYSTEM_TEMPLATE differ, the SYSTEM_TEMPLATE wins.

---

## Table of Contents

1. [Seedance 2.0 Cinematic Craft — Deep Reference](#1-seedance-20-cinematic-craft--deep-reference)
   - 1.1 How Seedance reads a prompt
   - 1.2 Vocabulary glossary — camera moves
   - 1.3 Vocabulary glossary — shot types and framing
   - 1.4 Vocabulary glossary — lighting cues
   - 1.5 Vocabulary glossary — mood, atmosphere, and lens terms
   - 1.6 Motion physics and naturalistic action cues
   - 1.7 Style lock phrases and quality suffixes
2. [Character Consistency Mastery](#2-character-consistency-mastery)
   - 2.1 Why AI characters drift and how to fight it
   - 2.2 Reference image strategy
   - 2.3 The character identity sentence (front-loaded lock)
   - 2.4 Positive constraint language vs. negative prompts
   - 2.5 Week-to-week consistency for a running show
3. [Audio Direction](#3-audio-direction)
   - 3.1 How Seedance TTS works
   - 3.2 Voice timbre cues
   - 3.3 Pacing and word density (extended)
   - 3.4 Silence, pause, and breath handling
   - 3.5 Speech-action-speech rhythm for instructional moments
   - 3.6 The camera-cover technique for silent beats
4. [Scene Continuity Across Clips](#4-scene-continuity-across-clips)
   - 4.1 What makes a crossfade read as smooth vs. jarring
   - 4.2 Within-block compositional matching
   - 4.3 Lighting temperature continuity
   - 4.4 Camera direction continuity (no whiplash cuts)
   - 4.5 Block-to-block transition (dojo → outdoor)
5. [Brand-Anchored Generation](#5-brand-anchored-generation)
   - 5.1 The locked-description principle
   - 5.2 Reference image budgeting and ordering
   - 5.3 Environmental motion cues for outdoor clips
   - 5.4 Dojo positioning discipline
6. [Torah Tai Chi Direction Language](#6-torah-tai-chi-direction-language)
   - 6.1 The brand register in prompt terms
   - 6.2 Contemplative camera vocabulary
   - 6.3 Dojo shot compositions that read as branded
   - 6.4 Outdoor shot compositions that read as sage wisdom
   - 6.5 Voiceover rhythm examples
7. [Worked Examples](#7-worked-examples)
   - 7.1 Example A — Parashat Bereishit: "In the beginning, a breath"
   - 7.2 Example B — Parashat Yitro: "The voice from the mountain"
   - 7.3 Example C — Parashat Vayikra: "The smallest letter" (embodied exercise)
   - 7.4 Example D — Parashat Noach: "After the flood, presence"
   - 7.5 Example E — Parashat Lech Lecha: "The walk that changed everything"
8. [Quick-Reference Checklists](#8-quick-reference-checklists)
9. [Sources](#9-sources)

---

## 1. Seedance 2.0 Cinematic Craft — Deep Reference

### 1.1 How Seedance Reads a Prompt

Seedance 2.0 is a text-to-video model with strong temporal instruction-following.
Key architectural behaviors that shape how you write:

**Front-loading is critical.** The model weights the first 25–30 words of a prompt
most heavily. This is why the character identity sentence must appear as the very
first clause of every visual_prompt — not after the setting description. If the
subject definition is buried, the model may not honor it consistently.

**One strong instruction beats six weak ones.** A prompt with five competing camera
verbs produces chaos. A single, well-chosen camera instruction with clear subject
and action produces clean, controllable output. When in doubt, remove a detail
rather than add one.

**Temporal markers are SSML-equivalent for video.** Seedance natively interprets
second-range markers (e.g., `0-3s: X. 3-7s: Y.`) as timing instructions, not
descriptive language. Actions placed at specific timestamps land at those timestamps.
This is the primary mechanism for speech-action-speech rhythm in instructional clips
and for pacing voiceover against visual beats. Use these in every clip ≥8 seconds.

**Prompt length sweet spot: 60–120 words for a single clip.** Too short (under 30
words) leaves the model under-constrained; too long (over 200 words) dilutes
attention and the model begins ignoring lower-priority clauses. The visual_prompt
plus character identity sentence plus setting anchor plus temporal markers should
typically land in the 80–130 word range for Torah Tai Chi clips.

**Chronological action ordering.** List actions in the order they should occur.
Seedance interprets temporal sequence naturally when you write it forward. Do not
describe the final beat first and then the opening beat — the model may render
them out of order.

**The 9:16 aspect ratio shapes composition.** Vertical framing in Seedance favors
portrait-oriented framing and vertical movement (tilt up/down, slow push in toward
a face). Wide horizontal pans feel unnatural and produce more artifacts in 9:16.
Lean into the vertical: medium-close talking-head framing, tilt-down to hands or
feet, slow push in on a face. These are Seedance's strengths in portrait mode.

---

### 1.2 Vocabulary Glossary — Camera Moves

Use exactly one of these per clip. These are Seedance's verified movement types
with their Torah Tai Chi application notes:

| Move | Description | Torah Tai Chi Use |
|------|-------------|-------------------|
| `static medium shot` | Locked-off camera, no movement. Emphasizes action over camera. | Closing embodiment beats; CTA clips where stillness reads as presence |
| `slow push in` | Camera moves physically toward the subject. Most intimate, most cinematic for close work. | Hook clip (Clip 0) to open on a face and draw the viewer in; emotional peaks |
| `slight pull back` | Camera retreats slowly. Creates sense of opening space, revelation. | Transition from tight teaching to wider wisdom; end of a thought |
| `pan left` / `pan right` | Rotational lateral movement. Keep slow — fast pans cause motion blur in 9:16. | Revealing an environment alongside Rav Eli; outdoor clips showing landscape extending beyond frame |
| `tilt up` | Camera pivots upward. Upward motion reads as aspiration, revelation. | Outdoor clips at mountain ridge or hilltop; ascending spiritual moments |
| `tilt down` | Camera pivots downward. Grounding, earthward. | Camera cover during silent embodiment (hands, feet); grounding teachings |
| `lateral tracking shot` | Camera moves parallel to the subject as they move. | Walking outdoors clips; tracking Rav Eli along a path |
| `slow orbit` | Camera rotates around the subject. **Use ONLY for landscape/environmental clips where Rav Eli is small in frame or absent. Never when his face is the primary focus — orbiting a stylized 3D face breaks geometry.** | Wide landscape establishing when Rav Eli is a small figure; slow rotation around the olive-wood table with no character close-up |

**Speed modifiers:** Pair motion verbs with `slow` or `gentle` for Torah Tai Chi.
The brand register is contemplative — `slow push in` reads as sage, `fast push in`
reads as thriller. When in doubt, add `slow` or `gentle` before any movement verb.

**Compound moves are forbidden.** "Slow push in while panning right" produces
chaotic, unstable footage. Write one verb. If you need two movements across a
10s clip, use temporal markers to sequence them: `0-5s: static medium shot. 5-10s: slow push in.`
This is cleaner than a compound instruction.

---

### 1.3 Vocabulary Glossary — Shot Types and Framing

| Term | Framing | Torah Tai Chi Application |
|------|---------|--------------------------|
| Extreme close-up (ECU) | Eyes, mouth, hands only | Micro-expression beats; holding a smooth stone or teacup |
| Close-up (CU) | Head and upper shoulders | Strong emotional or teaching beats; clip 0 hook |
| Medium-close (MCU) | Head to mid-chest | Default dojo teaching framing; shows face + logo on shirt |
| Medium shot (MS) | Waist-up | Standard teaching stance; shows posture without being wide |
| Medium-wide (MWS) | Knees-up | Showing fuller body gesture; walking near the olive-wood table |
| Wide shot (WS) | Full body + significant environment | Outdoor establishing beat; use only mid-clip, not as clip opener |
| Extreme wide (EWS) | Subject is small in frame | Landscape reveals; Rav Eli as a figure in the mountain or meadow |

**Clip 0 rule:** Always open at CU or MCU. Social video retention depends on
recognizing a human face in the first 0.5 seconds. Never open with WS or EWS.

**Framing consistency within a block:** Clips 0→1 and clips 2→3 must end and
begin at compatible framing sizes (see Section 4). Do not end Clip 0 at ECU and
begin Clip 1 at WS — this is a compositional whiplash cut.

---

### 1.4 Vocabulary Glossary — Lighting Cues

Lighting has the single highest impact-per-word ratio in Seedance prompts.
One precise lighting descriptor outperforms three generic style adjectives.
Carry the lighting cue established in the setting anchor through every clip in
that block — contradictory lighting between clips in the same setting makes them
read as discontinuous.

| Term | Feel | Use In |
|------|------|--------|
| `soft morning light` | Warm, diffused, gentle; the dojo's established light | Dojo clips (locked in DOJO_ANCHOR_TEXT) |
| `golden hour` | Warm, low-angle, long shadows; aspirational | Mountain ridge, hilltop meadow, desert outcrop clips |
| `dappled afternoon light` | Filtered through leaves; intimate, sheltered | Garden path, forest clearing, orchard clips |
| `soft midday sun` | Neutral, bright, clear; alive and present | Riverside grove, seashore clips |
| `late-afternoon shadows` | Long shadows, golden but cooling; contemplative weight | Desert outcrop; closing teachings |
| `dawn light` | Cool-warm transition; mist; new beginning | Hilltop meadow; threshold teachings |
| `rim light` | Light catching the edge of the subject; separates from background | Use sparingly to enhance depth in medium shots |
| `warm cinematic lighting` | General warm-toned filmic feel | Default quality suffix; always append to STYLE_LOCK |

**Do not contradict the anchor.** If the setting anchor says "soft morning light
filters through the wooden lattice screens," do not write "dramatic blue-toned
twilight" in the clip's visual_prompt. Match the anchor's established light.

**Temperature drift causes identity drift.** Dramatic color temperature shifts
between clips (warm dojo → cool-blue outdoor) force the model to reconstruct
the character's face under different light, producing perceptible identity
variation. The Torah Tai Chi palette is warm-to-neutral. Keep all clips in the
warm-golden range unless the archetype explicitly uses cooler tones (SEASHORE
at dawn, DESERT_OUTCROP at dusk edge).

---

### 1.5 Vocabulary Glossary — Mood, Atmosphere, and Lens Terms

These modifiers steer the emotional register of a clip. Use 1–2 per clip max —
stacking too many produces a muddled aesthetic signal.

**Mood cues (append to style/atmosphere section of visual_prompt):**

| Term | Register |
|------|----------|
| `contemplative` | Inward, reflective, still |
| `serene` | Peaceful, unhurried, spacious |
| `grounded` | Earthward, present, embodied |
| `warm and intimate` | Close, human, personal |
| `meditative stillness` | No restlessness; every movement deliberate |
| `quietly reverent` | Spiritual without being overwrought |
| `sage-paced` | Every action carries weight; nothing rushed |

**Atmosphere terms:**

| Term | Visual Effect |
|------|---------------|
| `soft natural light` | Diffused, flattering, present |
| `warm shadows` | Shadows with amber/gold tones, not cold gray |
| `morning mist still lifting` | Soft depth cue for outdoor dawn scenes |
| `light filtering through` | Indicates a mediating surface (leaves, lattice, canopy) |
| `air feels still` | Implies very slow or absent wind — use for teaching moments |
| `gentle breeze through` | Use in outdoor clips to animate the environment |

**Lens terms (for quality suffix or style anchor):**

| Term | Effect |
|------|--------|
| `shallow depth of field` | Background softly blurred; subject isolated; close work reads as intimate |
| `soft 3D render` | Maintains Pixar-style material feel; prevents over-sharp plastic look |
| `warm cinematic lighting` | Global quality anchor for Torah Tai Chi's filmic register |
| `anamorphic lens` | Produces characteristic horizontal bokeh; more cinematic than spherical — use sparingly for emotional peaks |
| `35mm` | Film-stock reference; grounds the 3D animation in a filmic (not video-game) aesthetic |

**Avoid:** `4K ultra-sharp hyper-detailed cinematic IMAX`, etc. These quality-stacking
patterns work for live-action prompts but fight against the Pixar-3D stylization.
For Torah Tai Chi, `soft 3D render, warm cinematic lighting` is the correct
quality anchor, not a "maximum realism" stack.

---

### 1.6 Motion Physics and Naturalistic Action Cues

Seedance 2.0 renders physically plausible motion reliably when described in
concrete physical terms rather than abstract concepts. For Torah Tai Chi, this
means describing what the body does, not what the move is called.

**Reliable action vocabulary for Rav Eli:**

| Preferred (concrete, physical) | Avoid (abstract, named) |
|-------------------------------|------------------------|
| `slowly raises both hands to chest height, palms facing down` | `initiates ward-off posture` |
| `shifts weight from right foot to left, shoulders settle` | `performs rooting stance` |
| `hands move in a slow horizontal arc, like water parting` | `cloud hands` |
| `turns to face slightly to the left, pauses mid-turn` | `grasp the bird's tail` |
| `breathes in visibly, chest rises gently` | `centering breath` |
| `sets the teacup on the table with deliberate care` | `offering gesture` |
| `traces a slow circle in the air with one open hand` | `tai chi circle form` |
| `presses both palms forward slightly, then releases` | `push hands` |

**Micro-expression cues (highly reliable in Seedance):**
These render consistently and communicate the sage teacher register:
- `eyes close gently for a beat`
- `slight smile, lips together`
- `brow softens`
- `eyes open slowly on a long exhale`
- `a small nod, eyes steady`
- `looks down, then back to camera`

**Weight and texture cues for objects:**
- `turns the smooth river stone in his palm`
- `lifts the teacup slowly, cradling it in both hands`
- `sets the walking stick against his knee`
- `holds the folded cloth loosely at his side`

**Environmental motion (required in outdoor clips per SYSTEM_TEMPLATE rule):**
These prevent frozen-background artifacts and make the scene feel alive:
- `wind moves through the tall grass in slow waves`
- `light ripples on the water's surface`
- `a single leaf drifts down from the canopy`
- `soft clouds drift across the valley`
- `mist continues lifting off the meadow grass`
- `branches sway very gently in a high breeze`

---

### 1.7 Style Lock Phrases and Quality Suffixes

The `STYLE_LOCK` from `src/settings.py` is appended to every Seedance payload
by `video_generator.py` — do not include it in the visual_prompt itself. But
within the visual_prompt, you can reinforce specific style anchors that complement
it:

**Style reinforcement phrases (use at most one per clip):**
- `Pixar-quality 3D animation, warm cinematic look`
- `soft-rendered 3D character, warm fill light`
- `animated feature film lighting`

**Positive constraints closer (verbatim — already in SYSTEM_TEMPLATE rules, include in every visual_prompt):**
> `Character must match all uploaded reference images. Steady framing, single speaker only, face fully visible at all times.`

This positive constraint framing is more effective than negative prompts
("no face distortion", "no extra characters"). Seedance responds better to
explicit affirmations of what must remain stable than to prohibition lists.

---

## 2. Character Consistency Mastery

### 2.1 Why AI Characters Drift and How to Fight It

AI video models reconstruct characters from scratch on every generation. They do
not "remember" a character — they re-infer them from reference images and prompt
language each time. Drift is caused by:

1. **Prompt variation across clips.** If the character identity sentence uses
   slightly different wording between Clip 0 and Clip 3, the model builds a
   slightly different character each time. Use identical wording verbatim.

2. **Reference image swaps or inconsistency.** Uploading a different reference
   (even one that "looks similar") creates a new character anchor. Use the same
   ordered set of references every week, every clip.

3. **Dramatic lighting changes.** Color temperature shifts force the model to
   reconstruct the face under new light conditions. The face it builds under warm
   golden-hour light will differ slightly from one built under blue-cool dawn.
   Keep the Torah Tai Chi palette in the warm-neutral range throughout.

4. **Camera angle extremes.** Profile shots, back-of-head shots, extreme low
   angles looking up under the chin — these obscure the identifying features
   that the reference images established. The model has less face information
   to lock to. Prefer face-forward and 3/4 view.

5. **Session-to-session drift (week-to-week).** Even with identical references
   and identical prompt text, generation seeds vary. The goal is not pixel-perfect
   identity but perceptual continuity — viewers recognize Rav Eli as Rav Eli
   immediately. This requires stable references + stable character sentence +
   stable style anchor, run after run.

---

### 2.2 Reference Image Strategy

The pipeline currently supports up to 9 reference images per clip, distributed
between character refs and dojo refs depending on `setting_id`. See
`src/video_generator.py` for the exact budgeting logic. The principles:

**For dojo clips (Clips 0–1):**
- Up to 4 dojo refs + up to 5 character refs (MAX_DOJO_REFS = 4)
- Dojo refs anchor the setting; character refs anchor the person
- Dojo ref count was bumped from 3 to 4 after early runs showed setting drift

**For outdoor clips (Clips 2–3):**
- Up to 9 character refs; no setting refs (outdoor archetypes are text-locked)
- More character refs = more identity stability in outdoor scenes

**Reference image selection principles:**
- Use refs that show Rav Eli from multiple angles: front-facing, 3/4 view,
  and medium-shot (waist-up) to give the model a complete structural understanding
- Include at least one ref showing the chest logo clearly — this anchors the
  brand mark to the character and helps the shirt logo render consistently
- Never swap references mid-series. If a ref is retired, replace it only after
  generating a full "calibration" clip to verify the new ref doesn't shift identity
- Generate 3–5 variations of any tricky clip and curate the most identity-stable
  result, using that result's strong frames as new reference candidates

**The 3/4 angle is the highest-value single ref.** It carries the most structural
information about face and body proportions simultaneously. If you had to pick one
character ref, it would be a well-lit 3/4 view at MCU (medium-close) framing.

---

### 2.3 The Character Identity Sentence (Front-Loaded Lock)

Per the SYSTEM_TEMPLATE rules, the character identity sentence must be the very
first clause of every visual_prompt. The exact canonical form:

> `A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo.`

**Why this exact wording, in this order:**
- "Pixar-style 3D" locks the render style before any other signal reaches the model
- "mid-50s" anchors age, preventing the model from drifting younger or older
- "salt-and-pepper beard" is a distinctive, specific physical anchor
- "brown leather kippah" — the material (leather) and color (brown) are both in
  there because "kippah" alone doesn't specify
- "navy mandarin-collar shirt with Torah Tai Chi logo" locks the branded garment

Do not paraphrase this sentence. Do not add "and" between items or reorder them.
The model weights the first strong instruction; use it for the character lock.

---

### 2.4 Positive Constraint Language vs. Negative Prompts

Seedance responds better to explicit statements of what must remain stable
than to lists of prohibitions. Negative prompts ("no face distortion," "no
extra characters") are processed as things to consider and may be partially
ignored. Positive constraints are processed as requirements.

**Prefer positive form:**
- "Face fully visible at all times" — not "no hidden face"
- "Single speaker only, no other speaking characters" — not "no multi-person lip sync"
- "Character must match all uploaded reference images" — not "no identity drift"
- "Steady framing" — not "no camera shake"
- "Consistent character appearance throughout" — not "no drift"

The positive constraints closer at the end of every visual_prompt (`Character must
match all uploaded reference images. Steady framing, single speaker only, face
fully visible at all times.`) encodes this pattern. Keep it verbatim; do not add
negative prohibitions alongside it.

---

### 2.5 Week-to-Week Consistency for a Running Show

Torah Tai Chi is a recurring show. The same character in the same branded dojo
appears every week. The generation strategy is:

**Lock the invariants completely and vary only what changes:**

| What must never change | What changes week to week |
|-----------------------|--------------------------|
| Character identity sentence (verbatim) | Outdoor archetype (parsha-driven) |
| DOJO_ANCHOR_TEXT (verbatim) | Voiceover content |
| Reference image set (same files, same order) | Temporal marker specifics |
| STYLE_LOCK text (verbatim) | Subject actions (what Rav Eli is doing) |
| Positive constraints closer (verbatim) | Mood cue (1 per clip, parsha-appropriate) |
| Lighting cue within each archetype | Parsha-specific sensory detail (1-2 sentences for outdoor clips) |

**Session management:** When the pipeline re-runs for a new parsha, Claude
receives the same SYSTEM_TEMPLATE with the same DOJO_ANCHOR_TEXT and STYLE_LOCK.
This stability is the primary mechanism for week-to-week consistency. Do not
improvise new character descriptions. Trust the locked text.

**Calibration clips:** When character drift is observed across episodes, generate
a fresh calibration clip using the same base prompt as Clip 0 without any new
content — just the character identity sentence + dojo anchor + "Rav Eli stands
in the center of the room, looking at the camera, slight smile, static medium
shot." This gives a clean identity baseline to measure against.

---

## 3. Audio Direction

### 3.1 How Seedance TTS Works

Seedance 2.0 generates audio natively as part of the video generation process.
It produces voice, ambient sound, and background texture simultaneously with
the visual. For Torah Tai Chi:

- The voice is generated from the text in the `voiceover` field (passed as
  `Character speaks: "..."` in the prompt payload by `video_generator.py`)
- The timbre is steered by the `STYLE_LOCK` voice cues: "warm and weathered,
  an experienced elder teacher in his late 50s, calm authority not booming"
- The ambient sound is inferred from the setting description (the dojo's quiet
  with wood and ceramic textures; the outdoor archetypes' naturalistic sounds)
- The `generate_audio: true` flag enables this; it is the default

**Critical behavior:** Seedance fits the voiceover text INTO the clip duration.
This means longer voiceover = faster speech = rushed delivery. The word-density
math in SYSTEM_TEMPLATE (1.8 wps target, 2.0 wps cap) exists precisely because
of this. More words do not produce more time — they produce faster speech.

**Reference audio (@Audio1):** The pipeline has a slot for `reference_audio_urls`
in `video_generator.py` but it is currently unused in production (see
`2026-04-15-torah-tai-chi-direction-v2-design.md`, Section 3 Non-Goals).
When that feature is activated, a 3–8 second clean audio clip of a warm, measured
male voice at ~80% natural speaking pace would be the ideal reference.

---

### 3.2 Voice Timbre Cues

The STYLE_LOCK already encodes: "warm and weathered, an experienced elder teacher
in his late 50s, calm authority not booming." These additional timbre cues, if
included in the visual_prompt or voiceover context line, reinforce the register:

**Cues to use:**
- `measured, contemplative delivery`
- `sage-paced, each phrase landing before the next begins`
- `voice like someone who has said this many times and means it each time`
- `deliberate enunciation, never rushed`
- `low-energy warmth, not performative enthusiasm`

**Cues to avoid:**
- Anything implying excitement, urgency, or exhortation
- "authoritative" alone (implies booming or domineering)
- "energetic" or "animated" (inverts the register)
- "whispered" (loses the teaching authority)

**Emotion anchors that work:** "calm," "warm," "grounded," "contemplative,"
"gently reverent." These emotion tags influence how Seedance generates the
prosody — consonant closure, breathing pattern, mouth openness.

---

### 3.3 Pacing and Word Density (Extended)

The SYSTEM_TEMPLATE's word-density rules are reproduced here with additional
guidance on how to apply them:

**The formula:**
```
target ~1.8 wps for contemplative clips
cap at 2.0 wps for any clip
words = duration_s × wps_target
```

**Per-duration targets:**

| Clip duration | Target words (1.8 wps) | Maximum words (2.0 wps) |
|--------------|------------------------|------------------------|
| 8s | ~14 | 16 |
| 9s | ~16 | 18 |
| 10s | ~18 | 20 |
| 11s | ~20 | 22 |
| 12s | ~22 | 24 |
| 13s | ~23 | 26 |

**How to count:** Count every word in the voiceover field, including phonetic
Hebrew words (each hyphenated word like "Vah-yeek-RAH" counts as one word).
Ellipses and em-dashes do not count but are effective at adding felt pause space
without adding words.

**Where word density matters most:**
- Clip 3 (CTA/closing) should ALWAYS be at or below 1.8 wps. The viewer needs
  to breathe with the teaching before "Follow Torah Tai Chi" lands.
- Clip 0 (hook) can run up to 2.0 wps — hooks are slightly faster, more urgent.
- Clips with breathing/embodiment cues should be well under 1.8 wps, because
  part of the clip's duration is silent (camera off the face) and no words
  are delivered during that window.

**The silence budget:** For instructional clips using speech-action-speech rhythm,
the silent action window (e.g., 3–6s of visible exhale while camera tilts to
hands) produces zero words but uses 3 seconds of clip. Subtract that window
from the word-density calculation:
```
effective_speaking_duration = clip_duration - silent_window_s
effective_word_budget = effective_speaking_duration × 1.8
```
A 10s clip with a 4s silent window has an effective speaking budget of ~11 words.

---

### 3.4 Silence, Pause, and Breath Handling

**Pause marker reference (from SYSTEM_TEMPLATE, elaborated here):**

| Marker | Pause feel | Seedance behavior |
|--------|-----------|-------------------|
| `...` (ellipsis) | One full breath pause, ~0.4s | TTS slows and inserts audible breath-space |
| ` — ` (em-dash with spaces) | Shorter pause, emphasis setup | Slight micro-hesitation before the next phrase |
| `.` (period between short sentences) | Phrase-completion beat | Clean stop; each sentence lands separately |

**When to use each:**

- `...` after a question, or before delivering the answer: `"What does it mean to be called?... It means you were being waited for."`
- ` — ` before an unexpected reframe: `"This wasn't about sacrifice — it was about coming close."`
- `.` between teaching units: `"Stand still. Feel your feet. This is enough."`

**Critical tip on ellipsis placement:** Do not stack ellipses. One per clause
maximum. Over-ellipsed voiceover (e.g., `"The Torah... tells us... something...
important..."`) reads as hesitant rather than contemplative. The sage knows where
he is going; he pauses to let the listener catch up, not because he is uncertain.

**End-of-clip silence:** The SYSTEM_TEMPLATE rule requires instructional clips
to end with silence (the last 1–3 seconds are quiet embodiment). Signal this in
the visual_prompt with: `"silence holds final Xs"` or `"voiceover ends at roughly
Ns; remaining Ms is silent embodiment."` This cues Seedance to generate no speech
during that window. Clip 3 almost always benefits from this treatment.

---

### 3.5 Speech-Action-Speech Rhythm for Instructional Moments

When the script calls for Rav Eli to physically demonstrate something (breathe,
exhale, settle the shoulders, feel the weight), the correct structure for the
clip is:

```
STRUCTURE: speech → silent action → speech (or: speech → silent close)

TEMPORAL MARKERS:
  0-[N]s:  Rav Eli faces camera, speaks opening line.
  [N]-[M]s: camera [cover move — tilt down / pan away]; character performs silent action.
  [M]-[Z]s: camera returns / continues; character speaks closing line.
  [Z]-[clip_end]s: silence holds final beat (if Clip 3 or embodiment close).

VOICEOVER FIELD:
  Only the spoken lines — opening line. Closing line.
  The silent window has no voiceover text.
```

**Word density for this structure:** Use the "silence budget" formula from 3.3.
If a 10s clip has a 4s silent window, the voiceover budget is ~11 words.

**The camera cover must make physical sense.** The camera covers the silent beat
by moving AWAY from the face — down to hands, up to ceiling, across to the dojo
wall — not by cutting to a different subject. The camera returns naturally at
the end of the silent window for the closing speech. This reads as intentional
direction, not avoidance.

---

### 3.6 The Camera-Cover Technique for Silent Beats

This is the most important audio-visual technique in the Torah Tai Chi pipeline.
When Rav Eli is performing a silent physical action (exhaling, settling, holding
stillness), showing his face at that moment would reveal a closed mouth while
the viewer expects voice — creating a disturbing gap. The camera-cover technique
prevents this:

**Step 1:** Determine when in the clip the silence falls (using temporal markers).

**Step 2:** Choose a camera direction that naturally moves AWAY from the face:
- `tilt down to his hands` — shows hands performing the action, face out of frame
- `pan right to the dojo wall` — environmental beat; face leaves frame
- `pull back slowly to show posture` — still shows him, but from wider angle that
  contextualizes the silence as deliberate stillness
- `slow tilt up toward the lattice screens` — environmental, contemplative

**Step 3:** Write a camera direction that RETURNS to the face for the closing speech:
- `camera returns to medium-close on his face`
- `slow push in returns to close-up as he speaks`

**Step 4:** In the temporal markers, explicitly note the face-to-off-face-to-face arc.

**Example (10s instructional clip):**
```
visual_prompt:
  "0-3s: Rav Eli at medium-close, faces camera, speaks 'Exhale fully...'.
  3-7s: camera tilts DOWN to his hands, resting open on his thighs, as he
  exhales visibly, shoulders release, chest settles — silence, no speech.
  7-9s: camera tilts back UP to his face, he speaks 'Let yourself arrive.'
  9-10s: slight smile, lips together, silence holds final 1s."

voiceover:
  "Exhale fully... Let yourself arrive."
  [word count: 5 words — 2.5s at 2.0 wps — well within the 6s speaking window]
```

---

## 4. Scene Continuity Across Clips

### 4.1 What Makes a Crossfade Read as Smooth vs. Jarring

The pipeline stitches clips with a 0.5s xfade (see the direction spec). For a
crossfade to read as smooth, the exiting clip and the entering clip must be
compatible at the edit point. The primary factors:

**1. Framing size compatibility.** A crossfade between two clips at similar
framing reads as continuous movement. A crossfade between ECU and WS reads as
a jump — even with a 0.5s dissolve, the viewer's eye has to re-anchor completely.

**2. Subject position in frame.** If Rav Eli exits Clip 0 at frame-center and
Clip 1 begins with him frame-left, the dissolve shows a position jump mid-dissolve.
Keep his approximate screen position consistent at the edit point.

**3. Lighting temperature.** Crossfading between warm dojo light and cool outdoor
light reads as natural (intentional block change). Crossfading between two clips
in the same block with different temperatures reads as a generation artifact.

**4. Camera direction continuity.** A clip ending with camera moving left and the
next clip beginning with camera moving right creates visual whiplash even through
a dissolve. Prefer same-direction or static-to-motion at edit points.

**5. Character state.** If Rav Eli exits Clip 0 speaking (mouth open, mid-phrase)
and Clip 1 begins in silence (mouth closed), the crossfade shows a jarring mouth
transition. End clips at natural speech pauses — complete sentences, not mid-word.

---

### 4.2 Within-Block Compositional Matching

**Dojo block (Clips 0→1):**

The temporal markers in Clip 0 should plan for it to END at a compatible
composition for Clip 1 to BEGIN. Write Clip 0's closing beat and Clip 1's
opening beat as a matched pair.

| Clip 0 ends at... | Clip 1 should begin at... |
|------------------|--------------------------|
| MCU, slow push in reaching CU | CU or near-CU framing, same relative head position |
| MS, character gesturing right | MS, character settling (same scale) |
| Static MCU, teaching beat | Slight pull back to MS or static MCU |

**Outdoor block (Clips 2→3):**

| Clip 2 ends at... | Clip 3 should begin at... |
|------------------|--------------------------|
| Wide, Rav Eli small in landscape | Wide or medium-wide; do not jump to CU |
| Medium, facing 3/4 left | Medium, facing forward or completing the 3/4 turn |
| Tracking shot in motion | Begin stationary at similar scale |

**Block-to-block transition (Clips 1→2):**
This is the one intentional cut (dojo to outdoor). It is EXPECTED to be a
context change. A 0.5s crossfade softens it but does not need to be compositionally
matched the way within-block transitions do. However, exiting Clip 1 at a
quiet, settled moment (not mid-gesture, not mid-breath) gives the crossfade
a clean departure point.

---

### 4.3 Lighting Temperature Continuity

Already established in Section 1.4. Key rules for continuity specifically:

- Within a block, all clips must share the same lighting descriptor as the anchor
- Do not use "golden hour" for Clip 2 and "moonlight" for Clip 3 — they are
  in the same block and should feel like consecutive moments, not different days
- The dojo's "soft morning light" is locked by `DOJO_ANCHOR_TEXT`. Do not
  introduce additional lighting modifiers that contradict it (e.g., "dramatic
  spotlights", "single candle in darkness")

---

### 4.4 Camera Direction Continuity (No Whiplash Cuts)

Plan the four clips as a camera sequence, not as four independent shots:

**Suggested camera sequence patterns:**

```
Pattern 1 — Build inward, open outward:
  Clip 0: slow push in (drawing viewer in)
  Clip 1: static medium shot (settled teaching)
  Clip 2: slight pull back (opening to landscape)
  Clip 3: static medium shot or tilt up (closing presence)

Pattern 2 — Grounded throughout:
  Clip 0: static medium shot (immediate presence)
  Clip 1: slow push in (deepening into teaching)
  Clip 2: lateral tracking shot (walking in landscape)
  Clip 3: static medium shot (arrival, stillness)

Pattern 3 — Ascending:
  Clip 0: slow push in (hook, into face)
  Clip 1: slight pull back (broadening the teaching)
  Clip 2: pan right (landscape reveal)
  Clip 3: tilt up (aspiration, open sky)
```

Avoid: two consecutive clips with the same direction (push in → push in reads
repetitive); opposing movements between clips in the same block (tilt up →
tilt down reads like a correction, not intention).

---

### 4.5 Block-to-Block Transition (Dojo to Outdoor)

The one-cut between Block 1 and Block 2 is the biggest transition in the video.
Make it feel intentional:

- **End Clip 1 at a natural breath point.** The voiceover should complete a
  thought. The camera should be arriving at stillness, not mid-movement.
  `"silence holds final 1s"` at the end of Clip 1 gives the crossfade a
  clean base.

- **Begin Clip 2 with environmental motion.** Per the SYSTEM_TEMPLATE rule,
  outdoor clips must include an explicit environmental motion cue. This motion
  (wind through grass, light on water) signals the location change actively —
  the world is moving, we are somewhere new.

- **Begin Clip 2 at a wide-enough framing to re-establish.** Clip 2 can open
  wider than Clip 1 ended. Viewers expect a new location to need re-establishing.
  Opening Clip 2 at WS or MWS (showing Rav Eli in the landscape) is appropriate.
  The hook-framing rule (CU/MCU at clip 0) does not apply to Clip 2.

---

## 5. Brand-Anchored Generation

### 5.1 The Locked-Description Principle

Torah Tai Chi's visual brand depends on exact repetition of the same anchor
texts, week after week. This is the primary mechanism for week-to-week setting
consistency. The principle:

> **Never rewrite what is locked. Only add parsha-specific sensory detail.**

The `DOJO_ANCHOR_TEXT` and every `OUTDOOR_ARCHETYPES` entry in `src/settings.py`
are sacred. They appear verbatim in every visual_prompt. Changing even one word
of the dojo anchor (substituting "cedar" for "wood", rephrasing the layout)
generates a subtly different dojo every time.

**What "add 1-2 sentences of parsha-specific sensory detail" means in practice:**

For outdoor clips, the locked archetype anchor comes first (verbatim), then
1–2 sentences of parsha context. Examples:

- *Yitro at mountain ridge:* `...low pine scrub catching warm light. Thunder
  still rolls in the distance across the far peaks, echoes dying against stone.`
- *Bereishit at garden path:* `...dappled afternoon light through a fig tree.
  New leaves unfurl on the vines, each one a beginning.`
- *Noach at riverside:* `...soft midday sun glinting on water. The water is
  still; the flood a memory in the smoothness of the river stones.`

Note: the parsha detail does not change the setting — it contextualizes it.
It should always be sensory (what you see, hear, feel) not narrative (do not
retell the parsha's events in the setting description).

---

### 5.2 Reference Image Budgeting and Ordering

From `src/video_generator.py`:
- **Dojo clips:** `dojo_refs[:MAX_DOJO_REFS]` first, then `char_refs[:remaining]`
- **Outdoor clips:** `char_refs[:MAX_REFS]` (all 9 slots for character)

**Practical implication for Claude:** You do not control which refs are loaded.
The pipeline handles this mechanically. Your job is to write prompts that
complement the reference strategy:
- In dojo clips: the dojo setting refs anchor the room; your text anchor
  (DOJO_ANCHOR_TEXT verbatim) reinforces the room layout in text
- In outdoor clips: all 9 slots are character refs, so character identity
  is maximally supported; but there is no setting ref, so your text anchor
  for the outdoor archetype must do all the work

This is why outdoor archetype text anchors are more detailed than the dojo
anchor — the dojo has image support; the outdoors only has text.

---

### 5.3 Environmental Motion Cues for Outdoor Clips

Per the SYSTEM_TEMPLATE, every outdoor clip requires an explicit environmental
motion cue. This is not decorative — it prevents a frozen-background artifact
where the environment looks like a still image behind a moving character.

**Pattern:** Write the motion cue as its own sentence, immediately after the
archetype anchor and before the subject action:

> `[Archetype anchor verbatim]. [1-2 parsha detail sentences.] [Environmental motion sentence.] [Subject action.]`

**Environmental motion cue vocabulary by archetype:**

| Archetype | Motion cue |
|-----------|------------|
| MOUNTAIN_RIDGE | `a slow wind moves through the pine scrub below the ridge` |
| GARDEN_PATH | `flowering vines stir gently, petals drift from the stone wall` |
| RIVERSIDE_GROVE | `light moves in small ripples across the water's surface` |
| DESERT_OUTCROP | `heat haze shimmers faintly above the valley floor` |
| FOREST_CLEARING | `shafts of light shift slowly through the high canopy` |
| SEASHORE | `waves roll in gently and recede over the dark stones` |
| ORCHARD | `soft breeze moves through the orchard rows, tall grass bending` |
| HILLTOP_MEADOW | `morning mist continues lifting off the wildflower meadow` |

---

### 5.4 Dojo Positioning Discipline

Rav Eli's position in the dojo is not arbitrary. The layout is fixed
(see `DOJO_ANCHOR_TEXT` for the cardinal directions). Consistent positioning
produces consistent dojo shots:

**Standing position:** On the indigo wool runner between the south doorway
and the olive-wood table — runner serves as a visual spine, Rav Eli stands
on it facing north (toward camera). The table is in front of him (south-of-him,
between him and the camera) or beside him — never behind him.

**The table rule:** Rav Eli must NEVER be positioned at, leaning on, or
overlapping the olive-wood table. The table is a separate foreground or
midground object. Leaning against it makes it read as a prop he's using;
the table belongs to the room, not to him.

**Clip 0 positioning:** Start MCU or CU. Rav Eli is not yet moving to the
table or windows. He is facing the camera on the runner. The camera sees
him with the dojo visible around and behind him.

**Clip 1 positioning:** Can vary slightly — he may have shifted to gesture
toward the west wall (where the logo display is), or stepped slightly
toward the table. But he is still on the runner, still facing camera-forward.

**What to NOT describe:** Do not describe Rav Eli touching or lifting anything
from the olive-wood table unless it is specifically called for by the script
(e.g., the teaching involves the teacup). Unscripted table interaction
shifts the visual focus away from the teaching.

---

## 6. Torah Tai Chi Direction Language

### 6.1 The Brand Register in Prompt Terms

Torah Tai Chi occupies a specific aesthetic register. Translate the brand
feel into concrete prompt vocabulary:

| Brand quality | Prompt vocabulary |
|--------------|-------------------|
| Pixar-3D | `Pixar-style 3D`, `soft 3D render`, `animated feature film quality` |
| Jewish sage | `rabbi-teacher`, `mid-50s`, `salt-and-pepper`, `kippah`, deliberate and warm |
| Martial wisdom | naturalistic body movement, weight and balance cues, slow deliberate gesture |
| Meditative | `contemplative`, `sage-paced`, `meditative stillness`, `each phrase lands` |
| Warm | `warm cinematic lighting`, `warm fill light`, amber/golden palette |
| Wise | `slight smile, lips together`, `eyes steady`, `small nod`, `brow softens` |
| Grounded | `weight settled`, `stands rooted`, `feet planted on cedar floor` |

**What makes a clip feel "Torah Tai Chi":**
- Rav Eli is never rushed. Every movement has a settling-in beat before the next
- The camera's movement is slow — never snap-zooms, never fast pans
- The space (dojo or outdoor) feels earned, not incidental
- Sound texture: the dojo's quiet warmth; the outdoor archetype's naturalistic
  ambient (wind, water, leaves) — both are appropriate for meditation
- The teaching lands in the space between words, not in the words themselves

---

### 6.2 Contemplative Camera Vocabulary

For Torah Tai Chi, camera moves should feel like slow breathing:

**Preferred pairs:**
- Hook clip: `slow push in` — the camera breathes IN toward Rav Eli's face
- Teaching settle: `static medium shot` — camera holds, world quiets
- Application reveal: `slight pull back` or `pan right` — the wisdom opens outward
- Closing: `static medium shot` or `tilt up` — presence, space, or aspiration

**Timing for contemplative moves:**
- A `slow push in` on a 10s clip should be perceptible but gentle —
  describe it as "slow push in, approximately 1 foot over 10s" if you need
  to control the speed
- A `pan right` should always be preceded by `slow` — `slow pan right`
- A `tilt up` at the end of a clip should feel like a long exhale — describe
  it starting at mid-clip: `7-12s: slow tilt up toward the open sky above the ridge`

---

### 6.3 Dojo Shot Compositions That Read as Branded

Specific compositions that reinforce the brand:

**The Canonical Teaching Shot:**
MCU, Rav Eli on the runner, logo-shirt facing camera, soft morning light,
dojo walls visible in background (lattice screens south/east, wooden logo
display west, Star of David plaque north). `static medium shot` or `slow push in`.
This is the home position. Open every dojo block here.

**The Logo Reveal Shot:**
Pan right slowly to reveal the west wall Torah Tai Chi logo display, then
back to Rav Eli. Use for moments where the brand name or concept is introduced
in the voiceover. Rare — once per video maximum, only if the voiceover references
Torah Tai Chi by name.

**The Table Meditation Shot:**
Rav Eli standing near the olive-wood table (not at it), looking down at the
teacup, then back up at camera. MCU. Use for intimate, introspective teaching
moments. The pomegranates and teacup in frame add texture. Static or slight pull back.

**The Lattice Screen Shot:**
Rav Eli near the south doorway, soft morning light filtering through the wooden
lattice, casting gentle grid-shadows on him. MCU or MS. Use for teachings about
transparency, entering, or threshold moments.

---

### 6.4 Outdoor Shot Compositions That Read as Sage Wisdom

**The Teacher-in-Landscape Shot:**
Rav Eli is visible but not dominant — MWS or WS, the landscape extends around
him. He is a figure within the world, not standing apart from it. Use for
application clips where the teaching is moving from abstract to embodied.

**The Hand/Object Shot:**
ECU on Rav Eli's hands — holding a smooth river stone, lifting a handful of
earth, tracing a circle in the air above still water. No face visible. Use for
teaching moments that involve touch, texture, or physical sensation. Camera
tilts up to face for the spoken closing.

**The Walking-on-a-Path Shot:**
`lateral tracking shot` alongside Rav Eli walking along the path. He is at MS.
He does not look at the camera — he looks ahead. Use for "the walk," "the
journey," "each step" metaphors. Voice-over plays over his walking.

**The Horizon/Aspiration Shot:**
Wide, Rav Eli at the edge of a ridge or hilltop, facing away from camera or
3/4 away, looking at the valley. `slight pull back` or `static medium shot`.
Use for closure teachings: "this is the practice," "this is what Torah asks."

---

### 6.5 Voiceover Rhythm Examples

These examples show the sage-paced rhythm in practice. All counts include pause
markers as natural pauses, not extra words.

**Hook rhythm (Clip 0, 8s, ~14 words target):**
> "The smallest letter in the whole Torah... is a silence. And God speaks from it."

*Count: 15 words. 1.9 wps on 8s. Good. Strong contrast (smallest → silence), question implied but not asked, mystery in the last line.*

**Teaching rhythm (Clip 1, 10s, ~18 words target):**
> "Vah-yeek-RAH — God called. Not commanded. Not appeared to. Called. That one word holds everything about how Torah sees the relationship."

*Count: 20 words. 2.0 wps on 10s. At cap. Trim "That one word holds everything about" → "And that call..." to pull back to 1.8 wps.*

Better version:
> "Vah-yeek-RAH — God called. Not commanded. Called. There is a tenderness hidden in the grammar."

*Count: 13 words. 1.3 wps on 10s. This is even better — more sage-like. Less is more.*

**Application rhythm (Clip 2, 11s, ~20 words target):**
> "In your practice today... notice the moments you are calling out — to your body. To your breath. And notice what calls back."

*Count: 21 words. 1.9 wps on 11s. Good. Three short imperative phrases ("notice...notice...notice") give it forward motion without rushing.*

**Closing/embodiment rhythm (Clip 3, 10s, with 3s silence window, ~11 words speaking budget):**
> "Exhale fully. Let yourself take up exactly this much space... no more."

*Count: 12 words. 2.0 wps on 6s speaking window (10s clip − 4s silent embodiment). Just at cap. Acceptable for a charged closing. The final 4s is silent embodiment.*

---

## 7. Worked Examples

These examples show a full dvar-torah draft → ClipPlan transformation.
Each demonstrates all components in context. Voiceover word counts are noted.
Visual prompts are abbreviated where the character identity sentence and
setting anchor are already established — in actual output, include them in full.

---

### 7.1 Example A — Parashat Bereishit: "In the beginning, a breath"

**Draft (dvar torah input):**
> The Torah begins not with a commandment but with a breath. "In the beginning God created" — the Rabbis asked: why does the Torah start here? Rashi answers: to teach us that the whole earth belongs to God. But Baal HaTurim notices something else — the very first letter, the beit of Bereishit, is an open letter, open to the future. In tai chi, we call this the opening posture: arms wide, ready, before anything is done. This is how Torah asks us to enter the world — open. Try it with me now: open your arms, open your breath. Follow Torah Tai Chi for more.

**Outdoor archetype choice:** `GARDEN_PATH` — "beginnings, growth, intimacy"

**Voiceover adaptation strategy:**
- Hook: the breath image, strongest sensory opening
- Teaching: Baal HaTurim's "open letter" — the key insight, phonetic Hebrew
- Application: embodied — "open your arms, open your breath" (instructional clip)
- CTA: short, with silent arrival

---

**ClipPlan:**

```json
{
  "parsha": "Bereishit",
  "hook": "The Torah begins not with a commandment but with a breath.",
  "outdoor_archetype_id": "GARDEN_PATH",
  "clips": [
    {
      "index": 0,
      "duration_s": 8,
      "setting_id": "DOJO",
      "voiceover": "The whole Torah... begins with a breath. With opening.",
      "visual_prompt": "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo. [DOJO_ANCHOR_TEXT verbatim]. 0-2s: Rav Eli at medium-close, faces camera, eyes open and steady. 2-6s: slow push in toward his face as he speaks, eyes alive, slight wonder in his expression. 6-8s: slight smile, lips together, silence holds final 2s. Soft morning light. Slow push in. Character must match all uploaded reference images. Steady framing, single speaker only, face fully visible at all times."
    },
    {
      "index": 1,
      "duration_s": 10,
      "setting_id": "DOJO",
      "voiceover": "The BAH-ahl hah-too-REEM noticed: the very first letter of Torah — beit — is open on one side. Open to what comes next.",
      "visual_prompt": "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo. [DOJO_ANCHOR_TEXT verbatim]. 0-3s: medium-close, same position as clip 0 close, teaching stillness. 3-8s: static medium shot, Rav Eli gestures slowly, both hands open and rising at chest height — a natural opening gesture, not a named form. 8-10s: hands settle, slight nod, voice trails into quiet. Soft morning light. Static medium shot. Character must match all uploaded reference images. Steady framing, single speaker only, face fully visible at all times."
    },
    {
      "index": 2,
      "duration_s": 11,
      "setting_id": "GARDEN_PATH",
      "voiceover": "New leaves unfurl on the vines. Each one... a beginning. This is how Torah asks us to enter the world — open.",
      "visual_prompt": "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo. Walled stone garden with flowering vines along the wall, a worn stone bench off the path, dappled afternoon light through a fig tree. New leaves unfurl on the climbing vines along the wall. A flowering vine stirs gently in a soft breeze, single petals drift to the stone path. 0-4s: Rav Eli at medium-wide on the garden path, facing slightly left, pauses walking, looks at a vine. 4-9s: slow pan right along the vine, Rav Eli small at left edge, speaking to the space. 9-11s: camera returns to medium shot on Rav Eli, slight pull back settling. Dappled afternoon light. Pan right. Character must match all uploaded reference images. Steady framing, single speaker only, face fully visible at all times."
    },
    {
      "index": 3,
      "duration_s": 10,
      "setting_id": "GARDEN_PATH",
      "voiceover": "Try it with me now. Open your arms... open your breath.",
      "visual_prompt": "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather kippah, navy mandarin-collar shirt with Torah Tai Chi logo. Walled stone garden with flowering vines along the wall, a worn stone bench off the path, dappled afternoon light through a fig tree. A gentle breeze moves through the garden, vines sway lightly. 0-3s: Rav Eli at medium shot, faces camera, speaks 'Try it with me now. Open your arms...'. 3-7s: camera tilts down toward his arms as he slowly raises them to shoulder height, palms open — no speech, camera off face. 7-9s: camera tilts back up to his face as he exhales, speaks 'open your breath.' 9-10s: arms settle, slight smile, silence holds final 1s. Voiceover ends at roughly 9s; final 1s is silent arrival. Dappled afternoon light. Tilt down. Character must match all uploaded reference images. Steady framing, single speaker only, face fully visible at all times."
    }
  ]
}
```

**Why each choice:**
- *Clip 0:* 2s silence after push-in lets the "breath/opening" image land. 8 words, 1.0 wps — very sage-paced. The slow push in is the camera breathing in.
- *Clip 1:* The phonetic "BAH-ahl hah-too-REEM" is critical — "Baal HaTurim" pronounced as English would sound like "bal ha-TOOR-im" with no meaning. 19 words on 10s = 1.9 wps, just under cap.
- *Clip 2:* The environmental motion (vine stirring, petals drifting) prevents frozen-background artifact. The pan right away from his face is intentional — lets the garden be present.
- *Clip 3:* Instructional clip using speech-action-speech rhythm. Camera covers silent arm-raise with tilt down. Word count: 9 words. Silent window: 4s. Speaking window: 6s. WPS: 9/6 = 1.5 — sage pace.

---

### 7.2 Example B — Parashat Yitro: "The voice from the mountain"

**Draft:**
> At Sinai, the Torah says, all of Israel heard the voice of God — kol hamedaber, the voice that speaks. But Rashi notes something strange: the voice was silent after God spoke. There was a silence after revelation. In tai chi, this is the settling posture — after movement, the body comes to rest and that rest is not empty. It is full of what just happened. The practice this week: after each form, pause. Stand in the silence. That silence is the teaching landing in your body. Follow Torah Tai Chi.

**Outdoor archetype:** `MOUNTAIN_RIDGE` — revelation, ascent, perspective.
Parsha detail: `Thunder still rolls far across the valley, the last of it dying against the stone.`

**Word density check for each clip:**

| Clip | Duration | Voiceover | Word count | WPS |
|------|---------|-----------|-----------|-----|
| 0 | 9s | "At Sinai... all of Israel heard the voice. — kohl hah-meh-dah-BEHR. The voice that speaks." | 16 words | 1.8 |
| 1 | 11s | "And then — silence. Rah-SHEE says: after revelation, the voice stilled. That silence was not empty. It was full." | 19 words | 1.7 |
| 2 | 11s | "After each form this week... pause. Stand in the silence. That is the teaching landing in your body." | 18 words | 1.6 |
| 3 | 9s | "Follow Torah Tai Chi. Each week... a new silence to stand in." | 12 words | 1.3 |

**Clip 0 visual note:** `slow push in` to his face from MCU. Clip 1 carries forward from near that CU — static medium shot to settle. Clip 2 opens at MWS on the ridge, wider re-establishing. Clip 3 `tilt up` at the end of the clip toward the open sky above the ridge (aspiration close).

---

### 7.3 Example C — Parashat Vayikra: "The smallest letter" (embodied exercise)

This example demonstrates the full speech-action-speech structure for a breathing clip.

**Draft:**
> Vayikra opens with a strange grammatical curiosity — the aleph at the end of the word is written small, smaller than all other letters. The Baal HaTurim says this is Moses's humility: even as God calls to him, Moses steps back a little. In your body, try that now. As you breathe in, let yourself feel called. As you breathe out, step back just a little — let the call be bigger than you. That is the Torah's teaching in your body. Follow Torah Tai Chi.

**Outdoor archetype:** `FOREST_CLEARING` — hidden wisdom, mystery.

**Clip 3 is the embodied exercise clip:**

```
voiceover: "Breathe in... feel called. Breathe out — step back. Let the call be bigger."
[14 words]

visual_prompt (Clip 3, 12s, FOREST_CLEARING):
  "A Pixar-style 3D mid-50s rabbi-teacher, salt-and-pepper beard, brown leather
  kippah, navy mandarin-collar shirt with Torah Tai Chi logo. Sunlit clearing in
  ancient pines, moss-covered fallen log to one side, shafts of light cutting
  through the high canopy. Shafts of light shift slowly through the high canopy,
  pine needles drift down. 0-3s: Rav Eli at medium shot, faces camera, speaks
  'Breathe in... feel called.' — chest rises visibly. 3-7s: camera tilts DOWN
  toward his feet as he exhales, shoulders drop, weight settles downward —
  silence, no speech. 7-10s: camera tilts back UP to his face, he speaks
  'Breathe out — step back. Let the call be bigger.' 10-12s: eyes close gently,
  slight smile, silence holds final 2s. Voiceover ends at roughly 10s; final 2s
  silent embodiment. Shafts of light through canopy. Tilt down. Character must
  match all uploaded reference images. Steady framing, single speaker only,
  face fully visible at all times."

duration_s: 12
```

**Word density check:**
- Silent window: 4s (3-7s)
- Speaking window: 8s (0-3s + 7-10s)
- Words: 14
- WPS in speaking window: 14/8 = 1.75 — sage pace, correct

**Why this works:**
- The tilt-down camera move covers the 4s silent exhale — viewer sees feet and
  lower body settling, not a closed mouth
- The temporal markers give Seedance precise timing: it generates speech at 0-3s
  and 7-10s, silence at 3-7s and 10-12s
- "Breathe in... feel called" is 4 words with a mid-clause ellipsis — the pause
  after "in..." gives room for the inhale to be heard/shown
- The 2s silence after "bigger" is the clip ending on a held breath, not a
  word — the viewer exhales with Rav Eli

---

### 7.4 Example D — Parashat Noach: "After the flood, presence"

**Draft:**
> After the waters recede in parashat Noach, the Torah says: va-yizkor Elohim et Noach — and God remembered Noah. The word remember in Hebrew doesn't mean God forgot and then recalled. It means God turned God's full attention. In tai chi, this is the pivot: the moment you turn toward where you are going. Your practice this week: once per day, stop. Turn your full attention to what is in front of you. That is the zecher — the remembering. Follow Torah Tai Chi.

**Outdoor archetype:** `RIVERSIDE_GROVE` — flow, yielding, life-giving water.
Parsha detail: `The water is still and wide, the flood a distant memory in the smoothness of the river stones.`

**Key adaptations:**
- "va-yizkor Elohim et Noach" → "vah-yeez-KOR Eh-loh-HEEM et NOH-ach"
- "zecher" → "ZEH-cher"
- Clip 1 teaching focuses on the Hebrew memory word — most theologically dense clip
- Clip 2 uses the river setting to embody the "turning" pivot

**Clip 2 voiceover (application, 11s):**
> "Stand at the river's edge. Pivot — turn your full attention to what is in front of you. The water teaches this."

*Count: 18 words on 11s = 1.6 wps. Good.*

**Camera for Clip 2:** `pan right` along the river as Rav Eli walks slowly to the water's edge, pauses, turns toward camera — lateral tracking becomes a pivot moment.

---

### 7.5 Example E — Parashat Lech Lecha: "The walk that changed everything"

**Draft:**
> God says to Avraham: Lech lecha — go for yourself. The commentators ask: what does "for yourself" mean? Why not just "go"? Rashi says: for your own benefit, for your own improvement. In tai chi, we say: the form teaches the body, but the body teaches the self. You cannot practice without being changed. Lech lecha — this is not just a journey outward. It is a journey inward through movement. Every step is also a becoming. Follow Torah Tai Chi.

**Outdoor archetype:** `DESERT_OUTCROP` — journey, scarcity, clarity.
*Why desert for Lech Lecha:* Avraham walks into the unknown; the desert outcrop's wide dry valley mirrors that scope.

**The core tension:** "Go for yourself" — the inward/outward paradox. Clip 1 should land on this with teaching stillness. Clip 2 should show Rav Eli walking — literally lech lecha.

**Clip 2 camera:** `lateral tracking shot` — camera walks alongside him. This is a rare use of tracking shot in the pipeline; it is right here because the parsha itself is about walking.

**Clip 2 voiceover (walking clip, 11s):**
> "Lech-LEH-chah. Go for yourself. Every step you take in this practice... is also a becoming."

*Count: 14 words on 11s = 1.3 wps. Very sage. The walking matches the speech's forward motion.*

**Clip 3 close (CTA, 9s):**
> "Follow Torah Tai Chi. Walk with us each week. Each step is the teaching."

*Count: 13 words on 9s = 1.4 wps. Clean, measured, complete.*

---

## 8. Quick-Reference Checklists

### Before Writing Each Clip

- [ ] Character identity sentence is the FIRST clause of visual_prompt (verbatim)
- [ ] Setting anchor appears verbatim (DOJO or chosen archetype)
- [ ] For outdoor clips: explicit environmental motion cue sentence included
- [ ] Word count calculated; at or below duration × 2.0 wps
- [ ] All Hebrew terms in phonetic form (hyphens, stressed syllable in CAPS)
- [ ] Pause markers placed at natural breath points (ellipses, em-dashes)
- [ ] Exactly ONE camera direction from the permitted list
- [ ] Temporal markers included for clips ≥8s
- [ ] Positive constraints closer is the last sentence (verbatim)

### For Instructional / Breathing Clips

- [ ] Speech-action-speech rhythm planned with temporal markers
- [ ] Silent window duration calculated; word count adjusted for speaking window only
- [ ] Camera-cover move written for silent window (tilt down / pan away from face)
- [ ] Camera return written for closing speech
- [ ] "Voiceover ends at roughly Xs; remaining Ys is silent embodiment." in visual_prompt

### For Clip 0 (Hook)

- [ ] Opens at CU or MCU (never WS or EWS)
- [ ] Camera: `static medium shot`, `slow push in`, or `slight pull back` only
- [ ] First 0-2s establishes the face immediately
- [ ] The hook line is the most arresting phrase from the parsha teaching

### For Clip 3 (CTA / Closing)

- [ ] Voiceover is shortest of the four clips (1.3–1.6 wps ideal)
- [ ] Ends with silence (at least 1s of held beat after final word)
- [ ] Includes "Follow Torah Tai Chi" (or variation) if CTA is the purpose
- [ ] "Silence holds final Xs" or "voiceover ends at roughly Ns" in visual_prompt

### Within-Block Continuity Check (before finalizing)

- [ ] Clip 0 ends at a framing Clip 1 can begin from (no big size jump)
- [ ] Clip 2 ends at a framing Clip 3 can begin from
- [ ] Camera directions in same block do not oppose each other
- [ ] Lighting descriptors within same block are consistent

---

## 9. Sources

Research basis for this guide:

- [Timeline Prompting with Seedance 2.0 for Cinematic AI Video — MindStudio](https://www.mindstudio.ai/blog/timeline-prompting-seedance-2-cinematic-ai-video)
- [What Is Seedance 2.0? ByteDance's AI Video Model — MindStudio](https://www.mindstudio.ai/blog/what-is-seedance-2-ai-video-model)
- [Seedance 2.0 Official Prompt Guide — apiyi.com](https://help.apiyi.com/en/seedance-2-0-prompt-guide-video-generation-camera-style-tips-en.html)
- [Seedance 2.0 Usage Guide: Complete Prompt Engineering Playbook — redreamality.com](https://redreamality.com/blog/seedance-2-guide/)
- [Seedance 2.0 Prompt Template: Copy-Paste Framework — WaveSpeedAI](https://wavespeed.ai/blog/posts/blog-seedance-2-0-prompt-template/)
- [Exclusive Seedance 2.0 Prompt Guide With 70 Ready-To-Use Prompts — imagine.art](https://www.imagine.art/blogs/seedance-2-0-prompt-guide)
- [Kie.ai Seedance 2 API Documentation](https://docs.kie.ai/market/bytedance/seedance-2)
- [How to Use Seedance 2.0 With Reference Images for Consistent Characters — sagnikbhattacharya.com](https://sagnikbhattacharya.com/blog/seedance-reference-images-characters)
- [How to Make Consistent Characters in Seedance 2.0 — sagnikbhattacharya.com](https://sagnikbhattacharya.com/blog/consistent-characters-seedance)
- [Seedance 2.0 Lip Sync + Voiceover: What Works, What Breaks — CrePal](https://crepal.ai/blog/aivideo/blog-seedance-2-0-lip-sync-voiceover-fix/)
- [How to Keep Characters Consistent in AI Video (2026) — Magic Hour](https://magichour.ai/blog/how-to-keep-characters-consistent-in-ai-video)
- [AI Multi-Shot Video: Consistent Characters Across Clips — AI Magicx](https://www.aimagicx.com/blog/ai-multi-shot-video-character-consistency-2026)
- [How to Use Seedance 2.0 Like a Pro in 2026 — fal.ai](https://fal.ai/learn/tools/how-to-use-seedance-2-0)
- [Seedance 2.0 Best Prompt Engineering Guide — seedance2.today](https://www.seedance2.today/blog/best-seedance-prompt-engineering-guide-master-multi-shot-tutorial-2026)
- [Seamless AI Video Transitions with Frames — Artlist Blog](https://artlist.io/blog/ai-video-transitions-study-case/)
- [GitHub: awesome-seedance-2-prompts — YouMind-OpenLab](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts)

---

*Guide version: 2026-04-15. Maintained alongside `src/settings.py`. When `DOJO_ANCHOR_TEXT`, `OUTDOOR_ARCHETYPES`, `STYLE_LOCK`, or `GUARDRAILS_TEXT` change, review Section 5 and Section 6 for alignment.*
