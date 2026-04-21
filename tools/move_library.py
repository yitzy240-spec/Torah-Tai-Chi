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


def main(args: argparse.Namespace) -> int:
    try:
        check_dependencies()
    except MissingDependencyError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(f"Parsed args: {args}")
    return 0


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
