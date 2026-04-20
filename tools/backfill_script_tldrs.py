"""Backfill title + tldr for every row in the scripts table.

For each row in `scripts`, ask Claude Haiku for:
  - a short title (3-6 words, no trailing punctuation)
  - a tldr — one sentence, ~12-18 words, describing the concept/angle

Updates the row in place. Idempotent: rows whose `tldr` is already
populated are skipped unless --force is passed.

Cost: ~$0.02 total for the 208 parsha scripts at Haiku pricing.

Usage:
  py tools/backfill_script_tldrs.py [--dry-run] [--force] [--only <parsha-slug>]
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

SUPABASE_URL = "https://jswdfthmegjbhnwbgeca.supabase.co"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5"  # fast + cheap; upgrade to sonnet if quality is off

SYSTEM = """You summarize short dvar torah / tai-chi fusion scripts for a
dashboard card. Each script is a ~100-word teaching by "Rav Eli" — a
Jewish teacher who weaves the weekly parsha with tai chi / internal-arts
principles.

Given a script, return ONLY a single line of valid JSON with two keys:
  {"title": "<3-6 word title, no trailing punctuation>",
   "tldr":  "<one sentence, 12-18 words, concrete and specific about the
             idea or angle this variant takes>"}

The title should be evocative, not generic — it's how Yonah will tell
this variant apart from other variants of the same parsha on a card.
The tldr should name the concrete angle (e.g. "Ties shemittah's land-rest
to zhan zhuang: stillness as the root that feeds motion.").

Avoid: generic phrases like "A teaching about...", "Explores the idea
of...", "Connects Torah and tai chi..." — be specific to THIS script.

Return raw JSON only. No code fences, no prose."""


async def _summarize(
    http: httpx.AsyncClient,
    api_key: str,
    parsha_name: str,
    option: str,
    draft_text: str,
) -> tuple[str, str]:
    user_msg = (
        f"Parsha: {parsha_name}\n"
        f"Script option: {option}\n\n"
        f"Script:\n{draft_text}"
    )
    payload = {
        "model": MODEL,
        "max_tokens": 256,
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
    raw = data["content"][0]["text"].strip()

    # Be forgiving of accidental code fences.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].lstrip()
    parsed = json.loads(raw)
    title = str(parsed["title"]).strip().rstrip(".")
    tldr = str(parsed["tldr"]).strip()
    return title, tldr


async def _process_one(
    http: httpx.AsyncClient,
    api_key: str,
    row: dict,
    parsha_name: str,
    supabase_headers: dict,
    dry: bool,
    force: bool,
) -> bool:
    if row.get("tldr") and not force:
        return False
    draft = row.get("draft_text") or ""
    if not draft.strip():
        print(f"  {parsha_name:15s} [{row['option']:10s}] skip (empty draft)")
        return False

    title, tldr = await _summarize(
        http, api_key, parsha_name, row["option"], draft,
    )
    print(f"  {parsha_name:15s} [{row['option']:10s}] -> {title}")
    print(f"    {tldr}")

    if dry:
        return False

    patch_url = (
        f"{SUPABASE_URL}/rest/v1/scripts?id=eq.{row['id']}"
    )
    r = await http.patch(
        patch_url,
        headers={**supabase_headers, "Prefer": "return=minimal"},
        json={"title": title, "tldr": tldr},
    )
    r.raise_for_status()
    return True


async def run(dry: bool, force: bool, only: str | None) -> None:
    load_dotenv(ROOT / ".env")
    anthropic_key = os.environ["ANTHROPIC_API_KEY"]
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not service_key:
        raise SystemExit(
            "SUPABASE_SERVICE_ROLE_KEY missing from .env — this tool needs "
            "service-role to bypass RLS for the UPDATE."
        )
    supabase_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120) as http:
        # Fetch parshiot map
        r = await http.get(
            f"{SUPABASE_URL}/rest/v1/parshiot",
            headers=supabase_headers,
            params={"select": "id,slug,name"},
        )
        r.raise_for_status()
        parshiot = {p["id"]: p for p in r.json()}

        # Fetch scripts
        params = {"select": "id,parsha_id,option,title,tldr,draft_text"}
        if only:
            target = next(
                (p for p in parshiot.values() if p["slug"] == only),
                None,
            )
            if not target:
                raise SystemExit(f"No parsha with slug {only!r}")
            params["parsha_id"] = f"eq.{target['id']}"
        r = await http.get(
            f"{SUPABASE_URL}/rest/v1/scripts",
            headers=supabase_headers,
            params=params,
        )
        r.raise_for_status()
        rows = r.json()
        print(f"Fetched {len(rows)} scripts.")

        # Process concurrently (small limit to be polite).
        sem = asyncio.Semaphore(6)

        async def guarded(row: dict) -> bool:
            async with sem:
                parsha = parshiot.get(row["parsha_id"])
                name = parsha["name"] if parsha else "(unknown)"
                try:
                    return await _process_one(
                        http, anthropic_key, row, name,
                        supabase_headers, dry, force,
                    )
                except Exception as e:  # noqa: BLE001
                    print(f"  !! {name:15s} [{row['option']}] FAIL: {e}")
                    return False

        results = await asyncio.gather(*(guarded(r) for r in rows))
        updated = sum(1 for r in results if r)
        print(
            f"\n{'[dry-run] ' if dry else ''}"
            f"{updated}/{len(rows)} scripts updated."
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="Print Claude output, do not update DB.")
    ap.add_argument("--force", action="store_true",
                    help="Re-summarize even rows that already have a tldr.")
    ap.add_argument("--only", default=None,
                    help="Process a single parsha by slug.")
    args = ap.parse_args()
    asyncio.run(run(args.dry_run, args.force, args.only))
    return 0


if __name__ == "__main__":
    sys.exit(main())
