"""Stitch clips into a single mp4 with adaptive, per-join fade transitions.

Each join gets a still-frame fade transition whose *pause length adapts to
the clips' actual speech timing*. We measure the real trailing silence of
the outgoing clip and the leading silence of the incoming clip, then insert
only enough silent still-frame to reach a target speech-to-speech gap
(the "preset" target — Standard ~700 ms). Clips that already breathe get a
minimal insert; clips whose narration butts speech-to-speech get more.

  clip N speech ends → (natural trailing silence) → short fade-to-black
                     → inserted silent still-frame easing in from black
                     → clip N+1 speech begins at full volume

Hard-concat between clips — no overlap, so no audio bleed (the 2026-06-02
crossfade regression stays banned). Lip-sync is preserved because the
prepended still-frame region is static and silent.

Why adaptive (2026-07-01): the previous build used a *fixed* ~900 ms gap
tuned for the worst case (speech running to a clip's edge). But Seedance
places speech differently every clip, so on clips that already end/begin
with silence the fixed gap stacked on top → dead air → "video keeps
stopping and starting" (Yonah, latest published video). Measured on that
video, natural join gaps ranged 0.22s–1.40s; a single fixed value cannot
fit them. See docs/superpowers/specs/2026-06-24-adaptive-stitch-transitions-design.md.

Only the pause is adaptive; the still-frame/no-overlap structure, the
de-tone notch, the final-clip trailing-artifact fade, and forced 30 fps
are all unchanged.
"""
from __future__ import annotations
import os
import re
import shutil
import subprocess
from pathlib import Path

# ffmpeg/ffprobe are on PATH inside the Modal container (bare names). For
# local testing on machines where they're not on PATH, set FFMPEG_BIN /
# FFPROBE_BIN to the full exe path — prod (Modal) leaves them unset and
# gets the bare names exactly as before.
_FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
_FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def _probe_duration(mp4: Path) -> float:
    result = subprocess.run([
        _FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp4),
    ], check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def _has_audio_stream(mp4: Path) -> bool:
    result = subprocess.run([
        _FFPROBE, "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp4),
    ], capture_output=True, text=True)
    return bool(result.stdout.strip())


def _probe_resolution(mp4: Path) -> tuple[int, int]:
    """Returns (width, height) of the video stream."""
    result = subprocess.run([
        _FFPROBE, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(mp4),
    ], check=True, capture_output=True, text=True)
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


# Seedance's neural audio decoder consistently bakes a ~5-6 kHz tonal
# artifact into every clip — clearly audible as a high-pitch background
# whine (Yonah 2026-05-29). A moderately-wide notch (Q=2.0) at 5500 Hz
# with -15 dB catches the 5040-6000 Hz variants across clips while only
# nicking sibilance by ~3 dB. Applied as a per-clip pre-pass in both
# render paths so every stitched video benefits — and applied before
# silence measurement so the whine doesn't read as "sound".
_DETONE_FILTER = "equalizer=f=5500:width_type=q:width=2.0:g=-15"

# ── Adaptive transition tuning ──────────────────────────────────────────
# Target speech-to-speech gap at each join (the "Standard" preset). The
# adaptive layer inserts only enough silent still-frame to reach this,
# given the clips' measured natural silence. Presets map here:
#   Tight ~0.35 · Standard ~0.70 · Breathing ~1.00 (s)
# Provisional per the design spec; calibrated 2026-07-01 against the
# choppy published video (natural join gaps 0.22-1.40s → Standard lands
# speech-butting joins at ~0.70s without padding already-spacious ones).
_TARGET_PAUSE_STANDARD_S = 0.70

# The inserted still-frame pause is clamped to this range. MIN keeps a hair
# of breath (and a visible scene-change beat) even on already-spacious
# joins; MAX caps the worst case so a clip with no trailing silence can't
# produce an absurd gap.
_MIN_INSERT_PAUSE_S = 0.15
_MAX_INSERT_PAUSE_S = 0.80

# Fade-out on the outgoing (non-final) clip. Capped small for visual
# polish; per-clip it's further limited to the clip's trailing silence
# (+50 ms grace) so the fade never eats the final word of narration.
_FADE_OUT_MAX_S = 0.25

