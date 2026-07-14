"""Generate the branded ANIMATED outro (Torah Tai Chi).

9:16 cream end card in the brand palette (linen/cedar/ink) and display serif
(Fraunces): the wooden medallion is present from the first frame; the web
address rises + fades in, a brass divider draws, then the tagline rises + fades
in. Encodes to a silent mp4 the stitcher appends to every video.

Outputs:
  references/_brand/outro.mp4        (the animated segment, 1080x1920, silent)
  references/_brand/outro_card.png   (final frame — poster / reference)

Run: FFMPEG_BIN=... python tools/make_outro.py
"""
from __future__ import annotations
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "references" / "_brand" / "logo.png"
FONT = ROOT / "work" / "outro" / "Fraunces.ttf"
FONT_ITALIC = ROOT / "work" / "outro" / "Fraunces-Italic.ttf"
OUT_MP4 = ROOT / "references" / "_brand" / "outro.mp4"
OUT_PNG = ROOT / "references" / "_brand" / "outro_card.png"
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")

W, H = 1080, 1920
FPS = 30
DURATION_S = 3.6
OUTRO_URL = "TorahTaiChi.com"

# Brand tokens (website src/styles/tokens.css)
INK_900 = (35, 27, 16)
CEDAR_700 = (106, 70, 34)
BRASS = (158, 122, 58)
TOP = (252, 247, 236)
BOT = (238, 230, 216)

# Animation schedule (seconds): (start, end) of each element's ease-in.
URL_IN = (0.55, 1.45)
DIV_IN = (1.30, 1.85)
TAG_IN = (1.65, 2.55)
RISE_PX = 16  # how far text rises into place


def _ease_out_cubic(p: float) -> float:
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3


def _seg(t: float, span: tuple[float, float]) -> float:
    a, b = span
    return _ease_out_cubic((t - a) / (b - a)) if b > a else (1.0 if t >= a else 0.0)


def _vertical_gradient(w: int, h: int, top, bot) -> Image.Image:
    base = Image.new("RGB", (w, h), top)
    px = base.load()
    for y in range(h):
        t = y / (h - 1)
        row = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    return base


def _font(size: int, wght: float, italic: bool = False) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT_ITALIC if italic else FONT), size)
    try:
        f.set_variation_by_axes([size, wght, 0.0, 0.0])
    except Exception:
        pass
    return f


def _text_layer(text: str, font, fill, cx: int, y: int) -> Image.Image:
    """A full-frame RGBA layer with `text` centred at (cx, y)."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = d.textbbox((0, 0), text, font=font)[2]
    d.text((cx - tw / 2, y), text, font=font, fill=fill + (255,))
    return layer


def _div_layer(cx: int, y: int, half: int) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line([(cx - half, y), (cx + half, y)], fill=BRASS + (255,), width=3)
    return layer


def _fade(layer: Image.Image, alpha: float, dy: int = 0) -> Image.Image:
    """Return `layer` shifted up by dy and scaled to `alpha` opacity."""
    if dy:
        layer = layer.transform(
            layer.size, Image.AFFINE, (1, 0, 0, 0, 1, dy), resample=Image.BILINEAR
        )
    a = layer.split()[3].point(lambda v: int(v * max(0.0, min(1.0, alpha))))
    layer.putalpha(a)
    return layer


def _build_base() -> tuple[Image.Image, int, int, int]:
    card = _vertical_gradient(W, H, TOP, BOT).convert("RGBA")

    logo = Image.open(LOGO).convert("RGBA")
    lw = logo.width
    mask = Image.new("L", (lw, lw), 0)
    ImageDraw.Draw(mask).ellipse(
        [lw / 2 - lw * 0.485, lw / 2 - lw * 0.485,
         lw / 2 + lw * 0.485, lw / 2 + lw * 0.485], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(lw * 0.006))
    logo.putalpha(mask)
    target_w = int(W * 0.62)
    logo = logo.resize((target_w, int(logo.height * target_w / lw)), Image.LANCZOS)
    lx = (W - logo.width) // 2
    ly = int(H * 0.205)
    card.alpha_composite(logo, (lx, ly))

    y_url = ly + logo.height + int(H * 0.015)
    y_div = y_url + 132
    y_tag = y_div + 44
    return card, y_url, y_div, y_tag


def main():
    base, y_url, y_div, y_tag = _build_base()
    cx = W // 2
    url_font = _font(96, 600)
    tag_font = _font(58, 420, italic=True)

    url_full = _text_layer(OUTRO_URL, url_font, INK_900, cx, y_url)
    tag_full = _text_layer("Where Torah and Tai Chi Meet", tag_font, CEDAR_700, cx, y_tag)

    n = int(round(DURATION_S * FPS))
    tmp = Path(tempfile.mkdtemp(prefix="outro_"))
    try:
        for i in range(n):
            t = i / FPS
            frame = base.copy()

            au = _seg(t, URL_IN)
            if au > 0:
                frame.alpha_composite(_fade(url_full.copy(), au, int((1 - au) * RISE_PX)))
            ad = _seg(t, DIV_IN)
            if ad > 0:
                half = int(W * 0.09 * ad)
                frame.alpha_composite(_fade(_div_layer(cx, y_div + 18, half), min(1.0, ad * 1.3)))
            at = _seg(t, TAG_IN)
            if at > 0:
                frame.alpha_composite(_fade(tag_full.copy(), at, int((1 - at) * (RISE_PX - 2))))

            frame.convert("RGB").save(tmp / f"f{i:04d}.png")
            if i == n - 1:
                frame.convert("RGB").save(OUT_PNG)

        args = [
            FFMPEG, "-y",
            "-framerate", str(FPS), "-i", str(tmp / "f%04d.png"),
            "-f", "lavfi", "-t", f"{DURATION_S}", "-i", "anullsrc=r=44100:cl=stereo",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "192k", "-shortest",
            "-movflags", "+faststart", str(OUT_MP4),
        ]
        r = subprocess.run(args, capture_output=True)
        if r.returncode != 0:
            raise SystemExit(r.stderr.decode("utf-8", "replace")[-1500:])
        print(f"wrote {OUT_MP4} ({DURATION_S}s, {n} frames) + {OUT_PNG}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
