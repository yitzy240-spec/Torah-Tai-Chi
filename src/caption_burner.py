"""Burn word-timed subtitles onto the stitched video.

Flow:
  1. Align the known voiceover text to the stitched audio via Whisper forced
     alignment (more accurate than blind transcription because we already
     know what was said).
  2. Group aligned words into phrase-sized cues (3-6 words, breaking at
     natural pause markers: ellipsis, em-dash, period, comma).
  3. Write an ASS subtitle file with per-clip positioning derived from each
     clip's caption_position field in the ClipPlan.
  4. Invoke ffmpeg with `-vf subtitles=...` to burn the subs into a new mp4.

Used by tools/generate.py after src/stitcher.py produces the stitched mp4.
"""
from __future__ import annotations
import re
import subprocess
from pathlib import Path
from typing import Any

from src.models import ClipPlan


_PAUSE_RE = re.compile(r"[.!?\u2026]|[\u2014]|,")
_MAX_WORDS_PER_CUE = 6


def _ends_with_hard_break(word_text: str) -> bool:
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (".", "!", "?", "\u2026")


def _ends_with_soft_break(word_text: str) -> bool:
    cleaned = word_text.rstrip("\"'\u201d")
    return bool(cleaned) and cleaned[-1] in (",", "\u2014")


def group_words_into_cues(
    words: list[dict[str, Any]],
    max_words: int = _MAX_WORDS_PER_CUE,
) -> list[dict[str, Any]]:
    """Group word-level Whisper output into phrase-sized caption cues."""
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
        current.append(w)
        word_text = w["word"]
        hit_max = len(current) >= max_words
        hard = _ends_with_hard_break(word_text)
        soft = _ends_with_soft_break(word_text) and len(current) >= 3
        if hard or soft or hit_max:
            flush()
    flush()
    return cues


def ass_position_tag(
    position: str, video_w: int, video_h: int,
) -> str:
    """ASS inline override for a given caption_position.

    bottom: no override (default bottom-aligned style handles it)
    top:    inline an8 (top-center align) + pos() at top 15%
    middle: inline an5 (center align) + pos() at vertical center
    """
    if position == "bottom":
        return ""
    cx = video_w // 2
    if position == "top":
        cy = int(video_h * 0.15)
        return f"{{\\an8\\pos({cx},{cy})}}"
    if position == "middle":
        cy = int(video_h * 0.5)
        return f"{{\\an5\\pos({cx},{cy})}}"
    return ""


def _fmt_ass_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def build_ass_file(
    cues: list[dict[str, Any]],
    out_path: Path,
    video_w: int,
    video_h: int,
) -> Path:
    """Write an ASS subtitle file with subtle styling + per-cue positioning."""
    font_size = max(24, int(video_h * 0.042))
    margin_v = max(40, int(video_h * 0.08))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Default,Inter Medium,{font_size},&H00FFFFFF,&H00000000,&H00000000,0,2,1,2,60,60,{margin_v}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    lines: list[str] = [header]
    for cue in cues:
        pos_override = ass_position_tag(
            cue.get("position", "bottom"), video_w, video_h,
        )
        start = _fmt_ass_time(cue["start"])
        end = _fmt_ass_time(cue["end"])
        text = cue["text"].replace("\n", " ")
        text_with_pos = pos_override + text
        lines.append(
            f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text_with_pos}"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def burn_cues_to_mp4(
    in_mp4: Path, cues: list[dict[str, Any]], out_mp4: Path,
    video_w: int, video_h: int,
) -> Path:
    """Given a prepared cues list, build ASS + burn into video."""
    ass_path = out_mp4.with_suffix(".ass")
    build_ass_file(cues, ass_path, video_w, video_h)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    ass_for_filter = (
        str(ass_path.resolve()).replace("\\", "/").replace(":", "\\:")
    )
    subprocess.run([
        "ffmpeg", "-y", "-i", str(in_mp4),
        "-vf", f"subtitles='{ass_for_filter}'",
        "-c:a", "copy",
        str(out_mp4),
    ], check=True, capture_output=True)
    return out_mp4


def _probe_video_dimensions(mp4: Path) -> tuple[int, int]:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(mp4),
    ], check=True, capture_output=True, text=True)
    lines = result.stdout.strip().splitlines()
    return int(lines[0]), int(lines[1])


def _words_for_plan(
    stitched_mp4: Path, plan: ClipPlan, model_size: str = "small",
) -> list[dict[str, Any]]:
    """Use Whisper forced alignment on the known voiceover text."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    expected = " ".join(c.voiceover for c in plan.clips)
    segments, _info = model.transcribe(
        str(stitched_mp4),
        initial_prompt=expected,
        word_timestamps=True,
        beam_size=5,
    )
    words: list[dict[str, Any]] = []
    for seg in segments:
        for w in (seg.words or []):
            words.append({
                "word": w.word.strip(),
                "start": float(w.start),
                "end": float(w.end),
            })
    return words


def _clip_time_boundaries(plan: ClipPlan) -> list[tuple[float, float]]:
    """Return [(start_s, end_s)] for each clip, accounting for xfade overlap."""
    xfade = 0.5
    boundaries = []
    cursor = 0.0
    for i, c in enumerate(plan.clips):
        start = cursor
        end = start + c.duration_s - (0 if i == len(plan.clips) - 1 else xfade)
        boundaries.append((start, end))
        cursor = end
    return boundaries


def _assign_positions(
    cues: list[dict[str, Any]], plan: ClipPlan,
) -> list[dict[str, Any]]:
    boundaries = _clip_time_boundaries(plan)
    out = []
    for cue in cues:
        mid = (cue["start"] + cue["end"]) / 2
        position = plan.clips[-1].caption_position
        for i, (s, e) in enumerate(boundaries):
            if s <= mid < e:
                position = plan.clips[i].caption_position
                break
        out.append({**cue, "position": position})
    return out


def burn_captions(
    stitched_mp4: Path, plan: ClipPlan, out_mp4: Path,
    model_size: str = "small",
) -> Path:
    """Full pipeline: align, cue, position, burn."""
    video_w, video_h = _probe_video_dimensions(stitched_mp4)
    words = _words_for_plan(stitched_mp4, plan, model_size=model_size)
    cues = group_words_into_cues(words)
    cues = _assign_positions(cues, plan)
    burn_cues_to_mp4(stitched_mp4, cues, out_mp4, video_w, video_h)
    return out_mp4
