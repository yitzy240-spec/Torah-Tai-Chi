from __future__ import annotations
import asyncio
import json
import time
from pathlib import Path
from typing import Any
import httpx


class KieTaskFailed(Exception):
    pass


class KieClient:
    CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask"
    RECORD_URL = "https://api.kie.ai/api/v1/jobs/recordInfo"
    CREDIT_URL = "https://api.kie.ai/api/v1/chat/credit"

    # poll_timeout_s: 1800 -> 3000 on 2026-08-24. Kie's queue completed a
    # Ki Tavo clip in 34 minutes — 4 minutes past the old 30-min window —
    # so we abandoned (and Kie billed) a render that finished fine. 50 min
    # still leaves ~10 min of the clips job's 60-min Modal budget for
    # download/upload/stitch. If a render outruns even this, the Kie task
    # id is in the job's error message and the asset is recoverable via
    # recordInfo — do NOT re-render immediately.
    def __init__(self, api_key: str, timeout_s: int = 60,
                 poll_interval_s: float = 5.0, poll_timeout_s: int = 3000):
        self._key = api_key
        self._timeout = timeout_s
        self._poll_interval = poll_interval_s
        self._poll_timeout = poll_timeout_s

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json"}

    async def get_credits(self, timeout_s: float = 10.0) -> float:
        """Return the account's remaining Kie credits. Raises on any failure.

        Same endpoint the dashboard's /api/kie-balance proxies. Observed
        shape (Apr 2026): {"code": 200, "msg": "success", "data": 1226.98}
        — `data` is a bare number; nested credits/balance variants are
        accepted in case Kie changes it. No retries: callers use this for a
        best-effort pre-flight and must proceed if it fails.
        """
        async with httpx.AsyncClient(timeout=timeout_s) as c:
            r = await c.get(self.CREDIT_URL, headers=self._headers())
            r.raise_for_status()
            data = r.json()
        if data.get("code") not in (None, 200):
            raise RuntimeError(f"credit endpoint error: {data}")
        d = data.get("data")
        for v in (d,
                  d.get("credits") if isinstance(d, dict) else None,
                  d.get("balance") if isinstance(d, dict) else None,
                  data.get("credits"), data.get("balance")):
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return float(v)
        raise RuntimeError(f"credit endpoint returned no balance: {data}")

    async def create_task(self, model: str, input_payload: dict[str, Any]) -> str:
        """Create a Kie.ai task. Retries:
          - Transient network errors / Kie 5xx: 3 attempts with 1s/2s/4s backoff.
          - 'Credits insufficient' (auto-top-off gives us credits a few minutes
            after exhaustion): 3 attempts with 60s/120s/180s backoff.
        """
        FAST_MAX = 3
        CREDITS_MAX = 3
        CREDITS_BACKOFFS = (60, 120, 180)
        fast_attempt = 0
        credits_attempt = 0
        last_transient: Exception | None = None
        while True:
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as c:
                    r = await c.post(self.CREATE_URL, headers=self._headers(),
                                     json={"model": model, "input": input_payload})
                    if r.status_code >= 500:
                        raise httpx.HTTPStatusError(
                            f"Kie 5xx: {r.status_code}", request=r.request, response=r,
                        )
                    r.raise_for_status()
                    data = r.json()
                if data.get("code") != 200:
                    msg = str(data.get("msg") or "")
                    if "insufficient" in msg.lower():
                        if credits_attempt >= CREDITS_MAX:
                            raise RuntimeError(
                                f"createTask error (credits exhausted after "
                                f"{CREDITS_MAX} long retries): {data}"
                            )
                        backoff = CREDITS_BACKOFFS[credits_attempt]
                        credits_attempt += 1
                        print(f"[kie_client] credits insufficient; waiting {backoff}s "
                              f"for auto-top-off (attempt {credits_attempt}/{CREDITS_MAX})")
                        await asyncio.sleep(backoff)
                        fast_attempt = 0  # reset fast-retry counter after each credits wait
                        continue
                    raise RuntimeError(f"createTask error: {data}")
                return data["data"]["taskId"]
            except (httpx.ConnectError, httpx.ReadError, httpx.ReadTimeout,
                    httpx.RemoteProtocolError, httpx.HTTPStatusError) as e:
                last_transient = e
                fast_attempt += 1
                if fast_attempt >= FAST_MAX:
                    raise
                backoff = 2 ** (fast_attempt - 1)  # 1s, 2s, 4s
                print(f"[kie_client] transient createTask error on attempt "
                      f"{fast_attempt}/{FAST_MAX}: {type(e).__name__}: {e}; "
                      f"retrying in {backoff}s")
                await asyncio.sleep(backoff)
        # Unreachable
        del last_transient

    async def poll_task(self, task_id: str) -> tuple[list[str], dict]:
        """Poll a Seedance task until terminal. Returns (urls, raw_data).

        raw_data is Kie's full task record so callers can extract cost
        and other metadata. Field names vary by endpoint — common
        candidates include credits_consumed, costCredits, cost — caller
        decides which to read.

        Retries transient errors (read/connect timeouts, HTTP 5xx/429,
        non-JSON/empty responses) with exponential backoff + jitter for
        the full poll window, so a temporary Kie API hiccup doesn't lose
        an already-billed render. Does NOT retry on definitive failure
        states (state="fail").
        """
        import random
        deadline = time.monotonic() + self._poll_timeout
        consecutive_failures = 0
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            while time.monotonic() < deadline:
                try:
                    r = await c.get(f"{self.RECORD_URL}?taskId={task_id}",
                                    headers=self._headers())
                    
                    # Retry on HTTP 5xx and 429 (rate limit)
                    if r.status_code >= 500 or r.status_code == 429:
                        raise httpx.HTTPStatusError(
                            f"Kie poll {r.status_code}: {r.text[:200]}",
                            request=r.request, response=r,
                        )
                    
                    r.raise_for_status()
                    
                    # Try to parse JSON; retry on malformed/empty response
                    try:
                        data = r.json()
                    except Exception as json_err:
                        raise RuntimeError(
                            f"Non-JSON response (len={len(r.content)}): "
                            f"{r.text[:200]}"
                        ) from json_err

                    d = data.get("data") if isinstance(data, dict) else None
                    if not d or not isinstance(d, dict):
                        raise RuntimeError(
                            f"Empty data in response: {data}"
                        )

                    state = d.get("state")

                    # Terminal success: extract results and return
                    if state == "success":
                        # A truncated/garbled resultJson on an already-billed
                        # success used to escape as JSONDecodeError (a
                        # ValueError, not caught below) and kill the poll.
                        # Treat it as transient: the next poll re-reads it.
                        rj = d.get("resultJson") or "{}"
                        try:
                            parsed = json.loads(rj) if isinstance(rj, str) else rj
                        except ValueError as rj_err:
                            raise RuntimeError(
                                f"unparseable resultJson: {str(rj)[:200]}"
                            ) from rj_err
                        if not isinstance(parsed, dict):
                            raise RuntimeError(f"resultJson not an object: {str(rj)[:200]}")
                        urls = parsed.get("resultUrls") or []
                        if not urls:
                            raise RuntimeError(f"success without urls: {d}")
                        # One-time per-task log of all top-level keys + numeric
                        # values so we can identify the cost field. Excludes
                        # heavy fields (resultJson is already parsed above).
                        cost_hint = {
                            k: v for k, v in d.items()
                            if k != "resultJson"
                            and isinstance(v, (int, float, str))
                            and not (isinstance(v, str) and len(v) > 80)
                        }
                        print(f"[kie_client] task {task_id} success meta={cost_hint}")
                        return urls, d
                    
                    # Terminal failure: raise immediately, no retry
                    if state == "fail":
                        raise KieTaskFailed(
                            f"{d.get('failCode')}: {d.get('failMsg')}"
                        )
                    
                    # Non-terminal state (waiting/running): reset failure count
                    # and continue polling
                    consecutive_failures = 0
                    await asyncio.sleep(self._poll_interval)
                
                # TransportError covers every network-level failure
                # (connect/read/write timeouts and errors, protocol and
                # proxy errors); HTTPStatusError is a separate branch.
                except (httpx.TransportError, httpx.HTTPStatusError,
                        RuntimeError) as e:
                    # Don't retry KieTaskFailed (definitive failure state)
                    if isinstance(e, KieTaskFailed):
                        raise
                    
                    consecutive_failures += 1
                    time_left = deadline - time.monotonic()
                    
                    # If we've run out of time, raise
                    if time_left <= 0:
                        raise TimeoutError(
                            f"poll timeout for task {task_id} after "
                            f"{consecutive_failures} consecutive failures"
                        ) from e
                    
                    # Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s
                    base_backoff = min(2 ** (consecutive_failures - 1), 60)
                    # Add jitter: ±25% of base_backoff
                    jitter = base_backoff * 0.25 * (2 * random.random() - 1)
                    backoff = max(1, base_backoff + jitter)
                    # Don't wait longer than time remaining
                    backoff = min(backoff, time_left)
                    
                    print(
                        f"[kie_client] poll transient error on task {task_id} "
                        f"(attempt {consecutive_failures}): "
                        f"{type(e).__name__}: {e}; retrying in {backoff:.1f}s "
                        f"(time_left={time_left:.1f}s)"
                    )
                    await asyncio.sleep(backoff)
        
        raise TimeoutError(f"poll timeout for task {task_id}")

    # Waits between download attempts; len + 1 = total attempts.
    DOWNLOAD_RETRY_WAITS_S: tuple[float, ...] = (2, 5, 15)

    async def download(self, url: str, dest: Path) -> None:
        """Fetch a finished render to `dest`, retrying transient failures.

        Runs AFTER Kie has billed the task, so a single CDN blip (timeout,
        5xx, empty body) used to fail the whole job and strand a paid clip.
        Any HTTP/transport error or empty body is retried; the file is
        written via a temp name so a partial body never looks complete.
        """
        dest = Path(dest)
        tmp = dest.with_name(dest.name + ".part")
        for attempt, wait_s in enumerate((*self.DOWNLOAD_RETRY_WAITS_S, None), start=1):
            try:
                async with httpx.AsyncClient(
                    timeout=self._timeout * 3, follow_redirects=True,
                ) as c:
                    r = await c.get(url)
                    r.raise_for_status()
                    body = r.content
                if not body:
                    raise RuntimeError(f"empty download body from {url}")
                tmp.write_bytes(body)
                tmp.replace(dest)
                return
            except (httpx.HTTPError, RuntimeError) as e:
                if wait_s is None:
                    raise
                print(
                    f"[kie_client] download attempt {attempt} failed "
                    f"({type(e).__name__}: {e}); retrying in {wait_s}s"
                )
                await asyncio.sleep(wait_s)

    async def upload_file(self, path: Path, remote_dir: str = "torah-tai-chi") -> str:
        """Upload via base64 endpoint, return downloadUrl.

        Retries transient 5xx from Kie's upload endpoint with 1s/2s/4s
        backoff, matching submit_task. Without this, a single 500 (which
        Kie returns sporadically — Yonah hit one mid-render on 2026-05-28)
        killed the entire clip render and forced the operator to manually
        retry from the UI. Idempotent endpoint: re-uploading the same
        bytes just returns a new downloadUrl, no duplicate-state risk.
        """
        import base64
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        mime = "image/png" if path.suffix == ".png" else "application/octet-stream"
        payload = {
            "base64Data": f"data:{mime};base64,{b64}",
            "uploadPath": remote_dir,
            "fileName": path.name,
        }
        url = "https://kieai.redpandaai.co/api/file-base64-upload"
        last_err: Exception | None = None
        for attempt in range(1, 4):  # 3 total attempts
            try:
                async with httpx.AsyncClient(timeout=self._timeout * 2) as c:
                    r = await c.post(url, headers=self._headers(), json=payload)
                    # Retry on 5xx; surface 4xx immediately (bad payload, auth, etc.).
                    if r.status_code >= 500:
                        raise httpx.HTTPStatusError(
                            f"Kie upload {r.status_code}: {r.text[:200]}",
                            request=r.request,
                            response=r,
                        )
                    r.raise_for_status()
                    data = r.json()
                    if not data.get("success"):
                        raise RuntimeError(f"upload failed: {data}")
                    return data["data"]["downloadUrl"]
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                last_err = e
                if attempt == 3:
                    break
                backoff = 2 ** (attempt - 1)  # 1s, 2s, 4s
                print(
                    f"[kie_client] upload_file 5xx/network on attempt {attempt}/3 "
                    f"({path.name}); retrying in {backoff}s — {e}"
                )
                await asyncio.sleep(backoff)
        raise last_err if last_err else RuntimeError("upload_file: unreachable")
