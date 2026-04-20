"""Execution-event logger for the Python pipeline.

Mirrors dashboard/src/lib/events.ts — writes to the `execution_events`
table using whatever Supabase client the caller already has. Never
raises: any failure is printed and swallowed so the main pipeline can't
be killed by diagnostics.
"""
from __future__ import annotations

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
        actor: who produced the event — must match the CHECK constraint.
        level: severity — info / warn / error / action.
        event: short snake-case code, e.g. "pipeline.clip.ok".
        message: human-readable one-liner.
        subject_type: optional, e.g. "job", "video", "script".
        subject_id: optional UUID of that subject.
        details: optional JSON-serialisable payload (tracebacks, etc).
    """
    try:
        sb.table("execution_events").insert({
            "actor": actor,
            "level": level,
            "event": event,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "message": message,
            "details": details,
        }).execute()
    except Exception as e:  # pragma: no cover — logging must never fail the caller
        # Stay silent in the normal path; surface when debugging.
        print(f"[events] log_event failed (swallowed): {type(e).__name__}: {e}")
