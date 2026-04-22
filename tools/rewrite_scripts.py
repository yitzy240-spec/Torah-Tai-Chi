"""Rewrite every script in the DB into a tight 45s-video draft via Claude Sonnet 4.6.

Target: 90-110 words per rewrite. Preserves the teaching's concept,
citations, and Yonah's voice; free to pick a different angle if it fits
better; errs shorter when unclear.

Usage:
    # Dry run — print before/after word counts + previews, no DB writes:
    python -m tools.rewrite_scripts

    # Apply — write the rewrites back via service-role client:
    python -m tools.rewrite_scripts --apply

    # Scope to one parsha:
    python -m tools.rewrite_scripts --parsha acharei-mot

Claude goes through Kie.ai (`/claude/v1/messages`). Requires KIE_AI_API_KEY.
Writes go through the Supabase service role (bypasses RLS on scripts).
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

KIE_CLAUDE_URL = "https://api.kie.ai/claude/v1/messages"
MODEL = "claude-sonnet-4-6"

REWRITE_SYSTEM = """You are editing Yonah's dvar torah drafts into tight short-form video
scripts for his weekly Torah Tai Chi channel. Each rewrite is 90-110 words
— a 40-55 second spoken teaching at a sage-teacher pace.

PRESERVE:
- The teaching's core concept (the point it wants to land).
- Torah citations if present (Baal HaTurim, specific parshas, specific
  psukim, tractates, rabbis named).
- Yonah's voice: sage, calm, patient teacher. Not copywriter, not clever,
  not preachy.

HEBREW VOCABULARY — AVOID UNLESS THE TEACHING REQUIRES IT:
The downstream pipeline runs the script through a TTS that mispronounces
Hebrew names (Eden becomes 'Aden', etc.). Default to English equivalents:
  Eden / Gan Eden -> "Eden" or "the Garden" (NO phonetic)
  Bereishit -> "Genesis"
  Vayikra -> "Leviticus"
  Shemot -> "Exodus"
  Bamidbar -> "Numbers"
  Devarim -> "Deuteronomy"
  Moshe -> "Moses"
  Aharon -> "Aaron"
  Yosef -> "Joseph"
  Yaakov -> "Jacob"
  Yitzchak -> "Isaac"
  Avraham -> "Abraham"
  Adam, Israel, etc. — already English, leave as-is
ONLY keep Hebrew when the teaching is specifically ABOUT a Hebrew word's
meaning (e.g., a teaching on the letters of "vayikra"). Otherwise use the
English form.

FREEDOM:
- You MAY pick a different angle on the parsha's theme if it fits 90-110
  words better than the existing angle.
- You MAY drop secondary examples, ornamental sentences, rhetorical
  flourishes, repeated callbacks.
- You MAY change sentence structure, word choice, order.
- Prefer shorter. When unclear whether to keep a sentence, cut it.

STRUCTURE (optional but helpful): most scripts work well as
[HOOK] 1-2 sentence opener
[TEACHING] 2-4 sentences of the core teaching
[APPLICATION] 1-2 sentences bringing it to the body / practice / breath
[CTA] one short line (optional)

OUTPUT: the rewritten draft only. No preamble. No markdown. No headers."""


USER_TEMPLATE = """PARSHA: {parsha_name} ({book})
SCRIPT OPTION: {option}

EXISTING DRAFT:
---
{draft_text}
---

