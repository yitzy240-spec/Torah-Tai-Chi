"""Time script words to speech without changing the on-screen wording.

The spoken caption *text* always comes from the clip voiceover (or the
admin caption override), word for word. Audio is used only to recover
when each of those words is spoken:

  1. Transcribe the stitched soundtrack with local faster-whisper
     (CPU, no paid API, no new secrets).
  2. Map each script word onto a recognized word timestamp with a
     tolerant SequenceMatcher + similarity alignment.
  3. Even-split any unaligned span between its neighboring anchors.
  4. If too little of the script can be anchored, fall back to an even
     word-count split over the content window.

The Whisper model is imported lazily so unit tests and the dashboard
never need it.
"""
from __future__ import annotations

import difflib
import re
import unicodedata
from pathlib import Path
from typing import Any, Sequence

# Drop below this fraction of anchored script words and the caller should
# treat the whole segment as unaligned (even-split fallback).
MIN_ANCHOR_RATIO = 0.40
DEFAULT_WHISPER_MODEL = "base"
_WORD_RE = re.compile(r"[^a-z0-9]+")

_whisper_model = None
_whisper_model_name: str | None = None


def normalize_word(word: str) -> str:
    """Fold a token for matching: case, accents, punctuation, apostrophes."""
    text = unicodedata.normalize("NFKD", word or "")
    text = text.encode("ascii", "ignore").decode("ascii")
    return _WORD_RE.sub("", text.lower())


def words_are_similar(a: str, b: str) -> bool:
    """True when two already-normalized tokens should be treated as a match."""
    if not a or not b:
        return False
    if a == b:
        return True
    if a.rstrip("s") == b.rstrip("s") and min(len(a), len(b)) >= 3:
        return True
    # Names and romanizations often differ by a letter (Yaakov/Yakov, Sui/Suei).
    if len(a) >= 3 and len(b) >= 3 and (a in b or b in a):
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def _pair_replace(
    script_slice: list[tuple[int, str]],
    rec_slice: list[tuple[int, str]],
) -> list[tuple[int, int]]:
    """Best-effort pairs inside a SequenceMatcher 'replace' block."""
    if not script_slice or not rec_slice:
        return []
    a_norms = [n for _, n in script_slice]
    b_norms = [n for _, n in rec_slice]
    matcher = difflib.SequenceMatcher(a=a_norms, b=b_norms, autojunk=False)
    pairs: list[tuple[int, int]] = []
    used_rec: set[int] = set()
    used_script: set[int] = set()
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            continue
        for k in range(i2 - i1):
            si = script_slice[i1 + k][0]
            ri = rec_slice[j1 + k][0]
            pairs.append((si, ri))
            used_script.add(si)
            used_rec.add(ri)
    # Greedy similarity pass for leftovers, preserving order.
    rec_cursor = 0
    for s_idx, s_norm in script_slice:
        if s_idx in used_script or not s_norm:
            continue
        best: tuple[int, int] | None = None
        for offset, (r_idx, r_norm) in enumerate(rec_slice[rec_cursor:], start=rec_cursor):
            if r_idx in used_rec or not r_norm:
                continue
            if words_are_similar(s_norm, r_norm):
                best = (offset, r_idx)
                break
        if best is not None:
            rec_cursor, r_idx = best
            pairs.append((s_idx, r_idx))
            used_script.add(s_idx)
            used_rec.add(r_idx)
            rec_cursor += 1
    return pairs


