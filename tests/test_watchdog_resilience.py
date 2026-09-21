"""The watchdog must never page the owner for a transient blip.

2026-09-14: Modal emailed "[Digest] Scheduled function failure ...
reap_stranded_jobs ... Timed out after 120 seconds". Cause: postgrest-py's
DEFAULT client timeout is 120s — identical to this function's Modal
timeout — so a stalled Supabase call waited the full 120s while Modal
killed the container at the same moment.

Two guarantees locked in here:
  1. The DB timeout stays well under the Modal function timeout, so a
     stall raises a catchable error instead of being killed mid-flight.
  2. A failed tick returns cleanly (no raise) — the next tick 10 minutes
     later does identical, idempotent work, so alerting on one blip is
     pure noise. Persistent failure is still visible via the
     pipeline.watchdog_error event it logs.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "modal_app.py").read_text(encoding="utf-8")


def test_db_timeout_is_well_under_the_modal_timeout():
    db = int(re.search(r"^_WATCHDOG_DB_TIMEOUT_S\s*=\s*(\d+)", SRC, re.M).group(1))
    # The decorator immediately above reap_stranded_jobs
    fn = SRC.index("def reap_stranded_jobs")
    decorator = SRC[SRC.rindex("@app.function(", 0, fn):fn]
    modal_timeout = int(re.search(r"timeout\s*=\s*(\d+)", decorator).group(1))
    assert db < modal_timeout / 2, (
        f"watchdog DB timeout {db}s must be well under the Modal timeout "
        f"{modal_timeout}s, or a stall gets killed instead of raising"
    )


def test_watchdog_creates_its_client_with_an_explicit_timeout():
    fn = SRC.index("def reap_stranded_jobs")
    body = SRC[fn:fn + 4000]
    assert "postgrest_client_timeout=_WATCHDOG_DB_TIMEOUT_S" in body, (
        "watchdog must not use postgrest's 120s default timeout"
    )


def test_watchdog_swallows_failures_instead_of_raising():
    fn = SRC.index("def reap_stranded_jobs")
    nxt = SRC.index("@app.function(", fn)
    body = SRC[fn:nxt]
    assert "except Exception as e:" in body
    assert "pipeline.watchdog_error" in body, "a failed tick must leave a trail"
    # the except block must return, never re-raise
    tail = body[body.index("except Exception as e:"):]
    assert "return {" in tail
    assert not re.search(r"^\s+raise\s*$", tail, re.M), (
        "a transient janitor failure must not fail the Modal function"
    )


def test_reaping_is_still_the_function_of_record():
    pytest.importorskip("modal")
    from modal_app import reap_stranded_jobs  # noqa: F401