# Audio-only fade on the TAIL of the FINAL clip (and the single-clip path)
# to kill Seedance's trailing audio artifact — a discrete ~-28 dB burst
# baked into the last ~100 ms, sitting after ~300 ms of near-silence that
# follows the speech. Non-final clips hide this via their fade-out; the
# final clip has no fade-out, so it gets this audio-only tail fade (the
# video must still end on its final frame). This is also the answer to
# "there's a sound at the end of the last clip" — it's removed at stitch.
_END_AUDIO_FADE_S = 0.5

# silencedetect params. -30 dB threshold sits above the -28 dB trailing
# artifact, so measured trailing silence ends just before the artifact
# (slightly under-counts existing breath → we add slightly more pause, the
# safe direction). 80 ms min-silence avoids treating inter-word gaps as
# silence.
_SILENCE_THRESH_DB = -30
_SILENCE_MIN_D_S = 0.08


def _measure_silence(src: Path, has_audio: bool) -> tuple[float, float]:
    """Return (leading_silence_s, trailing_silence_s) for one clip,
    measured on de-toned audio. (0, 0) when the clip has no audio."""
    if not has_audio:
        return (0.0, 0.0)
    duration = _probe_duration(src)
    result = subprocess.run(
        [_FFMPEG, "-i", str(src),
         "-af",
         f"{_DETONE_FILTER},"
         f"silencedetect=noise={_SILENCE_THRESH_DB}dB:d={_SILENCE_MIN_D_S}",
         "-f", "null", "-"],
        capture_output=True,
    )
    txt = result.stderr.decode("utf-8", errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start: ([\-0-9.]+)", txt)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\-0-9.]+)", txt)]

    # Leading: a silence region starting at (or ~at) t=0.
    leading = 0.0
    if starts and starts[0] < 0.05:
        leading = (ends[0] if ends else duration) - starts[0]

    # Trailing: the last silence region runs to EOF — detected either by a
    # dangling start with no matching end, or a final end coinciding with
    # the clip duration.
    trailing = 0.0
    if starts and (len(ends) < len(starts)
                   or (ends and abs(ends[-1] - duration) < 0.05)):
        trailing = duration - starts[-1]

    leading = max(0.0, min(leading, duration))
    trailing = max(0.0, min(trailing, duration))
    return (leading, trailing)


def _compute_inserted_pause(
    trailing_prev: float, leading_next: float, target: float
) -> float:
    """How much silent still-frame to prepend to the incoming clip so the
    total speech-to-speech gap at this join reaches `target`, clamped to
    [_MIN_INSERT_PAUSE_S, _MAX_INSERT_PAUSE_S]. Add-only: never trims a
    clip's own silence (trimming would break first-frame/last-frame
    chaining continuity)."""
    existing = trailing_prev + leading_next
    return max(_MIN_INSERT_PAUSE_S, min(_MAX_INSERT_PAUSE_S, target - existing))


def _detone_audio(src: Path, dest: Path) -> Path:
    """Apply the de-tone equalizer notch to one clip, copying video.
    Used by the single-clip path and (chained) by loudnorm_then_concat."""
    result = subprocess.run(
        [_FFMPEG, "-y", "-i", str(src),
         "-af", _DETONE_FILTER,
         "-c:v", "copy",
         str(dest)],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"_detone_audio failed for {src}: "
            f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
        )
    return dest


