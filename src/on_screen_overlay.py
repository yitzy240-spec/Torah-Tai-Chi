"""Burn hook text + spoken captions onto a stitched 9:16 video.

Added at stitch time (after concat, before upload), never inside Seedance
generation. Designed to differ from the old caption_burner path, which
Yonah disliked:

  * captions lived at the bottom (or top 15%) — inside reel unsafe zones
  * Inter Medium, ~4.2% of frame height, 2px outline — small and low contrast
  * style and wording were hardcoded (Whisper of the voiceover, no admin edit)
  * no hook line, and no awareness of the branded Follow/Subscribe end card
  * never wired into the Modal compose path that actually ships videos

This module:

  * keeps every glyph inside the middle safe zone (below the top 14% and
    above the bottom 35% of a 9:16 frame)
  * puts a short hook (first ~3s) that clears the face: above the head
    when there is room under the 14% safe line, otherwise in the
    lower-middle safe zone
  * while the hook is on screen, spoken captions are suppressed so the
    same words are not shown twice; they resume at hook end
  * keeps phrases like "Tai Chi" / "Torah Tai Chi" together, merges
    one-word tails, and holds each cue on screen for at least ~0.4s
  * uses bundled Inter Bold with a thick black outline (hook in brand gold)
  * times captions to actual speech (local Whisper word timestamps,
    mapped onto the script words; even-split fallback if alignment fails)
  * shows short 2–4 word chunks while those words are spoken
  * stops before the end card, and is applied identically to both endings
"""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from src.caption_timing import normalize_word, script_text_for_captions, timed_script_words
from src.face_detect import FaceBox, detect_face_in_clip

SAFE_TOP_FRAC = 0.14
SAFE_BOTTOM_FRAC = 0.35  # measured from the bottom of the frame
HOOK_DURATION_S = 3.0
HOOK_FONT_FRAC = 0.042
CAPTION_FONT_FRAC = 0.046
HOOK_OUTLINE = 6
CAPTION_OUTLINE = 5
# Default hook is top-aligned at the 14% safe line when the face sits
# low enough to clear a 2-line block. If a close-up leaves no room,
# adapt_overlay_layout moves the hook to the bottom of the safe zone
# (just above the 65% line) and shifts captions for the hook window.
HOOK_TOP_FRAC = 0.14
CAPTION_CY_FRAC = 0.54
MAX_WORDS_PER_CUE = 4
MAX_CUE_CHARS = 18
MIN_CUE_DURATION_S = 0.40
LINE_HEIGHT = 1.25
# Multi-word names/phrases that must not be split across cues.
KEEP_TOGETHER = (
    ("torah", "tai", "chi"),
    ("tai", "chi"),
    ("sui", "shi"),
    ("hua", "jin"),
)
# Conservative average glyph width for Inter Bold, as a fraction of font
# size. Used to wrap so lines cannot overflow the 9:16 frame.
CHAR_WIDTH_FRAC = 0.62
SIDE_GUTTER_FRAC = 0.08
HOOK_MAX_LINES = 2
CAPTION_MAX_LINES = 2

# Brand tokens (website/src/styles/tokens.css): brighter brass so it stays
# readable on both the dark dojo and a bright outdoor sky, with the same
# thick black outline as the captions.
HOOK_PRIMARY = "&H006AD7F3"  # ASS is BGR: #F3D67A
CAPTION_PRIMARY = "&H00FFFFFF"
OUTLINE_COLOUR = "&H00000000"
SHADOW_COLOUR = "&H00000000"

# Font file is bundled next to the branded outros so Modal's
# add_local_dir("references") ships it with no network fetch at render time.
_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FONT_PATH = _REPO_ROOT / "references" / "_brand" / "fonts" / "Inter-Bold.ttf"
FONT_FAMILY = "Inter"

_ASS_SPECIAL = re.compile(r"[{}\\]")


@dataclass(frozen=True)
class OverlayLayout:
    video_w: int
    video_h: int
    safe_top: int
    safe_bottom: int
    hook_font: int
    caption_font: int
    hook_top: int
    hook_cy: int
    caption_cy: int
    hook_outline: int = HOOK_OUTLINE
    caption_outline: int = CAPTION_OUTLINE
    hook_placement: str = "above"  # "above" | "below"
    hook_window_caption_cy: int | None = None

    @property
    def cx(self) -> int:
        return self.video_w // 2

    def usable_width(self) -> int:
        gutter = int(round(self.video_w * SIDE_GUTTER_FRAC))
        return max(1, self.video_w - 2 * gutter)

    def max_chars(self, font_size: int) -> int:
        return max_chars_for_font(self.usable_width(), font_size)


