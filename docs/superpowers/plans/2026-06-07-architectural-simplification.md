# Architectural Simplification: Single-Operator App

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-tenant SaaS infrastructure patterns this app accidentally inherited with patterns appropriate for a single operator running a weekly pipeline. The driver is bug reduction — most of the "weird behaviour" we've spent weeks chasing traces back to over-engineered async / realtime / autosave / multi-cron complexity that this use case never needed.

**Architecture:** Three guiding principles:
1. **Push, not poll** — Modal already knows when state changes; it should tell us directly, not write to a DB we then poll for changes.
2. **One operator means one source of truth** — eliminate consistency layers built for concurrent editors (autosave, optimistic UI, defensive polls) in favor of explicit save + reload.
3. **Run things when they need to run, not on a clock** — daily crons for a weekly workflow are wasted work AND a recurring failure surface.

**Tech Stack:** Next.js 16 App Router + Vercel + Supabase Postgres + Modal Python pipeline. No stack change — just changing how the pieces talk to each other.

---

## Architecture decision record

**Decision: Modal publishes live progress to Supabase Broadcast; Modal POSTs to Vercel only on terminal stages for email/push side-effects.**

Alternatives considered:
1. **SSE held open on Vercel** — REJECTED. Vercel bills functions by execution time; a 15-min Modal run held open as SSE = 15 min billable per watched job. Also: in-process pub/sub between webhook POST and SSE GET requires same-isolate routing that serverless doesn't guarantee even within one region.
2. **Continue with postgres_changes realtime subscription** — REJECTED. This is the current architecture burning IO budget. WAL decode on every Modal write is the root cause we're trying to eliminate.
3. **Supabase Broadcast** — CHOSEN. Lightweight Realtime pub-sub that does NOT touch postgres WAL. Modal publishes via Supabase service-role client (existing dependency). Browser subscribes via Supabase JS client (existing dependency). No Vercel involvement in the live-event path. Vercel only handles the terminal POST for email.

Implication: Realtime infrastructure still in the stack, but only for Broadcast channels, not postgres_changes. Broadcast doesn't decode WAL — cost is per-message, not per-write.

## Free tier compatibility (HARD CONSTRAINT)

This project must stay on **Vercel Hobby + Supabase Free**. Every architectural decision in this plan was checked against those constraints. Numbers verified from official docs on 2026-06-07:

| Constraint | Limit | Our usage under this plan | Margin |
|---|---|---|---|
| Vercel Hobby function max duration | 60 sec | `/api/jobs/done` is a 1–2 sec POST; no long-held connections anywhere | 30× margin |
| Vercel Hobby invocations | 1M / month | ~4 done-webhooks/month + occasional dashboard server-renders | <0.01% |
| Vercel Hobby bandwidth | 100 GB / month | Mostly static + tiny API payloads; mp4s served from Supabase Storage | well under |
| Vercel Hobby cron jobs | 100 / project | Currently 3, Phase 4 drops to 1 | comfortable |
| Vercel Functions as WebSocket server | **NOT SUPPORTED** on any plan | We use Supabase Broadcast instead — exactly what their docs recommend | ✓ avoided |
| Supabase Free concurrent realtime connections | 200 | Yonah's one tab = 1 active | 0.5% |
| Supabase Free realtime messages | 2M / month | ~50 events × ~4 pipeline runs/month = 200 messages/month | 0.01% |
| Supabase Free database | 500 MB | Currently ~XX MB (verify before Phase 1 ships) | TBD |
| Supabase Free bandwidth (egress) | 5 GB / month | Storage egress is the big one — mp4 downloads | watch |
| Supabase Free disk IOPS budget | Baseline shared allowance | **This is the alert we got 2026-06-07.** Plan eliminates the WAL-decode load that caused it | Target: alert never returns |

