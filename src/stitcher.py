"""Stitch clips into a single mp4 with scene-aware transitions.

Each cut between two clips is one of:
  - "hard" → a plain concat. The clips play back-to-back with no transition.
             Used WITHIN a scene (same setting, continuous) — a hard cut flows.
  - "fade" → a real fade-OUT of the outgoing clip then fade-IN of the incoming
             clip (video to/from black + audio to/from silence), NOT an
             overlapping crossfade. Used at a SCENE BREAK (setting changes, or
             the incoming clip can't be frame-chained, e.g. a motion-ref clip).

Why a sequential fade and not a crossfade (2026-07-01): a crossfade overlaps
the two clips' audio, so an outgoing clip whose narration runs to its end has
its last words faded down mid-word — "the fade clips the audio" (Yonah). A
sequential fade-out→fade-in gives each clip's audio its own room. To guarantee
the fade never lands on speech, the outgoing clip is padded with a short
held-last-frame settle (and the incoming with a held-first-frame lead) so the
fade region is always silence. Hard cuts get none of this — they stay tight
and flowing. Only true scene breaks fade.

The caller decides each cut's type from clip metadata (see
modal_app.compose_video / auto_cut_type). Kept: the de-tone notch, a short
trailing-artifact audio fade on hard-cut clips, the final-clip end fade
("sound at the end of the last clip"), forced 30 fps for Reels.
"""
from __future__ import annotations
import os
import re
import shutil
import subprocess
from pathlib import Path

_FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
_FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")

_DETONE_FILTER = "equalizer=f=5500:width_type=q:width=2.0:g=-15"

# Short audio-only tail fade on hard-cut clips to kill Seedance's trailing
# ~-28 dB burst (last ~100 ms) so it isn't audible at a hard cut.
_ARTIFACT_FADE_S = 0.12
# Longer audio-only tail fade on the FINAL clip — the "sound at the end" fix.
_END_AUDIO_FADE_S = 0.5
# Fade-out / fade-in duration at a scene break (each side).
_FADE_S = 0.45
# silencedetect params (used only to size the fade's settle so it lands in
# silence). -30 dB sits above the -28 dB artifact.
_SILENCE_THRESH_DB = -30
_SILENCE_MIN_D_S = 0.08

HARD = "hard"
FADE = "fade"
BRANDED_OUTRO_PATH = Path(
    os.environ.get(
        "TORAH_TAI_CHI_OUTRO_PATH",
        "/root/references/_brand/outro.mp4",
    )
)


def build_final_timeline(
    clips: list[Path],
    *,
    cut_types: list[str] | None,
    outro_path: Path = BRANDED_OUTRO_PATH,
) -> tuple[list[Path], list[str]]:
    """Return the production timeline with a branded outro scene break."""
    if not clips:
        raise ValueError("No content clips to finalize")
    content_cuts = list(cut_types) if cut_types is not None else [HARD] * (len(clips) - 1)
    content_cuts = (content_cuts + [HARD] * (len(clips) - 1))[: len(clips) - 1]
    return [*clips, outro_path], [*content_cuts, FADE]


def _probe_video_duration(mp4: Path) -> float:
    """Duration of the VIDEO stream, not the container. They differ on
    Seedance-derived clips (audio outlasts video) — see _transition_concat."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mp4)],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return _probe_duration(mp4)


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
    result = subprocess.run([
        _FFPROBE, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", str(mp4),
    ], check=True, capture_output=True, text=True)
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


def _detone_audio(src: Path, dest: Path) -> Path:
    result = subprocess.run(
        [_FFMPEG, "-y", "-i", str(src), "-af", _DETONE_FILTER,
         "-c:v", "copy", str(dest)],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"_detone_audio failed for {src}: "
            f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
        )
    return dest


def _measure_silence(src: Path, has_audio: bool) -> tuple[float, float]:
    """(leading_silence_s, trailing_silence_s) on de-toned audio. Used only to
    size a fade's settle so the fade never lands on speech."""
    if not has_audio:
        return (0.0, 0.0)
    duration = _probe_duration(src)
    result = subprocess.run(
        [_FFMPEG, "-i", str(src), "-af",
         f"{_DETONE_FILTER},silencedetect=noise={_SILENCE_THRESH_DB}dB:d={_SILENCE_MIN_D_S}",
         "-f", "null", "-"],
        capture_output=True,
    )
    txt = result.stderr.decode("utf-8", errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start: ([\-0-9.]+)", txt)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\-0-9.]+)", txt)]
    leading = 0.0
    if starts and starts[0] < 0.05:
        leading = (ends[0] if ends else duration) - starts[0]
    trailing = 0.0
    if starts and (len(ends) < len(starts) or (ends and abs(ends[-1] - duration) < 0.05)):
        trailing = duration - starts[-1]
    return (max(0.0, min(leading, duration)), max(0.0, min(trailing, duration)))


