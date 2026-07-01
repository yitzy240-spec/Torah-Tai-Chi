import pytest
import subprocess
from pathlib import Path
from src.stitcher import concat_clips


def _make_test_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    """Generate a tiny MP4 with silent audio using ffmpeg's lavfi sources."""
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(path),
    ], check=True, capture_output=True)


# The burst is confined to the FINAL 60 ms of the clip — deep inside
# the last clip's 0.5 s tail audio-fade (afade gain there averages
# ~-23 dB), so the fade attenuates it well past the ~20 dB the test
# asserts. (A burst that bled further back into the fade ramp would
# only be partly attenuated, capping the measurable delta near ~15 dB.)
_ARTIFACT_BURST_S = 0.06


def _make_artifact_clip(path: Path, seconds: int = 2, color: str = "blue") -> None:
    """Generate a tiny MP4 whose audio is SILENCE for most of the clip
    then a loud 1 kHz sine tone burst in the final ~60 ms — simulating
    Seedance 2.0's trailing audio artifact (a discrete spike at the very
    end after a stretch of near-silence). Built by concatenating an
    anullsrc silence bed with a short sine burst via the concat audio
    filter, muxed against a solid color video of the same length.
    """
    burst = _ARTIFACT_BURST_S
    silence = max(0.0, seconds - burst)
    # filter_complex: silence then a loud 1kHz tone, concatenated.
    # volume=4.0 drives the AAC-encoded tone up near full-scale so the
    # input tail is clearly loud relative to the faded output tail.
    fc = (
        f"anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:{silence:.3f}[s];"
        f"sine=frequency=1000:sample_rate=44100,atrim=0:{burst:.3f},"
        f"volume=4.0,aformat=channel_layouts=stereo[b];"
        f"[s][b]concat=n=2:v=0:a=1[a]"
    )
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={seconds}",
        "-filter_complex", fc,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(path),
    ], check=True, capture_output=True)


def _tail_mean_volume_db(mp4: Path, tail_s: float = 0.1) -> float:
    """Return the mean_volume (dB) of the final `tail_s` of a clip's
    audio, measured via ffmpeg's volumedetect on the tail.

    Uses an ACCURATE seek (-ss placed AFTER -i) so the measured window
    is exactly the final `tail_s`. A pre-input seek (-ss before -i) on
    these short, sparse-keyframe test clips lands imprecisely and misses
    the burst entirely."""
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(mp4),
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    ss = max(0.0, duration - tail_s)
    result = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(mp4), "-ss", f"{ss:.3f}",
        "-af", "volumedetect", "-f", "null", "-",
    ], capture_output=True, text=True)
    stderr = result.stderr
    for line in stderr.splitlines():
        if "mean_volume:" in line:
            # e.g. "[Parsed_volumedetect_0 @ ...] mean_volume: -28.4 dB"
            return float(line.split("mean_volume:")[1].strip().split()[0])
    raise AssertionError(f"no mean_volume in volumedetect output:\n{stderr[-1000:]}")


@pytest.mark.slow
def test_tail_artifact_is_attenuated_single_clip(tmp_path):
    """Single-clip path applies a tail audio-fade that kills Seedance's
    trailing artifact. The final 100 ms of the OUTPUT must be at least
    ~20 dB quieter than the same window of the INPUT artifact clip."""
    src = tmp_path / "artifact.mp4"
    _make_artifact_clip(src, seconds=2, color="blue")
    out = tmp_path / "out.mp4"
    concat_clips([src], out)
    assert out.exists()

    in_db = _tail_mean_volume_db(src)
    out_db = _tail_mean_volume_db(out)
    assert out_db <= in_db - 20.0, (
        f"tail not attenuated: input {in_db:.1f} dB, output {out_db:.1f} dB "
        f"(expected output >= 20 dB quieter)"
    )


@pytest.mark.slow
def test_tail_artifact_is_attenuated_last_of_many(tmp_path):
    """In a multi-clip concat, the LAST clip's trailing artifact is
    attenuated by the end audio-fade (last clip has fade_out=False but
    end_audio_fade=True). Measure the final 100 ms of the stitched
    output vs the final 100 ms of the raw last-clip input."""
    c0 = tmp_path / "c0.mp4"
    c1 = tmp_path / "c1_artifact.mp4"
    _make_test_clip(c0, seconds=2, color="red")
    _make_artifact_clip(c1, seconds=2, color="blue")
    out = tmp_path / "out.mp4"
    concat_clips([c0, c1], out)
    assert out.exists()

    in_db = _tail_mean_volume_db(c1)
    out_db = _tail_mean_volume_db(out)
    assert out_db <= in_db - 20.0, (
        f"tail not attenuated: last-clip input {in_db:.1f} dB, "
        f"output {out_db:.1f} dB (expected output >= 20 dB quieter)"
    )


