import pytest
from src.video_generator import build_seedance_input, _inject_sentence_beats
from src.models import Clip
from src.settings import STYLE_LOCK


def _dojo_clip() -> Clip:
    return Clip(index=0, voiceover="Hello.", visual_prompt="Rav Eli sits, dolly in, soft morning light",
                duration_s=8, setting_id="DOJO")


def _outdoor_clip() -> Clip:
    return Clip(index=2, voiceover="Hi.", visual_prompt="Rav Eli walks, lateral tracking shot, dappled afternoon",
                duration_s=9, setting_id="GARDEN_PATH")


def test_build_seedance_input_dojo_includes_dojo_refs():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png", "https://x/c.png"],
        dojo_ref_urls=["https://x/dojo1.png", "https://x/dojo2.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    refs = payload["reference_image_urls"]
    # Dojo refs come FIRST so Seedance anchors the room; chars fill
    # the remainder. (Was reversed 2026-04-30 → 2026-05-04 — drifted
    # dojo + drifted kippah; restored.)
    assert refs[:2] == ["https://x/dojo1.png", "https://x/dojo2.png"]
    assert refs[2:] == ["https://x/a.png", "https://x/b.png", "https://x/c.png"]
    assert len(refs) <= 9
    assert "first_frame_url" not in payload
    assert STYLE_LOCK in payload["prompt"]
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_outdoor_excludes_dojo_refs():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png", "https://x/b.png"],
        dojo_ref_urls=["https://x/dojo1.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "https://x/dojo1.png" not in payload["reference_image_urls"]
    assert payload["reference_image_urls"] == ["https://x/a.png", "https://x/b.png"]


def test_build_seedance_input_with_first_frame_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"],
        dojo_ref_urls=[],
        first_frame_url="https://x/last.png",
        audio_url=None, resolution="720p",
    )
    assert payload["first_frame_url"] == "https://x/last.png"


def test_build_seedance_input_caps_refs_at_nine():
    """Regression: with 20 chars and 5 dojos on a DOJO clip, dojo refs
    get guaranteed seats first (up to MAX_DOJO_REFS=4), then chars fill
    the rest, total capped at MAX_REFS=9. Earlier code put chars first
    and starved dojos to zero — that shipped 2026-04-30 and Yonah saw
    drifting dojos + drifting kippah for four days because the dojo had
    no anchor at all."""
    clip = _dojo_clip()
    chars = [f"https://x/c{i}.png" for i in range(20)]
    dojos = [f"https://x/d{i}.png" for i in range(5)]
    payload = build_seedance_input(
        clip,
        character_ref_urls=chars,
        dojo_ref_urls=dojos,
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    refs = payload["reference_image_urls"]
    assert len(refs) == 9
    # 4 dojo refs FIRST (Seedance weights leading items more), then
    # 5 char refs filling the rest.
    assert refs[:4] == [f"https://x/d{i}.png" for i in range(4)]
    assert refs[4:] == [f"https://x/c{i}.png" for i in range(5)]


def test_build_seedance_input_with_audio_ref():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url="https://a/v.mp3", resolution="720p",
    )
    assert payload["reference_audio_urls"] == ["https://a/v.mp3"]
    assert "@Audio1" in payload["prompt"]


def test_build_seedance_input_resolution_normalized_lowercase():
    clip = _outdoor_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["u"], dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720P",
    )
    assert payload["resolution"] == "720p"


def test_build_seedance_input_with_reference_video_url():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=["https://x/d0.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
        reference_video_url="https://supabase/videos/tai_chi_moves/x.mp4",
    )
    assert payload["reference_video_urls"] == [
        "https://supabase/videos/tai_chi_moves/x.mp4"
    ]
    assert "motion study" in payload["prompt"].lower()
    assert "silent" in payload["prompt"].lower()
    assert "do not mute" in payload["prompt"].lower() or "do not freeze" in payload["prompt"].lower()
    # Voiceover must still be in the prompt — the ref does not replace speech.
    assert '"Hello."' in payload["prompt"]


def test_build_seedance_input_without_reference_video_url_omits_field():
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=[],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    assert "reference_video_urls" not in payload
    assert "motion study" not in payload["prompt"].lower()