Rewrite as a 90-110 word tight video script now."""


def word_count(text: str | None) -> int:
    if not text:
        return 0
    return len([w for w in text.strip().split() if w])


async def rewrite_one(
    http: httpx.AsyncClient,
    api_key: str,
    parsha_name: str,
    book: str,
    option: str,
    draft_text: str,
    max_retries: int = 3,
) -> str:
    """Call Claude Sonnet 4.6 via Kie. Returns the rewritten draft text.

    Retries on transient errors (ConnectError, 5xx, 429) with exponential
    backoff — 208 sequential calls see a handful of transient failures.
    """
    user = USER_TEMPLATE.format(
        parsha_name=parsha_name, book=book, option=option,
        draft_text=draft_text.strip(),
    )
    body = {
        "model": MODEL,
        "max_tokens": 1000,
        "system": REWRITE_SYSTEM,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            r = await http.post(KIE_CLAUDE_URL, headers=headers, json=body)
            if r.status_code >= 500 or r.status_code == 429:
                raise httpx.HTTPStatusError(
                    f"Kie {r.status_code}: {r.text[:200]}",
                    request=r.request, response=r,
                )
            r.raise_for_status()
            data = r.json()
            out = data["content"][0]["text"].strip()
            if out.startswith("```"):
                out = out.split("```")[1]
                if out.startswith("text"):
                    out = out[4:]
                out = out.strip("` \n")
            return out
        except (httpx.ConnectError, httpx.ReadError, httpx.ReadTimeout,
                httpx.RemoteProtocolError, httpx.HTTPStatusError) as e:
            last_exc = e
            if attempt == max_retries - 1:
                break
            backoff = 2 ** attempt  # 1s, 2s, 4s
            await asyncio.sleep(backoff)
    assert last_exc is not None
    raise last_exc


async def main(args: argparse.Namespace) -> int:
    # Supabase imported lazily so --help doesn't require the dep.
    from supabase import create_client

    api_key = os.environ["KIE_AI_API_KEY"]
    sb_url = os.environ["SUPABASE_URL"]
    sb_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(sb_url, sb_key)

    # Pull all scripts + their parsha (name + book).
    q = (
        sb.table("scripts")
        .select("id, option, draft_text, parsha_id, parshiot(name, book, slug)")
    )
    rows = q.execute().data or []

    # Optional filter: --parsha <slug>
    if args.parsha:
        filtered = []
        for r in rows:
            parsha = r.get("parshiot") or {}
            if isinstance(parsha, list):
                parsha = parsha[0] if parsha else {}
            if parsha.get("slug") == args.parsha:
                filtered.append(r)
        rows = filtered

    if not rows:
        print("No scripts found (after filter)." if args.parsha else "No scripts in DB.", file=sys.stderr)
        return 1

    print(f"{'Applying' if args.apply else 'DRY RUN'} — rewriting {len(rows)} script(s)")
    print("=" * 74)

    total_before = 0
    total_after = 0
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=120.0) as http:
        for r in rows:
            parsha: dict[str, Any] | list | None = r.get("parshiot")
            if isinstance(parsha, list):
                parsha = parsha[0] if parsha else None
            if not parsha:
                errors.append(f"{r['id'][:8]}: no parsha joined; skipping")
                continue
            parsha_name = parsha.get("name") or "Unknown"
            book = parsha.get("book") or "Unknown"
            slug = parsha.get("slug") or "?"
            option = r.get("option") or "?"
            draft = (r.get("draft_text") or "").strip()
            if not draft:
                print(f"  {slug:18s} {option:12s} — empty draft, skipping")
                continue

            wc_before = word_count(draft)
            total_before += wc_before

            try:
                new_draft = await rewrite_one(http, api_key, parsha_name, book, option, draft)
            except Exception as e:
                errors.append(f"{slug} {option}: {type(e).__name__}: {e}")
                print(f"  {slug:18s} {option:12s} — ERROR: {type(e).__name__}")
                continue

            wc_after = word_count(new_draft)
            total_after += wc_after
            delta = wc_after - wc_before
            sign = "+" if delta >= 0 else ""
            print(f"  {slug:18s} {option:12s}  {wc_before:>3}w -> {wc_after:>3}w  ({sign}{delta})")

            if args.apply:
                up = sb.table("scripts").update({"draft_text": new_draft}).eq("id", r["id"]).execute()
                if not up.data:
                    errors.append(f"{slug} {option}: update returned no data")

    print("=" * 74)
    # Ascii-only so Windows default cp1252 doesn't choke.
    print(f"Totals: {total_before}w -> {total_after}w  "
          f"(delta {total_after - total_before:+d})")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  • {e}")
    if not args.apply:
        print("\nThis was a DRY RUN. Re-run with --apply to write these rewrites to the DB.")
    return 0 if not errors else 2


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="rewrite_scripts",
        description="Rewrite every script in the DB into a tight 45s video draft.",
    )
    p.add_argument("--apply", action="store_true",
                   help="Actually write the rewrites to the DB. Without this flag, prints a preview.")
    p.add_argument("--parsha", type=str, default=None,
                   help="Optional parsha slug to scope the rewrite to a single parsha.")
    return p.parse_args(argv)


if __name__ == "__main__":
    sys.exit(asyncio.run(main(parse_args(sys.argv[1:]))))
