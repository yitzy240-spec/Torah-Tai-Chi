"""Finished jobs (done / failed / cancelled) are never moved again.

Before this guard, every Modal worker's set_status was an unconditional
UPDATE: the operator pressed Cancel, the worker's next stage write turned
'cancelled' back into 'generating_clips', and the job could still end
'done' (autopilot and all). The reaper and the dashboard's
dispatch-error writes had the same read-then-overwrite race.

The guard sits in the WHERE clause (status NOT IN terminal), so a cancel
that lands between a read and a write still wins.
"""
import re
from pathlib import Path

import pytest

from src.db_rows import (
    TERMINAL_JOB_STATUSES,
    JobAlreadyTerminal,
    job_failed_update,
    set_job_status,
    update_job_unless_terminal,
)
from tests.fakes.fake_supabase import FakeSupabase

ROOT = Path(__file__).resolve().parent.parent
MODAL_SRC = (ROOT / "modal_app.py").read_text(encoding="utf-8")
JOB = "00000000-0000-4000-8000-0000000000f1"


def _job(status: str) -> FakeSupabase:
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB, status=status)
    return sb


def _status(sb: FakeSupabase) -> str:
    return sb.table("jobs").select("status").eq("id", JOB).single().execute().data["status"]


def test_terminal_set_matches_the_dashboard():
    ts = (ROOT / "dashboard/src/lib/job-status.ts").read_text(encoding="utf-8")
    listed = re.search(r"TERMINAL_JOB_STATUSES = \[([^\]]*)\]", ts).group(1)
    assert tuple(re.findall(r"'(\w+)'", listed)) == TERMINAL_JOB_STATUSES


@pytest.mark.parametrize("status", TERMINAL_JOB_STATUSES)
def test_finished_job_is_not_moved(status):
    sb = _job(status)
    assert update_job_unless_terminal(sb, JOB, {"status": "generating_clips"}) is False
    assert _status(sb) == status


def test_in_flight_job_is_moved():
    sb = _job("generating_clips")
    assert update_job_unless_terminal(sb, JOB, {"status": "stitching"}) is True
    assert _status(sb) == "stitching"


def test_cancelled_job_stays_cancelled_through_a_worker_run():
    """The worker's stage write raises (stop spending) and its failure
    write is a no-op: the row ends exactly as the operator left it."""
    sb = _job("generating_clips")
    sb.table("jobs").update({"status": "cancelled"}).eq("id", JOB).execute()  # operator
    with pytest.raises(JobAlreadyTerminal):
        set_job_status(sb, JOB, "stitching", "Crossfading clips")
    assert update_job_unless_terminal(sb, JOB, job_failed_update("boom")) is False
    assert _status(sb) == "cancelled"


def test_non_strict_tick_on_a_finished_job_writes_nothing_and_does_not_raise():
    sb = _job("cancelled")
    assert set_job_status(sb, JOB, "generating_clips", "3 of 5", strict=False) is False
    assert _status(sb) == "cancelled"


def test_failure_update_sets_completed_at():
    assert job_failed_update("x") == {
        "status": "failed", "error_message": "x", "completed_at": "now()",
    }


# ── modal_app.py wiring (modal isn't importable here, so read the source) ──

def _worker_bodies() -> list[str]:
    """Source of every function that defines a set_status closure."""
    out = []
    for m in re.finditer(r"^    def set_status\(", MODAL_SRC, re.M):
        start = MODAL_SRC.rindex("\ndef ", 0, m.start())
        end = MODAL_SRC.find("\n@app.function(", m.start())
        out.append(MODAL_SRC[start:end])
    return out


def test_every_worker_set_status_is_guarded():
    bodies = _worker_bodies()
    assert len(bodies) == 9
    for body in bodies:
        closure = body[body.index("    def set_status("):][:400]
        assert "set_job_status(sb," in closure, closure


def test_no_unguarded_job_status_write_remains():
    """No `sb.table("jobs").update({... "status": ...})` outside the helpers."""
    for m in re.finditer(r'table\("jobs"\)\s*\.update\(\s*(\{[^}]*\}|\w+)', MODAL_SRC):
        payload = m.group(1)
        assert '"status"' not in payload, f"unguarded jobs status write: {m.group(0)}"


def test_every_failure_handler_is_guarded_and_stops_quietly():
    for body in _worker_bodies():
        assert "update_job_unless_terminal(sb," in body
        assert "job_failed_update(" in body
        assert "return _log_terminal_abort(" in body


def test_reaper_is_guarded():
    fn = MODAL_SRC.index("def reap_stranded_jobs")
    body = MODAL_SRC[fn:MODAL_SRC.index("@app.function(", fn)]
    assert "update_job_unless_terminal(sb, j[\"id\"], job_failed_update(msg))" in body


def test_in_render_progress_ticks_are_non_strict():
    """A tick fired after a paid render but before its row is saved must
    not abort the worker (the billed clip would be lost)."""
    assert MODAL_SRC.count("set_status_fn=partial(set_status, strict=False)") == 3
    for label in ('f"Generating {completed} of {len(plan.clips)} clips"',
                  'f"Generating {completed_count} of {len(target_planned)} clips"'):
        i = MODAL_SRC.index(label)
        assert "strict=False" in MODAL_SRC[i:i + 120], label


# ── dashboard writers ────────────────────────────────────────────────────

DASH = ROOT / "dashboard/src"


def test_dashboard_failed_writes_are_guarded():
    hits = 0
    for f in DASH.rglob("*.ts"):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"\.update\(\{ status: 'failed'[^\n]*\n(.*\n){1,2}", src):
            block = m.group(0)
            if "from('posts')" in src[max(0, m.start() - 80):m.start()]:
                continue
            hits += 1
            assert ".not('status', 'in', TERMINAL_STATUS_LIST)" in block, f"{f}: {block}"
    assert hits >= 12


def test_cancel_cannot_overwrite_a_finished_job():
    src = (DASH / "app/actions/cancel-job.ts").read_text(encoding="utf-8")
    assert ".in('status', CANCELLABLE_STATUSES)" in src
    assert "!cancelled?.length" in src
