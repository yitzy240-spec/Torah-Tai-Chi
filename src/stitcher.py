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


def _probe_resolution(mp4: Path) -> tuple[int, int]:
    """Returns (width, height) of the video stream."""
    result = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(mp4),
    ], check=True, capture_output=True, text=True)
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


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

    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0:
        # Surface ffmpeg's actual stderr — without this, the calling code
        # (e.g. compose_video in modal_app.py) only sees CalledProcessError's
        # generic "returned non-zero exit status 1" message and we can't
        # diagnose. xfade-concat tends to fail on heterogeneous inputs
        # (different fps, resolution, or codec params across clips from
        # different generation runs), so the actual ffmpeg complaint is
        # usually a one-line "Codec/format mismatch" or similar.
        stderr = result.stderr.decode("utf-8", errors="replace")
        durations_str = ", ".join(f"{d:.2f}s" for d in durations)
        raise RuntimeError(
            f"concat ffmpeg failed (exit {result.returncode}). "
            f"Inputs: {len(clips)} clips, durations [{durations_str}], "
            f"crossfade={crossfade_s}s, has_audio={has_audio}. "
            f"ffmpeg stderr (last 2000 chars):\n"
            f"{stderr[-2000:]}"
        )
    return dest


def loudnorm_then_concat(
    inputs: list[Path], dest: Path, crossfade_s: float = 0.35
) -> Path:
    """Two-pass: normalize each input's audio with EBU R128 loudnorm,
    then concat with crossfade.

    Compose pulls clips from different generation runs which can have
    different loudness profiles AND can have different video dimensions
    (e.g. mixing a 480p version with newer 720p versions). xfade
    requires all inputs to share the same width/height; loudnorm
    previously used -c:v copy which preserved the heterogeneity and
    caused a hard ffmpeg failure: "First input link main parameters
    (size 496x864) do not match the corresponding second input link
    xfade parameters (size 720x1280)".

    First pass: per-clip loudnorm + video rescale to the LARGEST input
    dimensions found across the batch (scaling smaller clips up;
    scaling larger ones down would lose info). Output is libx264 +
    yuv420p + 24fps so the second-pass concat_clips re-encode is on
    fully homogeneous inputs.

    Cost: full video re-encode per clip on this pass instead of -c:v
    copy. Compute is cheap on Modal; correctness wins.
    """
    work_dir = dest.parent
    work_dir.mkdir(parents=True, exist_ok=True)

    # Probe all inputs and pick the max dimensions as the target. Padding
    # smaller clips up to this size preserves their aspect ratio without
    # downsampling anything.
    sizes = [_probe_resolution(src) for src in inputs]
    target_w = max(w for w, _ in sizes)
    target_h = max(h for _, h in sizes)

    # Use a scale-then-pad chain: scale to fit within target maintaining
    # aspect ratio, then center-pad to exactly target_w x target_h.
    # Even target dims (h264 yuv420p constraint).
    target_w = target_w if target_w % 2 == 0 else target_w + 1
    target_h = target_h if target_h % 2 == 0 else target_h + 1
    vfilter = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"setsar=1,fps=24"
    )

    normalized: list[Path] = []
    for i, src in enumerate(inputs):
        norm_path = work_dir / f"_norm_{i:02d}.mp4"
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src),
                "-af", "loudnorm=I=-23:LRA=7:TP=-2",
                "-vf", vfilter,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k",
                str(norm_path),
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"loudnorm+rescale failed for {src} "
                f"(input {sizes[i][0]}x{sizes[i][1]} -> {target_w}x{target_h}): "
                f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
            )
        normalized.append(norm_path)
    return concat_clips(normalized, dest, crossfade_s=crossfade_s)
