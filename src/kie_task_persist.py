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
from typing import Any, Optional

from src.events import log_event


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