@dataclass(frozen=True)
class TextBox:
    """Axis-aligned box for a block of text, in pixels."""
    left: int
    top: int
    right: int
    bottom: int
    role: str

    @property
    def height(self) -> int:
        return self.bottom - self.top


@dataclass(frozen=True)
class ClipTranscript:
    index: int
    voiceover: str
    duration_s: float


@dataclass(frozen=True)
class OnScreenSettings:
    enabled: bool = False
    hook_text: str = ""
    caption_override: str = ""
    hook_duration_s: float = HOOK_DURATION_S


def safe_zone(video_h: int) -> tuple[int, int]:
    """Inclusive-exclusive pixel range [top, bottom) that is safe for text."""
    top = int(round(video_h * SAFE_TOP_FRAC))
    bottom = int(round(video_h * (1.0 - SAFE_BOTTOM_FRAC)))
    return top, bottom


def compute_layout(video_w: int, video_h: int) -> OverlayLayout:
    if video_w <= 0 or video_h <= 0:
        raise ValueError(f"invalid frame size {video_w}x{video_h}")
    safe_top, safe_bottom = safe_zone(video_h)
    hook_font = max(36, int(round(video_h * HOOK_FONT_FRAC)))
    caption_font = max(28, int(round(video_h * CAPTION_FONT_FRAC)))
    hook_top = int(round(video_h * HOOK_TOP_FRAC))
    caption_cy = int(round(video_h * CAPTION_CY_FRAC))
    hook_block = int(round(hook_font * LINE_HEIGHT * HOOK_MAX_LINES)) + 2 * HOOK_OUTLINE
    hook_cy = hook_top + hook_block // 2
    layout = OverlayLayout(
        video_w=video_w,
        video_h=video_h,
        safe_top=safe_top,
        safe_bottom=safe_bottom,
        hook_font=hook_font,
        caption_font=caption_font,
        hook_top=hook_top,
        hook_cy=hook_cy,
        caption_cy=caption_cy,
    )
    _assert_layout_in_safe_zone(layout)
    return layout


def _text_box(cy: int, font_size: int, outline: int, lines: int, video_w: int, role: str) -> TextBox:
    # Half the typographic block, plus outline so the stroke stays in-zone.
    block = int(round(font_size * LINE_HEIGHT * lines)) + 2 * outline
    half = (block + 1) // 2
    # Horizontal: leave 8% gutter so long words don't hit the frame edge.
    gutter = int(round(video_w * 0.08))
    return TextBox(
        left=gutter,
        top=cy - half,
        right=video_w - gutter,
        bottom=cy + half,
        role=role,
    )


def hook_box(layout: OverlayLayout, lines: int = HOOK_MAX_LINES) -> TextBox:
    """Hook box: top-aligned at layout.hook_top (above or below, per placement)."""
    lines = max(1, min(int(lines), HOOK_MAX_LINES))
    block = int(round(layout.hook_font * LINE_HEIGHT * lines)) + 2 * layout.hook_outline
    gutter = int(round(layout.video_w * SIDE_GUTTER_FRAC))
    return TextBox(
        left=gutter,
        top=layout.hook_top,
        right=layout.video_w - gutter,
        bottom=layout.hook_top + block,
        role="hook",
    )


def hook_center_y(layout: OverlayLayout, lines: int) -> int:
    box = hook_box(layout, lines)
    return (box.top + box.bottom) // 2


def caption_box(layout: OverlayLayout, lines: int = 2) -> TextBox:
    return _text_box(
        layout.caption_cy, layout.caption_font, layout.caption_outline,
        lines, layout.video_w, "caption",
    )


def _assert_layout_in_safe_zone(layout: OverlayLayout) -> None:
    hook = hook_box(layout, HOOK_MAX_LINES)
    cap = caption_box(layout, CAPTION_MAX_LINES)
    boxes = [hook, cap]
    if layout.hook_window_caption_cy is not None:
        boxes.append(_text_box(
            layout.hook_window_caption_cy, layout.caption_font,
            layout.caption_outline, CAPTION_MAX_LINES, layout.video_w,
            "caption-during-hook",
        ))
    for box in boxes:
        if box.top < layout.safe_top or box.bottom > layout.safe_bottom:
            raise ValueError(
                f"{box.role} box {box.top}-{box.bottom} escapes safe zone "
                f"{layout.safe_top}-{layout.safe_bottom} at {layout.video_w}x{layout.video_h}"
            )
    if layout.hook_placement == "below":
        mid = boxes[-1] if layout.hook_window_caption_cy is not None else cap
        if mid.bottom + layout.caption_outline > hook.top:
            raise ValueError(
                f"hook box overlaps captions ({mid.bottom} > {hook.top})"
            )
    elif hook.bottom + layout.caption_outline > cap.top:
        raise ValueError(
            f"hook box overlaps captions ({hook.bottom} > {cap.top})"
        )