def _preprocess_clip_for_concat(
    src: Path,
    dest: Path,
    target_w: int,
    target_h: int,
    fade_out_s: float,
    pre_still_s: float,
    has_audio: bool,
    end_audio_fade: bool = False,
) -> Path:
    """Re-encode one clip: detone + rescale + optional tail fade-out +
    optional still-frame prepend that fades in from black.

    Single ffmpeg pass so we don't transcode twice. Output is normalized to
    (target_w, target_h) so the final hard-concat doesn't choke on
    heterogeneous inputs.

    `fade_out_s > 0`     → fade the last `fade_out_s` of video+audio to
                           black/silence (outgoing non-final clips). Caller
                           sizes this to not exceed the clip's trailing
                           silence, so narration isn't clipped.
    `pre_still_s > 0`    → clone the first frame for `pre_still_s` seconds at
                           the start, fade it in from black over that whole
                           window, and delay audio by the same window so
                           speech starts when the visual fully blooms. This
                           is the adaptive per-join pause.
    `end_audio_fade`     → 500 ms AUDIO-ONLY tail fade (final clip only) to
                           kill Seedance's trailing artifact. Video is NOT
                           faded. Mutually exclusive with fade_out_s.
    """
    # A clip must never get BOTH a tail fade-out and the end-audio-fade —
    # they'd double-fade the tail. The final clip is the only one with
    # end_audio_fade and it always has fade_out_s=0, so this is defensive.
    if fade_out_s > 0 and end_audio_fade:
        end_audio_fade = False

    duration = _probe_duration(src)
    fadeout_start = max(0.0, duration - fade_out_s)
    end_audio_fade_start = max(0.0, duration - _END_AUDIO_FADE_S)

    v_parts = [
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease",
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black",
        "setsar=1",
    ]
    if fade_out_s > 0:
        v_parts.append(f"fade=t=out:st={fadeout_start:.3f}:d={fade_out_s:.3f}")
    if pre_still_s > 0:
        v_parts.append(f"tpad=start_duration={pre_still_s:.3f}:start_mode=clone")
        v_parts.append(f"fade=t=in:st=0:d={pre_still_s:.3f}")
    vf = ",".join(v_parts)

    a_parts = [_DETONE_FILTER]
    if fade_out_s > 0:
        a_parts.append(f"afade=t=out:st={fadeout_start:.3f}:d={fade_out_s:.3f}")
    if end_audio_fade:
        a_parts.append(
            f"afade=t=out:st={end_audio_fade_start:.3f}:d={_END_AUDIO_FADE_S}"
        )
    if pre_still_s > 0:
        pre_ms = int(round(pre_still_s * 1000))
        a_parts.append(f"adelay={pre_ms}|{pre_ms}")
    af = ",".join(a_parts)

    args = [_FFMPEG, "-y", "-i", str(src), "-vf", vf]
    if has_audio:
        args += ["-af", af]
    args += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        # Force 30 fps. Seedance outputs 23.976 fps natively; Facebook /
        # Instagram Reels require >= 24 fps and reject 23.976 (rounded to
        # 23 by their preflight). 30 gives a stable round number; libx264
        # duplicates frames as needed (visually identical).
        "-r", "30",
    ]
    if has_audio:
        args += ["-c:a", "aac", "-b:a", "192k"]
    args.append(str(dest))

    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"_preprocess_clip_for_concat failed for {src} "
            f"(fade_out_s={fade_out_s:.3f}, pre_still_s={pre_still_s:.3f}, "
            f"dur={duration:.2f}s): "
            f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
        )
    return dest


