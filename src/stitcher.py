"""Stitch clips into a single mp4 with still-frame fade transitions.

Each non-last clip fades to black + silence over its last 400 ms; each
non-first clip is prepended with a 500 ms held first-frame that fades
in from black (audio delayed by the same window). Hard-concat
between clips — no overlap, so no audio bleed. The combined effect is
cinematic breathing room between scenes:

  clip N speech ends → 400 ms fade-to-black + silence
                     → 500 ms still-frame easing in from black + silence
                     → clip N+1 speech begins at full volume

Replaced the previous xfade crossfade approach 2026-06-02 (Yonah
feedback: crossfade overlap caused both word-salad audio bleed at any
fade > 0.3s AND no perceptible pause between sentences/clips). The
still-frame fade-in pattern preserves lip-sync (the prepended frames
are silent and static, so there's no speech to fall out of sync with),
gives a real ~900 ms of breathing room per join, and avoids the
"video stopped and started" feel that a pure black gap produced in
testing (work/fade_test/behaalotcha_v10/v11 iterations).
"""
from __future__ import annotations
import shutil
import subprocess
from pathlib import Path


def _probe_duration(mp4: Path) -> float:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp4),
    ], check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def _has_audio_stream(mp4: Path) -> bool:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp4),
    ], capture_output=True, text=True)
    return bool(result.stdout.strip())


def _probe_resolution(mp4: Path) -> tuple[int, int]:
    """Returns (width, height) of the video stream."""
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(mp4),
    ], check=True, capture_output=True, text=True)
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


# Seedance's neural audio decoder consistently bakes a ~5-6 kHz tonal
# artifact into every clip — clearly audible as a high-pitch background
# whine (Yonah 2026-05-29). Spectrum analysis on a sample raw clip:
# peak at ~5250 Hz, 30 dB above the broadband noise floor. Variants
# across clips sit anywhere from 5040 to 6000 Hz, so a moderately-wide
# notch (Q=2.0) at 5500 Hz with -15 dB catches all of them while only
# nicking sibilance by ~3 dB. After-fix peak: +18 dB above floor —
# below most listeners' perceptual threshold.
#
# Applied as a per-clip pre-pass in both render paths (concat_clips
# and loudnorm_then_concat) so every stitched video benefits.
_DETONE_FILTER = "equalizer=f=5500:width_type=q:width=2.0:g=-15"

# Fade-out applied to the last 400 ms of every non-last clip (video
# fades to black; audio fades to silence). Calibrated 2026-06-02 via
# fade-test iterations against the live Beha'alotcha source clips —
# 400 ms reads as deliberate, not glitchy. Bump higher only if a clip
# ends mid-motion (Seedance's prompt requests a settled end-frame so
# this should rarely happen).
_FADE_OUT_S = 0.4

# Audio-only fade applied to the TAIL of the FINAL clip (and the
# single-clip path) to kill Seedance 2.0's trailing audio artifact.
# Seedance recently started baking a discrete sound burst (~-28 dB)
# into the last ~100 ms of every clip, sitting after ~300 ms of
# near-silence that follows the speech (speech typically ends ~600 ms
# before the clip's end). Non-last clips already hide this via the
# 400 ms video+audio fade; the last clip kept fade_out=False so its
# artifact played at full volume as the video's final sound. 0.5 s
# comfortably covers the silence gap + the final-100ms spike while
# only barely touching speech (which ends ~600 ms before clip end).
# Audio-only by design — the video must still end on its final frame.
_END_AUDIO_FADE_S = 0.5

# Still-frame prepend at the start of every non-first clip. Clones
# the clip's first frame for this many seconds before the actual
# clip content begins, then fades that prepended region in from
# black. Audio is delayed by the same window so speech starts at
# full volume the moment the visual fully blooms. Calibrated to
# 500 ms — shorter felt rushed in testing, longer felt like the
# video stopped. Adjust if operator feedback shifts.
_STILL_FRAME_PRE_S = 0.5