def test_build_seedance_input_drops_first_frame_when_reference_video_set():
    """Regression: Seedance rejects payloads with both first_frame_url and
    reference_video_urls (400: "reference video and first/last frames are
    mutually exclusive"). When both are provided, drop first_frame and let
    reference_image_urls anchor identity instead — the user-selected
    motion ref outranks the auto-attached chain frame."""
    clip = _dojo_clip()
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/c0.png"],
        dojo_ref_urls=["https://x/d0.png"],
        first_frame_url="https://x/prev_last.png",
        audio_url=None, resolution="720p",
        reference_video_url="https://supabase/videos/tai_chi_moves/x.mp4",
    )
    assert "first_frame_url" not in payload
    assert payload["reference_video_urls"] == [
        "https://supabase/videos/tai_chi_moves/x.mp4"
    ]
    # Identity falls back to reference_image_urls when chain frame drops.
    assert "https://x/c0.png" in payload["reference_image_urls"]


# ─── Sentence-beat cadence ────────────────────────────────────────────────
# Spec: docs/superpowers/specs/2026-06-02-sentence-beats-cadence-design.md
# Plan: docs/superpowers/plans/2026-06-02-sentence-beats-cadence.md
# Verified technique: third-person stage direction between Character
# speaks: blocks produces a real pause without breaking lip-sync
# (2026-06-01 single-clip Seedance test render).


def test_inject_sentence_beats_single_sentence_unchanged():
    """Single-sentence voiceover renders as one Character speaks: block
    with no beat — back-compat with pre-cadence behavior."""
    out = _inject_sentence_beats("When Yaakov wrestled the angel, he did not run.")
    assert out == 'Character speaks: "When Yaakov wrestled the angel, he did not run."\n'
    assert "holds the moment" not in out


def test_inject_sentence_beats_two_sentences_one_beat():
    """Two sentences produce two Character speaks: blocks separated by
    exactly one beat line."""
    out = _inject_sentence_beats(
        "When Yaakov wrestled the angel, he did not run. He stayed in contact until dawn."
    )
    expected = (
        'Character speaks: "When Yaakov wrestled the angel, he did not run."\n'
        'Rav Eli holds the moment, breathes calmly, then continues:\n'
        'Character speaks: "He stayed in contact until dawn."\n'
    )
    assert out == expected
    assert out.count("Character speaks:") == 2
    assert out.count("holds the moment") == 1


def test_inject_sentence_beats_three_sentences_two_beats():
    """Three sentences produce three blocks separated by two beats —
    confirms the beat is inserted between every adjacent pair, not just
    the first."""
    out = _inject_sentence_beats("He walked. He thought. He prayed.")
    assert out.count("Character speaks:") == 3
    assert out.count("holds the moment") == 2
    lines = [ln for ln in out.split("\n") if ln]
    assert lines[0].startswith("Character speaks:")
    assert lines[-1].startswith("Character speaks:")


def test_inject_sentence_beats_abbreviation_does_not_split():
    """`Dr. Cohen said hello. He walked away.` should split at ONE
    boundary (between `hello.` and `He`) — not at `Dr. Cohen`. The
    abbreviation pre-mask handles this."""
    out = _inject_sentence_beats("Dr. Cohen said hello. He walked away.")
    assert out.count("Character speaks:") == 2
    assert out.count("holds the moment") == 1
    # The Dr. abbreviation survives unchanged in the rendered output
    assert '"Dr. Cohen said hello."' in out


def test_inject_sentence_beats_empty_string_does_not_crash():
    """Empty voiceover renders as a single empty block — no crash."""
    out = _inject_sentence_beats("")
    assert out == 'Character speaks: ""\n'
    assert "holds the moment" not in out


def test_build_seedance_input_voiceover_gets_sentence_beats():
    """End-to-end: a clip with a two-sentence voiceover produces a
    payload['prompt'] containing TWO Character speaks: blocks and ONE
    beat between them. Verifies the helper is wired in."""
    clip = Clip(
        index=0,
        voiceover="When Yaakov wrestled the angel, he did not run. He stayed until dawn.",
        visual_prompt="Rav Eli sits, dolly in, soft morning light",
        duration_s=10,
        setting_id="DOJO",
    )
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"],
        dojo_ref_urls=["https://x/dojo1.png"],
        first_frame_url=None,
        audio_url=None,
        resolution="720p",
    )
    prompt = payload["prompt"]
    assert prompt.count("Character speaks:") == 2
    assert "Rav Eli holds the moment, breathes calmly, then continues:" in prompt
    first_idx = prompt.index('"When Yaakov wrestled the angel, he did not run."')
    beat_idx = prompt.index("holds the moment")
    second_idx = prompt.index('"He stayed until dawn."')
    assert first_idx < beat_idx < second_idx