def _preprocess_clip(
    src: Path, dest: Path, target_w: int, target_h: int, has_audio: bool,
    *, fade_in_s: float, fade_out_s: float, pre_settle_s: float,
    post_settle_s: float, artifact_fade_s: float, end_audio_fade: bool,
) -> Path:
    """Normalize one clip (rescale + 30 fps + de-tone) and bake in its head/
    tail fades. `pre/post_settle_s` clone the first/last frame so a fade lands
    on silence. All clips end up same-format for a clean hard concat."""
    duration = _probe_duration(src)
    total = duration + pre_settle_s + post_settle_s

    v = [
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease",
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black",
        "setsar=1",
    ]
    if pre_settle_s > 0 or post_settle_s > 0:
        tp = []
        if pre_settle_s > 0:
            tp.append(f"start_duration={pre_settle_s:.3f}:start_mode=clone")
        if post_settle_s > 0:
            tp.append(f"stop_duration={post_settle_s:.3f}:stop_mode=clone")
        v.append("tpad=" + ":".join(tp))
    if fade_in_s > 0:
        v.append(f"fade=t=in:st=0:d={fade_in_s:.3f}")
    if fade_out_s > 0:
        v.append(f"fade=t=out:st={max(0.0, total - fade_out_s):.3f}:d={fade_out_s:.3f}")
    vf = ",".join(v)

    args = [_FFMPEG, "-y", "-i", str(src), "-vf", vf]
    if has_audio:
        a = [_DETONE_FILTER]
        if pre_settle_s > 0:
            ms = int(round(pre_settle_s * 1000))
            a.append(f"adelay={ms}|{ms}")
        if post_settle_s > 0:
            a.append(f"apad=pad_dur={post_settle_s:.3f}")
        if fade_out_s > 0:
            a.append(f"afade=t=out:st={max(0.0, total - fade_out_s):.3f}:d={fade_out_s:.3f}")
        elif end_audio_fade:
            a.append(f"afade=t=out:st={max(0.0, total - _END_AUDIO_FADE_S):.3f}:d={_END_AUDIO_FADE_S}")
        elif artifact_fade_s > 0:
            a.append(f"afade=t=out:st={max(0.0, total - artifact_fade_s):.3f}:d={artifact_fade_s:.3f}")
        args += ["-af", ",".join(a)]

    args += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-r", "30"]
    if has_audio:
        args += ["-c:a", "aac", "-b:a", "192k"]
    args.append(str(dest))

    result = subprocess.run(args, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"_preprocess_clip failed for {src} (fade_in={fade_in_s:.2f} "
            f"fade_out={fade_out_s:.2f} pre={pre_settle_s:.2f} post={post_settle_s:.2f}): "
            f"{result.stderr.decode('utf-8', errors='replace')[-500:]}"
        )
    return dest


# Video+audio overlap at a HARD cut. Chained clips start from the previous
# clip's extracted last frame, but Seedance re-synthesizes that anchor ~3%
# off in scale and ~4% off in exposure — a butt joint showed the snap in a
# single frame ("weird frame jump", Eikev 2026-07-28). Four frames of
# crossfade read as a straight cut but smear the snap below perception.
# Audio is safe to overlap at this width: hard-cut outgoing tails are
# already artifact-faded to near-silence over the SAME 0.12s window.
_MICRO_XFADE_S = 0.12


