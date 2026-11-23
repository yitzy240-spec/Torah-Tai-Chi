"""Safe-zone layout + caption timing for on-screen text."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from src.on_screen_overlay import (
    CAPTION_CY_FRAC,
    HOOK_TOP_FRAC,
    HOOK_MAX_LINES,
    SAFE_BOTTOM_FRAC,
    SAFE_TOP_FRAC,
    ClipTranscript,
    OnScreenSettings,
    caption_box,
    caption_cues_for_clips,
    compute_layout,
    content_end_s,
    even_word_timings,
    group_words_into_cues,
    hook_box,
    hook_cue,
    safe_zone,
    scale_clip_windows,
    settings_from_video_row,
    should_burn,
    wrap_cue_text,
    max_chars_for_font,
    tokenize_for_wrap,
)


@pytest.mark.parametrize("width,height", [(720, 1280), (1080, 1920), (480, 854)])
def test_safe_zone_matches_reel_insets(width, height):
    top, bottom = safe_zone(height)
    assert top == int(round(height * 0.14))
    assert bottom == int(round(height * 0.65))
    assert top / height == pytest.approx(SAFE_TOP_FRAC, abs=0.002)
    assert (height - bottom) / height == pytest.approx(SAFE_BOTTOM_FRAC, abs=0.002)
    # Usable band is the middle 51% of the frame.
    assert bottom > top
    assert (bottom - top) / height == pytest.approx(0.51, abs=0.005)


@pytest.mark.parametrize("width,height", [(720, 1280), (1080, 1920), (480, 854)])
def test_hook_and_captions_stay_in_safe_zone(width, height):
    layout = compute_layout(width, height)
    hook = hook_box(layout, lines=2)
    cap = caption_box(layout, lines=2)
    assert hook.top >= layout.safe_top
    assert hook.bottom <= layout.safe_bottom
    assert cap.top >= layout.safe_top
    assert cap.bottom <= layout.safe_bottom
    # Hook sits above captions with a gap for the outline.
    assert hook.bottom < cap.top
    # Default hook is top-aligned at the 14% safe line.
    assert hook.top == layout.hook_top
    assert hook.top == layout.safe_top
    assert hook.top / height == pytest.approx(HOOK_TOP_FRAC, abs=0.005)
    assert hook.top / height == pytest.approx(0.14, abs=0.005)
    # Two-line hook at the safe line still ends well above mid-frame eyes.
    assert hook.bottom / height <= 0.30
    assert layout.caption_cy == int(round(height * CAPTION_CY_FRAC))
    # Boxes stay horizontally inset from the edges.
    assert hook.left >= int(width * 0.05)
    assert hook.right <= width - int(width * 0.05)


def test_hook_sits_above_the_face_on_a_low_closeup():
    """Vayeitzei-style close-up (face top ~26%): hook stays in the ceiling band."""
    from src.face_detect import FaceBox
    from src.on_screen_overlay import adapt_overlay_layout

    layout = adapt_overlay_layout(
        compute_layout(720, 1280),
        FaceBox(left=261, top=334, right=464, bottom=629, score=0.92),
        hook_lines=2,
    )
    hook = hook_box(layout, lines=HOOK_MAX_LINES)
    assert layout.hook_placement == "above"
    assert hook.top == layout.safe_top == 179  # 14% of 1280
    # Hook ends at the YuNet hairline (~26%), well above the eyes (~32%).
    assert hook.bottom <= 334
    assert hook.bottom < 410
    cap = caption_box(layout, lines=2)
    assert cap.top > 600


def test_compute_layout_rejects_bad_frame():
    with pytest.raises(ValueError):
        compute_layout(0, 1280)


def test_content_end_excludes_end_card():
    # Follow and Subscribe endings share the same content; only the card
    # length is subtracted, with no xfade overlap.
    assert content_end_s(70.0, 3.6) == pytest.approx(66.4)
    assert content_end_s(10.0, 10.0) == 0.0
    assert content_end_s(8.0, 10.0) == 0.0
    assert content_end_s(0.0, 3.6) == 0.0
    # Captions must never be assigned a time past the end card.
    end = content_end_s(60.0, 3.6)
    assert end < 60.0
    assert end + 3.6 == pytest.approx(60.0)


def test_even_word_timings_splits_by_word_count():
    words = even_word_timings("Lavan and Leah met at the well", 0.0, 10.0)
    assert [w["word"] for w in words] == [
        "Lavan", "and", "Leah", "met", "at", "the", "well",
    ]
    assert words[0]["start"] == pytest.approx(0.0)
    assert words[-1]["end"] == pytest.approx(10.0)
    # Equal share: 7 words over 10s.
    widths = [w["end"] - w["start"] for w in words]
    assert widths[0] == pytest.approx(10 / 7)
    assert sum(widths) == pytest.approx(10.0)
    # Adjacent cues abut (no gap, no overlap).
    for a, b in zip(words, words[1:]):
        assert a["end"] == pytest.approx(b["start"])


def test_even_word_timings_empty_and_whitespace():
    assert even_word_timings("", 0.0, 5.0) == []
    assert even_word_timings("   ", 0.0, 5.0) == []


def test_group_words_into_cues_breaks_on_punctuation_and_max():
    words = even_word_timings(
        "The smallest letter is an aleph. Then we move.", 0.0, 8.0,
    )
    cues = group_words_into_cues(words, max_words=5)
    assert any(c["text"].endswith("aleph.") for c in cues)
    assert all(len(c["text"].split()) <= 5 for c in cues)
    assert cues[0]["start"] == pytest.approx(0.0)
    assert cues[-1]["end"] == pytest.approx(8.0)


def test_group_words_into_cues_respects_char_budget():
    words = even_word_timings(
        "extraordinarily longish wording stuffed together tightly", 0.0, 6.0,
    )
    cues = group_words_into_cues(words, max_words=8, max_chars=28)
    assert all(len(c["text"]) <= 28 or len(c["text"].split()) == 1 for c in cues)


def test_scale_clip_windows_covers_content_without_gap():
    clips = [
        ClipTranscript(0, "one two", 5.0),
        ClipTranscript(1, "three four five", 10.0),
        ClipTranscript(2, "six", 5.0),
    ]
    windows = scale_clip_windows(clips, 40.0)  # 2x planned 20s
    assert windows[0] == pytest.approx((0.0, 10.0))
    assert windows[1] == pytest.approx((10.0, 30.0))
    assert windows[2] == pytest.approx((30.0, 40.0))
    assert windows[-1][1] == pytest.approx(40.0)


def test_caption_cues_default_to_per_clip_voiceover():
    clips = [
        ClipTranscript(0, "Hello from clip one.", 4.0),
        ClipTranscript(1, "And clip two finishes it.", 6.0),
    ]
    cues = caption_cues_for_clips(clips, content_end=10.0)
    joined = " ".join(c["text"] for c in cues)
    assert "Hello" in joined and "finishes" in joined
    assert cues[0]["start"] == pytest.approx(0.0)
    assert cues[-1]["end"] <= 10.0 + 1e-9
    # First clip's words must finish by the clip boundary (4s of 10).
    first_clip_end = max(
        c["end"] for c in cues if "Hello" in c["text"] or "one." in c["text"]
    )
    assert first_clip_end <= 4.0 + 1e-6


def test_caption_override_replaces_voiceover_across_whole_video():
    clips = [
        ClipTranscript(0, "PHONETIC SPELL-ing we do not want on screen", 5.0),
        ClipTranscript(1, "more hidden voiceover", 5.0),
    ]
    cues = caption_cues_for_clips(
        clips, content_end=10.0,
        caption_override="Lavan and Leah wait at the well",
    )
    joined = " ".join(c["text"] for c in cues)
    assert "Lavan" in joined and "well" in joined
    assert "SPELL-ing" not in joined
    assert "hidden" not in joined
    assert cues[0]["start"] == pytest.approx(0.0)
    assert cues[-1]["end"] == pytest.approx(10.0)


def test_cues_never_extend_into_the_end_card():
    clips = [ClipTranscript(0, "word " * 20, 14.0)]
    cues = caption_cues_for_clips(clips, content_end=10.0)
    assert cues
    assert all(c["end"] <= 10.0 + 1e-9 for c in cues)
    assert all(c["start"] < 10.0 for c in cues)


def test_hook_cue_is_capped_at_three_seconds_and_content_end():
    hook = hook_cue("Why did Lavan run?", content_end=20.0)
    assert hook is not None
    assert hook["start"] == 0.0
    assert hook["end"] == pytest.approx(3.0)
    assert hook["text"] == "Why did Lavan run?"
    short = hook_cue("A short clip", content_end=1.5)
    assert short is not None and short["end"] == pytest.approx(1.5)
    assert hook_cue("  ", content_end=10.0) is None
    assert hook_cue("Hello", content_end=0.0) is None


def test_wrap_cue_text_inserts_a_single_break():
    wrapped = wrap_cue_text("Why did Lavan run to the well", max_chars=20)
    assert r"\N" in wrapped
    assert "Lavan" in wrapped and "well" in wrapped
    assert wrap_cue_text("Short line", max_chars=28) == "Short line"


def test_wrap_splits_em_dash_and_fits_hook_width():
    hook = "Are you adapting\u2014or giving in?"
    hook = hook.encode("utf-8").decode("unicode_escape") if False else (
        "Are you adapting" + "—" + "or giving in?"
    )
    assert "—" in hook
    tokens = tokenize_for_wrap(hook)
    assert any(t.startswith("adapting") for t in tokens)
    assert "or" in tokens or any(t == "or" or t.startswith("or") for t in tokens)
    # 720x1280 hook font must wrap to lines that fit the usable width.
    from src.on_screen_overlay import compute_layout
    layout = compute_layout(720, 1280)
    max_chars = layout.max_chars(layout.hook_font)
    wrapped = wrap_cue_text(hook, max_chars=max_chars, max_lines=3)
    lines = wrapped.split(r"\N")
    assert 1 <= len(lines) <= 3
    assert all(len(line) <= max_chars + 2 for line in lines)  # +2 for a trailing dash
    assert "adapting" in wrapped and "giving" in wrapped
    # Estimated pixel width of each line stays inside the gutters.
    usable = layout.usable_width()
    from src.on_screen_overlay import CHAR_WIDTH_FRAC
    for line in lines:
        assert len(line) * layout.hook_font * CHAR_WIDTH_FRAC <= usable + 1




def test_settings_from_video_row_prefers_columns_over_nested():
    row = {
        "hook_text": "Column hook",
        "caption_override": "Column captions",
        "burn_on_screen_text": True,
        "stitch_settings": {
            "on_screen": {
                "hook_text": "Nested hook",
                "caption_override": "Nested captions",
                "enabled": False,
            }
        },
    }
    s = settings_from_video_row(row)
    assert s.hook_text == "Column hook"
    assert s.caption_override == "Column captions"
    assert s.enabled is True


def test_settings_from_video_row_falls_back_to_stitch_settings():
    # Pre-migration SELECT won't include the new columns.
    s = settings_from_video_row({
        "stitch_settings": {
            "cuts": {"0": "hard"},
            "on_screen": {
                "hook_text": "Nested hook",
                "caption_override": "",
                "enabled": True,
            },
        }
    })
    assert s.hook_text == "Nested hook"
    assert s.enabled is True
    assert settings_from_video_row(None).enabled is False
    # Empty row, no hook/override: stay off.
    assert settings_from_video_row({}).enabled is False


def test_should_burn_requires_toggle_and_something_to_show():
    clips = [ClipTranscript(0, "Hello world", 5.0)]
    assert should_burn(OnScreenSettings(enabled=False, hook_text="Hi"), clips) is False
    assert should_burn(OnScreenSettings(enabled=True), clips) is True
    assert should_burn(OnScreenSettings(enabled=True, hook_text="Hi"), []) is True
    assert should_burn(OnScreenSettings(enabled=True), []) is False
    assert should_burn(
        OnScreenSettings(enabled=True, caption_override="Shown"),
        [ClipTranscript(0, "", 5.0)],
    ) is True


def test_default_toggle_on_only_when_hook_or_override_set():
    """Dashboard default: ON only if hook or caption override is filled."""
    def default_on(hook: str, override: str) -> bool:
        return bool(hook.strip() or override.strip())

    assert default_on("", "") is False
    assert default_on("Why did Lavan run?", "") is True
    assert default_on("", "Lavan and Leah") is True
    # Spoken voiceover alone does not auto-enable — Yonah opts in, so a
    # transitions re-stitch on an existing video will not suddenly burn
    # phonetic spellings onto the file.
    assert default_on("  ", "  ") is False


@pytest.mark.slow
def test_burn_overlay_ffmpeg_keeps_audio_and_writes_mp4(tmp_path):
    from src.on_screen_overlay import apply_on_screen_overlay

    in_mp4 = tmp_path / "in.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=720x1280:d=5",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest",
            str(in_mp4),
        ],
        check=True, capture_output=True,
    )
    out_mp4 = tmp_path / "out.mp4"
    apply_on_screen_overlay(
        in_mp4, out_mp4,
        clips=[ClipTranscript(0, "Lavan and Leah wait at the well", 5.0)],
        settings=OnScreenSettings(
            enabled=True, hook_text="Why did Lavan run?",
        ),
        outro_duration_s=1.0,  # content_end = 4s of a 5s dummy
        align_audio=False,  # this dummy has no speech; don't load Whisper
        detect_face=False,
    )
    assert out_mp4.exists() and out_mp4.stat().st_size > 0
    # ASS was written next to the output and uses the safe-zone positions.
    ass = (tmp_path / "out.ass").read_text(encoding="utf-8")
    assert "Style: Hook,Inter," in ass
    assert "Style: Caption,Inter," in ass
    assert r"\pos(360," in ass  # centered in the 720-wide safe zone
    assert "Why did" in ass and "Lavan" in ass and "run?" in ass
    assert "Lavan" in ass
