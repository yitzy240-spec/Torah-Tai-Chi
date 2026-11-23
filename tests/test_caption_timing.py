"""Audio-to-script word alignment for on-screen caption timing."""
from __future__ import annotations

import pytest

from src.caption_timing import (
    align_script_to_timings,
    normalize_word,
    script_text_for_captions,
    words_are_similar,
)
from src.on_screen_overlay import (
    ClipTranscript,
    caption_cues_for_clips,
    even_word_timings,
    group_words_into_cues,
    even_split_caption_words,
)


def test_normalize_word_folds_case_accents_and_punctuation():
    assert normalize_word("Yaakov") == "yaakov"
    assert normalize_word("Suí") == "sui"
    assert normalize_word("can't.") == "cant"
    assert normalize_word("—") == ""


def test_words_are_similar_accepts_close_name_spellings():
    assert words_are_similar("yaakov", "yakov")
    assert words_are_similar("sui", "suei")
    assert words_are_similar("adapting", "adapting")
    assert not words_are_similar("lavan", "leah")
    assert not words_are_similar("", "yaakov")


def test_align_script_to_timings_copies_matching_words():
    script = ["Are", "you", "afraid", "that", "adapting"]
    recognized = [
        {"word": "Are", "start": 0.10, "end": 0.28},
        {"word": "you", "start": 0.28, "end": 0.40},
        {"word": "afraid", "start": 0.40, "end": 0.80},
        {"word": "that", "start": 0.80, "end": 0.95},
        {"word": "adapting", "start": 0.95, "end": 1.40},
    ]
    out = align_script_to_timings(script, recognized)
    assert [w["word"] for w in out] == script
    assert all(w["aligned"] for w in out)
    assert out[0]["start"] == pytest.approx(0.10)
    assert out[-1]["end"] == pytest.approx(1.40)


def test_align_script_maps_similar_spellings_and_keeps_script_text():
    script = ["Yaakov", "meets", "Lavan"]
    recognized = [
        {"word": "Yakov", "start": 1.0, "end": 1.4},
        {"word": "meets", "start": 1.4, "end": 1.7},
        {"word": "Lavan.", "start": 1.7, "end": 2.1},
    ]
    out = align_script_to_timings(script, recognized)
    assert [w["word"] for w in out] == script  # script wording, not ASR
    assert out[0]["start"] == pytest.approx(1.0)
    assert out[2]["end"] == pytest.approx(2.1)
    assert all(w["aligned"] for w in out)


def test_align_script_interpolates_a_gap_between_anchors():
    script = ["He", "then", "spends", "twenty", "years"]
    recognized = [
        {"word": "He", "start": 0.0, "end": 0.2},
        # "then spends" missed by ASR
        {"word": "twenty", "start": 0.8, "end": 1.1},
        {"word": "years", "start": 1.1, "end": 1.4},
    ]
    out = align_script_to_timings(script, recognized)
    assert [w["word"] for w in out] == script
    assert out[0]["aligned"] is True
    assert out[1]["aligned"] is False
    assert out[2]["aligned"] is False
    assert out[3]["aligned"] is True
    # Gap is even-split between He.end and twenty.start.
    assert out[1]["start"] == pytest.approx(0.2)
    assert out[2]["end"] == pytest.approx(0.8)
    assert out[1]["end"] == pytest.approx(out[2]["start"])


def test_align_script_returns_empty_when_too_little_matches():
    script = ["Are", "you", "afraid", "that", "adapting", "means", "losing"]
    recognized = [
        {"word": "hello", "start": 0.0, "end": 0.3},
        {"word": "world", "start": 0.3, "end": 0.6},
    ]
    assert align_script_to_timings(script, recognized) == []


def test_align_script_ignores_extra_recognized_words():
    script = ["In", "Tai", "Chi"]
    recognized = [
        {"word": "um", "start": 0.0, "end": 0.15},
        {"word": "In", "start": 0.20, "end": 0.35},
        {"word": "Tai", "start": 0.35, "end": 0.55},
        {"word": "Chi", "start": 0.55, "end": 0.80},
        {"word": "yeah", "start": 0.80, "end": 1.00},
    ]
    out = align_script_to_timings(script, recognized)
    assert [w["word"] for w in out] == script
    assert out[0]["start"] == pytest.approx(0.20)
    assert out[-1]["end"] == pytest.approx(0.80)


def test_script_text_for_captions_prefers_override():
    clips = [ClipTranscript(0, "clip one words", 5.0)]
    assert script_text_for_captions(clips, "Override text here") == "Override text here"
    assert script_text_for_captions(clips, "  ") == "clip one words"
    assert script_text_for_captions(
        [ClipTranscript(0, "one", 1.0), ClipTranscript(1, "two three", 2.0)],
        "",
    ) == "one two three"


def test_caption_cues_use_provided_timed_words_not_even_split():
    clips = [ClipTranscript(0, "Are you afraid that adapting", 10.0)]
    even = even_split_caption_words(clips, 10.0)
    # Speech is front-loaded: all six words land in the first 2 seconds.
    timed = [
        {"word": "Are", "start": 0.00, "end": 0.20},
        {"word": "you", "start": 0.20, "end": 0.35},
        {"word": "afraid", "start": 0.35, "end": 0.80},
        {"word": "that", "start": 0.80, "end": 1.00},
        {"word": "adapting", "start": 1.00, "end": 1.60},
    ]
    cues = caption_cues_for_clips(clips, 10.0, timed_words=timed)
    assert cues
    assert cues[0]["start"] == pytest.approx(0.00)
    assert cues[-1]["end"] == pytest.approx(1.60)
    # Must not spill the last cue out to the even-split end of the clip.
    assert even[-1]["end"] == pytest.approx(10.0)
    assert cues[-1]["end"] < 2.0
    joined = " ".join(c["text"].replace("\\N", " ") for c in cues)
    assert "Are" in joined and "adapting" in joined


def test_group_words_default_is_two_to_four_word_chunks():
    words = even_word_timings(
        "Are you afraid that adapting means losing yourself in this",
        0.0, 5.0,
    )
    cues = group_words_into_cues(words)
    counts = [len(c["text"].split()) for c in cues]
    assert counts
    assert all(1 <= n <= 4 for n in counts)
    # The default path should prefer short spoken chunks, not 5-word lines.
    assert max(counts) <= 4
    assert any(n >= 2 for n in counts)
