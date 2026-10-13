"""Shared accept/reject matrix for pipeline DB write payloads.

Every case is built with the SAME helpers the pipeline uses
(src/kie_task_persist.py, src/db_rows.py, src/events.py) and runs through
both backends:
  * tests/test_db_write_payloads.py  -> tests/fakes/fake_supabase.py (always)
  * tests/db/test_real_postgres.py   -> real Postgres (CI db-schema job)
Identical expected outcomes on both keep the fake honest.

Each case runs against a fresh database holding SEED_ROWS.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from src.db_rows import (
    JOB_STATUSES,
    build_video_row,
    cost_event_row,
    job_status_update,
)
from src.events import build_event_row
from src.kie_task_persist import build_done_clip_row, build_pending_clip_row
from src.models import Clip

JOB_ID = "00000000-0000-4000-8000-000000000001"
JOB2_ID = "00000000-0000-4000-8000-000000000002"
VIDEO_ID = "00000000-0000-4000-8000-0000000000a1"
SEED_CLIP_ID = "00000000-0000-4000-8000-0000000000c0"
MISSING_ID = "00000000-0000-4000-8000-00000000dead"

CLIP0 = Clip(index=0, voiceover="Shalom.", visual_prompt="Rav Eli bows, dolly in",
             duration_s=8, setting_id="DOJO")
CLIP1 = Clip(index=1, voiceover="Breathe.", visual_prompt="Rav Eli exhales",
             duration_s=6, setting_id="DOJO")

# Inserted in order before every case.
SEED_ROWS: list[tuple[str, dict]] = [
    ("jobs", {"id": JOB_ID}),
    ("jobs", {"id": JOB2_ID, "kind": "clips-only"}),
    ("videos", {"id": VIDEO_ID, "job_id": JOB_ID, "mp4_path": "jobs/seed/final.mp4"}),
    ("clips", {**build_pending_clip_row(JOB_ID, CLIP0, "t-seed"), "id": SEED_CLIP_ID}),
]

# Outcome classes, so the fake's postgrest-style codes and Postgres
# SQLSTATEs can be compared.
OK = "ok"
NOT_NULL = "not_null"          # 23502
CHECK = "check"                # 23514
BAD_VALUE = "bad_value"        # 22P02 (enum label / uuid / integer syntax)
UNKNOWN_COLUMN = "unknown_column"  # PGRST204 (PostgREST) / 42703 (Postgres)
NO_CONFLICT_TARGET = "no_conflict_target"  # 42P10
DUPLICATE = "duplicate"        # 23505
FOREIGN_KEY = "foreign_key"    # 23503

CODE_TO_OUTCOME = {
    "23502": NOT_NULL, "23514": CHECK, "22P02": BAD_VALUE,
    "PGRST204": UNKNOWN_COLUMN, "42703": UNKNOWN_COLUMN,
    "42P10": NO_CONFLICT_TARGET, "23505": DUPLICATE, "23503": FOREIGN_KEY,
}


@dataclass
class Case:
    id: str
    table: str
    op: str                      # insert | upsert | update
    payload: dict
    expect: str
    on_conflict: Optional[str] = None
    where: dict[str, Any] = field(default_factory=dict)  # update: col == value


def _cases() -> list[Case]:
    cases = [
        # ── clips: the #15 class ────────────────────────────────────────
        Case("pending_clip_row_fresh_index", "clips", "upsert",
             build_pending_clip_row(JOB_ID, CLIP1, "t-1", "bow", "https://m/bow.mp4"),
             OK, on_conflict="job_id,index"),
        Case("pending_clip_row_existing_index", "clips", "upsert",
             build_pending_clip_row(JOB_ID, CLIP0, "t-2"), OK, on_conflict="job_id,index"),
        Case("done_clip_row", "clips", "upsert",
             build_done_clip_row(JOB_ID, CLIP0, task_id="t-2",
                                 storage_path="jobs/x/clips/clip_00.mp4", cost_usd=2.87),
             OK, on_conflict="job_id,index"),
        Case("done_clip_row_regen", "clips", "upsert",
             build_done_clip_row(JOB2_ID, CLIP0, task_id=None,
                                 storage_path="jobs/y/clips/clip_00.mp4", cost_usd=0.0,
                                 motion_ref_slug=None, motion_ref_url=None),
             OK, on_conflict="job_id,index"),
        # run_pipeline's done-upsert (verify-loop fields), on an index
        # whose pending row is gone: must INSERT, not match zero rows.
        Case("done_clip_row_verified_missing_pending_row", "clips", "upsert",
             build_done_clip_row(JOB_ID, CLIP1, task_id="t-2",
                                 storage_path="jobs/x/clips/clip_01.mp4", cost_usd=2.87,
                                 verification_status="verified", verification_attempts=2,
                                 verification_notes={"checks": [], "results": []}),
             OK, on_conflict="job_id,index"),
        Case("done_clip_row_verified_existing_row", "clips", "upsert",
             build_done_clip_row(JOB_ID, CLIP0, task_id="t-2",
                                 storage_path="jobs/x/clips/clip_00.mp4", cost_usd=None,
                                 verification_status="unchecked", verification_attempts=1,
                                 verification_notes={"skipped": "no checks"}),
             OK, on_conflict="job_id,index"),
        # regen_agent / regen_single_clip payload: verify-loop fields plus
        # regen_of_clip_id (FK -> clips.id) on a fresh regen job.
        Case("done_clip_row_regen_verified", "clips", "upsert",
             build_done_clip_row(JOB2_ID, CLIP0, task_id="t-8",
                                 storage_path="jobs/y/clips/clip_00.mp4", cost_usd=2.87,
                                 regen_of_clip_id=SEED_CLIP_ID,
                                 verification_status="failed", verification_attempts=3,
                                 verification_notes={"checks": [{"q": "bow?"}]}),
             OK, on_conflict="job_id,index"),
        Case("done_clip_row_regen_dangling_parent", "clips", "upsert",
             build_done_clip_row(JOB2_ID, CLIP0, task_id="t-8",
                                 storage_path="jobs/y/clips/clip_00.mp4", cost_usd=0.0,
                                 regen_of_clip_id=MISSING_ID),
             FOREIGN_KEY, on_conflict="job_id,index"),
        Case("clip_row_unknown_job", "clips", "upsert",
             build_pending_clip_row(MISSING_ID, CLIP0, "t-8"),
             FOREIGN_KEY, on_conflict="job_id,index"),
        # PR #15 verbatim: a bare task-id upsert. Fails even though the
        # (job_id, index) row EXISTS — the INSERT half is checked first.
        Case("pr15_partial_upsert_existing_row", "clips", "upsert",
             {"job_id": JOB_ID, "index": 0, "seedance_task_id": "t-3"},
             NOT_NULL, on_conflict="job_id,index"),
        Case("pr15_partial_upsert_fresh_row", "clips", "upsert",
             {"job_id": JOB_ID, "index": 1, "seedance_task_id": "t-3"},
             NOT_NULL, on_conflict="job_id,index"),
        Case("clip_upsert_wrong_conflict_target", "clips", "upsert",
             build_pending_clip_row(JOB_ID, CLIP1, "t-4"), NO_CONFLICT_TARGET,
             on_conflict="job_id"),
        Case("clip_insert_duplicate_index", "clips", "insert",
             build_done_clip_row(JOB_ID, CLIP0, task_id="t-5", storage_path="p", cost_usd=0),
             DUPLICATE),
        Case("clip_update_partial_ok", "clips", "update",
             {"seedance_task_id": "t-6", "status": "pending"}, OK,
             where={"job_id": JOB_ID, "index": 0}),
        Case("clip_update_null_voiceover", "clips", "update",
             {"voiceover": None}, NOT_NULL, where={"job_id": JOB_ID, "index": 0}),
        Case("clip_verification_status_verifying", "clips", "update",
             {"verification_status": "verifying", "verification_attempts": 1}, OK,
             where={"job_id": JOB_ID, "index": 0}),
        Case("clip_verification_status_invalid", "clips", "update",
             {"verification_status": "passed"}, CHECK, where={"job_id": JOB_ID, "index": 0}),
        Case("clip_unknown_column", "clips", "update",
             {"task_id": "t-7"}, UNKNOWN_COLUMN, where={"job_id": JOB_ID, "index": 0}),
        # ── jobs ─────────────────────────────────────────────────────────
        Case("job_status_running_is_not_an_enum_value", "jobs", "update",
             job_status_update("running"), BAD_VALUE, where={"id": JOB_ID}),
        Case("job_failed_with_completed_at_now", "jobs", "update",
             {"status": "failed", "error_message": "x", "completed_at": "now()"}, OK,
             where={"id": JOB_ID}),
        Case("job_kind_video_topic", "jobs", "update", {"kind": "video_topic"}, OK,
             where={"id": JOB_ID}),
        Case("job_kind_topic_rejected", "jobs", "update", {"kind": "topic"}, CHECK,
             where={"id": JOB_ID}),
        Case("job_resolution_invalid", "jobs", "update", {"resolution": "4k"}, CHECK,
             where={"id": JOB_ID}),
        # ── cost_events ──────────────────────────────────────────────────
        Case("cost_event_row", "cost_events", "insert",
             cost_event_row(JOB_ID, "clip", "kie", 2.87, "clips_only clip 0 (500 credits)"), OK),
        Case("cost_event_null_cost", "cost_events", "insert",
             cost_event_row(JOB_ID, "clip", "kie", None), NOT_NULL),
        # ── videos ───────────────────────────────────────────────────────
        Case("video_row", "videos", "insert",
             {**build_video_row(JOB2_ID, "jobs/y/final.mp4"),
              "thumb_path": "jobs/y/thumb.jpg", "title": "Bereishit",
              "subtitle": None, "description": None, "website_caption": None,
              "spoken_script": "Shalom."}, OK),
        Case("video_row_second_for_same_job", "videos", "insert",
             build_video_row(JOB_ID, "jobs/x/final.mp4"), DUPLICATE),
        # ── execution_events ─────────────────────────────────────────────
        Case("event_row_paid_render_unsaved", "execution_events", "insert",
             build_event_row(actor="modal", level="error", event="kie.paid_render_unsaved",
                             message="billed but not saved", subject_type="job",
                             subject_id=JOB_ID,
                             details={"task_id": "t-9", "result_urls": ["https://cdn/x.mp4"]}),
             OK),
        Case("event_row_non_uuid_subject_is_moved", "execution_events", "insert",
             build_event_row(actor="ai-image", level="info", event="compose.image.ok",
                             message="m", subject_type="kie_task", subject_id="kie-task-123"),
             OK),
        Case("event_raw_non_uuid_subject", "execution_events", "insert",
             {"actor": "modal", "level": "info", "event": "e", "message": "m",
              "subject_id": "kie-task-123"}, BAD_VALUE),
        # ── posts (dashboard literals; guards the edit-posted fix) ───────
        Case("post_status_unposted_rejected", "posts", "insert",
             {"video_id": VIDEO_ID, "platform": "youtube", "caption": "c",
              "status": "unposted"}, CHECK),
        Case("post_status_failed_ok", "posts", "insert",
             {"video_id": VIDEO_ID, "platform": "youtube", "caption": "c",
              "status": "failed", "error_message": "Replaced by repost"}, OK),
    ]
    cases += [
        Case(f"job_status_{s}", "jobs", "update", job_status_update(s, f"msg {s}"), OK,
             where={"id": JOB_ID})
        for s in JOB_STATUSES
    ]
    return cases


CASES = _cases()
