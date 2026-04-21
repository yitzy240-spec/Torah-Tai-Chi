# Tai Chi Move Reference Library — Design

**Date:** 2026-04-21
**Status:** Approved for implementation

## Goal

Build a local library of short (≤15 second), clean tai chi move demonstration clips that can be passed to Seedance 2.0 as reference videos, so Rav Eli can recreate each move in AI-generated clips. Each file is named after the move it demonstrates.

## Non-goals

- Automated YouTube search for ad-hoc moves (deferred — "nice to have" per user).
- Move-recognition or quality scoring. Humans eyeball clips during curation.
- Any editing UI. This is a CLI-driven local workflow.

## Output structure

```
references/
  tai_chi_moves/
    moves.yaml                  # canonical seed list (committed)
    commencing_form.mp4         # one file per move, named <slug>.mp4
    part_wild_horses_mane.mp4
    white_crane_spreads_wings.mp4
    ...
    .downloads/                 # raw yt-dlp downloads, gitignored
```

Clip files themselves are **not** committed to git (they're large + copyrighted reference material). The `moves.yaml` manifest IS committed — it's the source of truth. Anyone cloning can rebuild the library by running the script.

## `moves.yaml` schema

```yaml
moves:
  - slug: white_crane_spreads_wings        # filename-safe, unique, required
    english: "White Crane Spreads Its Wings"
    pinyin: "Báihè Liàngchì"
    section: yang_24_form                   # yang_24_form | bonus | warmups_and_stances
    order: 3                                # position within section (24-form uses canonical 1-24)
    priority: high                          # high | medium | low — curation order
    visual: "Stands on right leg with left toe touching, right hand above forehead..."
    url: https://youtube.com/watch?v=...    # optional until URL is curated
    start: 42                               # seconds; optional, defaults to 0
    duration: 14                            # seconds; optional, defaults to 15, max 15
```

The 41 entries from the research phase (24 Yang-form + 10 bonus + 7 warmups/stances) are seeded with everything EXCEPT `url` / `start` / `duration`. URLs get curated incrementally. The script skips entries without a URL (logged as "pending curation").

## Priority heuristic for URL curation

- **high**: most visually iconic, highest likelihood of Rav Eli performing them — Single Whip, White Crane, Cloud Hands, Wuji Stance, Commencing Form, Part the Wild Horse's Mane, Grasp Sparrow's Tail, Brush Knee and Push, Golden Rooster, Snake Creeps Down, Fair Lady Works the Shuttles, Closing Form.
- **medium**: the rest of the Yang 24-form, plus Horse Stance / Bow Stance / Empty Stance / Basic Weight Shift.
- **low**: Chen-style (Buddha's Warrior, Lazy About Tying Coat, Hidden Thrust) and deeper Yang 108-form moves (Sweep Lotus, Shoot Tiger, Punch Down, White Snake, Step Back Ride Tiger), plus Silk Reeling.

## Download script: `tools/download_moves.py`

One mode for now — curated download:

```
python tools/download_moves.py                    # download all entries with a URL
python tools/download_moves.py --slug single_whip # single move
python tools/download_moves.py --priority high    # filter by priority tier
python tools/download_moves.py --force            # re-download even if clip exists
```

### Behavior per entry

1. Skip if `references/tai_chi_moves/<slug>.mp4` already exists (unless `--force`).
2. Skip if entry has no `url` (log: "pending curation").
3. `yt-dlp` downloads the best video-only stream ≤720p to `.downloads/<slug>.<ext>` (keep audio — instructor counts/breathing can help Seedance).
4. `ffmpeg` trims to `[start, start+duration]`, re-encodes to 720p H.264 MP4 with AAC audio, writes to `references/tai_chi_moves/<slug>.mp4`.
5. Enforce `duration ≤ 15` (clamp with warning).
6. On failure (404, geo-block, age-gate): log and continue batch; don't halt.

### Dependencies

- `yt-dlp` (Python package)
- `pyyaml`
- `ffmpeg` (already on `C:\Users\yitzym\bin\ffmpeg.exe`)

On first run, the script checks for `yt-dlp`, `pyyaml`, and `ffmpeg`. If any are missing, it prints the exact install command (`pip install yt-dlp pyyaml`) and exits — does **not** auto-install.

## URL curation workflow

URL curation is **manual** and happens outside the script:

1. Open `references/tai_chi_moves/moves.yaml`.
2. Find a move missing a URL, starting with `priority: high`.
3. Search YouTube for the English name + "tai chi" + "demonstration" or "shorts".
4. Pick a clip with: full-body visible, single clean execution, minimal text/watermarks, no talking heads.
5. Add `url`, `start` (seconds into source), `duration` (clip length).
6. Run `python tools/download_moves.py --slug <slug>` to pull it.
7. Watch the resulting clip. If it's not clean, adjust `start` or swap URL; re-run with `--force`.

This keeps quality control tight, matching the "clean and clear reference" constraint for Seedance.

## Deferred (future work — not this spec)

- `--search "move name"` and `--add "move name"` flags (YouTube search + auto-curate). Revisit once the curated library is populated enough to see the gaps.
- Batch URL suggestion via an LLM call that searches + proposes URLs for human approval.
- A tiny web UI for Yonah to browse the library and trigger re-downloads.

## Files changed / created

- **New:** `references/tai_chi_moves/moves.yaml` (committed; 41-entry seed)
- **New:** `tools/download_moves.py` (committed)
- **New:** `tools/README.md` (committed; 3 example commands)
- **Modified:** `.gitignore` — add `references/tai_chi_moves/*.mp4` and `references/tai_chi_moves/.downloads/`