def _transition_concat(
    files: list[Path], dest: Path, cut_types: list[str], has_audio: bool,
) -> Path:
    """Assemble preprocessed clips in one filter graph: HARD boundaries
    overlap by a micro-crossfade (xfade + acrossfade); FADE boundaries are
    butt joints via the concat filter — their sequential fade-out/fade-in
    is already baked into the clips by _preprocess_clip."""
    # Runs of consecutive clips joined by HARD cuts.
    runs: list[list[int]] = [[0]]
    for i, ct in enumerate(cut_types):
        if ct == HARD:
            runs[-1].append(i + 1)
        else:
            runs.append([i + 1])

    # xfade offsets MUST come from the VIDEO stream's duration, not the
    # container's. Seedance-derived clips mux audio ~60-100ms past the
    # last video frame; an offset computed from container duration lands
    # past the first input's final frame, the transition never fires, and
    # ffmpeg passes through the second input wholesale (the first clip
    # vanishes from the output). Same audio-tail geometry that broke
    # last-frame chaining (16a3d82). The 0.005s margin keeps the whole
    # fade window strictly inside the outgoing clip's video stream.
    durs = [_probe_video_duration(f) for f in files]
    fc: list[str] = []
    for i in range(len(files)):
        fc.append(f"[{i}:v]settb=AVTB,fps=30[v{i}]")
        if has_audio:
            fc.append(
                f"[{i}:a]aformat=channel_layouts=stereo,"
                f"aresample=async=1:out_sample_rate=48000[a{i}]"
            )

    run_v: list[str] = []
    run_a: list[str] = []
    for r_idx, run in enumerate(runs):
        vlab, alab = f"v{run[0]}", f"a{run[0]}"
        acc = durs[run[0]]
        for j, idx in enumerate(run[1:], start=1):
            nv = f"rv{r_idx}_{j}"
            off = max(0.0, acc - _MICRO_XFADE_S - 0.005)
            fc.append(
                f"[{vlab}][v{idx}]xfade=transition=fade:"
                f"duration={_MICRO_XFADE_S}:offset={off:.3f}[{nv}]"
            )
            vlab = nv
            if has_audio:
                na = f"ra{r_idx}_{j}"
                fc.append(f"[{alab}][a{idx}]acrossfade=d={_MICRO_XFADE_S}[{na}]")
                alab = na
            # The chained output's video runs to off + in2's full length.
            acc = off + durs[idx]
        run_v.append(vlab)
        run_a.append(alab)

    if len(runs) == 1:
        out_v, out_a = run_v[0], run_a[0]
    else:
        if has_audio:
            ins = "".join(f"[{v}][{a}]" for v, a in zip(run_v, run_a))
            fc.append(f"{ins}concat=n={len(runs)}:v=1:a=1[vout][aout]")
            out_v, out_a = "vout", "aout"
        else:
            ins = "".join(f"[{v}]" for v in run_v)
            fc.append(f"{ins}concat=n={len(runs)}:v=1:a=0[vout]")
            out_v, out_a = "vout", ""

    args = [_FFMPEG, "-y"]
    for f in files:
        args += ["-i", str(f)]
    args += ["-filter_complex", ";".join(fc), "-map", f"[{out_v}]"]
    if has_audio:
        args += ["-map", f"[{out_a}]", "-c:a", "aac", "-b:a", "192k"]
    args += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-r", "30",
             "-movflags", "+faststart", str(dest)]
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"_transition_concat failed ({len(files)} files, "
            f"cuts={cut_types}): "
            f"{r.stderr.decode('utf-8', errors='replace')[-800:]}"
        )
    return dest


def concat_clips(
    clips: list[Path],
    dest: Path,
    cut_types: list[str] | None = None,
    crossfade_s: float = 0.35,          # retained for back-compat; ignored
    **_legacy,                          # swallow removed kwargs
) -> Path:
    """Stitch clips with per-cut transitions.

    `cut_types` — list of length len(clips)-1, each HARD or FADE, for the cut
    AFTER clip i. None ⇒ all hard (seamless). At a FADE cut the outgoing clip
    fades out and the incoming fades in (with settles so audio isn't clipped);
    everything then hard-concatenates.
    """
    if not clips:
        raise ValueError("No clips to concat")
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent
    n = len(clips)

    if cut_types is None:
        cut_types = [HARD] * (n - 1)
    else:
        cut_types = [FADE if str(t) == FADE else HARD for t in cut_types]
        cut_types = (cut_types + [HARD] * (n - 1))[: max(0, n - 1)]

    has_audio = all(_has_audio_stream(c) for c in clips)

    if n == 1:
        if has_audio:
            w, h = _probe_resolution(clips[0])
            w += w % 2
            h += h % 2
            return _preprocess_clip(
                clips[0], dest, w, h, True,
                fade_in_s=0.0, fade_out_s=0.0, pre_settle_s=0.0,
                post_settle_s=0.0, artifact_fade_s=0.0, end_audio_fade=True,
            )
        shutil.copy(clips[0], dest)
        return dest

    sizes = [_probe_resolution(c) for c in clips]
    target_w = max(w for w, _ in sizes)
    target_h = max(h for _, h in sizes)
    target_w += target_w % 2
    target_h += target_h % 2

    # Silence only needed to size settles at FADE cuts; measure once.
    any_fade = FADE in cut_types
    silences = [_measure_silence(c, has_audio) for c in clips] if any_fade else [(0.0, 0.0)] * n

    pps: list[Path] = []
    for i, src in enumerate(clips):
        is_first = i == 0
        is_last = i == n - 1
        leading_i, trailing_i = silences[i]

        do_fade_out = (not is_last) and cut_types[i] == FADE
        do_fade_in = (not is_first) and cut_types[i - 1] == FADE

        # Settle so the fade lands in silence, never on a word.
        post_settle = max(0.0, _FADE_S - trailing_i) if do_fade_out else 0.0
        pre_settle = max(0.0, _FADE_S - leading_i) if do_fade_in else 0.0
        fade_out_s = _FADE_S if do_fade_out else 0.0
        fade_in_s = _FADE_S if do_fade_in else 0.0
        # Hard-cut outgoing (non-final) clips still get the short artifact fade.
        artifact = _ARTIFACT_FADE_S if (not do_fade_out and not is_last) else 0.0

        pps.append(_preprocess_clip(
            src, work / f"_pp_{i:02d}.mp4", target_w, target_h, has_audio,
            fade_in_s=fade_in_s, fade_out_s=fade_out_s,
            pre_settle_s=pre_settle, post_settle_s=post_settle,
            artifact_fade_s=artifact, end_audio_fade=is_last,
        ))

    return _transition_concat(pps, dest, cut_types, has_audio)


