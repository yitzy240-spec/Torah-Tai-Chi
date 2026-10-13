"""Low-severity audit items (AUDIT.md §1, 2026-10-13 batch 13)."""
import re
from pathlib import Path

from src.db_rows import record_cost
from src.kie_task_persist import build_done_clip_row, build_reset_clip_row
from src.models import Clip
from tests.fakes.fake_supabase import APIError, FakeSupabase

MODAL_SRC = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(encoding="utf-8")
JOB = "00000000-0000-4000-8000-0000000000a7"
CLIP = Clip(index=0, voiceover="Shalom.", visual_prompt="Rav Eli bows", duration_s=8,
            setting_id="DOJO")


def _sb() -> FakeSupabase:
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB)
    return sb


# ── log_cost is best-effort ───────────────────────────────────────────────

def test_record_cost_writes_the_event_and_bumps_the_total():
    sb = _sb()
    assert record_cost(sb, JOB, "clip", "kie", 2.87, "clip 0") is True
    assert sb.table("cost_events").select("*").execute().data[0]["cost_usd"] == 2.87
    assert sb.rpcs == [("increment_job_cost", {"j_id": JOB, "delta": 2.87})]


def test_record_cost_failure_does_not_raise_and_leaves_a_trail():
    sb = _sb()
    sb.fail_on_next_write("cost_events", APIError("57014", "statement timeout"))
    assert record_cost(sb, JOB, "clip", "kie", 2.87) is False
    events = sb.table("execution_events").select("*").execute().data
    assert [e["event"] for e in events] == ["cost.log_failed"]
    assert events[0]["details"]["cost_usd"] == 2.87


def test_every_worker_log_cost_is_best_effort():
    closures = re.findall(r"    def log_cost\(.*?\n(?=\n|    \S)", MODAL_SRC, re.S)
    assert len(closures) == 7
    for c in closures:
        assert "record_cost(sb, job_id, action, vendor, cost_usd, notes)" in c, c
    assert 'table("cost_events")' not in MODAL_SRC


# ── reset upsert clears the previous render ──────────────────────────────

def test_reset_row_clears_a_previous_verified_render():
    sb = _sb()
    sb.table("clips").upsert(build_done_clip_row(
        JOB, CLIP, task_id="t-1", storage_path="jobs/x/clip_00.mp4", cost_usd=2.87,
        motion_ref_url="https://m/bow.mp4", verification_status="failed",
        verification_attempts=3, verification_notes={"why": "kippah"},
    ), on_conflict="job_id,index").execute()
    sb.table("clips").upsert([build_reset_clip_row(JOB, CLIP)], on_conflict="job_id,index").execute()
    row = sb.table("clips").select("*").eq("job_id", JOB).single().execute().data
    assert row["status"] == "pending"
    assert row["storage_path"] is None and row["mp4_path"] is None
    assert row["cost_usd"] == 0
    assert row["verification_status"] == "unchecked"
    assert row["verification_attempts"] == 0 and row["verification_notes"] is None
    assert row["motion_ref_url"] is None and row["completed_at"] is None
    assert row["seedance_task_id"] == "t-1"  # kept: recovery pointer for a billed render


def test_run_pipeline_reset_uses_the_builder():
    assert "build_reset_clip_row(job_id, c)" in MODAL_SRC


# ── copied plan-owner rows don't double count ────────────────────────────

def test_copied_clip_rows_carry_zero_cost():
    assert '.get("cost_usd"' not in MODAL_SRC
    start = MODAL_SRC.index("def clips_only_job(")
    body = MODAL_SRC[start:MODAL_SRC.index("\n@app.function(", start)]
    copy = body[body.index("# Copy the plan-owner clip row"):body.index('set_status("stitching"')]
    assert '"cost_usd": 0,' in copy


# ── regen_agent's plan row records what was actually logged ──────────────

def test_regen_agent_plan_cost_is_the_logged_sum_not_logged_twice():
    start = MODAL_SRC.index("def regen_agent(job_id: str)")
    body = MODAL_SRC[start:MODAL_SRC.index("\n@app.function(", start)]
    assert '"claude_cost_usd": round(sum(plan_costs), 4)' in body
    assert "plan_costs.append(cost_usd)" in body
    assert "\"claude_cost_usd\": 0.13" not in body
