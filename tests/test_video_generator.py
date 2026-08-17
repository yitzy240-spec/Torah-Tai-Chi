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


def test_inject_sentence_beats_two_sentences_single_block_no_beat():
    """Two sentences render as ONE block with no written beat.

    Ki Teitzei 2026-08-17: across 5 renders on 2 two-sentence clips the
    written beat realized 1.28-2.65s (mean ~2.1s) — a single mid-clip
    hold that the operator called dead air both times. Natural one-block
    cadence measured 0.4-0.93s at the same boundaries. With only one
    join, the hold dominates the clip; 3+ sentence flows keep the beat
    (that's where the June 'rushed' complaint lived)."""
    out = _inject_sentence_beats(
        "When Yaakov wrestled the angel, he did not run. He stayed in contact until dawn."
    )
    assert out.count("Character speaks:") == 1
    assert "holds the moment" not in out
    assert "he did not run. He stayed" in out


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


def test_inject_sentence_beats_question_mark_does_not_beat():
    """A question keeps its natural TTS pause — no written beat after `?`.

    Ki Teitzei 2026-08-17: the written beat after a hook question rendered
    as 1.3–2.6s of dead air (measured across four renders), and the
    operator could not remove it — deleting the `?` just made the `.`
    split instead. Question joins stay inside one quoted block; the
    verified beat remains for `.` and `!` joins."""
    out = _inject_sentence_beats(
        "How does a fence on the roof connect with Tai Chi? In this week's "
        "Tora portion, God commands us to build a fence around a roof."
    )
    assert out.count("Character speaks:") == 1
    assert "holds the moment" not in out
    assert "Tai Chi? In this week's" in out


def test_inject_sentence_beats_question_then_period_mixed():
    """`A? B. C.` — the `?` join never splits, leaving two segments,
    and two segments render as a single block (no beat)."""
    out = _inject_sentence_beats("Why did he stay? He was not afraid. He trusted.")
    assert out.count("Character speaks:") == 1
    assert "holds the moment" not in out
    assert "Why did he stay? He was not afraid. He trusted." in out


def test_inject_sentence_beats_four_segments_keep_beats():
    """3+ segments keep the verified beat between every adjacent pair —
    the June cadence feature is unchanged for longer flows."""
    out = _inject_sentence_beats(
        "He walked the path. He thought about it. He prayed at dusk. He slept."
    )
    assert out.count("Character speaks:") == 4
    assert out.count("holds the moment") == 3


def test_inject_sentence_beats_abbreviation_does_not_split():
    """`Dr.` must not count as a sentence boundary. With three real
    sentences (3 segments → beats active), the first block keeps
    `Dr. Cohen said hello.` intact — the abbreviation pre-mask holds."""
    out = _inject_sentence_beats(
        "Dr. Cohen said hello. He walked away. He returned at dawn."
    )
    assert out.count("Character speaks:") == 3
    assert out.count("holds the moment") == 2
    # The Dr. abbreviation survives unchanged in the rendered output
    assert '"Dr. Cohen said hello."' in out


def test_inject_sentence_beats_empty_string_does_not_crash():
    """Empty voiceover renders as a single empty block — no crash."""
    out = _inject_sentence_beats("")
    assert out == 'Character speaks: ""\n'
    assert "holds the moment" not in out


def test_build_seedance_input_voiceover_gets_sentence_beats():
    """End-to-end: a clip with a THREE-sentence voiceover produces a
    payload['prompt'] containing three Character speaks: blocks and two
    beats between them. Verifies the helper is wired in."""
    clip = Clip(
        index=0,
        voiceover=(
            "When Yaakov wrestled the angel, he did not run. "
            "He stayed until dawn. He earned a new name."
        ),
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
    assert prompt.count("Character speaks:") == 3
    assert "Rav Eli holds the moment, breathes calmly, then continues:" in prompt
    first_idx = prompt.index('"When Yaakov wrestled the angel, he did not run."')
    beat_idx = prompt.index("holds the moment")
    second_idx = prompt.index('"He stayed until dawn."')
    assert first_idx < beat_idx < second_idx


# ── emotive_note sanitization (Eikev "brief" leak, 2026-07-28) ──────────
# The plan wrote a delivery note that QUOTED script phrases:
#   "each phrase ('seeing clearly,' 'feeling deeply,' ...) lands with a
#    brief natural pause between them"
# Injected verbatim as the Delivery: line, Seedance saw the same words as
# speech AND instruction and blended them — Rav Eli stuttered and spoke
# the word "brief" mid-sentence at the quoted phrases. Delivery notes must
# never carry quoted script text into the prompt.

def _eikev_clip() -> Clip:
    return Clip(
        index=1,
        voiceover="We see clearly, feel deeply, and draw closer.",
        visual_prompt="Rav Eli stands on the indigo runner",
        duration_s=11, setting_id="DOJO",
        emotive_note=("measured and patient, teacher tone — each phrase "
                      "('seeing clearly,' 'feeling deeply,' 'drawing closer') "
                      "lands with a brief natural pause between them"),
    )


def test_emotive_note_quoted_script_fragments_are_stripped():
    payload = build_seedance_input(
        _eikev_clip(),
        character_ref_urls=["https://x/a.png"], dojo_ref_urls=["https://x/d.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    delivery_line = next(
        l for l in payload["prompt"].splitlines() if l.startswith("Delivery:")
    )
    assert "seeing clearly" not in delivery_line
    assert "feeling deeply" not in delivery_line
    assert "drawing closer" not in delivery_line
    # The tone direction itself survives.
    assert "measured and patient" in delivery_line


def test_emotive_note_contractions_survive_sanitization():
    clip = _eikev_clip().model_copy(update={
        "emotive_note": "warm, doesn't rush, isn't preachy — lands 'balance' gently",
    })
    payload = build_seedance_input(
        clip,
        character_ref_urls=["https://x/a.png"], dojo_ref_urls=["https://x/d.png"],
        first_frame_url=None, audio_url=None, resolution="720p",
    )
    delivery_line = next(
        l for l in payload["prompt"].splitlines() if l.startswith("Delivery:")
    )
    assert "doesn't rush" in delivery_line
    assert "isn't preachy" in delivery_line
    assert "'balance'" not in delivery_line
