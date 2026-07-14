"""Generate the branded outro card PNG (Torah Tai Chi).

9:16 cream card: logo emblem + web address + tagline, in the brand palette
(linen/cedar/ink) and display serif (Fraunces). Output is a static asset the
stitcher turns into a short end segment appended to every video.

Run: python tools/make_outro_card.py
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "references" / "_brand" / "logo.png"
FONT = ROOT / "work" / "outro" / "Fraunces.ttf"
OUT = ROOT / "references" / "_brand" / "outro_card.png"

W, H = 1080, 1920
OUTRO_URL = "TorahTaiChi.com"

# Brand tokens (website src/styles/tokens.css)
INK_900 = (35, 27, 16)      # #231B10  headline
CEDAR_700 = (106, 70, 34)   # #6A4622  tagline / wood tone
BRASS = (158, 122, 58)      # #9E7A3A  divider
TOP = (252, 247, 236)       # #FCF7EC  gradient top (matches logo bg)
BOT = (238, 230, 216)       # #EEE6D8  gradient bottom


def _vertical_gradient(w: int, h: int, top: tuple, bot: tuple) -> Image.Image:
    base = Image.new("RGB", (w, h), top)
    px = base.load()
    for y in range(h):
        t = y / (h - 1)
        r = round(top[0] + (bot[0] - top[0]) * t)
        g = round(top[1] + (bot[1] - top[1]) * t)
        b = round(top[2] + (bot[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return base


def _font(size: int, wght: float, ital: bool = False) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), size)
    try:
        # Fraunces variable axes: opsz 9-144, wght 100-900, SOFT 0-100, WONK 0-1
        f.set_variation_by_axes([size, wght, 0.0, 0.0])
    except Exception:
        pass
    return f


def _center_text(draw, cx, y, text, font, fill, tracking=0):
    if tracking == 0:
        w = draw.textbbox((0, 0), text, font=font)[2]
        draw.text((cx - w / 2, y), text, font=font, fill=fill)
        return
    # letter-spaced draw
    widths = [draw.textbbox((0, 0), ch, font=font)[2] for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def main():
    card = _vertical_gradient(W, H, TOP, BOT)

    # Logo emblem — mask the square backdrop to a feathered circle so only the
    # wooden medallion sits on the card (no rectangular seam), then scale.
    logo = Image.open(LOGO).convert("RGBA")
    lw = logo.width
    mask = Image.new("L", (lw, lw), 0)
    md = ImageDraw.Draw(mask)
    r = lw * 0.485
    md.ellipse([lw / 2 - r, lw / 2 - r, lw / 2 + r, lw / 2 + r], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(lw * 0.006))
    logo.putalpha(mask)

    target_w = int(W * 0.62)
    scale = target_w / logo.width
    logo = logo.resize((target_w, int(logo.height * scale)), Image.LANCZOS)
    lx = (W - logo.width) // 2
    ly = int(H * 0.205)
    card.paste(logo, (lx, ly), logo)

    draw = ImageDraw.Draw(card)
    cx = W / 2
    y = ly + logo.height + int(H * 0.015)

    # Web address — the call to action.
    url_font = _font(96, 600)
    _center_text(draw, cx, y, OUTRO_URL, url_font, INK_900)
    y += 132

    # Brass divider.
    dw = int(W * 0.18)
    draw.line([(cx - dw / 2, y + 18), (cx + dw / 2, y + 18)], fill=BRASS, width=3)
    y += 62

    # Tagline.
    tag_font = _font(58, 420)
    _center_text(draw, cx, y, "Where Torah and Tai Chi Meet", tag_font, CEDAR_700)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    card.save(OUT)
    print(f"wrote {OUT} ({card.size})")


if __name__ == "__main__":
    main()