def concat_clips(
    clips: list[Path],
    dest: Path,
    crossfade_s: float = 0.35,
    target_pause_s: float | None = None,
    join_overrides: dict[int, float] | None = None,
) -> Path:
    """Stitch clips end-to-end with adaptive, per-join still-frame fades.

    Single clip: detoned + trailing-artifact audio fade, passed through.

    Multiple clips: measure each clip's leading/trailing silence, compute a
    per-join inserted pause to reach the target speech-to-speech gap, then
    re-encode each clip once (detone + rescale + tail fade-out if non-last +
    adaptive still-frame prepend if non-first) and hard-concat via the
    demuxer (-c copy — no second transcode).

    `target_pause_s`   → the Standard/Tight/Breathing target gap in seconds.
                         None ⇒ Standard (_TARGET_PAUSE_STANDARD_S). This is
                         how the global preset reaches the engine.
    `join_overrides`   → optional {left_clip_index: target_pause_s} to
                         override the target at a specific join (per-join
                         preset). Absent keys use `target_pause_s`.
    `crossfade_s`      → retained for back-compat; IGNORED (no crossfade).

    Backward-compatible: existing callers that pass neither new param get
    adaptive-Standard transitions automatically.
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent
    base_target = target_pause_s if target_pause_s is not None else _TARGET_PAUSE_STANDARD_S
    overrides = join_overrides or {}

    # Single-clip: detone + trailing-artifact audio fade (or straight copy
    # when there's no audio). No transition work needed.
    if len(clips) == 1:
        if _has_audio_stream(clips[0]):
            w, h = _probe_resolution(clips[0])
            if w % 2:
                w += 1
            if h % 2:
                h += 1
            return _preprocess_clip_for_concat(
                clips[0], dest,
                target_w=w, target_h=h,
                fade_out_s=0.0,
                pre_still_s=0.0,
                has_audio=True,
                end_audio_fade=True,
            )
        shutil.copy(clips[0], dest)
        return dest

    sizes = [_probe_resolution(c) for c in clips]
    target_w = max(w for w, _ in sizes)
    target_h = max(h for _, h in sizes)
    if target_w % 2:
        target_w += 1
    if target_h % 2:
        target_h += 1

    has_audio = all(_has_audio_stream(c) for c in clips)

    # Measure natural silence per clip (leading, trailing) up front so we
    # can size each join's inserted pause and each clip's fade-out.
    silences = [_measure_silence(c, has_audio) for c in clips]

    # Per-clip pre-process: detone + rescale + adaptive fades, one ffmpeg
    # pass each, normalized to (target_w, target_h) so the concat demuxer
    # doesn't choke on heterogeneous inputs.
    preprocessed: list[Path] = []
    n = len(clips)
    for i, src in enumerate(clips):
        is_last = i == n - 1
        is_first = i == 0
        trailing_i = silences[i][1]

        # Outgoing fade-out (non-final): capped, and never longer than this
        # clip's trailing silence (+50 ms grace) so it can't clip narration.
        fade_out_s = 0.0
        if not is_last:
            fade_out_s = min(_FADE_OUT_MAX_S, trailing_i + 0.05)

        # Incoming adaptive pause (non-first): fill to the target for the
        # join between clip i-1 and clip i.
        pre_still_s = 0.0
        if not is_first:
            target = overrides.get(i - 1, base_target)
            trailing_prev = silences[i - 1][1]
            leading_i = silences[i][0]
            pre_still_s = _compute_inserted_pause(trailing_prev, leading_i, target)

        d = work / f"_pp_{i:02d}.mp4"
        _preprocess_clip_for_concat(
            src, d,
            target_w=target_w, target_h=target_h,
            fade_out_s=fade_out_s,
            pre_still_s=pre_still_s,
            has_audio=has_audio,
            end_audio_fade=is_last,
        )
        preprocessed.append(d)

    # Hard concat via demuxer. -c copy means no second transcode. The
    # demuxer resolves list entries relative to the LIST FILE's directory,
    # so we write bare basenames (the _pp files are always siblings of the
    # list). This is robust whether the caller passed an absolute or a
    # relative dest path — an absolute path in the list double-resolves
    # under a relative invocation.
    concat_list = work / "_concat_list.txt"
    with concat_list.open("w", encoding="utf-8") as f:
        for p in preprocessed:
            f.write(f"file '{p.name}'\n")

    args = [
        _FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        "-movflags", "+faststart",
        str(dest),
    ]
    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        durations_str = ", ".join(
            f"{_probe_duration(p):.2f}s" for p in preprocessed
        )
        sizes_str = ", ".join(f"{w}x{h}" for w, h in sizes)
        raise RuntimeError(
            f"concat ffmpeg failed (exit {result.returncode}). "
            f"Inputs: {len(clips)} clips, source sizes [{sizes_str}], "
            f"target {target_w}x{target_h}, has_audio={has_audio}, "
            f"preprocessed durations [{durations_str}]. "
            f"ffmpeg stderr (last 2000 chars):\n{stderr[-2000:]}"
        )
    return dest


def loudnorm_then_concat(
    inputs: list[Path],
    dest: Path,
    crossfade_s: float = 0.35,
    target_pause_s: float | None = None,
    join_overrides: dict[int, float] | None = None,
) -> Path:
    """Two-pass: normalize each input's audio with EBU R128 loudnorm, then
    adaptive concat.

    Compose pulls clips from different generation runs which can have
    different loudness profiles (sometimes 6+ LUFS apart). Loudnorm flattens
    them so cuts don't yank the volume. First pass: per-clip loudnorm with
    -c:v copy (cheap). Second pass: concat_clips (probes dimensions +
    rescales + adaptive fades). Forwards the preset params through.
    """
    work_dir = dest.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    for i, src in enumerate(inputs):
        norm_path = work_dir / f"_norm_{i:02d}.mp4"
        # De-tone BEFORE loudnorm so loudnorm doesn't normalize against a
        # clip whose energy is dominated by the artifact. Chained in one
        # ffmpeg pass (one re-encode, not two).
        result = subprocess.run(
            [
                _FFMPEG, "-y", "-i", str(src),
                "-af", f"{_DETONE_FILTER},loudnorm=I=-23:LRA=7:TP=-2",
                "-c:v", "copy",
                str(norm_path),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"detone+loudnorm failed for {src}: "
                f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
            )
        normalized.append(norm_path)
    # concat_clips re-detones (idempotent — the suppressed band stays
    # suppressed), so passing already-detoned inputs is fine.
    return concat_clips(
        normalized, dest,
        crossfade_s=crossfade_s,
        target_pause_s=target_pause_s,
        join_overrides=join_overrides,
    )