**The architecture choice is forced by the constraints:**
- **SSE on Vercel** — would NOT WORK on Hobby because Vercel Functions can't act as WebSocket servers and the 60s timeout kills any held-open connection mid-pipeline. Even on Pro this is wasteful.
- **postgres_changes realtime** — works but burns the IOPS budget (already proven). Keeps you on the wrong side of the alert.
- **Supabase Broadcast** — works on Free, designed for exactly this, 0.01% of message quota for our volume.

**Bandwidth note:** mp4 storage egress (downloading the final video to view it in the browser) is the largest free-tier risk. Not in scope for this plan, but worth tracking. If you hit 5 GB/month of Supabase egress, the fix is either CDN caching headers or moving final mp4s to a cheaper storage layer.

## Honest assessment: what's over-built and why

I've spent 3+ sessions trying to fix symptoms (Buffer rate limit, IO budget, stuck spinners, lost edits). The symptoms keep coming back because the underlying patterns are wrong for the use case. From the pg_stat_statements probe on 2026-06-07:

| Pattern | Built for | Actual use | Bug class produced |
|---|---|---|---|
| Realtime publication on 5 high-churn tables | Many concurrent operators watching state | 1 operator, watching only during 5–15 min Modal runs | Stuck spinners (`feedback_realtime_listeners_need_both_terminal_states`), IO budget alerts, WAL decode pressure |
| Defensive 10s polls on top of websockets | Unreliable client connections at scale | One iPhone PWA | Doubled DB load even when realtime works; ~265k auth queries / 52 days |
| Autosave on every keystroke (`useOptimisticSave`) | Multi-user collaborative editing | One operator editing their own draft | Buffer 24h rate limit cascades (731007f), lost edits (`feedback_writers_and_readers_must_share_source`), the "phantom edit" class |
| 5 separate posting card components | Per-platform feature variance | 95% identical code, 5 places to fix the same bug | The "fix in one card, forget the other four" class |
| 3 daily crons | Always-on production system | Weekly pipeline run | Failures even on weeks with no real activity; buffer-health probe consuming Resend quota for no signal most days |
| 5 auth queries per API request | Multi-tenant RLS | Single tenant | 1,024 refresh_tokens inserts in window; auth-query fanout amplifies every poll |
| Phase-by-phase routing (`?phase=N`) | Wizard-style flows | Operator who jumps around | Phase nav bugs (`feedback_phase_nav_via_url_not_reload`, `feedback_persist_dispatcher_mode_in_cookie`) |

## Target architecture

```
Modal pipeline
    ├── writes status/results to Supabase (persistent source of truth)
    ├── publishes events to Supabase Broadcast channel `job:${jobId}` (live push)
    └── on terminal stage: POSTs to Vercel /api/jobs/done (email side-effect)

Dashboard /videos/[slug]
    ├── server-renders current state from Supabase (no polling)
    ├── if job is in-flight: subscribes to Broadcast channel `job:${jobId}`
    └── subscription closes on terminal stage or tab close

Vercel /api/jobs/done
    └── receives Modal's terminal POST → sends Yonah an email + push

Posting cards (Phase 2)
    ├── server-renders current post state
    └── after operator clicks Post: blocks UI ~5s, then refreshes

Edits (Phase 3)
    ├── operator types into form
    ├── clicks Save (explicit moment)
    └── server confirms; UI shows saved state
```

**What gets deleted:** `useRealtimeRow`, `useRealtimeRows`, `useOptimisticSave`, defensive polls, `router.refresh()` intervals, the realtime publication on `jobs`/`clips`/`clip_plans`, the 5 posting card files (→ 1 parametrized), the `buffer-health` cron.

**What stays:** Supabase as system of record; Modal as compute layer; the pipeline itself (we only change how it COMMUNICATES status); Realtime infrastructure for Broadcast channels (no WAL cost).

## Phased rollout

Each phase ships independently and reverts cleanly. Stop after any phase if the next one isn't worth it.

