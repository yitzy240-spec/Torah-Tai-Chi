"""Canonical row/payload builders for the pipeline's Supabase writes.

modal_app.py's per-function set_status / log_cost closures and videos
inserts build their payloads here so tests can validate the EXACT dicts
the pipeline sends against the real schema (tests/fakes/fake_supabase.py
offline, real Postgres in the db-schema CI job). PR #15 shipped a partial
clips upsert that only failed in prod because no test ever checked a
payload against the schema — keep payload construction out of inline
dict literals in modal_app.py.

Clip rows live in src/kie_task_persist.py (build_pending_clip_row,
build_done_clip_row); execution_events rows in src/events.py
(build_event_row).
"""
from __future__ import annotations

from typing import Optional

# job_status enum, in enum order (0001_slice1_schema.sql + verifying).
JOB_STATUSES = (
    "queued", "loading_parsha", "generating_plan", "uploading_refs",
    "generating_clips", "stitching", "done", "failed", "cancelled",
    "verifying",
)


def job_status_update(status: str, message: Optional[str] = None) -> dict:
    """jobs UPDATE payload for a stage transition."""
    update = {"status": status}
    if message is not None:
        update["status_message"] = message
    return update


def cost_event_row(
    job_id: Optional[str], action: str, vendor: str, cost_usd: float,
    notes: Optional[str] = None,
) -> dict:
    """cost_events INSERT row (action/vendor/cost_usd are NOT NULL)."""
    return {
        "job_id": job_id, "action": action, "vendor": vendor,
        "cost_usd": cost_usd, "notes": notes,
    }


def build_video_row(job_id: str, mp4_path: str) -> dict:
    """Base videos INSERT row (job_id + mp4_path are NOT NULL; job_id is
    UNIQUE). Callers add thumb_path / title fields."""
    return {"job_id": job_id, "mp4_path": mp4_path}
