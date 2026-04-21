"""Tai chi reference library — yt-dlp search, ffmpeg extraction, Gemini review.

Entry point: tools/download_moves.py.
Spec: docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md
"""
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


def main(args: argparse.Namespace) -> int:
    """Entry point. Returns exit code. Fully wired in Task 11."""
    print(f"Parsed args: {args}")
    return 0
