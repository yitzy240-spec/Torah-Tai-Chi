# Tai Chi Move Reference Library — Design

**Date:** 2026-04-21
**Status:** Approved for implementation

## Goal

Build a local library of short (≤15 second), clean tai chi move demonstration clips that can be passed to Seedance 2.0 as reference videos, so Rav Eli can recreate each move in AI-generated clips. Each file is named after the move it demonstrates.

Core constraint: clips must be **clean and clear** — single move, full body, minimal text/talking overlay — so Seedance has unambiguous reference footage. Manual URL-hunting for all 41 moves is not acceptable; the script should find and pick clips automatically using AI video review.

## Non-goals

- Move-recognition beyond what Gemini 2.5 Flash can do by name + visual description match.
- Any editing UI. CLI-driven local workflow only.
- Fixing genuinely bad search universes. If no good clip exists on YouTube for a move, user intervenes.

## Output structure

```
references/
  tai_chi_moves/
    moves.yaml                  # canonical move list (committed)
    commencing_form.mp4         # one clip per move, named <slug>.mp4
    white_crane_spreads_wings.mp4
    ...
    .candidates/                # gitignored; rejected candidates kept for review
      cloud_hands/
        1.mp4
        2.mp4
        review.md               # Gemini's scoring notes for each candidate
    .downloads/                 # gitignored; raw yt-dlp working directory
```

Only `moves.yaml` is committed to git. MP4 clips are gitignored (copyrighted reference material + large). Anyone cloning the repo runs the script to rebuild the library.

## `moves.yaml` schema

```yaml
moves:
  - slug: white_crane_spreads_wings        # filename-safe, unique, required
    english: "White Crane Spreads Its Wings"
    pinyin: "Báihè Liàngchì"
    section: yang_24_form                   # yang_24_form | bonus | warmups_and_stances
    order: 3                                # position within section
    priority: high                          # high | medium | low — processing order
    visual: "Stands on right leg with left toe touching, right hand above forehead..."
    query: null                             # optional search query override
```

No URLs, no timestamps — those are discovered by the pipeline. The 41 research-phase entries (24 Yang-form + 10 bonus + 7 warmups) are seeded.

The `visual` field is critical — Gemini uses it as the identification anchor when rating candidates.

`query` is a per-move optional override. If `null`, the default query is `"<english> tai chi demonstration"`. Use the override for moves where the default returns noise (e.g. "Single Whip" alone is ambiguous → `"single whip tai chi yang style"`).

## Priority heuristic for processing order

The script processes high-priority moves first so the most valuable clips arrive early. If the AI-review budget runs long or errors accrue, you still end up with the moves most likely to appear in a Rav Eli video.

