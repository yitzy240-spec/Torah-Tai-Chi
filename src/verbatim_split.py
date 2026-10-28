"""Deterministic verbatim draft → clip voiceover splitter.

Yonah pastes his weekly script and expects the five-clip plan to keep his
exact wording. The LLM plan generator historically rephrased (SYSTEM_TEMPLATE
said "rephrase / tighten"), which forced him to hand-fix every clip.

This module owns the only allowed transform of draft → per-clip voiceover:
split at sentence boundaries, pack into 3–8 clips that fit the Seedance
15s cap at ~2.6 wps when possible, and never rewrite a word. Chunks that
cannot fit 15s at the hard 3.0 wps ceiling stay verbatim and are flagged
``over_budget`` so the dashboard can warn.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

TARGET_WPS = 2.6
HARD_WPS = 3.0
MAX_DURATION_S = 15
MIN_DURATION_S = 4
MIN_CLIPS = 3
MAX_CLIPS = 8

# Max words that fit a 15s clip at target / hard WPS.
_MAX_WORDS_TARGET = int(MAX_DURATION_S * TARGET_WPS)  # 39
_MAX_WORDS_HARD = int(MAX_DURATION_S * HARD_WPS)  # 45

# Same abbreviation mask pattern as src/video_generator.py so "Dr. Cohen"
# does not false-split. Sentence ends: . ! ? followed by whitespace + capital
# (or end of string). We DO split on `?` here — packing boundaries are not
# the TTS beat injection path.
_ABBREV_MASK = re.compile(r"\b(Dr|Mr|Mrs|Ms|St|Sr|Jr|vs|etc)\.(\s+)(?=[A-Z])")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'])")


@dataclass(frozen=True)
class VerbatimChunk:
    voiceover: str
    duration_s: int
    over_budget: bool
    word_count: int


def split_sentences(draft: str) -> list[str]:
    """Split draft into sentences without altering any character inside one.

    Leading/trailing whitespace on the whole draft is stripped once; internal
    spacing within a sentence is preserved. Empty segments are dropped.
    """
    text = (draft or "").strip()
    if not text:
        return []
    masked = _ABBREV_MASK.sub(
        lambda m: f"{m.group(1)}\x00{m.group(2)}",
        text,
    )
    parts = _SENTENCE_END.split(masked)
    return [p.replace("\x00", ".").strip() for p in parts if p.strip()]


def _word_count(text: str) -> int:
    return len(text.split()) if text.strip() else 0


def _duration_for(words: int) -> tuple[int, bool]:
    """Return (duration_s, over_budget) for a word count.

    Prefer TARGET_WPS; cap at 15s. Flag over_budget when even 15s cannot
    keep HARD_WPS (<= 3.0).
    """
    if words <= 0:
        return MIN_DURATION_S, False
    needed = math.ceil(words / TARGET_WPS)
    duration = max(MIN_DURATION_S, min(needed, MAX_DURATION_S))
    over = words / MAX_DURATION_S > HARD_WPS
    return duration, over


def _pack_greedy(sentences: list[str], max_words: int) -> list[list[str]]:
    """Pack sentences into groups, never exceeding max_words unless one
    sentence alone is longer (then it gets its own group).
    """
    groups: list[list[str]] = []
    current: list[str] = []
    current_words = 0
    for sent in sentences:
        sw = _word_count(sent)
        if current and current_words + sw > max_words:
            groups.append(current)
            current = [sent]
            current_words = sw
        else:
            current.append(sent)
            current_words += sw
    if current:
        groups.append(current)
    return groups


def _join_group(group: list[str]) -> str:
    return " ".join(group)


def _rebalance_to_n(sentences: list[str], n: int) -> list[list[str]]:
    """Distribute sentences across exactly n groups, contiguous, by weight.

    Used when greedy packing yielded fewer than MIN_CLIPS groups — we still
    only split on sentence boundaries (never mid-sentence).
    """
    if n <= 1 or len(sentences) <= 1:
        return [sentences] if sentences else []
    n = min(n, len(sentences))
    total = sum(_word_count(s) for s in sentences) or 1
    target = total / n
    groups: list[list[str]] = []
    current: list[str] = []
    current_words = 0
    remaining_slots = n
    for i, sent in enumerate(sentences):
        remaining_sents = len(sentences) - i
        sw = _word_count(sent)
        # Must leave enough sentences for remaining slots after this group.
        must_close = (
            current
            and remaining_slots > 1
            and remaining_sents < remaining_slots
        )
        should_close = (
            current
            and remaining_slots > 1
            and current_words + sw > target
            and remaining_sents >= remaining_slots
        )
        if must_close or should_close:
            groups.append(current)
            remaining_slots -= 1
            current = [sent]
            current_words = sw
            # Recompute target for remaining words/slots.
            remaining_words = sum(_word_count(s) for s in sentences[i:]) or 1
            target = remaining_words / remaining_slots
        else:
            current.append(sent)
            current_words += sw
    if current:
        groups.append(current)
    # If we undershot n (edge cases), peel trailing sentences into new groups.
    while len(groups) < n:
        # Find a group with >=2 sentences to peel from.
        donor = next((g for g in reversed(groups) if len(g) >= 2), None)
        if donor is None:
            break
        peeled = donor.pop()
        groups.append([peeled])
    return groups[:n]


def _merge_to_max(groups: list[list[str]], max_groups: int) -> list[list[str]]:
    """Merge adjacent groups until count <= max_groups (still verbatim)."""
    groups = [list(g) for g in groups]
    while len(groups) > max_groups:
        # Merge the adjacent pair with the smallest combined word count.
        best_i = 0
        best_cost = float("inf")
        for i in range(len(groups) - 1):
            cost = _word_count(_join_group(groups[i])) + _word_count(
                _join_group(groups[i + 1])
            )
            if cost < best_cost:
                best_cost = cost
                best_i = i
        groups[best_i] = groups[best_i] + groups[best_i + 1]
        del groups[best_i + 1]
    return groups


def split_draft_verbatim(
    draft: str,
    *,
    min_clips: int = MIN_CLIPS,
    max_clips: int = MAX_CLIPS,
    target_wps: float = TARGET_WPS,
) -> list[VerbatimChunk]:
    """Split Yonah's draft into verbatim clip voiceovers.

    Returns 3–8 chunks (when the draft has enough sentences). Concatenating
    chunk voiceovers with a single space reproduces the sentence sequence of
    the draft (whitespace between sentences may normalize to one space).
    """
    del target_wps  # reserved for callers; packing uses module TARGET_WPS
    sentences = split_sentences(draft)
    if not sentences:
        return []

    groups = _pack_greedy(sentences, _MAX_WORDS_TARGET)

    if len(groups) < min_clips and len(sentences) >= min_clips:
        groups = _rebalance_to_n(sentences, min_clips)
    elif len(groups) < min_clips:
        # Fewer sentences than min_clips — one sentence per clip, then
        # duplicate is impossible without rewriting; keep fewer and let
        # the ClipPlan validator / prompt request pad visuals only when
        # the LLM path adds empty beats. Here we keep what we have.
        groups = [[s] for s in sentences]

    if len(groups) > max_clips:
        groups = _merge_to_max(groups, max_clips)

    chunks: list[VerbatimChunk] = []
    for group in groups:
        vo = _join_group(group)
        words = _word_count(vo)
        duration, over = _duration_for(words)
        chunks.append(
            VerbatimChunk(
                voiceover=vo,
                duration_s=duration,
                over_budget=over,
                word_count=words,
            )
        )
    return ensure_min_total_duration(chunks)


def concatenated_voiceovers(chunks: list[VerbatimChunk]) -> str:
    return " ".join(c.voiceover for c in chunks)


def apply_verbatim_voiceovers(
    clips: list[dict],
    chunks: list[VerbatimChunk],
) -> list[dict]:
    """Overwrite clip voiceover/duration from verbatim chunks.

    ``clips`` is a list of Clip-like dicts (from ClipPlan.model_dump or
    raw LLM JSON). Returns a new list with the same length as ``chunks``.
    Visual fields are reused by index when counts match; when the LLM
    returned a different count, visuals are taken from the nearest
    available clip so we never invent scene direction.
    """
    if not chunks:
        return clips
    out: list[dict] = []
    n_src = len(clips)
    for i, chunk in enumerate(chunks):
        if n_src == 0:
            src: dict = {}
        elif n_src == len(chunks):
            src = dict(clips[i])
        else:
            # Map i in [0, len(chunks)) onto [0, n_src).
            src_i = min(int(i * n_src / len(chunks)), n_src - 1)
            src = dict(clips[src_i])
        src["index"] = i
        src["voiceover"] = chunk.voiceover
        src["duration_s"] = chunk.duration_s
        src["over_budget"] = chunk.over_budget
        out.append(src)
    return out

def ensure_min_total_duration(
    chunks: list[VerbatimChunk],
    min_total: int = 28,
) -> list[VerbatimChunk]:
    """Pad per-clip duration_s (never text) so total meets ClipPlan minimum.

    Extra seconds are distributed round-robin up to MAX_DURATION_S. Text and
    over_budget flags are unchanged.
    """
    if not chunks:
        return chunks
    total = sum(c.duration_s for c in chunks)
    if total >= min_total:
        return list(chunks)
    durations = [c.duration_s for c in chunks]
    i = 0
    guard = 0
    while sum(durations) < min_total and guard < 10_000:
        if durations[i] < MAX_DURATION_S:
            durations[i] += 1
        i = (i + 1) % len(durations)
        guard += 1
        # If every clip is already at cap, stop — ClipPlan may still fail;
        # that means the draft needs more clips than MAX_CLIPS allows.
        if all(d >= MAX_DURATION_S for d in durations):
            break
    return [
        VerbatimChunk(
            voiceover=c.voiceover,
            duration_s=durations[j],
            over_budget=c.over_budget,
            word_count=c.word_count,
        )
        for j, c in enumerate(chunks)
    ]

