"""Tai chi reference library — yt-dlp search, ffmpeg extraction, Gemini review.

Entry point: tools/download_moves.py.
Spec: docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md
"""
import importlib.util
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml


@dataclass(frozen=True)
class Move:
    slug: str
    english: str
    pinyin: str
    section: str         # yang_24_form | bonus | warmups_and_stances
    order: int
    priority: str        # high | medium | low
    visual: str
    query: Optional[str] = None

    @property
    def effective_query(self) -> str:
        if self.query:
            return self.query
        return f"{self.english} tai chi demonstration"


def load_moves(yaml_path: Path) -> list[Move]:
    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    raw_moves = data.get("moves", [])
    return [Move(**raw) for raw in raw_moves]


import argparse


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="download_moves",
        description="Auto-curate a library of tai chi move reference clips from YouTube.",
    )
    p.add_argument("--slug", help="Process only the move with this slug.")
    p.add_argument("--priority", choices=["high", "medium", "low"], help="Only process moves at this priority tier.")
    p.add_argument("--redo", help="Re-run the pipeline for this slug even if the clip already exists.")
    p.add_argument("--candidates", type=int, default=5, help="How many search candidates per move (default 5).")
    p.add_argument("--min-quality", type=int, default=7, help="Minimum Gemini quality score to accept (1-10, default 7).")
    p.add_argument("--model", default="google/gemini-3.1-pro-preview", help="OpenRouter model ID for video review.")
    p.add_argument("--query-override", help="Per-slug query override in format 'slug=search query'.")
    return p.parse_args(argv)


class MissingDependencyError(RuntimeError):
    pass


REQUIRED_PYTHON_PKGS = ["yt_dlp", "yaml", "httpx", "dotenv"]
REQUIRED_BINARIES = ["ffmpeg", "ffprobe"]


def check_dependencies() -> None:
    missing_bins = [b for b in REQUIRED_BINARIES if shutil.which(b) is None]
    missing_pkgs = [p for p in REQUIRED_PYTHON_PKGS if importlib.util.find_spec(p) is None]
    if missing_bins or missing_pkgs:
        msg_parts = []
        if missing_bins:
            msg_parts.append(f"Missing binaries on PATH: {', '.join(missing_bins)}")
        if missing_pkgs:
            pip_names = {"yt_dlp": "yt-dlp", "yaml": "pyyaml", "dotenv": "python-dotenv"}
            pip_list = " ".join(pip_names.get(p, p) for p in missing_pkgs)
            msg_parts.append(f"Missing Python packages. Install with: pip install {pip_list}")
        raise MissingDependencyError("\n".join(msg_parts))


@dataclass
class PipelineResult:
    move: Move
    status: str  # "completed" | "needs_review" | "skipped"
    chosen_quality: Optional[int] = None
    final_clip_path: Optional[Path] = None
    notes: str = ""


def main(args: argparse.Namespace) -> int:
    try:
        check_dependencies()
    except MissingDependencyError as e:
        print(str(e), file=sys.stderr)
        return 1

    yaml_path = Path("references/tai_chi_moves/moves.yaml")
    library_root = Path("references/tai_chi_moves")
    moves = load_moves(yaml_path)

    # Apply filters
    if args.slug:
        moves = [m for m in moves if m.slug == args.slug]
    if args.redo:
        moves = [m for m in moves if m.slug == args.redo]
    if args.priority:
        moves = [m for m in moves if m.priority == args.priority]

    # Apply query override
    if args.query_override:
        slug, _, override = args.query_override.partition("=")
        moves = [Move(**{**m.__dict__, "query": override}) if m.slug == slug else m for m in moves]

    # Sort by priority (high first) then section order
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    moves.sort(key=lambda m: (priority_rank[m.priority], m.section, m.order))

    # Skip existing unless --redo
    if not args.redo:
        moves = [m for m in moves if not (library_root / f"{m.slug}.mp4").exists()]

    if not moves:
        print("Nothing to do — all requested moves already have clips.")
        return 0

    results: list[PipelineResult] = []
    for i, m in enumerate(moves, start=1):
        print(f"[{i}/{len(moves)}] {m.slug} ({m.priority}) — searching…")
        try:
            r = process_move(m, library_root=library_root,
                             candidates=args.candidates,
                             min_quality=args.min_quality,
                             model=args.model)
        except Exception as e:
            r = PipelineResult(m, status="needs_review", notes=f"pipeline error: {e}")
        print(f"    → {r.status}" + (f" (quality {r.chosen_quality})" if r.chosen_quality else ""))
        results.append(r)

    print_report(results)
    return 0