- **high**: Single Whip, White Crane, Cloud Hands, Wuji Stance, Commencing Form, Part the Wild Horse's Mane, Grasp Sparrow's Tail (L+R), Brush Knee and Push, Golden Rooster, Snake Creeps Down, Fair Lady Works the Shuttles, Closing Form.
- **medium**: the rest of the Yang 24-form, plus Horse Stance / Bow Stance / Empty Stance / Basic Weight Shift.
- **low**: Chen-style (Buddha's Warrior, Lazy About Tying Coat, Hidden Thrust), deeper Yang 108-form moves (Sweep Lotus, Shoot Tiger, Punch Down, White Snake, Step Back Ride Tiger), Silk Reeling.

## Pipeline

```
For each move in moves.yaml (priority order):
  1. SEARCH      yt-dlp ytsearch5:"<query>" --match-filter "duration < 120"
                 → 5 candidate URLs
  2. DOWNLOAD    yt-dlp each candidate (720p max, audio kept) to .candidates/<slug>/N.mp4
  3. SAMPLE      ffmpeg extracts ~15 evenly-spaced frames per candidate with timestamps
  4. REVIEW      OpenRouter → Gemini 2.5 Flash, passes frames + move name + visual description
                 Returns JSON: {matches, quality 1-10, best_start_sec, best_duration_sec, reason}
  5. RANK        Pick candidate with highest quality score ≥ 7
  6. TRIM        ffmpeg cuts chosen candidate at [best_start_sec, best_start_sec + best_duration_sec],
                 re-encodes to 720p H.264 + AAC, writes references/tai_chi_moves/<slug>.mp4
  7. CLEANUP     Delete non-chosen candidate files; keep review.md for audit trail
  8. NO MATCH    If all candidates score < 7, leave the .candidates/ folder populated with
                 review.md and NO final clip. Move logs as "needs human review".
```

## AI video review

**Model:** `google/gemini-3.1-pro-preview` via OpenRouter (`OPENROUTER_API_KEY` in `.env`) by default.

**Why Gemini 3.1 Pro:** Strongest multimodal model currently exposed on OpenRouter. "Preview" status carries some API-stability risk but this is a utility run a handful of times — not production infra — so the risk is irrelevant. Full first pass is ~$2.50 across 205 evaluations. Fallbacks via `--model <openrouter_id>`: `google/gemini-2.5-pro` (stable GA, ~$1.50), `google/gemini-2.5-flash` (cheap bulk mode, ~$0.40), or `anthropic/claude-opus-4.7` for problem-move escalation.

**Input per candidate:**
- 15 frames extracted at even intervals from the candidate video
- Each frame labeled with its timestamp in seconds
- Move metadata: English name, pinyin, visual description from yaml

**Prompt:**
> *You are evaluating a YouTube clip as a reference for the tai chi move "{english}" ({pinyin}). The move visually looks like: "{visual}". You see 15 frames sampled at these timestamps: {ts_list}. Evaluate:
> 1. Does this clip clearly demonstrate that specific move? (matches: bool)
> 2. Rate demonstration quality 1-10: full body visible (+), clean background (+), minimal text/captions (+), no talking head cutaways (+), single clean execution (+), instructor filmed flat-on not mid-class (+).
> 3. Identify the single cleanest 10-15 second window showing the move (best_start_sec, best_duration_sec). Duration must be 10-15. If the whole clip is the move, start at 0.
> 4. One-sentence reason.
> Return JSON only, no prose.*

**Response schema (enforced via JSON mode):**
```json
{
  "matches": true,
  "quality": 8,
  "best_start_sec": 3,
  "best_duration_sec": 12,
  "reason": "Clean full-body demo against white wall, single execution, no overlay text."
}
```

**Threshold:** quality ≥ 7 to promote to final library. Tunable via `--min-quality` flag.

## Download script: `tools/download_moves.py`

```
python tools/download_moves.py                         # run full pipeline on all entries
python tools/download_moves.py --slug single_whip      # single move
python tools/download_moves.py --priority high         # filter by priority tier
python tools/download_moves.py --redo single_whip      # ignore cached clip, redo pipeline
python tools/download_moves.py --candidates 10         # grab more candidates per move (default 5)
python tools/download_moves.py --min-quality 6         # lower acceptance threshold
python tools/download_moves.py --model google/gemini-2.5-pro      # stable GA fallback if 3.1 preview breaks
python tools/download_moves.py --model google/gemini-2.5-flash    # cheap bulk mode
python tools/download_moves.py --model anthropic/claude-opus-4.7  # escalate for stubborn moves
python tools/download_moves.py --query "<slug>=<custom search>" # override query for this run
```

### Behavior

1. Skip move if `references/tai_chi_moves/<slug>.mp4` already exists (unless `--redo`).
2. On candidate-download failure (404, geo-block, age-gate): log and skip that candidate; continue with remaining.
3. On whole-move failure (all candidates fail / no candidates match): log, leave `.candidates/<slug>/` intact with `review.md`, continue to next move. **Never halt the batch.**
4. Final report at end lists: N moves completed, M moves needing review, list of slugs per category.

### Dependencies

- `yt-dlp` (Python package)
- `pyyaml`
- `httpx` or `requests` (OpenRouter API calls)
- `python-dotenv` (load `.env`)
- `ffmpeg` (already at `C:\Users\yitzym\bin\ffmpeg.exe`)

On first run, the script checks for all deps and prints `pip install yt-dlp pyyaml httpx python-dotenv` if anything is missing. Exits cleanly — does not auto-install.

## Curation workflow

First run: `python tools/download_moves.py --priority high`. Wait ~10-20 minutes (12 moves × 5 candidates × ~20s per AI review). Check `references/tai_chi_moves/` — most clips should be there. Spot-check a few by watching them.

For any `.candidates/<slug>/` folders still populated (meaning no candidate hit threshold):
- Open `review.md` to see Gemini's notes on each of the 5.
- Pick the best one manually, rename to `<slug>.mp4`, move up into the library folder.
- Or: `python tools/download_moves.py --redo <slug> --candidates 10 --min-quality 6` to try harder.
- Or: edit `moves.yaml` to add a better `query` override for that move, then `--redo <slug>`.

Then run `--priority medium` and `--priority low` for the rest.

## Files changed / created

- **New:** `references/tai_chi_moves/moves.yaml` (committed; 41-entry seed, no URLs)
- **New:** `tools/download_moves.py` (committed)
- **New:** `tools/README.md` (committed; example commands + curation workflow)
- **Modified:** `.env` — add `OPENROUTER_API_KEY` (already done)
- **Modified:** `.gitignore` — add `references/tai_chi_moves/*.mp4`, `references/tai_chi_moves/.candidates/`, `references/tai_chi_moves/.downloads/`

## Risk / open questions

- **Gemini accuracy on obscure moves:** Chen-style moves like "Buddha's Warrior Pounds Mortar" are less common in Gemini's training data. Mitigation: the `visual` description in the prompt is a strong anchor; if still bad, `--model-pro` escalation.
- **yt-dlp YouTube breakage:** YouTube periodically breaks yt-dlp; pipeline may need yt-dlp upgrades over time. Acceptable — user reruns with latest yt-dlp version.
- **Cost drift:** If the candidate count is ever bumped to 10 and run across the full library, cost rises to ~$0.80. Still trivial. No guardrail needed.
