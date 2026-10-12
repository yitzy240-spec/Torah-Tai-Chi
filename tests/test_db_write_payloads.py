"""Pipeline DB write payloads vs the real schema (offline, via the fake).

The fake validates against tests/schema/schema_snapshot.json, which the
db-schema CI job regenerates from the migrations; tests/db/ runs the same
CASES against real Postgres so the fake can't drift from reality.
"""
import pytest

import src.kie_task_persist as ktp
from src.db_rows import build_video_row, cost_event_row, job_status_update
from src.events import build_event_row, log_event
from src.kie_task_persist import (
    persist_kie_task_id,
    record_kie_task_created,
    save_paid_clip,
)
from tests.db_write_cases import (
    CASES, CLIP0, CLIP1, CODE_TO_OUTCOME, JOB_ID, OK, SEED_ROWS, Case,
)
from tests.fakes.fake_supabase import APIError, FakeSupabase, load_snapshot, simple_check_lists


def _seeded() -> FakeSupabase:
    sb = FakeSupabase()
    for table, row in SEED_ROWS:
        sb.seed(table, **row)
    return sb


def run_case_on_fake(case: Case) -> str:
    sb = _seeded()
    q = sb.table(case.table)
    if case.op == "insert":
        q = q.insert(case.payload)
    elif case.op == "upsert":
        q = q.upsert(case.payload, on_conflict=case.on_conflict)
    else:
        q = q.update(case.payload)
        for col, val in case.where.items():
            q = q.eq(col, val)
    try:
        q.execute()
    except APIError as e:
        return CODE_TO_OUTCOME.get(e.code, f"unmapped:{e.code}")
    return OK


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_write_case_on_fake(case):
    assert run_case_on_fake(case) == case.expect


# ── PR #15 regression, spelled out ─────────────────────────────────────

def test_pr15_partial_clip_upsert_is_rejected_even_when_row_exists():
    """The exact payload #15 shipped. On the old permissive mocks this
    'passed'; against the schema it is a 23502 — upsert = INSERT ... ON
    CONFLICT, and the INSERT half lacks voiceover/visual_prompt/
    setting_id/duration_s whether or not (job_id, index) already exists."""
    sb = _seeded()  # (JOB_ID, 0) already exists
    with pytest.raises(APIError) as ei:
        sb.table("clips").upsert(
            {"job_id": JOB_ID, "index": 0, "seedance_task_id": "t-123"},
            on_conflict="job_id,index",
        ).execute()
    assert ei.value.code == "23502"
    assert any(f'"{c}"' in ei.value.message
               for c in ("voiceover", "visual_prompt", "setting_id", "duration_s"))


def test_persist_kie_task_id_writes_a_valid_row_on_a_fresh_job():
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB_ID)
    assert persist_kie_task_id(sb, JOB_ID, CLIP1, "t-1", "bow", "https://m/bow.mp4") is True
    [row] = sb.rows["clips"]
    assert row["seedance_task_id"] == "t-1"
    assert row["status"] == "pending"
    assert row["voiceover"] == CLIP1.voiceover
    assert row["verification_status"] == "unchecked"  # default applied


def test_pending_then_done_upsert_leaves_one_done_row():
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB_ID)
    persist_kie_task_id(sb, JOB_ID, CLIP0, "t-1")
    sb.table("clips").upsert(
        ktp.build_done_clip_row(JOB_ID, CLIP0, task_id="t-1",
                                storage_path="jobs/j/clips/clip_00.mp4", cost_usd=2.87),
        on_conflict="job_id,index",
    ).execute()
    [row] = sb.rows["clips"]
    assert row["status"] == "done"
    assert row["storage_path"] == row["mp4_path"] == "jobs/j/clips/clip_00.mp4"
    assert row["seedance_task_id"] == "t-1"


def test_save_paid_clip_retries_a_transient_db_failure():
    sb = _seeded()
    sb.fail_on_next_write("clips", RuntimeError("JSONDecodeError: Expecting value"))
    row = ktp.build_done_clip_row(JOB_ID, CLIP0, task_id="t-1",
                                  storage_path="p.mp4", cost_usd=1.0)
    save_paid_clip(
        sb, JOB_ID, 0, "t-1", None,
        lambda: sb.table("clips").upsert(row, on_conflict="job_id,index").execute(),
        waits=(0, 0), sleep=lambda s: None,
    )
    assert [r["status"] for r in sb.rows["clips"]] == ["done"]
    assert sb.rows["execution_events"] == []  # no recovery trail needed


