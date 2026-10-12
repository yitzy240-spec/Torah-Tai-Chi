"""Persist Kie task ids early so an already-billed render is recoverable.

Kie bills at task creation. If the worker dies (or a DB write fails)
between create_task and the final 'done' clip upsert, the only handle on
the paid render is the task_id. These helpers live outside modal_app so
they're unit-testable without the `modal` SDK.

clips.voiceover / visual_prompt / setting_id / duration_s are NOT NULL,
so ANY upsert that may INSERT a new row must carry them — a bare
{job_id, index, seedance_task_id} upsert fails with 23502 when the job
has no pre-existing row for that index.
"""
from __future__ import annotations

import json
import time
from typing import Any, Callable, Optional

from src.events import log_event

# Waits between DB-write attempts for a paid clip row; len + 1 = attempts.
DB_WRITE_RETRY_WAITS_S: tuple[float, ...] = (1, 3, 8)


def build_pending_clip_row(
    job_id: str, clip: Any, task_id: str,
    motion_ref_slug: Optional[str] = None,
    motion_ref_url: Optional[str] = None,
) -> dict:
    """Full clips row (all NOT NULL columns) for a just-created Kie task."""
    return {
        "job_id": job_id,
        "index": clip.index,
        "voiceover": clip.voiceover,
        "visual_prompt": clip.visual_prompt,
        "setting_id": clip.setting_id,
        "duration_s": clip.duration_s,
        "seedance_task_id": task_id,
        "motion_ref_slug": motion_ref_slug,
        "motion_ref_url": motion_ref_url,
        "status": "pending",
    }


def build_done_clip_row(
    job_id: str, clip: Any, *, task_id: Optional[str], storage_path: str,
    cost_usd: Optional[float],
    motion_ref_slug: Optional[str] = None,
    motion_ref_url: Optional[str] = None,
    regen_of_clip_id: Optional[str] = None,
) -> dict:
    """Full clips row for a rendered + uploaded clip. Upsert-safe: carries
    every NOT NULL column, so it can INSERT on a fresh (job_id, index)."""
    row = {
        "job_id": job_id,
        "index": clip.index,
        "voiceover": clip.voiceover,
        "visual_prompt": clip.visual_prompt,
        "setting_id": clip.setting_id,
        "duration_s": clip.duration_s,
        "seedance_task_id": task_id,
        "motion_ref_slug": motion_ref_slug,
        "motion_ref_url": motion_ref_url,
        "storage_path": storage_path,
        "mp4_path": storage_path,
        "status": "done",
        "cost_usd": cost_usd,
        "completed_at": "now()",
    }
    if regen_of_clip_id is not None:
        row["regen_of_clip_id"] = regen_of_clip_id
    return row


def persist_kie_task_id(
    sb: Any, job_id: str, clip: Any, task_id: str,
    motion_ref_slug: Optional[str] = None,
    motion_ref_url: Optional[str] = None,
) -> bool:
    """Upsert the pending clip row carrying task_id. Best-effort: never
    raises — a failed persist only loses resumability, not the render.
    Returns True on success."""
    print(f"[kie_persist] clip {clip.index}: Kie task_id {task_id}")
    try:
        sb.table("clips").upsert(
            build_pending_clip_row(
                job_id, clip, task_id, motion_ref_slug, motion_ref_url,
            ),
            on_conflict="job_id,index",
        ).execute()
        return True
    except Exception as e:
        print(
            f"[kie_persist] clip {clip.index}: FAILED to save task_id "
            f"{task_id} ({type(e).__name__}: {e}); render continues"
        )
        log_event(
            sb, actor="modal", level="warn",
            event="kie.task_id_persist_failed",
            subject_type="job", subject_id=job_id,
            message=(
                f"Could not save Kie task_id {task_id} for clip "
                f"{clip.index}; render continues but is not resumable"
            ),
            details={
                "task_id": task_id, "clip_index": clip.index,
                "job_id": job_id, "error": f"{type(e).__name__}: {e}",
            },
        )
        return False


