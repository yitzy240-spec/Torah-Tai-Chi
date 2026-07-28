import pytest
import subprocess
from pathlib import Path
import src.stitcher as stitcher
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
    """Two-clip concat duration ≈ sum-of-sources. The test clips are fully
    SILENT, so each side of the cut already has silence far exceeding the
    beat — both the settle and the lead-in pads clamp to 0, adding no time.
    For 2s + 3s sources: total ≈ 5s."""
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
    # ±0.3s tolerance for ffmpeg frame-boundary rounding.
    assert 5.0 - 0.3 <= duration <= 5.0 + 0.3


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
    """Four-clip concat ≈ sum-of-sources. Fully-silent test clips → every
    side of every cut already exceeds the beat, so all pads clamp to 0.
    For 2 + 3 + 2 + 2 = 9s source content, total ≈ 9s."""
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
    assert 9.0 - 0.4 <= duration <= 9.0 + 0.4


# ── Scene-aware cut-type logic (pure functions — no ffmpeg) ──────────────
from src.stitcher import auto_cut_type, resolve_cut_types, HARD, FADE  # noqa: E402


def test_auto_hard_within_scene():
    prev = {"setting_id": "DOJO", "motion_ref_slug": None}
    curr = {"setting_id": "DOJO", "motion_ref_slug": None}
    assert auto_cut_type(prev, curr) == HARD


def test_auto_fade_on_setting_change():
    prev = {"setting_id": "DOJO", "motion_ref_slug": None}
    curr = {"setting_id": "HILLTOP", "motion_ref_slug": None}
    assert auto_cut_type(prev, curr) == FADE


def test_auto_fade_on_motion_ref():
    # A motion-ref clip can't be frame-chained → fade in, even same setting.
    prev = {"setting_id": "HILLTOP", "motion_ref_slug": None}
    curr = {"setting_id": "HILLTOP", "motion_ref_slug": "closing_form"}
    assert auto_cut_type(prev, curr) == FADE


_METAS = [
    {"setting_id": "DOJO", "motion_ref_slug": None},
    {"setting_id": "DOJO", "motion_ref_slug": None},
    {"setting_id": "HILLTOP", "motion_ref_slug": None},
    {"setting_id": "HILLTOP", "motion_ref_slug": None},
    {"setting_id": "HILLTOP", "motion_ref_slug": "closing_form"},
]


def test_resolve_auto_matches_metadata():
    assert resolve_cut_types(_METAS, None) == [HARD, FADE, HARD, FADE]
    assert resolve_cut_types(_METAS, {}) == [HARD, FADE, HARD, FADE]


def test_resolve_applies_overrides():
    # Force cut 0 to fade and cut 1 to hard.
    settings = {"cuts": {"0": "fade", "1": "hard"}}
    assert resolve_cut_types(_METAS, settings) == [FADE, HARD, HARD, FADE]


def test_resolve_skips_malformed_overrides():
    settings = {"cuts": {"x": "fade", "1": "nope", "2": "hard"}}
    # only "2": hard is valid → cut 2 forced hard, rest auto
    assert resolve_cut_types(_METAS, settings) == [HARD, FADE, HARD, FADE]


def test_build_final_timeline_appends_outro_with_fade(tmp_path):
    clips = [tmp_path / "clip_0.mp4", tmp_path / "clip_1.mp4"]
    outro = tmp_path / "outro.mp4"

    timeline, cuts = stitcher.build_final_timeline(
        clips,
        cut_types=[HARD],
        outro_path=outro,
    )

    assert timeline == [*clips, outro]
    assert cuts == [HARD, FADE]


# ── HARD-cut micro-crossfade (Eikev "weird frame jump", 2026-07-28) ─────
# Chained clips start from the previous clip's last frame, but Seedance
# re-synthesizes the anchor ~3% off in scale and ~4% off in exposure. A
# butt-joined hard cut showed that snap in a single frame. Hard cuts now
# overlap by a 0.12s video+audio micro-crossfade — invisible as a
# transition, but it smears the snap across ~4 frames. (Audio is safe:
# the outgoing tail is already artifact-faded to silence at hard cuts.)

@pytest.mark.slow
def test_hard_cut_has_a_blended_frame_at_the_join(tmp_path):
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    _make_test_clip(a, seconds=2, color="red")
    _make_test_clip(b, seconds=2, color="blue")
    out = concat_clips([a, b], tmp_path / "out.mp4", cut_types=["hard"])

    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    subprocess.run([
        "ffmpeg", "-y", "-ss", "1.5", "-to", "2.4", "-i", str(out),
        "-vsync", "0", str(frames_dir / "f_%03d.png"),
    ], check=True, capture_output=True)

    from PIL import Image
    saw_red = saw_blend = saw_blue = False
    for f in sorted(frames_dir.glob("f_*.png")):
        r, g, bl = Image.open(f).convert("RGB").resize((1, 1)).getpixel((0, 0))
        if r > 150 and bl < 80:
            saw_red = True
        elif bl > 150 and r < 80:
            saw_blue = True
        elif r > 40 and bl > 40:
            saw_blend = True
    assert saw_red and saw_blue, "expected both pure sides around the join"
    assert saw_blend, "hard cut must pass through at least one blended frame"


@pytest.mark.slow
def test_hard_cut_overlap_shortens_total_by_the_blend(tmp_path):
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    _make_test_clip(a, seconds=2, color="red")
    _make_test_clip(b, seconds=2, color="blue")
    out = concat_clips([a, b], tmp_path / "out.mp4", cut_types=["hard"])
    dur = stitcher._probe_duration(out)
    # 2 + 2 minus one 0.12s overlap (small mux tolerance).
    assert 3.7 <= dur <= 4.02, f"duration {dur}"


@pytest.mark.slow
def test_hard_cut_survives_audio_outlasting_video(tmp_path):
    """Real Seedance clips mux audio past the last video frame. An xfade
    offset computed from CONTAINER duration lands past the outgoing clip's
    final video frame — the transition never fires and the first clip
    VANISHES from the output (found stitching Eikev locally, 2026-07-28).
    Offsets must come from the video stream's duration."""
    def tail_clip(path, color, seconds):
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c={color}:s=320x240:d={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds + 0.1}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            str(path),
        ], check=True, capture_output=True)

    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    tail_clip(a, "red", 2.0)
    tail_clip(b, "blue", 2.0)
    out = concat_clips([a, b], tmp_path / "out.mp4", cut_types=["hard"])

    dur = stitcher._probe_video_duration(out)
    assert 3.6 <= dur <= 4.05, f"first clip vanished? video duration {dur}"

    from PIL import Image
    frames_dir = tmp_path / "fr"
    frames_dir.mkdir()
    subprocess.run([
        "ffmpeg", "-y", "-i", str(out), "-vf", "fps=2", "-vsync", "0",
        str(frames_dir / "f_%03d.png"),
    ], check=True, capture_output=True)
    seq = []
    for f in sorted(frames_dir.glob("f_*.png")):
        r, g, bl = Image.open(f).convert("RGB").resize((1, 1)).getpixel((0, 0))
        seq.append("R" if r > 150 and bl < 80 else ("B" if bl > 150 and r < 80 else "x"))
    assert "R" in seq and "B" in seq and seq.index("R") < len(seq) - 1 - seq[::-1].index("B"), \
        f"expected red before blue in output, got {''.join(seq)}"
