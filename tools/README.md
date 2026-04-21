# Tai Chi Reference Library Tools

Builds a local library of short tai chi move demonstration clips under [`../references/tai_chi_moves/`](../references/tai_chi_moves/) by searching YouTube, downloading candidates, and using **Gemini 2.5 Flash** (via OpenRouter) to pick the cleanest clip per move. Output: one 10-15 second 720p H.264 MP4 per move, named `<slug>.mp4`, ready to feed Seedance as reference footage for Rav Eli move recreations.

## Setup

1. Install deps:
   ```bash
   pip install yt-dlp pyyaml httpx python-dotenv pytest
   ```
2. Confirm `ffmpeg` and `ffprobe` are on your PATH.
3. Confirm `.env` at the repo root has `OPENROUTER_API_KEY=sk-or-v1-...`.

## Commands

### Build the whole library (priority order)
```bash
python -m tools.download_moves
```
Processes all 41 moves in priority order (high → medium → low). Skips any that already have a clip.

### Build just the high-priority moves
```bash
python -m tools.download_moves --priority high
```

### Do a single move
```bash
python -m tools.download_moves --slug single_whip
```

### Redo a move you weren't happy with
```bash
python -m tools.download_moves --redo single_whip --candidates 10 --min-quality 6
```

### Override the search query for one run
```bash
python -m tools.download_moves --redo cloud_hands --query-override "cloud_hands=yun shou tai chi slow demonstration"
```

### Use a different model
```bash
python -m tools.download_moves --slug buddha_warrior_pounds_mortar --model google/gemini-2.5-pro
# Or escalate to Claude Opus:
python -m tools.download_moves --slug buddha_warrior_pounds_mortar --model anthropic/claude-opus-4.7
```

## Curation workflow

After a run, check [`../references/tai_chi_moves/`](../references/tai_chi_moves/) for the clips that landed. For any move that ended up in the "needs review" list from the end-of-run report:

1. Open `references/tai_chi_moves/.candidates/<slug>/review.md` to see Gemini's notes on each candidate.
2. Decide whether to:
   - **Lower the threshold:** `python -m tools.download_moves --redo <slug> --min-quality 6`
   - **Try more candidates:** `--redo <slug> --candidates 10`
   - **Fix the search:** edit the move's `query` in `moves.yaml` and `--redo` it
   - **Escalate to a stronger model:** `--redo <slug> --model anthropic/claude-opus-4.7`
   - **Manually pick:** if one candidate in `.candidates/<slug>/` is actually good, rename it to `<slug>.mp4` and move it up into the parent folder

## Files

- [`download_moves.py`](download_moves.py) — CLI entry
- [`move_library.py`](move_library.py) — all logic (loader, search, download, review, trim, pipeline)
- [`test_move_library.py`](test_move_library.py) — unit tests (33 tests, mocks externals)
- [`../references/tai_chi_moves/moves.yaml`](../references/tai_chi_moves/moves.yaml) — canonical move list (41 entries)
- [`../docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md`](../docs/superpowers/specs/2026-04-21-tai-chi-reference-library-design.md) — full spec
- [`../docs/superpowers/plans/2026-04-21-tai-chi-reference-library.md`](../docs/superpowers/plans/2026-04-21-tai-chi-reference-library.md) — implementation plan

## How it works (one-paragraph version)

For each move in `moves.yaml`, `yt-dlp` runs a YouTube search using the move's `query` (or a default `"<english name> tai chi demonstration"`) with a ≤2 minute duration filter. The top N candidates are downloaded to `.candidates/<slug>/`. `ffmpeg` samples 15 evenly-spaced frames per candidate. Each candidate's frames + the move metadata (English name, pinyin, one-sentence visual description) are sent to Gemini 2.5 Flash via OpenRouter, which returns `{matches, quality 1-10, best_start_sec, best_duration_sec, reason}`. The highest-quality candidate above the `--min-quality` threshold is trimmed and re-encoded by ffmpeg at the Gemini-recommended timestamp into a 720p H.264 MP4 saved as `<slug>.mp4`. Losing candidates are cleaned up. If no candidate scores high enough, `.candidates/<slug>/review.md` is left for human inspection.