def hook_block_height(layout: OverlayLayout, lines: int = HOOK_MAX_LINES) -> int:
    lines = max(1, min(int(lines), HOOK_MAX_LINES))
    return int(round(layout.hook_font * LINE_HEIGHT * lines)) + 2 * layout.hook_outline


def adapt_overlay_layout(
    layout: OverlayLayout,
    face: FaceBox | None,
    *,
    hook_lines: int = HOOK_MAX_LINES,
) -> OverlayLayout:
    """Place the hook above the head, or in the lower safe zone if it cannot.

    Stays inside the reel safe zone (below the top 14%, above the bottom 35%).
    When the hook moves down, captions during the hook window shift into the
    gap between the chin and the hook so the two never overlap.
    """
    from dataclasses import replace

    hook_lines = max(1, min(int(hook_lines), HOOK_MAX_LINES))
    block = hook_block_height(layout, hook_lines)
    gap = max(8, layout.hook_outline)
    preferred_top = layout.safe_top
    head_clear = None
    face_bottom = None
    if face is None:
        # No detection: keep the default ceiling placement rather than
        # always jumping the hook to the lower band.
        return replace(
            layout,
            hook_top=preferred_top,
            hook_cy=preferred_top + block // 2,
            hook_placement="above",
            hook_window_caption_cy=None,
        )
    if face is not None:
        # Clear the detected hairline (YuNet box top). A kippah may sit
        # slightly above that box; a small gap is enough because eyes are
        # well below the box top. Tight Vayeitzei close-ups (face top ~26%)
        # still fit a 2-line hook at the 14% line; Vayishlach (face top
        # ~18%) does not.
        head_clear = face.top
        face_bottom = face.bottom
        if preferred_top + block + 4 <= head_clear:
            hook_top = preferred_top
            return replace(
                layout,
                hook_top=hook_top,
                hook_cy=hook_top + block // 2,
                hook_placement="above",
                hook_window_caption_cy=None,
            )
    hook_bottom = layout.safe_bottom
    hook_top = hook_bottom - block
    if face_bottom is not None:
        hook_top = max(hook_top, int(round(face_bottom)) + gap)
    hook_top = max(layout.safe_top, hook_top)
    hook_bottom = hook_top + block
    if hook_bottom > layout.safe_bottom:
        hook_bottom = layout.safe_bottom
        hook_top = hook_bottom - block
        hook_top = max(layout.safe_top, hook_top)

    cap_block = int(round(layout.caption_font * LINE_HEIGHT * CAPTION_MAX_LINES)) + 2 * layout.caption_outline
    region_top = layout.safe_top + gap
    if face_bottom is not None:
        region_top = max(region_top, int(round(face_bottom)) + gap)
    region_bottom = hook_top - gap
    if region_bottom - region_top < cap_block:
        cap_cy = (region_top + max(region_top + cap_block, region_bottom)) // 2
    else:
        cap_cy = (region_top + region_bottom) // 2
    cap_half = (cap_block + 1) // 2
    cap_cy = min(max(cap_cy, layout.safe_top + cap_half), hook_top - gap - cap_half)
    cap_cy = max(layout.safe_top + cap_half, min(cap_cy, layout.safe_bottom - cap_half))

    adapted = replace(
        layout,
        hook_top=int(hook_top),
        hook_cy=int(hook_top) + block // 2,
        hook_placement="below",
        hook_window_caption_cy=int(cap_cy),
    )
    _assert_layout_in_safe_zone(adapted)
    return adapted


def content_end_s(video_duration_s: float, outro_duration_s: float) -> float:
    """Last moment captions may appear: start of the branded end card.

    The stitcher appends the outro with a sequential fade (no overlap), so
    the end card begins at total - outro_duration.
    """
    if video_duration_s <= 0:
        return 0.0
    end = video_duration_s - max(0.0, outro_duration_s)
    return max(0.0, min(end, video_duration_s))


