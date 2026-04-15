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
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.post(self.CREATE_URL, headers=self._headers(),
                             json={"model": model, "input": input_payload})
            r.raise_for_status()
            data = r.json()
            if data.get("code") != 200:
                raise RuntimeError(f"createTask error: {data}")
            return data["data"]["taskId"]

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
