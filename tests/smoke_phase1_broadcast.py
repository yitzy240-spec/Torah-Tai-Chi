"""Smoke test: Modal → Supabase Broadcast → browser round trip.

What this tests:
  - emit_job_event publishes to Broadcast successfully (same code path Modal uses)
  - A WebSocket subscriber receives those events on the per-job channel
  - The wire format matches what useJobStream expects

What this does NOT test:
  - The Vercel /api/jobs/done route (needs the route on production; until PR
    merges, that lives only on the preview which is auth-walled). Verify
    that path on the first real Modal run after merge — Resend integration
    is unchanged from prior working code.

Usage:
  python tests/smoke_phase1_broadcast.py
"""
import asyncio
import json
import os
import secrets
import sys
import time
from urllib.parse import urlparse

from dotenv import load_dotenv

# Load root .env which has SUPABASE_SERVICE_ROLE_KEY. SUPABASE_URL is hard-
# coded from project memory (jswdfthmegjbhnwbgeca).
load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL') or 'https://jswdfthmegjbhnwbgeca.supabase.co'
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not SUPABASE_SERVICE_ROLE_KEY:
    print('FAIL: SUPABASE_SERVICE_ROLE_KEY not set in env')
    sys.exit(1)

# Wire emit_job_event using the same code Modal runs in production. The env
# vars below are what Modal's secret injects; we set them locally so the
# same module behaves identically.
os.environ['SUPABASE_URL'] = SUPABASE_URL
# Skip the terminal POST to Vercel — that endpoint isn't deployed to
# production main yet. Leaving VERCEL_DONE_WEBHOOK_URL unset makes
# _post_done_webhook a no-op (verified by test_emit_no_op_when_env_missing).
os.environ.pop('VERCEL_DONE_WEBHOOK_URL', None)
os.environ.pop('MODAL_WEBHOOK_SECRET', None)

# Now import — module-level _TIMEOUT etc. is captured at import time.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.job_events import emit_job_event

SUPABASE_HOST = urlparse(SUPABASE_URL).netloc
WS_URL = f'wss://{SUPABASE_HOST}/realtime/v1/websocket?apikey={SUPABASE_SERVICE_ROLE_KEY}&vsn=1.0.0'

# Unique per run — no risk of cross-talk if multiple smokes run.
SMOKE_JOB_ID = f'smoke-{secrets.token_hex(4)}'
CHANNEL = f'job:{SMOKE_JOB_ID}'
EVENT_NAME = 'progress'

EXPECTED_STAGES = ['queued', 'generating_plan', 'done']


async def subscribe_and_listen(received_events: list, ready_event: asyncio.Event):
    import websockets

    async with websockets.connect(WS_URL) as ws:
        # Join the per-job topic. Realtime protocol: send phx_join, wait
        # for phx_reply ok, then any broadcast on that topic arrives as a
        # message with event='broadcast'.
        await ws.send(json.dumps({
            'topic': f'realtime:{CHANNEL}',
            'event': 'phx_join',
            'payload': {'config': {'broadcast': {'self': True}}},
            'ref': '1',
        }))

        # Wait for join confirmation before signaling ready.
        join_confirmed = False
        deadline = time.time() + 5
        while not join_confirmed and time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                msg = json.loads(raw)
                if msg.get('event') == 'phx_reply' and msg.get('payload', {}).get('status') == 'ok':
                    join_confirmed = True
                    ready_event.set()
            except asyncio.TimeoutError:
                continue

        if not join_confirmed:
            print('FAIL: join was not confirmed within 5s')
            return

        # Now listen for actual broadcasts up to 8s after publish starts.
        listen_deadline = time.time() + 12
        while len(received_events) < len(EXPECTED_STAGES) and time.time() < listen_deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                msg = json.loads(raw)
                if msg.get('event') == 'broadcast':
                    payload = msg.get('payload', {})
                    inner = payload.get('payload') or payload  # Supabase wraps it once
                    received_events.append(inner)
            except asyncio.TimeoutError:
                continue


async def publish_events(ready_event: asyncio.Event):
    # Wait until subscriber confirms it's joined.
    await asyncio.wait_for(ready_event.wait(), timeout=10)
    # Small extra delay — give the WS connection a moment to be fully
    # ready to receive after phx_reply ok.
    await asyncio.sleep(0.3)
    for stage in EXPECTED_STAGES:
        emit_job_event(
            job_id=SMOKE_JOB_ID,
            stage=stage,
            message=f'smoke {stage}',
            video_path='smoke/dummy.mp4' if stage == 'done' else None,
        )
        # Tiny pause so events arrive in distinct ws frames.
        await asyncio.sleep(0.1)


async def main():
    received = []
    ready = asyncio.Event()

    sub_task = asyncio.create_task(subscribe_and_listen(received, ready))
    pub_task = asyncio.create_task(publish_events(ready))

    await asyncio.gather(sub_task, pub_task, return_exceptions=True)

    print(f'\nChannel: {CHANNEL}')
    print(f'Expected stages: {EXPECTED_STAGES}')
    print(f'Received {len(received)} events:')
    for i, e in enumerate(received):
        print(f'  {i+1}. stage={e.get("stage")!r} message={e.get("message")!r} videoPath={e.get("videoPath")!r}')

    received_stages = [e.get('stage') for e in received]
    if received_stages == EXPECTED_STAGES:
        print('\nPASS: round trip works — Modal-side publish reached a Broadcast subscriber.')
        return 0
    else:
        print(f'\nFAIL: expected stages {EXPECTED_STAGES}, got {received_stages}')
        return 1


if __name__ == '__main__':
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
