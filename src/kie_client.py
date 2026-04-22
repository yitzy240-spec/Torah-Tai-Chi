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

    def __init__(self, api_key: str, timeout_s: int = 60,
                 poll_interval_s: float = 5.0, poll_timeout_s: int = 1800):
        self._key = api_key
        self._timeout = timeout_s
        self._poll_interval = poll_interval_s
        self._poll_timeout = poll_timeout_s

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json"}

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

    async def poll_task(self, task_id: str) -> list[str]:
        deadline = time.monotonic() + self._poll_timeout
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            while time.monotonic() < deadline:
                r = await c.get(f"{self.RECORD_URL}?taskId={task_id}",
                                headers=self._headers())
                r.raise_for_status()
                d = r.json().get("data") or {}
                state = d.get("state")
                if state == "success":
                    rj = d.get("resultJson") or "{}"
                    parsed = json.loads(rj) if isinstance(rj, str) else rj
                    urls = parsed.get("resultUrls") or []
                    if not urls:
                        raise RuntimeError(f"success without urls: {d}")
                    return urls
                if state == "fail":
                    raise KieTaskFailed(
                        f"{d.get('failCode')}: {d.get('failMsg')}"
                    )
                await asyncio.sleep(self._poll_interval)
        raise TimeoutError(f"poll timeout for task {task_id}")

    async def download(self, url: str, dest: Path) -> None:
        async with httpx.AsyncClient(timeout=self._timeout * 3) as c:
            r = await c.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)

    async def upload_file(self, path: Path, remote_dir: str = "torah-tai-chi") -> str:
        """Upload via base64 endpoint, return downloadUrl."""
        import base64
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        mime = "image/png" if path.suffix == ".png" else "application/octet-stream"
        payload = {
            "base64Data": f"data:{mime};base64,{b64}",
            "uploadPath": remote_dir,
            "fileName": path.name,
        }
        url = "https://kieai.redpandaai.co/api/file-base64-upload"
        async with httpx.AsyncClient(timeout=self._timeout * 2) as c:
            r = await c.post(url, headers=self._headers(), json=payload)
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"upload failed: {data}")
            return data["data"]["downloadUrl"]
