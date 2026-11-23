"""Hook placement that clears the face, and end-of-video cue polish."""
from __future__ import annotations

import pytest

from src.face_detect import FaceBox, pick_hero_face
from src.on_screen_overlay import (
    MIN_CUE_DURATION_S,
    ClipTranscript,
    adapt_overlay_layout,
    caption_box,
    caption_cues_for_clips,
    compute_layout,
    even_word_timings,
    group_words_into_cues,
    hook_box,
    polish_caption_cues,
)


def test_group_words_keeps_torah_tai_chi_together():
    # This is the Vayishlach ending that shipped as "weekly Torah Tai" then "Chi."
    text = "subscribe for more weekly Torah Tai Chi."
    words = even_word_timings(text, 46.0, 48.2)
    cues = group_words_into_cues(words)
    joined = [c["text"] for c in cues]
    assert all("Chi" not in t or "Tai" in t for t in joined)
    assert any("Tai Chi" in t or "Torah Tai Chi" in t for t in joined)
    assert not any(t.strip() in {"Chi", "Chi."} for t in joined)


def test_group_words_keeps_tai_chi_even_when_char_budget_is_tight():
    words = even_word_timings("weekly Torah Tai Chi.", 0.0, 2.0)
    cues = group_words_into_cues(words, max_words=4, max_chars=18)
    texts = [c["text"] for c in cues]
    assert any("Torah Tai Chi" in t or "Tai Chi" in t for t in texts)
    assert not any(t.strip() in {"Chi", "Chi."} for t in texts)


def test_polish_merges_a_one_word_dangling_final_chunk():
    cues = [
        {"text": "weekly Torah Tai", "start": 47.0, "end": 47.80},
        {"text": "Chi.", "start": 47.80, "end": 48.00},
    ]
    out = polish_caption_cues(cues, content_end=48.54)
    assert len(out) == 1
    assert "Tai Chi" in out[0]["text"]
    assert out[0]["start"] == pytest.approx(47.0)
    assert out[0]["end"] == pytest.approx(48.00)


def test_polish_drops_or_merges_a_truncated_flash_at_content_end():
    cues = [
        {"text": "for more weekly", "start": 46.0, "end": 47.6},
        {"text": "Torah Tai Chi.", "start": 47.6, "end": 48.6},
    ]
    # content_end clips the last cue to 0.1s — too short to flash.
    out = polish_caption_cues(cues, content_end=47.7, min_duration=0.40)
    assert out
    assert all(c["end"] - c["start"] >= 0.40 - 1e-9 for c in out)
    assert all(c["end"] <= 47.7 + 1e-9 for c in out)
    # The phrase stays together in the last visible cue, not a 1-frame leftover.
    assert "Tai Chi" in out[-1]["text"]


def test_polish_enforces_minimum_cue_duration_by_merging():
    cues = [
        {"text": "click to follow", "start": 10.0, "end": 10.50},
        {"text": "or subscribe", "start": 10.50, "end": 10.70},  # 0.20s
    ]
    out = polish_caption_cues(cues, min_duration=0.40)
    assert len(out) == 1
    assert out[0]["text"] == "click to follow or subscribe"
    assert out[0]["end"] - out[0]["start"] == pytest.approx(0.70)
    assert MIN_CUE_DURATION_S == 0.40


def test_caption_cues_for_clips_apply_polish():
    script = (
        "Share this with someone facing a tough battle right now—and "
        "click to follow or subscribe for more weekly Torah Tai Chi."
    )
    clips = [ClipTranscript(0, script, 48.54)]
    cues = caption_cues_for_clips(clips, 48.54)
    texts = [c["text"] for c in cues]
    assert not any(t.strip() in {"Chi", "Chi."} for t in texts)
    assert any("Tai Chi" in t or "Torah Tai Chi" in t for t in texts)
    assert all(c["end"] - c["start"] >= MIN_CUE_DURATION_S - 1e-9 for c in cues)
    assert cues[-1]["end"] <= 48.54 + 1e-9


def test_high_face_moves_hook_to_lower_safe_zone_clear_of_the_head():
    # Measured YuNet box on Yonah's Vayishlach hook window (720x1280).
    face = FaceBox(left=282, top=239, right=447, bottom=477, score=0.928)
    layout = adapt_overlay_layout(compute_layout(720, 1280), face, hook_lines=2)
    hook = hook_box(layout, lines=2)
    assert layout.hook_placement == "below"
    assert hook.bottom == layout.safe_bottom  # 65% line
    assert hook.top >= face.bottom
    # Hook is fully in the safe zone and no longer sits on the forehead
    # (face top is ~18.6%; the old 15–26.5% hook overlapped it).
    assert hook.top / 1280 >= 0.45
    assert hook.top >= layout.safe_top
    assert hook.bottom <= layout.safe_bottom
    # Captions during the hook window sit in the gap under the chin.
    assert layout.hook_window_caption_cy is not None
    from dataclasses import replace
    mid_layout = replace(layout, caption_cy=layout.hook_window_caption_cy)
    mid = caption_box(mid_layout, lines=2)
    assert mid.top >= face.bottom
    assert mid.bottom <= hook.top
    assert mid.top >= layout.safe_top
    assert mid.bottom <= layout.safe_bottom
    # After the hook, default mid-torso captions are unchanged.
    cap = caption_box(layout, lines=2)
    assert cap.top > 600


def test_low_face_keeps_the_hook_in_the_ceiling_band():
    # Vayeitzei sample: face top ~26%, plenty of room under the 14% line.
    face = FaceBox(left=261, top=334, right=464, bottom=629, score=0.924)
    layout = adapt_overlay_layout(compute_layout(720, 1280), face, hook_lines=2)
    hook = hook_box(layout, lines=2)
    assert layout.hook_placement == "above"
    assert hook.top == layout.safe_top
    assert hook.bottom <= face.top
    assert hook.bottom < 410
    assert layout.hook_window_caption_cy is None


def test_no_face_keeps_default_top_hook():
    layout = adapt_overlay_layout(compute_layout(720, 1280), None, hook_lines=2)
    hook = hook_box(layout, lines=2)
    assert layout.hook_placement == "above"
    assert hook.top == layout.safe_top
    assert hook.bottom / 1280 <= 0.30


def test_pick_hero_face_ignores_tiny_side_boxes():
    hero = FaceBox(left=282, top=239, right=447, bottom=477, score=0.93)
    leaf = FaceBox(left=4, top=468, right=30, bottom=508, score=0.40)
    picked = pick_hero_face([hero, leaf], 720, 1280)
    assert picked == hero
    assert pick_hero_face([leaf], 720, 1280) is None
