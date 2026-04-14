"""One-shot importer: Torah_Tai_Chi_Parsha_Scripts.xlsx -> parshiot.json.

The xlsx has columns:
  A: Order   B: Parsha   C: Book
  D: Option A - Style Note   E: Option A - Title   F: Option A - Script
  G: Option B - Style Note   H: Option B - Title   I: Option B - Script
  J: Option C - Style Note   K: Option C - Title   L: Option C - Script
"""
from __future__ import annotations

import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).parent.parent
XLSX = ROOT / "Torah_Tai_Chi_Parsha_Scripts (1) (1).xlsx"
OUT = ROOT / "parshiot.json"
SHEET_NAME = "Parsha Scripts"


def main() -> None:
    if not XLSX.exists():
        raise SystemExit(f"xlsx not found: {XLSX}")
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb[SHEET_NAME]

    parshiot: list[dict] = []
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if len(row) < 3:
            continue
        order = row[0]
        name = row[1]
        book = row[2]
        if not name or not book:
            continue
        entry = {
            "order": int(order) if order is not None else row_idx - 1,
            "name": str(name).strip(),
            "book": str(book).strip(),
            "scripts": [],
        }
        # Three options: cols D-F (3,4,5), G-I (6,7,8), J-L (9,10,11)
        for letter, base in [("A", 3), ("B", 6), ("C", 9)]:
            style_note = row[base] if len(row) > base else None
            title = row[base + 1] if len(row) > base + 1 else None
            draft = row[base + 2] if len(row) > base + 2 else None
            if not (title and draft):
                continue
            entry["scripts"].append({
                "option": letter,
                "style_note": str(style_note).strip() if style_note else "",
                "title": str(title).strip(),
                "draft": str(draft).strip(),
            })
        if entry["scripts"]:
            parshiot.append(entry)

    OUT.write_text(
        json.dumps({"parshiot": parshiot}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {OUT} with {len(parshiot)} parshiot "
          f"({sum(len(p['scripts']) for p in parshiot)} scripts total)")


if __name__ == "__main__":
    main()
