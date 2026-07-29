# Character-ref crest fix — working folder (2026-07-29)

Yonah: Rav Eli's shirt crest must read **"Torah" (arced) / yin-yang logo /
"Tai Chi"** — several refs are cropped mid-crest and never show "Tai Chi",
so Seedance improvises the area below the logo inconsistently.

This folder = byte-copies of every character image the pipeline sends to
Seedance (the 12 numbered PNGs at `references/` top level) plus the two
canonical images (NOT sent — `_canonical/` is outside the upload glob).
Fix images here first; copy back to `references/` only after approval.

## What Seedance actually receives

All 12 numbered PNGs upload, ordered by `_CHAR_PRIORITY` (modal_app.py):
01, 07, 10, 05, then the rest alphabetically. But `MAX_REFS = 9` with
dojo refs taking 4 guaranteed slots means **on DOJO clips only the first
5 arrive: 01, 07, 10, 05, 03.** Non-dojo clips get the first ~9.

## Crest status per file (verified by zoom inspection, 2026-07-29)

| file | sent priority | crest status |
|---|---|---|
| 01_front_neutral | **#1 (dojo)** | ❌ CUT — frame bottom crops crest at the logo; no "Tai Chi", no room below it in-frame |
| 07_fullbody_yinyang_pose | **#2 (dojo)** | ✅ FULL crest, legible |
| 10_closeup_thoughtful | **#3 (dojo)** | ❌ CUT — frame bottom crops mid-logo; no "Tai Chi" |
| 05_profile_right | **#4 (dojo)** | ✅ FULL crest, legible (profile angle) |
| 03_threequarter_right_speaking | **#5 (dojo)** | ❌ crest half out of the right frame edge |
| 04_threequarter_left_speaking | #6 | ⚠️ logo visible, below-logo area blocked by hand / no "Tai Chi" visible |
| 06_fullbody_ready_stance | #7 | ✅ FULL crest (small but legible) |
| 08_fullbody_flowing_pose | #8 | crest tiny/oblique — low influence |
| 09_seated_teaching | #9 | crest tiny — low influence |
| 11_walking_forward | (rarely sent) | crest tiny |
| 12_meditation_pose | (rarely sent) | ❌ CUT at logo bottom; no "Tai Chi" |
| 13_overshoulder_back | (rarely sent) | back view — n/a |
| rav_eli_canonical | not sent | ❌ CUT below logo; no "Tai Chi" |
| rav_eli_chest_crest | not sent | ❌ CUT right below logo; no "Tai Chi" |

Net: of the five refs dojo clips actually see, **3 of 5 are missing
"Tai Chi"** — including priorities #1 and #3. That's why videos sometimes
render it and sometimes don't.

## GPT-image fix notes

Priority order for fixing: **01, 10** (top-priority refs), then 03, 04,
12, and the two canonicals. 05/06/07 are correct — use their crest as the
visual target. For 01 and 10 the crest touches the frame edge, so the fix
needs either (a) outpaint/extend the canvas downward, or (b) redraw the
crest slightly smaller/higher so "Tai Chi" fits in-frame. Identity lock:
face, kippah, shirt style, pose, lighting, and framing must stay
otherwise IDENTICAL — these are character-consistency anchors
(see MEMORY character_rav_eli).