def split_words(text: str) -> list[str]:
    return [w for w in (text or "").split() if w]


def even_word_timings(
    text: str, start_s: float, end_s: float,
) -> list[dict[str, Any]]:
    """Distribute words evenly across [start_s, end_s)."""
    words = split_words(text)
    if not words:
        return []
    span = max(0.0, end_s - start_s)
    slot = span / len(words) if span > 0 else 0.0
    out: list[dict[str, Any]] = []
    for i, word in enumerate(words):
        w_start = start_s + i * slot
        w_end = start_s + (i + 1) * slot if i < len(words) - 1 else end_s
        if w_end < w_start:
            w_end = w_start
        out.append({"word": word, "start": w_start, "end": w_end})
    return out


def _ends_with_hard_break(word_text: str) -> bool:
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (".", "!", "?", "\u2026")


def _ends_with_soft_break(word_text: str) -> bool:
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (",", ";", "\u2014", ":")


def _token_key(word_text: str) -> str:
    return normalize_word(word_text)


def _is_phrase_continuation(current: list[dict[str, Any]], next_word: dict[str, Any]) -> bool:
    """True if flushing now would split Tai Chi / Torah Tai Chi / etc."""
    if not current:
        return False
    keys = [_token_key(w["word"]) for w in current]
    nxt = _token_key(next_word["word"])
    if not nxt:
        return False
    for phrase in KEEP_TOGETHER:
        for i in range(len(phrase) - 1):
            need = list(phrase[: i + 1])
            if keys[-len(need):] == need and nxt == phrase[i + 1]:
                return True
    return False


def _trailing_phrase_prefix_len(current: list[dict[str, Any]]) -> int:
    keys = [_token_key(w["word"]) for w in current]
    best = 0
    for phrase in KEEP_TOGETHER:
        for i in range(1, len(phrase)):
            if keys[-i:] == list(phrase[:i]):
                best = max(best, i)
    return best


def _ends_mid_phrase(current: list[dict[str, Any]]) -> bool:
    return _trailing_phrase_prefix_len(current) > 0


def group_words_into_cues(
    words: list[dict[str, Any]],
    max_words: int = MAX_WORDS_PER_CUE,
    max_chars: int = MAX_CUE_CHARS,
) -> list[dict[str, Any]]:
    """Group word-level timings into short, readable caption cues."""
    cues: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        text = " ".join(w["word"] for w in current)
        cues.append({
            "text": text,
            "start": current[0]["start"],
            "end": current[-1]["end"],
        })
        current.clear()

    for w in words:
        trial = current + [w]
        trial_text = " ".join(x["word"] for x in trial)
        overflow = (
            current
            and (
                len(trial) > max_words
                or len(trial_text) > max_chars
            )
        )
        if overflow:
            if _is_phrase_continuation(current, w):
                # Keep "Torah Tai" + "Chi" in one cue even if it busts the budget.
                pass
            else:
                prefix = _trailing_phrase_prefix_len(current)
                if prefix and prefix < len(current):
                    held = current[-prefix:]
                    del current[-prefix:]
                    flush()
                    current.extend(held)
                else:
                    flush()
        current.append(w)
        word_text = w["word"]
        hit_max = len(current) >= max_words or len(" ".join(x["word"] for x in current)) >= max_chars
        hard = _ends_with_hard_break(word_text)
        soft = _ends_with_soft_break(word_text) and len(current) >= 2
        # Do not flush mid-phrase on a char/word budget hit; wait for the rest.
        if hard or (soft and not _ends_mid_phrase(current)) or (hit_max and not _ends_mid_phrase(current)):
            flush()
    flush()
    return cues


