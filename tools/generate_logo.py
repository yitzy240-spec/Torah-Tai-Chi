"""Generate Torah Tai Chi logo concepts via Kie.ai nano-banana-2.

Generates 4 logo concepts × 4 variants + 1 OG concept × 3 variants = 19 images.
Saves to:
  references/_brand/concept{N}_variant{M}.png
  references/_brand/og/og_variant{M}.png

Cost estimate: ~$0.95 total (19 generations × ~$0.05 each).

Usage:
    python tools/generate_logo.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from src.kie_client import KieClient  # noqa: E402

BRAND_DIR = ROOT / "references" / "_brand"
OG_DIR = BRAND_DIR / "og"

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_CONCEPT1_BASE = """\
Professional logo design for "Torah Tai Chi", an editorial brand fusing \
Jewish Torah wisdom with Chinese internal arts (tai chi).

Composition: square 1:1, centered on a circular cedar wood disc (diameter \
80% of frame). The disc is warm honey-brown cedar (#A8722F) with visible \
wood grain in shallow relief. Carved into the face of the disc: a classic \
yin-yang symbol in shallow relief — the contrast between light and dark \
lobes is subtle, not harsh. Embedded in the dark lobe of the yin-yang: a \
Star of David, outlined in warm brass (#9E7A3A), lightly etched into the \
wood. The light lobe of the yin-yang has a small dark dot, the dark lobe a \
small light dot.

Above the disc, arcing along the top curve: the word "TORAH" hand-carved in \
cedar-relief lettering, Fraunces-style editorial serif, honey-brown tone \
slightly darker than the disc.

Below the disc, straight baseline: the words "TAI CHI" in the same \
hand-carved cedar serif letterform, matching the "TORAH" treatment.

Background: very pale linen (#FAF4E8), almost white. Soft warm cinematic \
lighting from upper-left, casting a gentle shadow beneath the disc. Deep \
navy accent (#1F2C4B) used only as the dark lobe of the yin-yang. No \
gradients, no drop shadows on letterforms. Warm, contemplative, editorial \
aesthetic — NOT startup-tech, NOT cartoonish. High-quality product \
photography rendering, 4K detail, museum-quality craft.\
"""

_CONCEPT2_BASE = """\
Professional logo mark design (icon only, no text) for "Torah Tai Chi", an \
editorial brand fusing Jewish Torah wisdom with Chinese internal arts.

A single circular cedar wood disc (honey-brown #A8722F, visible wood grain). \
Carved into the face in shallow relief: a classic yin-yang symbol. The dark \
lobe is deep navy (#1F2C4B), the light lobe is warm cream (#FAF4E8). Embedded \
in the dark lobe: a Star of David, outlined in brass (#9E7A3A), lightly \
etched into the wood surface. No text. No wordmark.

Background: transparent OR pale linen (#FAF4E8). Square 1:1 composition. \
Centered disc, generous padding. Soft warm cinematic lighting from upper-left, \
subtle cast shadow below the disc.

Warm, contemplative, editorial aesthetic. High-quality rendering, 4K detail. \
Suitable for use as a favicon or app icon.\
"""

_CONCEPT3_BASE = """\
Professional horizontal wordmark logo design for "Torah Tai Chi", editorial \
brand fusing Jewish Torah wisdom with Chinese internal arts.

Horizontal composition (roughly 2:1 ratio). Left side: a circular cedar wood \
disc (~30% of total width), honey-brown (#A8722F) with visible wood grain, \
yin-yang carved in shallow relief, Star of David in brass (#9E7A3A) inset in \
the dark lobe. Right side: the wordmark "Torah Tai Chi" in an elegant \
Fraunces-style display serif, navy (#1F2C4B), generous tracking — three words \
stacked or inline. Vertical rhythm aligns the middle of the wordmark with the \
center of the disc.

Background: pale linen (#FAF4E8). Soft warm cinematic side-lighting. Suitable \
for website header.

Editorial, contemplative brand aesthetic. No drop shadows. High-quality \
rendering, 4K detail.\
"""

_CONCEPT4_BASE = """\
Professional flat-illustration logo design for "Torah Tai Chi", editorial \
brand fusing Jewish Torah wisdom with Chinese internal arts.

Square 1:1 composition. Centered circular disc — flat illustration style, \
no wood-grain realism, clean graphic shapes. The disc is solid honey-brown \
(#A8722F). On the disc: a flat graphic yin-yang symbol — dark lobe navy \
(#1F2C4B), light lobe cream (#FAF4E8), both lobes as clean vector shapes. \
In the dark lobe: a flat Star of David outline in brass (#9E7A3A), minimal \
strokes. Above the disc arcing: "TORAH" in clean serif type. Below: "TAI CHI" \
in matching serif type. Both in navy (#1F2C4B) or cream, high contrast against \
the disc color.

Background: pale linen (#FAF4E8). No gradients or shadows — pure flat \
illustration. Friendly, graphic, works at small sizes. Still warm and \
editorial, not cartoonish. Think Penguin Books cover art meets tai chi.\
"""

_CONCEPT5_BASE = """\
Open Graph share image for "Torah Tai Chi" website, editorial brand fusing \
Jewish Torah wisdom with Chinese internal arts.

Landscape composition (~1200×630). Background: very pale linen (#FAF4E8) with \
a very subtle warm cedar glow radiating from center. Centered vertically and \
horizontally: a circular cedar wood disc (honey-brown #A8722F, wood grain \
visible, ~250-300px diameter) with yin-yang carved in shallow relief — dark \
lobe navy (#1F2C4B), Star of David in brass (#9E7A3A) inset in dark lobe.

Directly below the disc, centered: "Torah Tai Chi" in an elegant \
Fraunces-style display serif, navy (#1F2C4B), ~48pt equivalent. Below that, \
small italic serif line: "Where ancient wisdom meets the body" in navy at \
~20pt equivalent. Generous vertical spacing.

Soft warm cinematic lighting on the disc element. No harsh shadows on \
typography. Feels like a thoughtful book cover or editorial journal header. \
High-quality rendering, 4K detail, clean margins.\
"""

# ---------------------------------------------------------------------------
# Variant seed suffixes (appended to each base prompt for diversity)
# ---------------------------------------------------------------------------
_VARIANTS = [
    "  -- Render variant A.",
    "  -- Render variant B, slightly different lighting angle and shadow depth.",
    "  -- Render variant C, slightly warmer color temperature.",
    "  -- Render variant D, slightly cooler tone and tighter composition.",
]

_OG_VARIANTS = [
    "  -- Render variant A.",
    "  -- Render variant B, slightly different lighting and shadow on the disc.",
    "  -- Render variant C, marginally more contrast between disc and background.",
]

CONCEPTS = {
    "concept1": (_CONCEPT1_BASE, "1:1", 4),
    "concept2": (_CONCEPT2_BASE, "1:1", 4),
    "concept3": (_CONCEPT3_BASE, "16:9", 4),
    "concept4": (_CONCEPT4_BASE, "1:1", 4),
}

OG_CONCEPT = ("concept5_og", _CONCEPT5_BASE, "16:9", 3)

# ---------------------------------------------------------------------------
# Generation helpers
# ---------------------------------------------------------------------------


async def _generate(
    kie: KieClient, name: str, prompt: str, aspect: str, dest: Path
) -> None:
    """Submit one task, poll, download."""
    payload = {
        "prompt": prompt,
        "image_input": [],
        "aspect_ratio": aspect,
        "resolution": "2K",
        "output_format": "png",
    }
    try:
        task_id = await kie.create_task("nano-banana-2", payload)
        urls = await kie.poll_task(task_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        await kie.download(urls[0], dest)
        print(f"  OK   {dest.relative_to(ROOT)}")
    except Exception as exc:
        print(f"  FAIL {name}: {exc}")


async def main() -> None:
    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("KIE_AI_API_KEY")
    if not api_key:
        raise SystemExit("KIE_AI_API_KEY not set in .env")

    kie = KieClient(api_key, poll_timeout_s=600)

    tasks: list[asyncio.Task] = []

    # Logo concepts 1-4 × 4 variants
    for concept_key, (base_prompt, aspect, n_variants) in CONCEPTS.items():
        for i, suffix in enumerate(_VARIANTS[:n_variants], start=1):
            name = f"{concept_key}_variant{i}"
            prompt = base_prompt + suffix
            dest = BRAND_DIR / f"{name}.png"
            t = asyncio.create_task(_generate(kie, name, prompt, aspect, dest))
            tasks.append(t)

    # OG concept × 3 variants
    og_key, og_base, og_aspect, og_n = OG_CONCEPT
    for i, suffix in enumerate(_OG_VARIANTS[:og_n], start=1):
        name = f"{og_key}_variant{i}"
        prompt = og_base + suffix
        dest = OG_DIR / f"og_variant{i}.png"
        t = asyncio.create_task(_generate(kie, name, prompt, og_aspect, dest))
        tasks.append(t)

    total = len(tasks)
    print(f"\nSubmitting {total} tasks in parallel (est. 2-4 min)...\n")

    await asyncio.gather(*tasks)

    print(f"\n--- Done: {total} images ---")
    print(f"\nLogo concepts saved to:  {BRAND_DIR}")
    print(f"OG images saved to:      {OG_DIR}")
    print(
        "\nNext step: open references/_brand/ and references/_brand/og/,"
        " pick your favourites, and tell us which concept numbers to"
        " integrate into the website and replace the default OG image."
    )


if __name__ == "__main__":
    asyncio.run(main())