def record_kie_task_created(
    sb: Any, job_id: str, clip_index: int, task_id: str,
) -> None:
    """Durable breadcrumb for a just-created (billed) Kie task on paths
    that don't hold a clips row yet (the regen paths insert theirs only
    after the render). If the worker dies mid-poll, this event is the
    only place outside Modal's logs the task_id survives. Never raises."""
    print(f"[kie_persist] clip {clip_index}: Kie task_id {task_id}")
    log_event(
        sb, actor="modal", level="info",
        event="kie.task_created",
        subject_type="job", subject_id=job_id,
        message=f"Kie task {task_id} created for clip {clip_index}",
        details={"task_id": task_id, "clip_index": clip_index, "job_id": job_id},
    )


def retry_db_write(
    write: Callable[[], Any], *, label: str,
    waits: tuple[float, ...] = DB_WRITE_RETRY_WAITS_S,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    """Run write() (a supabase `...execute()` thunk), retrying transient
    failures. Only use for IDEMPOTENT writes (upsert / update) — a retried
    insert whose first attempt actually landed would 23505."""
    for attempt, wait_s in enumerate((*waits, None), start=1):
        try:
            return write()
        except Exception as err:
            if wait_s is None:
                raise
            print(
                f"[db] {label} attempt {attempt} failed "
                f"({type(err).__name__}: {err}); retrying in {wait_s}s"
            )
            sleep(wait_s)


def save_paid_clip(
    sb: Any, job_id: str, clip_index: int, task_id: Optional[str],
    kie_meta: Optional[dict], write: Callable[[], Any],
    *, waits: tuple[float, ...] = DB_WRITE_RETRY_WAITS_S,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    """Persist a billed clip (upload and/or row write inside `write`) with
    retries; on final failure leave the kie.paid_render_unsaved recovery
    trail, then re-raise. `write` must be idempotent."""
    try:
        return retry_db_write(
            write, label=f"save clip {clip_index}", waits=waits, sleep=sleep,
        )
    except Exception as err:
        log_paid_render_unsaved(sb, job_id, clip_index, task_id, kie_meta, err)
        raise


def unsaved_render_logger(
    sb: Any, job_id: str, clip_index: int,
) -> Callable[[str, Optional[dict], BaseException], None]:
    """on_unsaved hook for generate_clip_with_meta."""
    def _hook(task_id: str, kie_meta: Optional[dict], err: BaseException) -> None:
        log_paid_render_unsaved(sb, job_id, clip_index, task_id, kie_meta, err)
    return _hook


def kie_result_urls(kie_meta: Optional[dict]) -> list[str]:
    """Pull resultUrls out of Kie's raw task record, tolerating either a
    JSON-string or dict resultJson. Never raises."""
    try:
        rj = (kie_meta or {}).get("resultJson") or "{}"
        parsed = json.loads(rj) if isinstance(rj, str) else rj
        return list(parsed.get("resultUrls") or [])
    except Exception:
        return []


def log_paid_render_unsaved(
    sb: Any, job_id: str, clip_index: int, task_id: Optional[str],
    kie_meta: Optional[dict], error: BaseException,
) -> None:
    """Record a billed Kie render whose mp4 upload or clip row failed, so
    it can be recovered by hand (task_id + result URLs). Never raises."""
    urls = kie_result_urls(kie_meta)
    print(
        f"[kie_unsaved] clip {clip_index}: PAID render not saved — "
        f"task_id={task_id} urls={urls} "
        f"({type(error).__name__}: {error})"
    )
    log_event(
        sb, actor="modal", level="error",
        event="kie.paid_render_unsaved",
        subject_type="job", subject_id=job_id,
        message=(
            f"Kie render for clip {clip_index} was billed but not saved "
            f"(task_id {task_id}); recover via Kie recordInfo"
        ),
        details={
            "task_id": task_id, "clip_index": clip_index, "job_id": job_id,
            "result_urls": urls, "error": f"{type(error).__name__}: {error}",
        },
    )