def print_report(results: list[PipelineResult]) -> None:
    done = [r for r in results if r.status == "completed"]
    needs = [r for r in results if r.status == "needs_review"]
    print(f"\n=== Report ===")
    print(f"Completed: {len(done)}")
    print(f"Needs review: {len(needs)}")
    if needs:
        print("\nMoves needing manual review:")
        for r in needs:
            print(f"  - {r.move.slug}: {r.notes}")
        print("\nOpen each folder in references/tai_chi_moves/.candidates/<slug>/review.md "
              "to inspect Gemini's notes on each candidate.")


import yt_dlp


def search_youtube(query: str, n: int = 5, max_duration_sec: int = 120) -> list[str]:
    """Return up to `n` YouTube URLs matching the query. Filters by duration."""
    def duration_filter(info_dict):
        duration = info_dict.get("duration")
        if duration is not None and duration > max_duration_sec:
            return f"Too long: {duration}s > {max_duration_sec}s"
        return None

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "match_filter": duration_filter,
        "skip_download": True,
    }
    search_query = f"ytsearch{n}:{query}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(search_query, download=False)
    entries = result.get("entries", []) if result else []
    return [
        e.get("webpage_url") or e.get("url")
        for e in entries
        if e and (e.get("webpage_url") or e.get("url"))
    ]


def download_candidate(url: str, out_path: Path) -> Path:
    """Download a single YouTube URL to out_path (mp4). Returns the actual written path."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "outtmpl": str(out_path.with_suffix(".%(ext)s")),
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    # yt-dlp may produce .mp4 or .webm — find it
    candidates = list(out_path.parent.glob(f"{out_path.stem}.*"))
    if not candidates:
        raise RuntimeError(f"yt-dlp produced no output for {url}")
    return candidates[0]


import subprocess
import json


@dataclass
class FrameSample:
    timestamp_sec: float
    image_path: Path


def get_video_duration(video_path: Path) -> float:
    """Get duration in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(video_path)],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def extract_frames(video_path: Path, n: int, out_dir: Path) -> list[FrameSample]:
    """Extract n evenly-spaced frames from the video. Returns FrameSample list."""
    out_dir.mkdir(parents=True, exist_ok=True)
    duration = get_video_duration(video_path)
    # Spacing: sample at (i + 0.5) * duration / n for i in 0..n-1 — stays interior
    timestamps = [(i + 0.5) * duration / n for i in range(n)]
    samples: list[FrameSample] = []
    for i, ts in enumerate(timestamps):
        img_path = out_dir / f"frame_{i:02d}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{ts:.3f}", "-i", str(video_path),
             "-vframes", "1", "-q:v", "4", "-vf", "scale=512:-2",
             str(img_path)],
            capture_output=True, check=True,
        )
        samples.append(FrameSample(timestamp_sec=ts, image_path=img_path))
    return samples


import base64
import os
import re
import httpx
from dotenv import load_dotenv

load_dotenv()  # loads .env once on import


@dataclass
class CandidateReview:
    matches: bool
    quality: int
    best_start_sec: int
    best_duration_sec: int
    reason: str


REVIEW_PROMPT_TEMPLATE = """You are evaluating a YouTube clip as a reference for the tai chi move "{english}" ({pinyin}).

Visually the move looks like: "{visual}"

You are shown {n_frames} frames sampled at these timestamps (seconds): {ts_list}.

Evaluate:
1. Does this clip clearly demonstrate that specific tai chi move? Answer with `matches` (bool).
2. Rate demonstration quality 1-10 (`quality`). Factors that raise the score: full body visible, clean background, minimal text/captions, no talking-head cutaways, single clean execution, instructor filmed flat-on not mid-class.
3. Identify the single cleanest 10-15 second window showing the move. Return `best_start_sec` (int) and `best_duration_sec` (int, 10-15). If the whole clip is the move, start at 0.
4. One-sentence `reason` summarizing your call.

Return JSON only, no surrounding prose. Shape:
{{"matches": bool, "quality": int, "best_start_sec": int, "best_duration_sec": int, "reason": str}}
"""


def build_review_prompt(move: Move, timestamps: list[float]) -> str:
    return REVIEW_PROMPT_TEMPLATE.format(
        english=move.english,
        pinyin=move.pinyin,
        visual=move.visual,
        n_frames=len(timestamps),
        ts_list=", ".join(f"{t:.1f}" for t in timestamps),
    )


