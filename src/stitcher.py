"""Stitch clips into a single mp4 with smooth crossfade transitions.

Uses ffmpeg's xfade + acrossfade filters to blend each clip into the next
over a short window (default 0.3s). This produces smoother scene changes
than hard cuts while letting every clip keep its own reference-image
character lock — frame-chaining via Seedance's first_frame_url is
incompatible with reference_image_urls, so we do the smoothing in post.
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


def concat_clips(clips: list[Path], dest: Path, crossfade_s: float = 0.35) -> Path:
    """Stitch clips end-to-end with crossfade transitions.

    Single clip: copied through unchanged.
    Multiple clips: chained through ffmpeg xfade (video) + acrossfade (audio
    if present). Output re-encodes to H.264 + AAC.

    Tuning history:
    - 0.5s fade: visually smooth but audio overlap caused word-salad at
      clip boundaries (Seedance speech bled into next clip).
    - 0.2s fade: kept voiceover clean but transitions felt jerky.
    - 0.35s dissolve: jerkiness gone but the noise-pattern mixing read
      as 'static' to viewers — too aggressive a look for a calm
      teaching video.
    - 0.35s fade: current. Plain alpha-blend at 0.35s is the smoothest
      we can push without audio bleed re-emerging. Dissolve was a
      detour; gentleness wins over edge-masking.
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)

    if len(clips) == 1:
        shutil.copy(clips[0], dest)
        return dest

    durations = [_probe_duration(c) for c in clips]
    has_audio = all(_has_audio_stream(c) for c in clips)

    # Compute cumulative offsets. For clip pair (i, i+1):
    # offset_i = sum(durations[0..i]) - (i+1) * crossfade_s
    video_filters: list[str] = []
    audio_filters: list[str] = []
    for i in range(len(clips) - 1):
        offset = sum(durations[: i + 1]) - (i + 1) * crossfade_s
        v_in_a = "[0:v]" if i == 0 else f"[vx{i - 1}]"
        v_in_b = f"[{i + 1}:v]"
        v_out = "[vout]" if i == len(clips) - 2 else f"[vx{i}]"
        video_filters.append(
            f"{v_in_a}{v_in_b}xfade=transition=fade:"
            f"duration={crossfade_s}:offset={offset:.3f}{v_out}"
        )
        if has_audio:
            a_in_a = "[0:a]" if i == 0 else f"[ax{i - 1}]"
            a_in_b = f"[{i + 1}:a]"
            a_out = "[aout]" if i == len(clips) - 2 else f"[ax{i}]"
            audio_filters.append(
                f"{a_in_a}{a_in_b}acrossfade=d={crossfade_s}{a_out}"
            )

    filter_complex = ";".join(video_filters + audio_filters)

    args: list[str] = ["ffmpeg", "-y"]
    for c in clips:
        args += ["-i", str(c)]
    args += [
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]
    if has_audio:
        args += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    args.append(str(dest))

    subprocess.run(args, check=True, capture_output=True)
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
    encode). Second pass: standard concat_clips, which re-encodes to
    H.264 + AAC. Total of one video encode.
    """
    work_dir = dest.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    for i, src in enumerate(inputs):
        norm_path = work_dir / f"_norm_{i:02d}.mp4"
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src),
                "-af", "loudnorm=I=-23:LRA=7:TP=-2",
                "-c:v", "copy",
                str(norm_path),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"loudnorm failed for {src}: "
                f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
            )
        normalized.append(norm_path)
    return concat_clips(normalized, dest, crossfade_s=crossfade_s)
