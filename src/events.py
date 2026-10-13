"""Execution-event logger for the Python pipeline.

Mirrors dashboard/src/lib/events.ts — writes to the `execution_events`
table using whatever Supabase client the caller already has. Never
raises: any failure is printed and swallowed so the main pipeline can't
be killed by diagnostics.
"""
from __future__ import annotations

import uuid
from typing import Any, Literal, Optional

EventActor = Literal[
    "yonah",
    "pipeline",
    "modal",
    "buffer",
    "youtube",
    "ai-image",
    "ai-video",
    "storyblok",
    "supabase",
    "system",
]

EventLevel = Literal["info", "warn", "error", "action"]


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def build_event_row(
    *, actor: str, level: str, event: str, message: str,
    subject_type: Optional[str] = None, subject_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> dict:
    """The execution_events row log_event inserts. subject_id is a uuid
    column: a non-uuid handle (e.g. a Kie task id) would 22P02 and the
    event would be swallowed, so it moves into details.subject_ref."""
    if subject_id is not None and not _is_uuid(subject_id):
        details = {**(details or {}), "subject_ref": subject_id}
        subject_id = None
    return {
        "actor": actor,
        "level": level,
        "event": event,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "message": message,
        "details": details,
    }


def log_event(
    sb: Any,
    actor: EventActor,
    level: EventLevel,
    event: str,
    message: str,
    subject_type: Optional[str] = None,
    subject_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    """Insert a row into `execution_events`. Never raises.

    Args:
        sb: a Supabase client (already configured with service-role key).
        actor: who produced the event. Prod has no CHECK on actor/level
            (2026-10-13 schema dump); EventActor/EventLevel are the guard.
        level: severity — info / warn / error / action.
        event: short snake-case code, e.g. "pipeline.clip.ok".
        message: human-readable one-liner.
        subject_type: optional, e.g. "job", "video", "script".
        subject_id: optional UUID of that subject.
        details: optional JSON-serialisable payload (tracebacks, etc).
    """
    try:
        sb.table("execution_events").insert(build_event_row(
            actor=actor, level=level, event=event, message=message,
            subject_type=subject_type, subject_id=subject_id, details=details,
        )).execute()
    except Exception as e:  # pragma: no cover — logging must never fail the caller
        # Stay silent in the normal path; surface when debugging.
        print(f"[events] log_event failed (swallowed): {type(e).__name__}: {e}")