def concat_final_video(
    clips: list[Path],
    dest: Path,
    cut_types: list[str] | None = None,
    *,
    outro_path: Path = BRANDED_OUTRO_PATH,
) -> Path:
    """Stitch content clips and always finish with the branded outro."""
    if not outro_path.is_file():
        raise FileNotFoundError(f"Branded outro asset missing: {outro_path}")
    timeline, final_cuts = build_final_timeline(
        clips,
        cut_types=cut_types,
        outro_path=outro_path,
    )
    return concat_clips(timeline, dest, cut_types=final_cuts)


def loudnorm_then_concat(
    inputs: list[Path],
    dest: Path,
    cut_types: list[str] | None = None,
    crossfade_s: float = 0.35,
    outro_path: Path | None = None,
    **_legacy,
) -> Path:
    """EBU R128 loudnorm each input (compose mixes clips from different runs),
    then scene-aware concat."""
    work_dir = dest.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    normalized: list[Path] = []
    for i, src in enumerate(inputs):
        norm_path = work_dir / f"_norm_{i:02d}.mp4"
        r = subprocess.run(
            [_FFMPEG, "-y", "-i", str(src),
             "-af", f"{_DETONE_FILTER},loudnorm=I=-23:LRA=7:TP=-2",
             "-c:v", "copy", str(norm_path)],
            capture_output=True,
        )
        if r.returncode != 0:
            raise RuntimeError(
                f"detone+loudnorm failed for {src}: "
                f"{r.stderr.decode('utf-8', errors='replace')[-500:]}"
            )
        normalized.append(norm_path)
    if outro_path is not None:
        return concat_final_video(
            normalized,
            dest,
            cut_types=cut_types,
            outro_path=outro_path,
        )
    return concat_clips(normalized, dest, cut_types=cut_types)


def auto_cut_type(prev_clip: dict, curr_clip: dict) -> str:
    """Decide the transition INTO curr_clip from prev_clip. FADE at a scene
    break — the incoming clip can't be frame-chained (a motion-reference clip)
    or the setting changes — otherwise a HARD cut (same scene, continuous)."""
    if curr_clip.get("motion_ref_slug") or curr_clip.get("motion_ref_url"):
        return FADE
    if prev_clip.get("setting_id") != curr_clip.get("setting_id"):
        return FADE
    return HARD


def resolve_cut_types(clip_metas: list[dict], settings: dict | None) -> list[str]:
    """Per-cut type list: auto from metadata, with operator per-cut overrides
    from settings["cuts"] = {"<leftClipIndex>": "hard"|"fade"} applied."""
    n = len(clip_metas)
    override: dict[int, str] = {}
    for k, v in ((settings or {}).get("cuts", {}) or {}).items():
        try:
            if str(v) in (HARD, FADE):
                override[int(k)] = str(v)
        except (TypeError, ValueError):
            continue
    return [
        override.get(i, auto_cut_type(clip_metas[i], clip_metas[i + 1]))
        for i in range(n - 1)
    ]
