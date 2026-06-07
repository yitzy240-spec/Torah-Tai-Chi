# src/job_events.py
"""Publish job events to Supabase Broadcast + post terminal events to Vercel.

Two channels, one helper:

  - Live progress: published to Supabase Broadcast channel `job:{job_id}`.
    The dashboard's useJobStream hook subscribes and shows progress
    in real time. Free / per-message cost. Does NOT touch postgres WAL.

  - Terminal side-effects: on stage in {done, failed, cancelled}, ALSO
    POSTs to Vercel /api/jobs/done. That route sends Yonah an email so
    he can close the dashboard tab and trust the notification.

Never raises. Webhook delivery is best-effort — the DB write done by
modal_app's set_status() is the source of truth. This is the push
notification layer on top.
"""
from __future__ import annotations

import datetime
import os
from typing import Optional

import httpx

_TIMEOUT = httpx.Timeout(connect=3.0, read=3.0, write=3.0, pool=3.0)

TERMINAL_STAGES = {'done', 'failed', 'cancelled'}


def emit_job_event(
    *,
    job_id: str,
    stage: str,
    clip_index: Optional[int] = None,
    total_clips: Optional[int] = None,
    video_path: Optional[str] = None,
    message: Optional[str] = None,
) -> None:
    """Publish to Broadcast; on terminal stages also POST to Vercel.

    Never raises. Best-effort.
    """
    event: dict[str, object] = {
        'jobId': job_id,
        'stage': stage,
        'ts': datetime.datetime.now(datetime.UTC).isoformat(),
    }
    if clip_index is not None:
        event['clipIndex'] = clip_index
    if total_clips is not None:
        event['totalClips'] = total_clips
    if video_path is not None:
        event['videoPath'] = video_path
    if message is not None:
        event['message'] = message

    _publish_broadcast(job_id, event)

    if stage in TERMINAL_STAGES:
        _post_done_webhook(event)


def _publish_broadcast(job_id: str, event: dict[str, object]) -> None:
    supabase_url = os.environ.get('SUPABASE_URL')
    service_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not supabase_url or not service_key:
        return
    # Supabase Realtime Broadcast REST endpoint:
    # POST {SUPABASE_URL}/realtime/v1/api/broadcast
    # body: { messages: [{ topic, event, payload }] }
    url = f'{supabase_url.rstrip("/")}/realtime/v1/api/broadcast'
    body = {
        'messages': [
            {
                'topic': f'job:{job_id}',
                'event': 'progress',
                'payload': event,
            }
        ]
    }
    try:
        httpx.post(
            url,
            json=body,
            headers={
                'Authorization': f'Bearer {service_key}',
                'apikey': service_key,
                'Content-Type': 'application/json',
            },
            timeout=_TIMEOUT,
        )
    except Exception as e:
        print(f'[job_events] broadcast failed (swallowed): {type(e).__name__}: {e}')


def _post_done_webhook(event: dict[str, object]) -> None:
    # Only email when a terminal 'done' actually has a videoPath. This:
    #   - suppresses the duplicate that fires when set_status('done', ...) is
    #     immediately followed by an explicit emit_job_event(..., video_path=...)
    #     in main pipelines
    #   - suppresses spurious "Video ready" emails for plan-only / clips-only
    #     completions where no video exists
    # 'failed' and 'cancelled' always email regardless of videoPath since
    # the operator must be told about pipeline failures.
    if event.get('stage') == 'done' and event.get('videoPath') is None:
        return
    url = os.environ.get('VERCEL_DONE_WEBHOOK_URL')
    secret = os.environ.get('MODAL_WEBHOOK_SECRET')
    if not url or not secret:
        return
    try:
        httpx.post(
            url,
            json=event,
            headers={'Authorization': f'Bearer {secret}'},
            timeout=_TIMEOUT,
        )
    except Exception as e:
        print(f'[job_events] done-webhook failed (swallowed): {type(e).__name__}: {e}')
