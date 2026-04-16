"""Generate a ~45s 'A-tight' variant of every parsha's option A draft.

Leaves Yonah's original option A, B, C untouched. Appends a new script
entry with option='A-tight' so Yonah can compare side-by-side and promote
winners later.

Target: ~105 words (~45s at Rav Eli's ~2.3 wps cadence).

Uses the current Anthropic flagship (Claude Opus 4.6) via direct httpx —
the Anthropic SDK has hung on this Windows env before.

Cost: ~$0.80 total (52 parshiot × ~$0.015 each).

Idempotent: skips parshiot that already have an 'A-tight' option.

Usage:
  py tools/rewrite_scripts_tight.py [--dry-run] [--only <parsha-name>]
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
PARSHIOT_JSON = ROOT / "parshiot.json"

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-opus-4-6"

SYSTEM = """You write SHORT-FORM dvar torah scripts — 45 seconds of video —
that fuse the week's parsha (plus broader Jewish philosophy: kabbalah,
chassidus, mussar) with tai chi and Chinese internal-martial-arts
principles. The fusion is the whole point. Each tradition illuminates the
other. A truth emerges neither articulates alone.

**HARD LENGTH: 95-110 words. Over 115 is a failure. Over 130 is a disaster.**
This is short-form social video. It plays in 45 seconds. Every word is
real estate.

SHORT DOES NOT MEAN WATERED-DOWN. Pack density, don't dilute. Every
sentence earns its place by doing real work. No filler, no restatement,
no meandering. A single razor-sharp image beats five abstractions.

VOICE:
Deep, intelligent, sagely, coherent. An elder teacher who has lived in
both worlds. Measured. Contemplative. Authoritative without volume.

YOU MUST INCLUDE:
- One specific tai chi/internal-arts principle — named (song 松, jin 勁,
  peng 掤, zhan zhuang, rooting, yielding, yi 意, li vs jin, etc.). NOT
  generic "flow" / "balance" / "harmony."
- The core Torah insight of the parsha (recognizable).
- Every Hebrew term that appears in Yonah's draft, spelled exactly as he
  spells it (no phonetic hyphens — downstream handles pronunciation).
- One concrete embodied moment — the body doing something real, not
  "feel the flow."
- An opening line that grips in one sentence; a landing that completes.

FREEDOM:
You are NOT preserving Yonah's wording. Rewrite freely. His draft is the
concept seed — you deliver the finished sage teaching.

AVOID:
- Generic metaphors without a named principle behind them.
- Listing abstract qualities.
- Mystical throat-clearing.
- Teaching two ideas when one is enough.
- Any sentence that doesn't advance the teaching.

Return ONLY the rewritten script. No preamble, no word count, no quotes,
no headers. Count your words before returning. If over 110, cut."""


async def _tighten(
    http: httpx.AsyncClient, api_key: str, name: str, draft: str,
) -> str:
    user_msg = f"Parsha: {name}\n\nDraft (concept seed):\n{draft}"
    payload = {
        "model": MODEL,
        "max_tokens": 1024,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user_msg}],
    }
    r = await http.post(
        ANTHROPIC_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
    )
    r.raise_for_status()
    data = r.json()
    return data["content"][0]["text"].strip()


async def _process_one(
    http: httpx.AsyncClient, api_key: str, parsha: dict, dry: bool,
    force: bool,
) -> bool:
    opts = {s["option"]: s for s in parsha["scripts"]}
    existing = opts.get("A-tight")
    if existing and not force:
        print(f"  {parsha['name']:15s} skip (A-tight exists; --force to overwrite)")
        return False
    src = opts.get("A")
    if not src:
        print(f"  {parsha['name']:15s} skip (no option A)")
        return False

    orig_wc = len(src["draft"].split())
    tight = await _tighten(http, api_key, parsha["name"], src["draft"])
    new_wc = len(tight.split())
    print(f"  {parsha['name']:15s} {orig_wc:3d}w -> {new_wc:3d}w")

    if dry:
        print(f"    [dry-run] preview: {tight[:80]}...")
        return False

    new_entry = {
        "option": "A-tight",
        "title": src.get("title", parsha["name"]) + " (tight)",
        "style_note": src.get("style_note", ""),
        "draft": tight,
    }
    if existing:
        # Overwrite in place to preserve position in the list
        for i, s in enumerate(parsha["scripts"]):
            if s["option"] == "A-tight":
                parsha["scripts"][i] = new_entry
                break
    else:
        parsha["scripts"].append(new_entry)
    return True


async def run(dry: bool, only: str | None, force: bool) -> None:
    load_dotenv(ROOT / ".env")
    api_key = os.environ["ANTHROPIC_API_KEY"]

    data = json.loads(PARSHIOT_JSON.read_text(encoding="utf-8"))
    parshiot = data["parshiot"]
    if only:
        parshiot = [p for p in parshiot if p["name"].lower() == only.lower()]
        if not parshiot:
            raise SystemExit(f"No parsha named {only!r}")

    async with httpx.AsyncClient(timeout=120) as http:
        results = await asyncio.gather(
            *(_process_one(http, api_key, p, dry, force) for p in parshiot),
            return_exceptions=True,
        )

    failures = [r for r in results if isinstance(r, Exception)]
    if failures:
        print(f"\n{len(failures)} failures:")
        for f in failures:
            print(f"  {type(f).__name__}: {f}")

    if not dry:
        PARSHIOT_JSON.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8",
        )
        print(f"\nWrote {PARSHIOT_JSON.name}.")
    else:
        print("\n[dry-run] no file written.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Print preview, do not modify parshiot.json")
    ap.add_argument("--only", default=None,
                    help="Process a single parsha by name (case-insensitive)")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite existing A-tight entries")
    args = ap.parse_args()
    asyncio.run(run(args.dry_run, args.only, args.force))
    return 0


if __name__ == "__main__":
    sys.exit(main())