@pytest.mark.slow
def test_concat_clips_produces_expected_duration(tmp_path):
    """Two-clip concat duration = sum-of-sources PLUS the adaptive
    still-frame prepend on the second clip (no overlap, no crossfade).

    The test clips are fully SILENT, so both clips read as all-silence:
    natural join breath already far exceeds the target, and the adaptive
    insert clamps to _MIN_INSERT_PAUSE_S. For 2s + 3s sources:
    total ≈ 5s + MIN."""
    from src.stitcher import _MIN_INSERT_PAUSE_S
    c1 = tmp_path / "a.mp4"
    c2 = tmp_path / "b.mp4"
    _make_test_clip(c1, seconds=2, color="blue")
    _make_test_clip(c2, seconds=3, color="red")
    out = tmp_path / "out.mp4"

    result = concat_clips([c1, c2], out)

    assert result.exists()
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    expected = 2 + 3 + _MIN_INSERT_PAUSE_S
    # ±0.2s tolerance for ffmpeg's frame-boundary rounding.
    assert expected - 0.2 <= duration <= expected + 0.2


@pytest.mark.slow
def test_concat_single_clip_through(tmp_path):
    """Single-clip path detones the audio (re-encodes) and writes to
    dest. Output exists and is roughly the same duration as input —
    file size differs from input because audio is re-encoded."""
    c1 = tmp_path / "only.mp4"
    _make_test_clip(c1, seconds=2, color="green")
    out = tmp_path / "out.mp4"
    concat_clips([c1], out)
    assert out.exists()
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    assert 1.8 <= float(probe.stdout.strip()) <= 2.2


@pytest.mark.slow
def test_concat_four_clips_duration(tmp_path):
    """Four-clip concat: sum-of-sources PLUS adaptive prepends on clips
    1, 2, 3 (the non-first clips). Fully-silent test clips → each join
    clamps to _MIN_INSERT_PAUSE_S. For 2 + 3 + 2 + 2 = 9s source content
    + 3 × MIN prepends."""
    from src.stitcher import _MIN_INSERT_PAUSE_S
    clips = []
    for i, (sec, color) in enumerate([(2, "blue"), (3, "red"), (2, "green"), (2, "yellow")]):
        p = tmp_path / f"c{i}.mp4"
        _make_test_clip(p, seconds=sec, color=color)
        clips.append(p)
    out = tmp_path / "out.mp4"
    concat_clips(clips, out)
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
        str(out)
    ], check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    expected = 9 + 3 * _MIN_INSERT_PAUSE_S
    assert expected - 0.3 <= duration <= expected + 0.3


# ── Adaptive pause math (pure functions — no ffmpeg) ────────────────────
from src.stitcher import (  # noqa: E402
    _compute_inserted_pause as _cip,
    _MIN_INSERT_PAUSE_S as _MN,
    _MAX_INSERT_PAUSE_S as _MX,
    _TARGET_PAUSE_STANDARD_S as _STD,
)


def test_pause_fills_deficit_to_target():
    # Speech butts speech (little natural silence) → fill up to target.
    assert abs(_cip(0.12, 0.10, 0.70) - 0.48) < 1e-9


def test_pause_standard_join_typical():
    assert abs(_cip(0.27, 0.27, 0.70) - 0.16) < 1e-9


def test_pause_already_spacious_clamps_to_min():
    # Clip already breathes (e.g. a 1.22s intro) → never pad on top, floor MIN.
    assert _cip(0.18, 1.22, 0.70) == _MN


def test_pause_small_deficit_clamps_up_to_min():
    assert _cip(0.42, 0.18, 0.70) == _MN


def test_pause_huge_deficit_caps_at_max():
    assert _cip(0.0, 0.0, 1.00) == _MX


def test_pause_preset_targets_move_result():
    assert _cip(0.10, 0.10, 0.35) < _cip(0.10, 0.10, 1.00)


def test_standard_constant_sane():
    assert _MN < _STD < _MX


# ── Settings resolver (level/joins → target_pause_s/join_overrides) ──────
from src.stitcher import resolve_stitch_targets as _rst  # noqa: E402


def test_resolve_none_is_auto():
    assert _rst(None) == (None, None)
    assert _rst({}) == (None, None)


def test_resolve_level_zero_is_auto():
    target, overrides = _rst({"level": 0})
    assert abs(target - _STD) < 1e-9
    assert overrides is None


def test_resolve_tighter_and_looser():
    assert _rst({"level": -2})[0] < _STD
    assert _rst({"level": 2})[0] > _STD


def test_resolve_level_clamps_out_of_range():
    assert _rst({"level": 9})[0] == _rst({"level": 2})[0]
    assert _rst({"level": -9})[0] == _rst({"level": -2})[0]


def test_resolve_per_cut_overrides():
    target, overrides = _rst({"level": 1, "joins": {"1": -2}})
    assert target > _STD
    assert overrides == {1: _rst({"level": -2})[0]}


def test_resolve_skips_malformed_joins():
    _, overrides = _rst({"joins": {"x": 1, "2": "nope"}})
    assert overrides is None  # both entries skipped, none valid
