"""Guards for supabase-py's maybe_single() landmine.

maybe_single().execute() returns None (not a response) when zero rows
match, so chaining .execute().data raises AttributeError. On 2026-08-23
(Ki Tavo) this crashed clips_only_job AFTER Kie billed for the render:
Yonah added a 5th clip to the plan, the stitch-prep loop queried the
plan-owner row of an index that had none, and two paid clip renders
($5.74) were discarded by the crash — twice, 15 minutes each, with the
UI resetting as if nothing happened.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

UNGUARDED = re.compile(
    r"\.maybe_single\(\)\s*\n?\s*\.execute\(\)\s*\n?\s*\.data"
)


def test_no_unguarded_maybe_single_chains():
    for name in ("modal_app.py",):
        text = (ROOT / name).read_text(encoding="utf-8")
        hits = [
            text[: m.start()].count("\n") + 1
            for m in UNGUARDED.finditer(text)
        ]
        assert not hits, (
            f"{name}: unguarded .maybe_single().execute().data at lines "
            f"{hits} — route through _maybe_row() (crashes on zero rows)"
        )


def test_maybe_row_none_response():
    pytest.importorskip("modal")
    from modal_app import _maybe_row

    class NoneQuery:
        def execute(self):
            return None  # supabase-py's zero-rows behavior

    class RowQuery:
        def execute(self):
            class R:
                data = {"storage_path": "x.mp4"}
            return R()

    assert _maybe_row(NoneQuery()) is None
    assert _maybe_row(RowQuery()) == {"storage_path": "x.mp4"}