def _merge_cue_pair(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    return {
        **a,
        "text": f"{a['text']} {b['text']}".strip(),
        "start": a["start"],
        "end": max(float(a["end"]), float(b["end"])),
    }


def _cue_word_count(cue: dict[str, Any]) -> int:
    return len([w for w in str(cue.get("text") or "").split() if w])


def _cues_split_a_phrase(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """True when cue A ends mid 'Tai Chi' / 'Torah Tai Chi' and B continues it."""
    dummy = [{"word": w} for w in str(a.get("text") or "").split()]
    first = str(b.get("text") or "").split()[:1]
    if not dummy or not first:
        return False
    return _is_phrase_continuation(dummy, {"word": first[0]})


def polish_caption_cues(
    cues: list[dict[str, Any]],
    *,
    content_end: float | None = None,
    min_duration: float = MIN_CUE_DURATION_S,
) -> list[dict[str, Any]]:
    """Keep phrases together, merge 1-word tails, and enforce a minimum duration.

    If content_end is given, a cue that would be truncated to a flash is
    merged into the previous cue (or dropped) so nothing appears for one
    frame against the end card.
    """
    out = [dict(c) for c in cues if str(c.get("text") or "").strip()]
    if not out:
        return []

    def merge_pass(should_merge) -> None:
        i = 1
        while i < len(out):
            if should_merge(out[i - 1], out[i], i == len(out) - 1):
                out[i - 1] = _merge_cue_pair(out[i - 1], out[i])
                del out[i]
            else:
                i += 1

    merge_pass(lambda a, b, _last: _cues_split_a_phrase(a, b))

    def short_tail(a: dict[str, Any], b: dict[str, Any], is_last: bool) -> bool:
        if _cue_word_count(b) != 1:
            return False
        # Always fold a 1-word final chunk into the previous cue.
        if is_last:
            return True
        # Mid-video: fold danglers that are not a new sentence after a stop.
        if _ends_with_hard_break(str(a.get("text") or "").split()[-1]):
            return False
        return True

    merge_pass(short_tail)

    # Minimum on-screen time: fold a short cue into its neighbour.
    i = 0
    while i < len(out):
        dur = float(out[i]["end"]) - float(out[i]["start"])
        if dur + 1e-9 >= min_duration:
            i += 1
            continue
        if i > 0:
            out[i - 1] = _merge_cue_pair(out[i - 1], out[i])
            del out[i]
            continue
        if i + 1 < len(out):
            out[i] = _merge_cue_pair(out[i], out[i + 1])
            del out[i + 1]
            continue
        # Lone short cue: stretch to min_duration if we have a content_end,
        # otherwise leave it for the clipper.
        if content_end is not None:
            out[i]["end"] = min(float(content_end), float(out[i]["start"]) + min_duration)
        i += 1

    if content_end is not None:
        out = _clip_cues_to_content(out, content_end)
        # After clipping, fold or drop a truncated flash at the end card.
        while out:
            last = out[-1]
            dur = float(last["end"]) - float(last["start"])
            if dur + 1e-9 >= min_duration:
                break
            if len(out) == 1:
                out = []
                break
            prev = out[-2]
            out[-2] = {
                **prev,
                "text": f"{prev['text']} {last['text']}".strip(),
                "start": prev["start"],
                "end": min(float(content_end), max(float(prev["end"]), float(last["end"]))),
            }
            del out[-1]
            out = _clip_cues_to_content(out, content_end)
    return out


def scale_clip_windows(
    clips: Sequence[ClipTranscript], content_end: float,
) -> list[tuple[float, float]]:
    """Map each clip onto [0, content_end) in proportion to duration_s."""
    if not clips or content_end <= 0:
        return [(0.0, 0.0)] * len(clips)
    planned = [max(0.0, c.duration_s) for c in clips]
    total = sum(planned)
    if total <= 0:
        slot = content_end / len(clips)
        return [(i * slot, (i + 1) * slot) for i in range(len(clips))]
    scale = content_end / total
    windows: list[tuple[float, float]] = []
    cursor = 0.0
    for i, dur in enumerate(planned):
        start = cursor
        end = content_end if i == len(planned) - 1 else cursor + dur * scale
        windows.append((start, end))
        cursor = end
    return windows


def even_split_caption_words(
    clips: Sequence[ClipTranscript],
    content_end: float,
    caption_override: str = "",
) -> list[dict[str, Any]]:
    """Fallback: even word-count split across the override or each clip."""
    override = (caption_override or "").strip()
    if override:
        return even_word_timings(override, 0.0, content_end)
    words: list[dict[str, Any]] = []
    for clip, (start, end) in zip(clips, scale_clip_windows(clips, content_end)):
        words.extend(even_word_timings(clip.voiceover, start, end))
    return words


def caption_cues_for_clips(
    clips: Sequence[ClipTranscript],
    content_end: float,
    caption_override: str = "",
    timed_words: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Build spoken-caption cues, clipped to the content timeline.

    Prefer precomputed (audio-aligned) word timings when they are
    provided and non-empty. Otherwise fall back to an even split.
    """
    words = list(timed_words) if timed_words else []
    if not words:
        words = even_split_caption_words(clips, content_end, caption_override)
    cues = group_words_into_cues(words)
    return polish_caption_cues(cues, content_end=content_end)


def _clip_cues_to_content(
    cues: list[dict[str, Any]], content_end: float,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for cue in cues:
        start = max(0.0, min(float(cue["start"]), content_end))
        end = max(start, min(float(cue["end"]), content_end))
        if end - start <= 0.01 or start >= content_end:
            continue
        out.append({**cue, "start": start, "end": end})
    return out


def suppress_captions_during_hook(
    cues: Sequence[dict[str, Any]],
    hook_end: float | None,
) -> list[dict[str, Any]]:
    """Drop caption cues that start while the hook is still on screen.

    Simple time-window rule, not text matching: if a hook is shown, any
    cue whose start is before hook_end is omitted, including a cue that
    straddles the boundary. Starting that cue at hook_end would flash
    the same words (or a mid-phrase fragment) just as the gold hook
    disappears. Cues that begin at or after hook_end are unchanged.
    With no hook (hook_end is None or <= 0), the cues are returned as-is.
    """
    if hook_end is None or hook_end <= 0:
        return [dict(cue) for cue in cues]
    kept: list[dict[str, Any]] = []
    for cue in cues:
        if float(cue["start"]) + 1e-9 >= float(hook_end):
            kept.append(dict(cue))
    return kept


def hook_cue(hook_text: str, content_end: float, duration_s: float = HOOK_DURATION_S) -> dict[str, Any] | None:
    text = " ".join(split_words(hook_text))
    if not text or content_end <= 0:
        return None
    end = min(max(0.0, duration_s), content_end)
    if end <= 0.05:
        return None
    return {"text": text, "start": 0.0, "end": end, "role": "hook"}


def max_chars_for_font(usable_width: int, font_size: int) -> int:
    """How many characters fit on one line at this font size."""
    if font_size <= 0 or usable_width <= 0:
        return 8
    return max(8, int(usable_width / (font_size * CHAR_WIDTH_FRAC)))


def tokenize_for_wrap(text: str) -> list[str]:
    """Split on whitespace and on dashes so a long hook can wrap mid-phrase."""
    raw = text or ""
    for dash in ("—", "–"):
        raw = raw.replace(dash, dash + " ")
    return [w for w in raw.split() if w]


def wrap_cue_text(
    text: str,
    max_chars: int = MAX_CUE_CHARS,
    max_lines: int = CAPTION_MAX_LINES,
) -> str:
    """Wrap into at most max_lines, breaking at spaces so glyphs stay on-frame."""
    words = tokenize_for_wrap(text)
    if not words:
        return ""
    joined = " ".join(words)
    if len(joined) <= max_chars or len(words) == 1:
        return joined
    lines: list[list[str]] = [[]]
    for word in words:
        trial = (" ".join(lines[-1] + [word])).strip() if lines[-1] else word
        if lines[-1] and len(trial) > max_chars:
            if len(lines) >= max_lines:
                lines[-1].append(word)
            else:
                lines.append([word])
        else:
            lines[-1].append(word)
    # Don't leave a tiny orphan ("a", "the") alone on the last line.
    if (
        len(lines) >= 2
        and len(lines[-1]) == 1
        and len(lines[-1][0]) <= 3
        and lines[-2]
    ):
        stolen = lines[-2].pop()
        lines[-1].insert(0, stolen)
        if not lines[-2]:
            lines.pop(-2)
    return r"\N".join(" ".join(part) for part in lines if part)


def escape_ass_text(text: str) -> str:
    """Escape ASS override specials, leaving wrap_cue_text's \\N breaks intact."""
    def esc(part: str) -> str:
        return part.replace("\\", "\\\\").replace("{", "").replace("}", "")
    return r"\N".join(esc(part) for part in text.split(r"\N"))


def _fmt_ass_time(t: float) -> str:
    if t < 0:
        t = 0.0
    cs_total = int(round(t * 100))
    h, rem = divmod(cs_total, 3600 * 100)
    m, rem = divmod(rem, 60 * 100)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def resolve_font_path(font_path: Path | None = None) -> Path:
    path = Path(font_path) if font_path else Path(
        os.environ.get("TORAH_TAI_CHI_CAPTION_FONT", DEFAULT_FONT_PATH)
    )
    if not path.is_file():
        raise FileNotFoundError(
            f"Bundled caption font missing: {path}. "
            "Inter-Bold.ttf must ship in references/_brand/fonts/."
        )
    return path



def _caption_position_windows(
    cue: dict[str, Any],
    hook_end: float | None,
    layout: OverlayLayout,
) -> list[tuple[float, float, int]]:
    """Caption Y may change at the end of the hook when the hook sits low."""
    start = float(cue["start"])
    end = float(cue["end"])
    default_cy = layout.caption_cy
    hook_cy = layout.hook_window_caption_cy
    if hook_cy is None or hook_end is None or hook_end <= 0:
        return [(start, end, default_cy)]
    if end <= hook_end:
        return [(start, end, hook_cy)]
    if start >= hook_end:
        return [(start, end, default_cy)]
    windows: list[tuple[float, float, int]] = []
    if hook_end - start > 0.01:
        windows.append((start, hook_end, hook_cy))
    if end - hook_end > 0.01:
        windows.append((hook_end, end, default_cy))
    return windows or [(start, end, default_cy)]


def build_ass_file(
    *,
    caption_cues: list[dict[str, Any]],
    hook: dict[str, Any] | None,
    out_path: Path,
    layout: OverlayLayout,
) -> Path:
    """Write an ASS file with Hook + Caption styles, both in the safe zone."""
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {layout.video_w}
PlayResY: {layout.video_h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Caption,{FONT_FAMILY},{layout.caption_font},{CAPTION_PRIMARY},{OUTLINE_COLOUR},{SHADOW_COLOUR},-1,{layout.caption_outline},1,5,40,40,0
Style: Hook,{FONT_FAMILY},{layout.hook_font},{HOOK_PRIMARY},{OUTLINE_COLOUR},{SHADOW_COLOUR},-1,{layout.hook_outline},2,5,40,40,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines: list[str] = [header.rstrip("\n")]
    hook_end = float(hook["end"]) if hook else None
    caption_cues = suppress_captions_during_hook(caption_cues, hook_end)
    if hook:
        hook_text = escape_ass_text(wrap_cue_text(
            hook["text"], max_chars=layout.max_chars(layout.hook_font),
            max_lines=HOOK_MAX_LINES,
        ))
        hook_lines = hook_text.count(r"\N") + 1
        hook_y = hook_center_y(layout, hook_lines)
        pos = f"{{\\an5\\pos({layout.cx},{hook_y})}}"
        lines.append(
            f"Dialogue: 1,{_fmt_ass_time(hook['start'])},{_fmt_ass_time(hook['end'])},"
            f"Hook,,0,0,0,,{pos}{hook_text}"
        )
    for cue in caption_cues:
        text = escape_ass_text(wrap_cue_text(
            cue["text"], max_chars=layout.max_chars(layout.caption_font),
            max_lines=CAPTION_MAX_LINES,
        ))
        for c_start, c_end, cy in _caption_position_windows(cue, hook_end, layout):
            pos = f"{{\\an5\\pos({layout.cx},{cy})}}"
            lines.append(
                f"Dialogue: 0,{_fmt_ass_time(c_start)},{_fmt_ass_time(c_end)},"
                f"Caption,,0,0,0,,{pos}{text}"
            )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


def _escape_libass_path(path: Path) -> str:
    # ffmpeg subtitles filter: escape \ and : and the filter separators.
    text = str(path.resolve()).replace("\\", "/").replace(":", r"\:")
    text = text.replace("'", r"\'")
    return text


def burn_overlay_on_mp4(
    in_mp4: Path,
    out_mp4: Path,
    *,
    caption_cues: list[dict[str, Any]],
    hook: dict[str, Any] | None,
    video_w: int,
    video_h: int,
    font_path: Path | None = None,
    face: FaceBox | None = None,
) -> Path:
    layout = compute_layout(video_w, video_h)
    if hook:
        hook_wrapped = wrap_cue_text(
            hook["text"], max_chars=layout.max_chars(layout.hook_font),
            max_lines=HOOK_MAX_LINES,
        )
        hook_lines = (hook_wrapped.count(r"\N") + 1) if hook_wrapped else 1
        layout = adapt_overlay_layout(layout, face, hook_lines=hook_lines)
    font = resolve_font_path(font_path)
    ass_path = out_mp4.with_suffix(".ass")
    build_ass_file(
        caption_cues=caption_cues, hook=hook, out_path=ass_path, layout=layout,
    )
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    fontsdir = _escape_libass_path(font.parent)
    ass = _escape_libass_path(ass_path)
    vf = f"subtitles='{ass}':fontsdir='{fontsdir}'"
    result = subprocess.run(
        [
            os.environ.get("FFMPEG_BIN", "ffmpeg"), "-y",
            "-i", str(in_mp4),
            "-vf", vf,
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(out_mp4),
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", errors="replace")[-800:]
        raise RuntimeError(f"ffmpeg subtitle burn failed: {err}")
    return out_mp4


def probe_duration_s(mp4: Path) -> float:
    result = subprocess.run(
        [
            os.environ.get("FFPROBE_BIN", "ffprobe"),
            "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(mp4),
        ],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def probe_dimensions(mp4: Path) -> tuple[int, int]:
    result = subprocess.run(
        [
            os.environ.get("FFPROBE_BIN", "ffprobe"),
            "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(mp4),
        ],
        check=True, capture_output=True, text=True,
    )
    lines = result.stdout.strip().splitlines()
    return int(lines[0]), int(lines[1])


def settings_from_video_row(row: dict[str, Any] | None) -> OnScreenSettings:
    """Read overlay settings from a videos row (columns and/or stitch_settings).

    Columns are the source of truth when present; stitch_settings.on_screen
    is a fallback so compose still works if the migration has not been
    applied and the SELECT omitted the new columns.
    """
    row = row or {}
    nested = {}
    settings = row.get("stitch_settings") or {}
    if isinstance(settings, dict):
        raw = settings.get("on_screen") or {}
        if isinstance(raw, dict):
            nested = raw

    def _pick(col: str, key: str, default: str = "") -> str:
        if col in row and row[col] is not None:
            return str(row[col])
        val = nested.get(key, default)
        return "" if val is None else str(val)

    hook = _pick("hook_text", "hook_text").strip()
    override = _pick("caption_override", "caption_override").strip()
    if "burn_on_screen_text" in row and row["burn_on_screen_text"] is not None:
        enabled = bool(row["burn_on_screen_text"])
    elif "enabled" in nested:
        enabled = bool(nested.get("enabled"))
    else:
        enabled = bool(hook or override)
    return OnScreenSettings(
        enabled=enabled,
        hook_text=hook,
        caption_override=override,
    )


def should_burn(settings: OnScreenSettings, clips: Sequence[ClipTranscript]) -> bool:
    if not settings.enabled:
        return False
    if settings.hook_text.strip():
        return True
    if settings.caption_override.strip():
        return True
    return any((c.voiceover or "").strip() for c in clips)


def resolve_timed_words(
    audio_path: Path,
    clips: Sequence[ClipTranscript],
    caption_override: str,
    content_end: float,
    *,
    align_audio: bool = True,
    timed_words: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return audio-aligned script-word timings, or [] to trigger even split."""
    if timed_words:
        return list(timed_words)
    if not align_audio:
        return []
    script = script_text_for_captions(clips, caption_override)
    if not script:
        return []
    try:
        return timed_script_words(audio_path, script, content_end)
    except Exception as err:
        print(
            f"[overlay] speech alignment failed "
            f"({type(err).__name__}: {err}); using even word-count split"
        )
        return []


def apply_on_screen_overlay(
    in_mp4: Path,
    out_mp4: Path,
    *,
    clips: Sequence[ClipTranscript],
    settings: OnScreenSettings,
    outro_duration_s: float,
    font_path: Path | None = None,
    timed_words: Sequence[dict[str, Any]] | None = None,
    align_audio: bool = True,
    detect_face: bool = True,
    face: FaceBox | None = None,
) -> Path:
    """Burn hook + captions onto one already-stitched ending (follow or subscribe)."""
    video_w, video_h = probe_dimensions(in_mp4)
    video_dur = probe_duration_s(in_mp4)
    content_end = content_end_s(video_dur, outro_duration_s)
    aligned = resolve_timed_words(
        in_mp4, clips, settings.caption_override, content_end,
        align_audio=align_audio, timed_words=timed_words,
    )
    captions = caption_cues_for_clips(
        clips, content_end,
        caption_override=settings.caption_override,
        timed_words=aligned or None,
    )
    hook = hook_cue(settings.hook_text, content_end, settings.hook_duration_s)
    if hook and detect_face and face is None:
        try:
            face = detect_face_in_clip(
                in_mp4, end_s=min(settings.hook_duration_s, content_end or 0.0),
            )
        except Exception as err:
            print(
                f"[overlay] face detection failed "
                f"({type(err).__name__}: {err}); using default hook placement"
            )
            face = None
    return burn_overlay_on_mp4(
        in_mp4, out_mp4,
        caption_cues=captions, hook=hook,
        video_w=video_w, video_h=video_h,
        font_path=font_path,
        face=face,
    )