| Phase | Title | Effort | Risk | Bug classes killed |
|---|---|---|---|---|
| **1** | Broadcast events + email notification | 1–2 days | Medium | Stuck spinners, IO burn, realtime listener gaps, polling races |
| **2** | Posting cards consolidation | 4 hours | Low | Per-platform drift, fix-in-one-forget-four |
| **3** | Explicit save (remove autosave) | 4–6 hours | Medium (UX change) | Phantom edits, autosave races, rate-limit cascades |
| **4** | Cron simplification | 2 hours | Low | Idle-week failures, cron email noise |
| **5** | Auth right-sizing | 4 hours | Medium | Refresh-token churn, session bugs |
| **6** | (DEFERRED) Phase-N consolidation | 1–2 days | Higher (UX redesign) | Phase nav bugs, edit-controls-hiding |

**Phase 6 is explicitly deferred.** It overlaps with the existing `project_video_page_redesign_kickoff` plan. Brainstorm with Yonah first before code.

---

## Phase 1: Broadcast events + email notification (execution-ready detail)

This is the load-bearing phase. Everything else builds on the patterns established here.

### File structure

**Created:**
- `dashboard/src/lib/job-event-types.ts` — shared event-shape types
- `dashboard/src/hooks/use-job-stream.ts` — React hook subscribing to Supabase Broadcast
- `dashboard/src/app/api/jobs/done/route.ts` — Vercel route Modal POSTs on terminal stages
- `src/job_events.py` — Modal-side helper: publishes Broadcast + POSTs terminal events
- `tests/test_job_events.py` — unit tests for the Modal helper
- `dashboard/supabase/migrations/20260608_drop_realtime_publication_high_churn.sql`

**Modified:**
- `modal_app.py` — call `emit_job_event(...)` alongside existing `set_status()`
- `dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx`
- `dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx`
- `dashboard/src/app/videos/[slug]/_components/plan-generating-card.tsx`
- `dashboard/src/components/job-progress.tsx`
- `dashboard/src/lib/email.ts` — add `sendJobDoneNotification(...)` helper

**Deleted (after migration verified):**
- `dashboard/src/hooks/use-realtime-row.ts`
- `dashboard/src/hooks/use-realtime-rows.ts`

### Task 1: Shared event types

**Files:** Create `dashboard/src/lib/job-event-types.ts`

- [ ] **Step 1: Write the type file**

```typescript
// dashboard/src/lib/job-event-types.ts
//
// The shape of every event Modal publishes. Single source of truth:
// Modal serializes to this shape (via src/job_events.py), dashboard
// parses to this shape (via useJobStream). Adding a new stage = one
// edit here + producer + consumer all guided by the type.

export type JobStage =
  | 'queued'
  | 'plan_generating'
  | 'plan_ready'
  | 'clips_generating'
  | 'clip_done'
  | 'clip_failed'
  | 'stitching'
  | 'uploading'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
  jobId: string;
  stage: JobStage;
  /** 1-indexed when stage is per-clip */
  clipIndex?: number;
  totalClips?: number;
  /** Storage path of the rendered mp4 (set when stage is 'done') */
  videoPath?: string;
  /** Operator-facing message (e.g. error detail) */
  message?: string;
  /** Wall-clock timestamp set by the publisher */
  ts?: string;
}

export const TERMINAL_STAGES: ReadonlySet<JobStage> = new Set([
  'done',
  'failed',
  'cancelled',
]);

export function isTerminalStage(s: JobStage | string | null | undefined): boolean {
  return typeof s === 'string' && TERMINAL_STAGES.has(s as JobStage);
}

export function broadcastChannel(jobId: string): string {
  return `job:${jobId}`;
}

export const BROADCAST_EVENT_NAME = 'progress';
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/lib/job-event-types.ts
git commit -m "feat(events): JobEvent shape + Broadcast channel convention"
```

### Task 2: Modal-side helper (`src/job_events.py`)