def test_save_paid_clip_final_failure_writes_valid_recovery_event():
    sb = _seeded()
    sb.fail_on_next_write("clips", *[RuntimeError("503")] * 3)
    with pytest.raises(RuntimeError):
        save_paid_clip(
            sb, JOB_ID, 0, "t-9", {"resultJson": '{"resultUrls": ["https://cdn/x.mp4"]}'},
            lambda: sb.table("clips").upsert({}, on_conflict="job_id,index").execute(),
            waits=(0, 0), sleep=lambda s: None,
        )
    [ev] = sb.rows["execution_events"]
    assert ev["event"] == "kie.paid_render_unsaved" and ev["level"] == "error"
    assert ev["subject_id"] == JOB_ID
    assert ev["details"]["task_id"] == "t-9"
    assert ev["details"]["result_urls"] == ["https://cdn/x.mp4"]


def test_record_kie_task_created_lands_in_execution_events():
    sb = _seeded()
    record_kie_task_created(sb, JOB_ID, 3, "t-42")
    [ev] = sb.rows["execution_events"]
    assert ev["event"] == "kie.task_created"
    assert ev["details"] == {"task_id": "t-42", "clip_index": 3, "job_id": JOB_ID}


def test_log_event_with_non_uuid_subject_is_not_dropped():
    """subject_id is uuid; a Kie task id there used to 22P02 and log_event
    silently swallowed the whole event."""
    sb = FakeSupabase()
    log_event(sb, actor="modal", level="warn", event="e", message="m",
              subject_type="kie_task", subject_id="t-123", details={"a": 1})
    [ev] = sb.rows["execution_events"]
    assert ev["subject_id"] is None
    assert ev["details"] == {"a": 1, "subject_ref": "t-123"}


def test_build_event_row_keeps_uuid_subject():
    row = build_event_row(actor="modal", level="info", event="e", message="m",
                          subject_type="job", subject_id=JOB_ID)
    assert row["subject_id"] == JOB_ID and row["details"] is None


def test_job_status_update_shape():
    assert job_status_update("done") == {"status": "done"}
    assert job_status_update("stitching", "Stitching") == {
        "status": "stitching", "status_message": "Stitching"}


def test_cost_event_and_video_rows_round_trip():
    sb = _seeded()
    sb.table("cost_events").insert(cost_event_row(JOB_ID, "clip", "kie", 2.87)).execute()
    sb.rpc("increment_job_cost", {"j_id": JOB_ID, "delta": 2.87}).execute()
    assert sb.rows["cost_events"][0]["cost_usd"] == 2.87
    [job] = [j for j in sb.rows["jobs"] if j["id"] == JOB_ID]
    assert job["total_cost_usd"] == pytest.approx(2.87)
    with pytest.raises(APIError) as ei:  # videos.job_id is UNIQUE
        sb.table("videos").insert(build_video_row(JOB_ID, "again.mp4")).execute()
    assert ei.value.code == "23505"


# ── the fake itself ─────────────────────────────────────────────────────

def test_snapshot_job_status_enum_matches_pipeline_vocabulary():
    from src.db_rows import JOB_STATUSES
    assert tuple(load_snapshot()["enums"]["job_status"]) == JOB_STATUSES


def test_simple_check_lists_parse_every_in_list_check():
    snap = load_snapshot()
    assert simple_check_lists(snap["tables"]["posts"])["status"] == [
        "pending", "scheduled", "published", "failed"]
    assert "plan-only" in simple_check_lists(snap["tables"]["jobs"])["kind"]
    assert simple_check_lists(snap["tables"]["clips"])["verification_status"] == [
        "unchecked", "verifying", "verified", "failed"]


def test_bulk_upsert_missing_key_becomes_null():
    """supabase-py bulk writes send NULL for keys a row lacks (union of
    keys) — a heterogeneous batch can null a NOT NULL column."""
    sb = _seeded()
    full = ktp.build_pending_clip_row(JOB_ID, CLIP1, "t-1")
    partial = {"job_id": JOB_ID, "index": 2, "seedance_task_id": "t-2"}
    with pytest.raises(APIError) as ei:
        sb.table("clips").upsert([full, partial], on_conflict="job_id,index").execute()
    assert ei.value.code == "23502"


def test_maybe_single_returns_none_on_zero_rows():
    sb = FakeSupabase()
    assert sb.table("jobs").select("id").eq("id", JOB_ID).maybe_single().execute() is None
