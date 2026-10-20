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

import re
from typing import Optional

# job_status enum, in enum order (0001_slice1_schema.sql + verifying).
JOB_STATUSES = (
    "queued", "loading_parsha", "generating_plan", "uploading_refs",
    "generating_clips", "stitching", "done", "failed", "cancelled",
    "verifying",
)


# A job in one of these states is finished. No worker, reaper or dashboard
# error path may move it out again: the operator's "cancelled" must stay
# cancelled, and a late failure must not relabel a "done" video. Re-running
# a finished job is an explicit operator action (retrigger-job.ts resets
# the row to "queued" first).
TERMINAL_JOB_STATUSES = ("done", "failed", "cancelled")


class JobAlreadyTerminal(RuntimeError):
    """The job became done/failed/cancelled under a running worker (almost
    always an operator cancel). Raised by a guarded stage transition so the
    worker stops before it spends more money."""


def job_status_update(status: str, message: Optional[str] = None) -> dict:
    """jobs UPDATE payload for a stage transition."""
    update = {"status": status}
    if message is not None:
        update["status_message"] = message
    return update


def job_failed_update(error_message: str) -> dict:
    """jobs UPDATE payload for a worker failure. completed_at drops the row
    out of the jobs_watchdog_active_idx partial index."""
    return {
        "status": "failed", "error_message": error_message,
        "completed_at": "now()",
    }


def update_job_unless_terminal(sb, job_id: str, update: dict) -> bool:
    """UPDATE jobs SET <update> WHERE id = job_id AND status NOT IN
    TERMINAL_JOB_STATUSES. Returns True when the row changed; False means
    the job was already finished (or is gone) and nothing was written.

    The guard lives in the WHERE clause, not a read-then-write, so a cancel
    that lands between a worker's read and its write still wins."""
    res = (
        sb.table("jobs").update(update).eq("id", job_id)
        .not_.in_("status", list(TERMINAL_JOB_STATUSES))
        .execute()
    )
    return bool(getattr(res, "data", None))


def set_job_status(
    sb, job_id: str, status: str, message: Optional[str] = None,
    *, strict: bool = True,
) -> bool:
    """Guarded stage transition for the Modal workers. Returns True when
    written. On a finished job it writes nothing and, when strict, raises
    JobAlreadyTerminal so the caller stops before rendering (and billing)
    more for a cancelled job.

    Pass strict=False for progress ticks fired while paid renders are in
    flight: raising there would abandon a billed clip before its row is
    saved. The worker then stops at its next strict transition."""
    if update_job_unless_terminal(sb, job_id, job_status_update(status, message)):
        return True
    if strict:
        raise JobAlreadyTerminal(
            f"job {job_id} is already finished (done/failed/cancelled); "
            f"not moving it to {status!r}"
        )
    return False


def cost_event_row(
    job_id: Optional[str], action: str, vendor: str, cost_usd: float,
    notes: Optional[str] = None,
) -> dict:
    """cost_events INSERT row (action/vendor/cost_usd are NOT NULL)."""
    return {
        "job_id": job_id, "action": action, "vendor": vendor,
        "cost_usd": cost_usd, "notes": notes,
    }


def build_video_row(
    job_id: str, mp4_path: str, mp4_subscribe_path: Optional[str] = None,
) -> dict:
    """Base videos row (job_id + mp4_path are NOT NULL). Workers write it
    with upsert(on_conflict="job_id") (videos_job_id_key is UNIQUE), so a
    re-render keeps the existing row's id, posts and feedback. Callers add
    thumb_path / title fields.

    mp4_path is the FOLLOW-ending cut (Facebook / Instagram / TikTok / X);
    mp4_subscribe_path the SUBSCRIBE-ending cut for YouTube. Always written,
    even as None, so a re-render whose subscribe cut failed clears the
    previous render's (now mismatched) subscribe file and readers fall back
    to mp4_path."""
    return {
        "job_id": job_id, "mp4_path": mp4_path,
        "mp4_subscribe_path": mp4_subscribe_path,
    }


def _filename_slug(value: Optional[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug or "torah-tai-chi"


def video_storage_paths(job_id: str, parsha_slug: Optional[str]) -> dict:
    """Storage paths (videos bucket) for the two endings of a job's final
    video: {"follow": "jobs/<job>/<parsha>-follow.mp4",
            "subscribe": "jobs/<job>/<parsha>-subscribe.mp4"}.
    Topic / unknown-parsha jobs fall back to "torah-tai-chi"."""
    slug = _filename_slug(parsha_slug)
    return {
        "follow": f"jobs/{job_id}/{slug}-follow.mp4",
        "subscribe": f"jobs/{job_id}/{slug}-subscribe.mp4",
    }


def video_complete_payload(
    job_id: str, video_id: str, mp4_path: Optional[str],
    mp4_subscribe_path: Optional[str],
) -> dict:
    """JSON body for the dashboard's /api/pipeline/video-complete webhook.
    Carries both endings' storage paths; mp4SubscribePath is None when the
    subscribe cut failed (YouTube then falls back to mp4Path)."""
    return {
        "jobId": job_id, "videoId": video_id,
        "mp4Path": mp4_path, "mp4SubscribePath": mp4_subscribe_path,
    }


def record_cost(
    sb, job_id: Optional[str], action: str, vendor: str, cost_usd: float,
    notes: Optional[str] = None,
) -> bool:
    """cost_events row + jobs.total_cost_usd bump (increment_job_cost).

    Best-effort: never raises. The workers call this AFTER a paid clip is
    already saved, and a cost-logging blip used to fail that finished job.
    A failure is printed and recorded as a cost.log_failed event (with the
    amount) so the books can be fixed by hand. Returns True when both
    writes succeeded."""
    try:
        sb.table("cost_events").insert(
            cost_event_row(job_id, action, vendor, cost_usd, notes)
        ).execute()
        sb.rpc("increment_job_cost", {"j_id": job_id, "delta": cost_usd}).execute()
        return True
    except Exception as e:
        from src.events import log_event

        err = f"{type(e).__name__}: {e}"
        print(f"[cost] FAILED to record {action}/{vendor} ${cost_usd} for job {job_id}: {err}")
        log_event(
            sb, actor="modal", level="warn", event="cost.log_failed",
            subject_type="job", subject_id=job_id,
            message=f"Could not record ${cost_usd} {action} cost ({vendor}); job continues",
            details={"action": action, "vendor": vendor, "cost_usd": cost_usd,
                     "notes": notes, "error": err},
        )
        return False


def record_unattached_cost(
    sb, action: str, vendor: str, cost_usd: float, notes: Optional[str] = None,
) -> bool:
    """cost_events row with job_id NULL, for spend that belongs to no job
    (chain_probe). No jobs.total_cost_usd bump. Best-effort: never raises."""
    try:
        sb.table("cost_events").insert(
            cost_event_row(None, action, vendor, cost_usd, notes)
        ).execute()
        return True
    except Exception as e:
        print(f"[cost] FAILED to record unattached {action}/{vendor} ${cost_usd}: {e}")
        return False