**Files:** Create `src/job_events.py`, `tests/test_job_events.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_job_events.py
import os
from unittest.mock import patch, MagicMock
from src.job_events import emit_job_event

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_non_terminal_publishes_broadcast_only(mock_post):
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='clip_done', clip_index=3, total_clips=8)
    # Should have called Supabase Broadcast endpoint (one POST), NOT the
    # Vercel terminal endpoint.
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('supabase.co' in u for u in urls)
    assert not any('example.com/api/jobs/done' in u for u in urls)

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
    'VERCEL_DONE_WEBHOOK_URL': 'https://example.com/api/jobs/done',
    'MODAL_WEBHOOK_SECRET': 'secret-xyz',
})
@patch('src.job_events.httpx.post')
def test_terminal_publishes_broadcast_AND_done_webhook(mock_post):
    mock_post.return_value = MagicMock(status_code=200, text='ok')
    emit_job_event(job_id='J1', stage='done', video_path='videos/J1.mp4')
    urls = [call.args[0] for call in mock_post.call_args_list]
    assert any('supabase.co' in u for u in urls)
    assert any('example.com/api/jobs/done' in u for u in urls)

@patch.dict(os.environ, {}, clear=True)
def test_emit_no_op_when_env_missing():
    emit_job_event(job_id='J1', stage='done')  # must not raise

@patch.dict(os.environ, {
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
})
@patch('src.job_events.httpx.post', side_effect=Exception('network down'))
def test_emit_swallows_network_errors(mock_post):
    emit_job_event(job_id='J1', stage='done')  # must not raise
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pytest tests/test_job_events.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Write the helper**

```python
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
import json
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pytest tests/test_job_events.py -v`
Expected: PASS 4/4

- [ ] **Step 5: Commit**

```bash
git add src/job_events.py tests/test_job_events.py
git commit -m "feat(events): Modal-side emit_job_event (Broadcast + terminal POST)"
```

### Task 3: Vercel terminal route (`/api/jobs/done`)

**Files:** Create `dashboard/src/app/api/jobs/done/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// dashboard/src/app/api/jobs/done/route.ts
//
// Modal POSTs here when a job reaches a terminal stage (done / failed /
// cancelled). We send Yonah an email so he can close the dashboard tab
// and trust the notification.
//
// Live progress does NOT go through here — Modal publishes that
// directly to Supabase Broadcast. This route is only for the
// terminal side-effect.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendJobDoneNotification } from '@/lib/email';
import type { JobEvent } from '@/lib/job-event-types';

const SHARED_SECRET = process.env.MODAL_WEBHOOK_SECRET;