def _detone_audio(src: Path, dest: Path) -> Path:
    """Apply the de-tone equalizer notch to one clip, copying video.
    Used by the single-clip path and (chained) by loudnorm_then_concat."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
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
    fade_out: bool,
    pre_still: bool,
    has_audio: bool,
    end_audio_fade: bool = False,
) -> Path:
    """Re-encode one clip with detone + rescale + optional fade-out at
    end + optional still-frame prepend with fade-in at start.

    Combined into a single ffmpeg pass so we don't transcode the same
    video twice. Output is normalized to (target_w, target_h) so the
    final hard-concat doesn't choke on heterogeneous inputs.

    `fade_out=True`       → applies the 400 ms tail fade (video + audio).
    `pre_still=True`      → clones the first frame for 500 ms at the start,
                           fades it in from black, delays audio by the same
                           window so speech starts when the visual fully
                           blooms.
    `end_audio_fade=True` → applies a 500 ms AUDIO-ONLY tail fade to kill
                           Seedance's trailing audio artifact. The video
                           is NOT faded (the clip must end on its final
                           frame). Independent of `fade_out`; used for the
                           final clip, which has fade_out=False. A clip
                           must never get BOTH the fade_out afade and the
                           end_audio_fade afade — they're mutually
                           exclusive (see guard below).

    For a 4-clip video the typical pattern is:
      clip 0 → fade_out=True,  pre_still=False, end_audio_fade=False
      clip 1 → fade_out=True,  pre_still=True,  end_audio_fade=False
      clip 2 → fade_out=True,  pre_still=True,  end_audio_fade=False
      clip 3 → fade_out=False, pre_still=True,  end_audio_fade=True
    """
    # The two tail-audio fades are mutually exclusive: fade_out already
    # fades the audio (and video) tail, so layering end_audio_fade on top
    # would be redundant/double-faded. The last clip is the only one with
    # end_audio_fade=True and it always has fade_out=False, so this guard
    # is defensive, not load-bearing.
    if fade_out and end_audio_fade:
        end_audio_fade = False
    duration = _probe_duration(src)
    fadeout_start = max(0.0, duration - _FADE_OUT_S)
    end_audio_fade_start = max(0.0, duration - _END_AUDIO_FADE_S)

    v_parts = [
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease",
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black",
        "setsar=1",
    ]
    if fade_out:
        v_parts.append(f"fade=t=out:st={fadeout_start:.3f}:d={_FADE_OUT_S}")
    if pre_still:
        v_parts.append(f"tpad=start_duration={_STILL_FRAME_PRE_S}:start_mode=clone")
        v_parts.append(f"fade=t=in:st=0:d={_STILL_FRAME_PRE_S}")
    vf = ",".join(v_parts)

    a_parts = [_DETONE_FILTER]
    if fade_out:
        a_parts.append(f"afade=t=out:st={fadeout_start:.3f}:d={_FADE_OUT_S}")
    if end_audio_fade:
        a_parts.append(
            f"afade=t=out:st={end_audio_fade_start:.3f}:d={_END_AUDIO_FADE_S}"
        )
    if pre_still:
        pre_ms = int(_STILL_FRAME_PRE_S * 1000)
        a_parts.append(f"adelay={pre_ms}|{pre_ms}")
    af = ",".join(a_parts)

    args = ["ffmpeg", "-y", "-i", str(src), "-vf", vf]
    if has_audio:
        args += ["-af", af]
    args += [
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
        # Force 30 fps. Seedance outputs 23.976 fps natively; Facebook Reels
        # + Instagram Reels require >= 24 fps and reject 23.976 (rounded
        # to 23 by their preflight check). Yonah hit this on the 2026-06-02
        # Beha'alotcha post — "frame rate must be between 24 and 60".
        # 30 gives a stable round number with headroom; libx264 will
        # duplicate frames as needed (visually identical to viewers).
        "-r", "30",
    ]
    if has_audio:
        args += ["-c:a", "aac", "-b:a", "192k"]
    args.append(str(dest))

    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"_preprocess_clip_for_concat failed for {src} "
            f"(fade_out={fade_out}, pre_still={pre_still}, dur={duration:.2f}s): "
            f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
        )
    return dest


def concat_clips(clips: list[Path], dest: Path, crossfade_s: float = 0.35) -> Path:
    """Stitch clips end-to-end with still-frame fade transitions.

    Single clip: detoned and passed through (no fade work needed when
    there's no transition).

    Multiple clips: each clip is re-encoded once via
    _preprocess_clip_for_concat (which applies detone + rescale +
    fade-out at end (if non-last) + still-frame prepend with fade-in
    (if non-first)), then the preprocessed files are concatenated
    via ffmpeg's `concat` demuxer (-c copy — no second transcode).

    Transition shape at each join:
      clip N speech ends → 400 ms fade-to-black + silence
                         → 500 ms still-frame fade-in from black, audio
                           still silent
                         → clip N+1 speech begins at full volume

    Cumulative breathing room per join: ~900 ms. Lip-sync stays intact
    because the prepended still-frame region is, by definition, static
    and silent.

    The `crossfade_s` parameter is retained for back-compat with
    existing callers (e.g. loudnorm_then_concat passes it through) but
    is IGNORED — there is no crossfade in the new flow. Tune the fade
    durations via the module-level _FADE_OUT_S and _STILL_FRAME_PRE_S
    constants instead.
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent

    # Single-clip: detone + tail audio-fade if it has audio, otherwise
    # straight-copy. The tail audio-fade kills Seedance's trailing
    # artifact (same fix as the final clip in the multi-clip path).
    # Routed through _preprocess_clip_for_concat at the clip's own
    # resolution with no video fade and no still-frame prepend, so the
    # video is untouched apart from the forced 30 fps re-encode.
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
                fade_out=False,
                pre_still=False,
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

    # Per-clip pre-process: detone + rescale + fades in a single
    # ffmpeg pass. Each output mp4 is normalized to (target_w, target_h)
    # so the concat demuxer doesn't choke on heterogeneous inputs.
    preprocessed: list[Path] = []
    for i, src in enumerate(clips):
        d = work / f"_pp_{i:02d}.mp4"
        _preprocess_clip_for_concat(
            src, d,
            target_w=target_w, target_h=target_h,
            fade_out=(i < len(clips) - 1),
            pre_still=(i > 0),
            has_audio=has_audio,
            end_audio_fade=(i == len(clips) - 1),
        )
        preprocessed.append(d)

    # Hard concat via demuxer. -c copy means no second transcode —
    # we already did the single re-encode per clip above. The concat
    # demuxer's list file uses single-quoted paths; forward-slash
    # paths (.as_posix()) are safe on every platform ffmpeg supports.
    concat_list = work / "_concat_list.txt"
    with concat_list.open("w", encoding="utf-8") as f:
        for p in preprocessed:
            f.write(f"file '{p.as_posix()}'\n")

    args = [
        "ffmpeg", "-y",
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
    inputs: list[Path], dest: Path, crossfade_s: float = 0.35
) -> Path:
    """Two-pass: normalize each input's audio with EBU R128 loudnorm,
    then concat with crossfade.

    Compose pulls clips from different generation runs which can have
    different loudness profiles (varies by Seedance roll, sometimes 6+
    LUFS apart). Loudnorm flattens them so cuts don't yank the volume.

    First pass: per-clip loudnorm with -c:v copy (cheap — no video re-
    encode). Second pass: concat_clips, which probes dimensions and
    rescales heterogeneous inputs inline before xfade (so we don't
    need to rescale here too).
    """
    work_dir = dest.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    for i, src in enumerate(inputs):
        norm_path = work_dir / f"_norm_{i:02d}.mp4"
        # De-tone BEFORE loudnorm so loudnorm doesn't normalize against
        # a clip whose energy is dominated by the artifact. Chained in
        # a single ffmpeg pass for efficiency (one re-encode, not two).
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src),
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
    # concat_clips would also detone, but the inputs here are already
    # detoned via the chained filter above. Detone is idempotent (the
    # already-suppressed band stays suppressed), so calling concat_clips
    # is fine — at worst we get one wasted ffmpeg pass per clip.
    return concat_clips(normalized, dest, crossfade_s=crossfade_s)