def parse_review_response(raw: str) -> CandidateReview:
    """Extract JSON from the model response and parse into a CandidateReview."""
    # Try to find a JSON object first
    m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", raw, re.DOTALL)
    if m:
        data = json.loads(m.group(0))
    else:
        # Fall back: try parsing the whole response or a JSON array containing an object
        stripped = raw.strip()
        try:
            parsed = json.loads(stripped)
            # If it's a list, take the first element
            if isinstance(parsed, list) and parsed:
                data = parsed[0]
            else:
                data = parsed
        except json.JSONDecodeError:
            raise ValueError(f"No JSON object found in response: {raw[:200]}")
    duration = min(int(data["best_duration_sec"]), 15)
    duration = max(duration, 10)
    return CandidateReview(
        matches=bool(data["matches"]),
        quality=int(data["quality"]),
        best_start_sec=int(data["best_start_sec"]),
        best_duration_sec=duration,
        reason=str(data.get("reason", "")),
    )


def review_candidate(move: Move, frames: list[FrameSample], model: str) -> CandidateReview:
    """Call OpenRouter/Gemini with move metadata + frames, return parsed review."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY missing — add it to .env")

    prompt = build_review_prompt(move, [f.timestamp_sec for f in frames])
    content = [{"type": "text", "text": prompt}]
    for f in frames:
        img_b64 = base64.b64encode(f.image_path.read_bytes()).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
        })

    resp = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/anthropics/torah-tai-chi",
            "X-Title": "Torah Tai Chi reference library",
        },
        json={
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"},
            "max_tokens": 400,
        },
        timeout=120,
    )
    resp.raise_for_status()
    content_str = resp.json()["choices"][0]["message"]["content"]
    return parse_review_response(content_str)


def trim_and_encode(src: Path, dst: Path, start_sec: int, duration_sec: int) -> Path:
    """Trim [start, start+duration] from src, re-encode to 720p H.264 + AAC, write to dst."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start_sec), "-i", str(src),
         "-t", str(duration_sec),
         "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
         "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart",
         str(dst)],
        capture_output=True, check=True,
    )
    return dst


def process_move(
    move: Move,
    library_root: Path,
    candidates: int,
    min_quality: int,
    model: str,
) -> PipelineResult:
    final_clip = library_root / f"{move.slug}.mp4"
    candidates_dir = library_root / ".candidates" / move.slug
    candidates_dir.mkdir(parents=True, exist_ok=True)

    urls = search_youtube(move.effective_query, n=candidates)
    if not urls:
        return PipelineResult(move, status="needs_review",
                              notes="No search results.")

    reviews: list[tuple[int, Optional[Path], CandidateReview]] = []
    for i, url in enumerate(urls, start=1):
        cand_path = candidates_dir / f"{i}.mp4"
        try:
            downloaded = download_candidate(url, cand_path)
        except Exception as e:
            reviews.append((i, None, CandidateReview(
                matches=False, quality=0, best_start_sec=0,
                best_duration_sec=10, reason=f"download failed: {e}")))
            continue

        frames_dir = candidates_dir / f"_frames_{i}"
        frames = extract_frames(downloaded, n=15, out_dir=frames_dir)
        try:
            review = review_candidate(move, frames, model=model)
        except Exception as e:
            review = CandidateReview(matches=False, quality=0, best_start_sec=0,
                                     best_duration_sec=10, reason=f"review failed: {e}")
        reviews.append((i, downloaded, review))

    # Write audit trail
    review_md_lines = [f"# Review log for {move.english} (`{move.slug}`)\n",
                       f"Query: `{move.effective_query}`\n"]
    for i, path, r in reviews:
        review_md_lines.append(
            f"## Candidate {i}\n"
            f"- path: `{path}`\n"
            f"- matches: {r.matches}\n"
            f"- quality: {r.quality}\n"
            f"- best_window: [{r.best_start_sec}, +{r.best_duration_sec}s]\n"
            f"- reason: {r.reason}\n"
        )

    acceptable = [(i, p, r) for (i, p, r) in reviews
                  if p is not None and r.matches and r.quality >= min_quality]
    if not acceptable:
        (candidates_dir / "review.md").write_text("\n".join(review_md_lines), encoding="utf-8")
        return PipelineResult(move, status="needs_review",
                              notes=f"No candidate scored >= {min_quality}.")

    acceptable.sort(key=lambda t: -t[2].quality)
    winner_i, winner_path, winner_review = acceptable[0]
    trim_and_encode(winner_path, final_clip,
                    start_sec=winner_review.best_start_sec,
                    duration_sec=winner_review.best_duration_sec)

    # Cleanup all candidate artifacts on success
    for i, path, _ in reviews:
        if path and path.exists():
            path.unlink()
        frames_dir = candidates_dir / f"_frames_{i}"
        if frames_dir.exists():
            for f in frames_dir.iterdir():
                f.unlink()
            frames_dir.rmdir()
    try:
        candidates_dir.rmdir()
    except OSError:
        pass

    return PipelineResult(move, status="completed",
                          chosen_quality=winner_review.quality,
                          final_clip_path=final_clip,
                          notes=f"Candidate {winner_i}: {winner_review.reason}")