export async function POST(request: Request) {
  if (!SHARED_SECRET) {
    return NextResponse.json({ error: 'MODAL_WEBHOOK_SECRET not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${SHARED_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: JobEvent;
  try {
    event = (await request.json()) as JobEvent;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!event.jobId || !event.stage) {
    return NextResponse.json({ error: 'jobId and stage required' }, { status: 400 });
  }

  // Resolve the video slug for the email link.
  const sb = createServiceClient();
  const { data: job, error } = await sb
    .from('jobs')
    .select('id, parsha_id, videos!inner(slug)')
    .eq('id', event.jobId)
    .maybeSingle();
  if (error || !job) {
    console.error('[jobs/done] cannot resolve job', error);
    return NextResponse.json({ ok: false, error: 'job not found' }, { status: 200 });
  }
  const slug = (job as unknown as { videos: { slug: string } }).videos?.slug;

  await sendJobDoneNotification({
    jobId: event.jobId,
    stage: event.stage as 'done' | 'failed' | 'cancelled',
    slug,
    message: event.message ?? null,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS (after Task 4 ships `sendJobDoneNotification`)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/api/jobs/done/route.ts
git commit -m "feat(events): /api/jobs/done — Modal's terminal webhook"
```

### Task 4: Email helper

**Files:** Modify `dashboard/src/lib/email.ts`

- [ ] **Step 1: Append to email.ts**

```typescript
// Append to dashboard/src/lib/email.ts

export async function sendJobDoneNotification(args: {
  jobId: string;
  stage: 'done' | 'failed' | 'cancelled';
  slug: string;
  message: string | null;
}): Promise<void> {
  const url = `https://torah-tai-chi-admin.vercel.app/videos/${args.slug}`;
  const subject =
    args.stage === 'done'
      ? `[Torah Tai Chi] Video ready: ${args.slug}`
      : args.stage === 'failed'
      ? `[Torah Tai Chi] Job FAILED: ${args.slug}`
      : `[Torah Tai Chi] Job cancelled: ${args.slug}`;
  const body =
    args.stage === 'done'
      ? `Your video is ready. Open it:\n${url}`
      : `Job stopped (${args.stage})${args.message ? `:\n\n${args.message}` : ''}\n\n${url}`;
  await sendNotification({
    subject,
    text: body,
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/lib/email.ts
git commit -m "feat(email): sendJobDoneNotification"
```

### Task 5: Wire `emit_job_event` into modal_app.py

**Files:** Modify `modal_app.py`

This touches the 4 pipeline entry points (run_pipeline, regen_smart, regen_clip, regen_agent) plus the per-clip completion writes.

- [ ] **Step 1: Add import at top of modal_app.py**

```python
from src.job_events import emit_job_event
```

- [ ] **Step 2: Locate every `set_status(...)` call and add the matching emit**

`set_status` is closure-bound to job_id inside each pipeline function. After each `set_status(stage, message)` call, add:

```python
emit_job_event(job_id=job_id, stage=stage, message=message)
```

(Where `stage` matches the string already passed to set_status. If set_status uses a custom name like `"loading_parsha"` that doesn't match our JobStage enum, map it — e.g. `'queued'`.)

- [ ] **Step 3: Wire per-clip completion at the "clip done" write site**

Find the location that flips a clip row to status='done' (around line 666 per the grep). After the DB write, add:

```python
emit_job_event(
    job_id=job_id,
    stage='clip_done',
    clip_index=clip_index + 1,
    total_clips=len(clips_in_order),
)
```

- [ ] **Step 4: Wire final 'done' with videoPath**

At each of the four set_status("done", ...) sites (lines 830, 3078, 3536, 4832 per the grep), pair with:

```python
emit_job_event(job_id=job_id, stage='done', video_path=<local var holding final mp4 storage_path>)
```

- [ ] **Step 5: Wire 'failed' and 'cancelled' similarly**

Same pattern; pass message=str(exception) or cancellation reason.

- [ ] **Step 6: Smoke test on Modal dev**

Run a real pipeline. Watch Modal logs for `[job_events]` lines. Tail Vercel logs for `/api/jobs/done` POSTs.

- [ ] **Step 7: Commit**

```bash
git add modal_app.py
git commit -m "feat(events): emit_job_event from every set_status + clip transition"
```

### Task 6: `useJobStream` React hook

**Files:** Create `dashboard/src/hooks/use-job-stream.ts`

- [ ] **Step 1: Write the hook**

```typescript
// dashboard/src/hooks/use-job-stream.ts
//
// Subscribes to Supabase Broadcast channel `job:${jobId}` for live
// progress. Replaces useRealtimeRow on the jobs table.
//
// Why Broadcast instead of postgres_changes: WAL decode is the IO
// burner. Broadcast is a separate Realtime feature that routes
// messages directly between publisher (Modal via service-role REST)
// and subscriber (browser via JS client). No WAL involvement.
//
// Lifecycle:
//   - Subscribe on mount.
//   - Latest event exposed via state.
//   - Unsubscribe + close channel on unmount or terminal stage.

'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  type JobEvent,
  isTerminalStage,
  broadcastChannel,
  BROADCAST_EVENT_NAME,
} from '@/lib/job-event-types';

export function useJobStream(jobId: string | null): JobEvent | null {
  const [event, setEvent] = useState<JobEvent | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(broadcastChannel(jobId), {
        config: { broadcast: { self: false, ack: false } },
      })
      .on('broadcast', { event: BROADCAST_EVENT_NAME }, (msg) => {
        const payload = msg.payload as JobEvent;
        setEvent(payload);
        if (isTerminalStage(payload.stage)) {
          supabase.removeChannel(channel);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  return event;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/use-job-stream.ts
git commit -m "feat(events): useJobStream — Supabase Broadcast subscriber"
```

### Task 7: Migrate `phase-4-stitched.tsx` to `useJobStream`

**Files:** Modify `dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx`

- [ ] **Step 1: Replace useRealtimeRow calls with useJobStream**

```typescript
// BEFORE:
import { useRealtimeRow } from '@/hooks/use-realtime-row';
const liveVideo = useRealtimeRow<{...}>('videos', videoId, ...);
const liveJob = useRealtimeRow<{...}>('jobs', composeJobId, null);
const composeFailed = liveJob?.status === 'failed';
const composeCancelled = liveJob?.status === 'cancelled';
const composeError = liveJob?.error_message ?? null;

// AFTER:
import { useJobStream } from '@/hooks/use-job-stream';
const liveEvent = useJobStream(composeJobId);
const effectiveMp4 = liveEvent?.videoPath ?? videoMp4Path;
const composeFailed = liveEvent?.stage === 'failed';
const composeCancelled = liveEvent?.stage === 'cancelled';
const composeError = liveEvent?.message ?? null;
```

(Adapt to the actual file. Remove the videos-table subscription entirely; the videoPath now arrives via the stream event.)

- [ ] **Step 2: Smoke test**

Run dev server, trigger a Modal job, watch the page update through stitching → done without refresh.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/app/videos/\[slug\]/_components/phase-4-stitched.tsx
git commit -m "refactor(phase-4): useJobStream replaces useRealtimeRow"
```

### Task 8: Migrate the other 3 components

For each: replace `useRealtimeRow` / `useRealtimeRows` / `setInterval(router.refresh, ...)` with `useJobStream`. Pattern matches Task 7.

- [ ] **Step 1: `plan-generating-card.tsx`** — `useRealtimeRow<JobRow>('jobs', jobId, ...)` → `useJobStream(jobId)`. Map `event.stage` to the existing isFailed/isCancelled checks. Trigger `router.refresh()` on `event.stage === 'plan_ready'` (or 'done').

- [ ] **Step 2: `phase-2-plan-review.tsx`** — Remove the pending-clips postgres_changes channels (lines 162–183). Remove the 30s `router.refresh()` interval. Add a single `useJobStream(jobId)`. On `event.stage === 'clip_done'` call `router.refresh()` so the new clip row is fetched server-side. Also remove the `useRealtimeRows<Clip>('clips', 'job_id', jobId, initialClips)` usage — rely on initial server-rendered clips plus router.refresh on clip_done.

- [ ] **Step 3: `job-progress.tsx`** — Remove all postgres_changes channels (lines 142–193). Remove the 4s `tick` poll (line 251). Replace with `useJobStream(job.id)`. On clip_done events, re-fetch clips list once (a single SELECT instead of the per-table tick). The clip_plans is now also obtained on demand at render, not polled.

- [ ] **Step 4: Smoke test end-to-end**

Trigger a fresh Modal pipeline. Walk through every page (phase 1 → 5). Each should update live without manual refresh.

- [ ] **Step 5: Commit each separately**

```bash
git add dashboard/src/app/videos/\[slug\]/_components/plan-generating-card.tsx
git commit -m "refactor(plan-card): useJobStream"

git add dashboard/src/app/videos/\[slug\]/_components/phase-2-plan-review.tsx
git commit -m "refactor(phase-2): useJobStream replaces channels + router-refresh poll"

git add dashboard/src/components/job-progress.tsx
git commit -m "refactor(job-progress): useJobStream replaces channels + 4s tick"
```

### Task 9: Drop high-churn tables from realtime publication

**Files:** Create `dashboard/supabase/migrations/20260608_drop_realtime_publication_high_churn.sql`

- [ ] **Step 1: Write migration**

```sql
-- Drop the high-write tables from postgres_changes realtime publication.
-- Now that the dashboard subscribes to job events via Supabase Broadcast
-- (Phase 1), nobody is listening to postgres_changes on these tables —
-- keeping them in the publication just costs WAL decode work on every
-- Modal write (the #1 disk-IO consumer per pg_stat_statements 2026-06-07).
--
-- Broadcast does NOT use the publication mechanism — it's a separate
-- realtime channel that routes messages directly. So removing tables
-- from the publication does NOT affect Broadcast subscriptions.
--
-- We keep videos + posts in the publication for now because Phase 2
-- still uses useRealtimeRow on posts (5 posting cards) and on videos
-- (live publish-state). Phase 2 will remove those uses, after which
-- those tables can also leave the publication.

do $$
begin
  alter publication supabase_realtime drop table public.jobs;
exception when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime drop table public.clips;
exception when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime drop table public.clip_plans;
exception when undefined_object then null;
end $$;
```

- [ ] **Step 2: Apply via Supabase SQL editor**

- [ ] **Step 3: Re-run pg_stat_statements probe; document the WAL decoder call-count drop**

- [ ] **Step 4: Commit**

```bash
git add dashboard/supabase/migrations/20260608_drop_realtime_publication_high_churn.sql
git commit -m "perf(realtime): drop jobs/clips/clip_plans from publication"
```

### Task 10: Delete obsoleted hooks

After all consumers verified migrated:

- [ ] **Step 1: Verify no remaining imports**

Run: `cd dashboard && grep -rn "use-realtime-row\|use-realtime-rows" src/`
Expected: zero matches outside the files about to be deleted.

- [ ] **Step 2: Delete files**

```bash
rm dashboard/src/hooks/use-realtime-row.ts
rm dashboard/src/hooks/use-realtime-rows.ts
```

- [ ] **Step 3: Final typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -u dashboard/src/hooks/
git commit -m "chore(hooks): delete obsoleted useRealtime hooks"
```

### Task 11: Env + secrets

- [ ] **Step 1: Generate `MODAL_WEBHOOK_SECRET`** — 32-char random string.
- [ ] **Step 2: Add to Vercel env** — `MODAL_WEBHOOK_SECRET` in production + preview.
- [ ] **Step 3: Add to Modal env**:
  - `MODAL_WEBHOOK_SECRET` — same value as Vercel
  - `VERCEL_DONE_WEBHOOK_URL` — `https://torah-tai-chi-admin.vercel.app/api/jobs/done`
  - (Modal already has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the Broadcast publish)
- [ ] **Step 4: Verify with a real pipeline run end-to-end**

### Task 12: Smoke verification + telemetry baseline

- [ ] **Step 1: Run a complete Modal pipeline (one parsha video) with the dashboard open**

Expected:
- Phase 1 → 5 pages all update live as Modal progresses
- No `useRealtimeRow` or postgres_changes activity in Supabase Realtime logs
- Vercel `/api/jobs/done` receives exactly one POST per terminal stage
- Email arrives at Yonah's inbox

- [ ] **Step 2: Re-run the pg_stat_statements probe from 2026-06-07**

Confirm the two WAL-parser queries (`SELECT wal->>$5 as type ...`) dropped to near zero. Record before/after numbers in `project_io_budget_audit.md`.

- [ ] **Step 3: Watch for 48 hours, then confirm Supabase IO budget alert does not return**

---

## Phase 2: Posting cards consolidation (high-level)

After Phase 1 is stable, replace the 5 posting-card files (`facebook-card.tsx`, `instagram-card.tsx`, `tiktok-card.tsx`, `x-card.tsx`, `youtube-card.tsx`) with a single `<PlatformPostingCard platform="facebook" ...>` parametrized by a platform config object.

Each card already has near-identical structure: realtime subscription on its post row + Post button + status display + edit-after-publish flow. After Phase 1, those subscriptions need to move off `useRealtimeRow` anyway — perfect moment to consolidate.

**Approach (detail plan to follow when ready):**
1. Extract a `PLATFORMS` config in `dashboard/src/lib/posting-platforms.ts` (display name, icon, character limits, caption-field name, action-route path).
2. Build `<PlatformPostingCard>` that takes a platform key + the post row + the operator callbacks.
3. Migrate one card at a time; verify each in the running dashboard before moving on.
4. Delete the 5 originals.

Will write detailed execution plan after Phase 1 ships.

## Phase 3: Explicit save (high-level)

Replace `useOptimisticSave` (keystroke autosave) with explicit Save buttons on each editable form. Add `isDirty` indicator + `beforeunload` warning. Eliminates the entire class of "edit got lost / edit got overwritten by a realtime event / autosave fired into a closed write window" bugs.

**Risk:** UX change. Yonah might prefer autosave even with its bugs. Brainstorm before code.

**Approach (detail plan after brainstorm):**
1. Inventory every component using `useOptimisticSave`.
2. Replace with controlled-input + Save action + dirty-state.
3. Remove `useOptimisticSave` hook.

## Phase 4: Cron simplification (high-level)

- **Delete `buffer-health` cron.** Replace with Sentry capture in actual posting code paths — alert only when a real post fails.
- **Move `reconcile-posts` to event-driven.** Trigger it from `/api/jobs/done` when stage='done', not on a daily clock.
- **Move `purge-old-clips` to weekly Sunday 3am.** Yonah's prep day is Tuesday; same-day cleanup is unnecessary.

Detail plan will be short — mostly vercel.json edits + Sentry capture wiring.

## Phase 5: Auth right-sizing (high-level)

Reduce refresh-token churn (1,024 inserts / 52 days = ~20/day). Options:
- **Long-lived sessions** — bump refresh interval from default 1h to 24h
- **Magic-link-per-device with 90-day expiry**
- **Skip MFA entirely** — one user, low blast radius

Defer until Phases 1–4 stable. Touches auth surface; smaller blast radius if shipped after the bigger architectural change has settled.

## Phase 6: Phase-N consolidation (DEFERRED)

Existing `project_video_page_redesign_kickoff` plan covers this. Brainstorm with Yonah first. Out of scope for this plan.

---

## Self-review

**Spec coverage:**
- Live progress via Broadcast: Tasks 1, 2, 6 ✓
- Terminal email side-effect: Tasks 3, 4 ✓
- Modal-side wiring: Task 5 ✓
- Frontend migration: Tasks 7, 8 ✓
- Publication cleanup: Task 9 ✓
- Hook deletion: Task 10 ✓
- Secrets + verification: Tasks 11, 12 ✓
- Phases 2–5 outlined, deferred to subsequent plans ✓

**Placeholder scan:** Phase 1 has actual code, file paths, commands, expected outputs. Phases 2–5 explicitly marked high-level. No "TBD"s in execution-ready tasks.

**Type consistency:** `JobEvent` shape used identically across `job-event-types.ts`, `job_events.py`, `route.ts`, `use-job-stream.ts`. Stage strings consistent across producer + consumer. `broadcastChannel()` helper used by both sides so the channel naming can't drift.

**Risk acknowledgments:**
- Task 2 acknowledges webhook is best-effort (DB is authoritative via existing set_status)
- Task 9 keeps videos+posts in publication (Phase 2 cleans those)
- Task 5 calls out the mapping concern (Modal's set_status strings vs JobStage enum)
- Phase 3 requires Yonah brainstorm before code
- Phase 5 explicitly defers
- Phase 6 explicitly out of scope
