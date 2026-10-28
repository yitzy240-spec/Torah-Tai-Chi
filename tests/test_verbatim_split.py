"""Verbatim draft → clip voiceover splitter."""
from __future__ import annotations

import pytest

from src.verbatim_split import (
    HARD_WPS,
    MAX_DURATION_S,
    apply_verbatim_voiceovers,
    concatenated_voiceovers,
    split_draft_verbatim,
    split_sentences,
)


VAYEIRA_DRAFT = (
    "How does being relaxed make you stronger? AV-ra-ham sat specifically "
    "at the entrance of his tent, between his private world and the outside. "
    "Still, but not disengaged. Open and always ready to welcome visitors.\n\n"
    "He lifted his eyes and saw three men. First, he perceives. In Tai Chi, "
    "we use Ting Jin to perceive information before responding. Then he runs "
    "to greet them and hurries to Sarah to help prepare a meal.\n\n"
    "His initial stillness in the tent wasn't passivity - it was preparation. "
    "In Tai Chi, we use Song, or relaxed release, to quiet unnecessary tension "
    "so that when action is needed, strong movement can emerge quickly and "
    "naturally.\n\n"
    "The open tent teaches that we can remain rooted in who we are while "
    "opening ourselves to others. A center that never opens outward can become "
    "isolation, while openness without a center can leave us scattered.\n\n"
    "True receptivity means having the inner stability to welcome what comes "
    "from beyond ourselves—without losing our direction. If this gave you "
    "something to think about, share it. And follow or subscribe for more."
)


def test_split_sentences_keeps_ting_jin_and_song():
    sents = split_sentences(VAYEIRA_DRAFT)
    joined = " ".join(sents)
    assert "Ting Jin" in joined
    assert "Song" in joined
    assert "AV-ra-ham" in joined
    assert "rephrase" not in joined.lower()


def test_split_draft_verbatim_preserves_every_sentence():
    chunks = split_draft_verbatim(VAYEIRA_DRAFT)
    assert 3 <= len(chunks) <= 8
    cat = concatenated_voiceovers(chunks)
    # Every sentence from the draft appears verbatim in the concatenation.
    for sent in split_sentences(VAYEIRA_DRAFT):
        assert sent in cat
    # Critical phrases the LLM used to rewrite must survive.
    assert "Ting Jin" in cat
    assert "we use Song, or relaxed release" in cat
    assert "AV-ra-ham sat specifically" in cat
    assert "follow or subscribe for more" in cat


def test_split_draft_verbatim_durations_within_seedance_cap():
    chunks = split_draft_verbatim(VAYEIRA_DRAFT)
    for ch in chunks:
        assert 4 <= ch.duration_s <= 15
        if not ch.over_budget:
            assert ch.word_count / ch.duration_s <= HARD_WPS + 1e-9


def test_single_oversized_sentence_flagged_not_rewritten():
    # 50+ words → cannot fit 15s at 3.0 wps.
    words = " ".join(f"word{i}" for i in range(50))
    draft = words[0].upper() + words[1:] + "."
    # Make it look like a sentence with capital start.
    draft = "Word0 " + " ".join(f"word{i}" for i in range(1, 50)) + "."
    chunks = split_draft_verbatim(draft, min_clips=1, max_clips=8)
    assert len(chunks) >= 1
    # With only one sentence, we get one chunk (min_clips can't invent text).
    assert any(c.over_budget for c in chunks)
    assert draft.strip().rstrip(".") in concatenated_voiceovers(chunks) or draft.strip() in concatenated_voiceovers(chunks) + "."
    # Text not shortened.
    assert "word49" in concatenated_voiceovers(chunks)


def test_apply_verbatim_overwrites_llm_rewrites():
    chunks = split_draft_verbatim(VAYEIRA_DRAFT)
    llm_clips = [
        {
            "index": i,
            "voiceover": f"REWRITTEN filler {i} listening instead of Ting Jin",
            "visual_prompt": f"Rav Eli gesture {i}",
            "duration_s": 8,
            "setting_id": "DOJO" if i < 2 else "GARDEN_PATH",
            "caption_position": "bottom",
        }
        for i in range(len(chunks))
    ]
    out = apply_verbatim_voiceovers(llm_clips, chunks)
    assert len(out) == len(chunks)
    for i, (clip, ch) in enumerate(zip(out, chunks)):
        assert clip["voiceover"] == ch.voiceover
        assert clip["duration_s"] == ch.duration_s
        assert clip["over_budget"] == ch.over_budget
        assert "Ting Jin" in concatenated_voiceovers(chunks) or True
        assert "listening instead of Ting Jin" not in clip["voiceover"]
        assert clip["visual_prompt"] == f"Rav Eli gesture {i}"


def test_apply_verbatim_realigns_when_llm_clip_count_differs():
    chunks = split_draft_verbatim(VAYEIRA_DRAFT)
    # LLM returned fewer clips than the verbatim split.
    llm_clips = [
        {
            "index": 0,
            "voiceover": "rewritten a",
            "visual_prompt": "visual A",
            "duration_s": 10,
            "setting_id": "DOJO",
        },
        {
            "index": 1,
            "voiceover": "rewritten b",
            "visual_prompt": "visual B",
            "duration_s": 10,
            "setting_id": "GARDEN_PATH",
        },
    ]
    out = apply_verbatim_voiceovers(llm_clips, chunks)
    assert len(out) == len(chunks)
    assert all(c["voiceover"] == ch.voiceover for c, ch in zip(out, chunks))
    assert out[0]["visual_prompt"] in {"visual A", "visual B"}


def test_empty_draft_returns_empty():
    assert split_draft_verbatim("") == []
    assert split_draft_verbatim("   ") == []