def align_script_to_timings(
    script_words: Sequence[str],
    recognized: Sequence[dict[str, Any]],
    *,
    min_anchor_ratio: float = MIN_ANCHOR_RATIO,
) -> list[dict[str, Any]]:
    """Map script words onto recognized word timings.

    Returns a list of {word, start, end, aligned} in script order, or an
    empty list when too few words can be anchored (caller should fall
    back to an even split).
    """
    if not script_words:
        return []
    script_norm = [(i, normalize_word(w)) for i, w in enumerate(script_words)]
    rec_items = [
        (i, normalize_word(str(w.get("word") or "")))
        for i, w in enumerate(recognized)
    ]
    rec_usable = [(i, n) for i, n in rec_items if n]
    if not rec_usable:
        return []

    matcher = difflib.SequenceMatcher(
        a=[n for _, n in script_norm],
        b=[n for _, n in rec_usable],
        autojunk=False,
    )
    anchors: dict[int, tuple[float, float]] = {}
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                script_i = script_norm[i1 + k][0]
                rec_i = rec_usable[j1 + k][0]
                anchors[script_i] = (
                    float(recognized[rec_i]["start"]),
                    float(recognized[rec_i]["end"]),
                )
        elif tag == "replace":
            for script_i, rec_i in _pair_replace(
                script_norm[i1:i2], rec_usable[j1:j2],
            ):
                anchors[script_i] = (
                    float(recognized[rec_i]["start"]),
                    float(recognized[rec_i]["end"]),
                )

    if len(anchors) / len(script_words) < min_anchor_ratio:
        return []

    times: list[tuple[float, float] | None] = [None] * len(script_words)
    for i, span in anchors.items():
        times[i] = span

    def _avg_dur() -> float:
        durs = [max(0.0, e - s) for s, e in anchors.values()]
        if not durs:
            return 0.30
        return max(0.12, sum(durs) / len(durs))

    def _fill(lo: int, hi: int, start: float, end: float) -> None:
        n = hi - lo
        if n <= 0:
            return
        span = end - start
        if span <= 0:
            # Neighbors overlap or reversed — park the gap at `start`.
            for k in range(lo, hi):
                times[k] = (start, start)
            return
        slot = span / n
        for k, idx in enumerate(range(lo, hi)):
            times[idx] = (start + k * slot, start + (k + 1) * slot)

    i = 0
    n = len(script_words)
    avg = _avg_dur()
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        if i == 0 and j == n:
            return []
        if i == 0:
            gap_end = times[j][0]  # type: ignore[index]
            gap_start = max(0.0, gap_end - avg * (j - i))
            _fill(i, j, gap_start, gap_end)
        elif j == n:
            gap_start = times[i - 1][1]  # type: ignore[index]
            _fill(i, j, gap_start, gap_start + avg * (j - i))
        else:
            _fill(i, j, times[i - 1][1], times[j][0])  # type: ignore[index]
        i = j

    # Make starts monotonic and give zero-width words a short life.
    out: list[dict[str, Any]] = []
    prev_end = 0.0
    for idx, word in enumerate(script_words):
        start, end = times[idx]  # type: ignore[misc]
        start = max(0.0, start)
        end = max(start, end)
        if start < prev_end:
            start = prev_end
            end = max(end, start)
        if end <= start:
            end = start + 0.05
        if out and start < out[-1]["end"]:
            # Don't pull the previous cue backward; just start here.
            start = out[-1]["end"]
            end = max(end, start + 0.05)
        out.append({
            "word": word,
            "start": start,
            "end": end,
            "aligned": idx in anchors,
        })
        prev_end = end
    return out


def script_text_for_captions(
    clips: Sequence[Any],
    caption_override: str = "",
) -> str:
    override = (caption_override or "").strip()
    if override:
        return override
    parts: list[str] = []
    for clip in clips:
        voice = getattr(clip, "voiceover", None)
        if voice is None and isinstance(clip, dict):
            voice = clip.get("voiceover")
        text = (voice or "").strip()
        if text:
            parts.append(text)
    return " ".join(parts)


def get_whisper_model(model_size: str = DEFAULT_WHISPER_MODEL):
    """Load (and cache) a CPU faster-whisper model."""
    global _whisper_model, _whisper_model_name
    if _whisper_model is not None and _whisper_model_name == model_size:
        return _whisper_model
    from faster_whisper import WhisperModel

    _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
    _whisper_model_name = model_size
    return _whisper_model


def transcribe_word_timings(
    audio_path: Path,
    *,
    prompt: str = "",
    model_size: str = DEFAULT_WHISPER_MODEL,
    content_end: float | None = None,
) -> list[dict[str, Any]]:
    """Return recognized {word, start, end} from a local Whisper pass."""
    model = get_whisper_model(model_size)
    hint = " ".join((prompt or "").split())
    # Whisper only consults a short initial prompt; keep the start of the script.
    if len(hint) > 800:
        hint = hint[:800]
    segments, _info = model.transcribe(
        str(audio_path),
        language="en",
        word_timestamps=True,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt=hint or None,
    )
    words: list[dict[str, Any]] = []
    for seg in segments:
        for w in (seg.words or []):
            token = (w.word or "").strip()
            if not token:
                continue
            start = float(w.start)
            end = float(w.end)
            if content_end is not None and start >= content_end:
                continue
            words.append({"word": token, "start": start, "end": end})
    return words


def timed_script_words(
    audio_path: Path,
    script_text: str,
    content_end: float,
    *,
    model_size: str = DEFAULT_WHISPER_MODEL,
    recognized: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Align script words to speech. Empty list means 'use the even split'."""
    words = [w for w in (script_text or "").split() if w]
    if not words:
        return []
    rec = list(recognized) if recognized is not None else transcribe_word_timings(
        audio_path, prompt=script_text, model_size=model_size, content_end=content_end,
    )
    if content_end > 0:
        rec = [w for w in rec if float(w["start"]) < content_end]
    aligned = align_script_to_timings(words, rec)
    if not aligned:
        return []
    # Drop anything that would paint over the end card.
    clipped: list[dict[str, Any]] = []
    for w in aligned:
        start = max(0.0, min(float(w["start"]), content_end))
        end = max(start, min(float(w["end"]), content_end))
        if end - start <= 0.01 or start >= content_end:
            continue
        clipped.append({**w, "start": start, "end": end})
    return clipped
