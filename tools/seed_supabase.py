"""Seed the Supabase scripts table from parshiot.json via PostgREST.

RLS must be disabled on the scripts table before running; re-enable after.

One-shot tool: reads parshiot.json, fetches parshiot rows to resolve slug->id,
inserts all 208 scripts in a single POST.
"""
from __future__ import annotations
import json
import os
import re
import sys
from pathlib import Path
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
PARSHIOT_JSON = ROOT / "parshiot.json"

SUPABASE_URL = "https://jswdfthmegjbhnwbgeca.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impzd2RmdGhtZWdqYmhud2JnZWNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDg0ODUsImV4cCI6MjA4ODUyNDQ4NX0.yPzNVSZTlWhTPHllREMITMVX3GryoHHpqu-X-BcCiMM"


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main() -> int:
    load_dotenv(ROOT / ".env")
    data = json.loads(PARSHIOT_JSON.read_text(encoding="utf-8"))

    with httpx.Client(
        base_url=f"{SUPABASE_URL}/rest/v1",
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60,
    ) as c:
        # Fetch slug->id mapping
        r = c.get("/parshiot", params={"select": "id,slug"})
        r.raise_for_status()
        slug_to_id = {row["slug"]: row["id"] for row in r.json()}
        print(f"Fetched {len(slug_to_id)} parshiot.")

        rows: list[dict] = []
        skipped = 0
        for p in data["parshiot"]:
            slug = slugify(p["name"])
            if slug not in slug_to_id:
                print(f"  skip {p['name']} ({slug}) -- not in DB")
                skipped += 1
                continue
            pid = slug_to_id[slug]
            for s in p["scripts"]:
                rows.append({
                    "parsha_id": pid,
                    "option": s["option"],
                    "title": s["title"],
                    "style_note": s.get("style_note") or "",
                    "draft_text": s["draft"],
                })

        print(f"Prepared {len(rows)} script rows ({skipped} parshiot skipped).")

        # Insert in batches of 50 to keep payloads reasonable
        inserted = 0
        for i in range(0, len(rows), 50):
            batch = rows[i:i + 50]
            r = c.post(
                "/scripts", json=batch,
                headers={"Prefer": "return=minimal"},
            )
            if r.status_code >= 400:
                print(f"  batch {i // 50 + 1} FAIL {r.status_code}: {r.text[:500]}")
                return 1
            inserted += len(batch)
            print(f"  batch {i // 50 + 1}: {inserted}/{len(rows)}")

    print(f"\nDONE. {inserted} scripts inserted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
