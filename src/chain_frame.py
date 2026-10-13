"""Upload a chain (first-frame) PNG to Kie under a unique name and verify it.

Noach 2026-10-13 (job 054f45a5, clip 1): the chain decision and the
Seedance request both said "chained, first frame sent", yet frame 0 of
the output was a different shot. Every chain frame used to go to the SAME
Kie path (torah-tai-chi-firstframes/firstframe_{index:02d}.png) for every
job and video, and Kie documents that a re-used name is overwritten but
"changes may not take effect immediately due to caching" (files are also
deleted 24h after upload). Seedance could be served a stale image for the
URL. Unique names remove the collision; the read-back check catches the
rest. Best-effort: verification never fails a render.
"""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

import httpx

VERIFY_TIMEOUT_S = 10.0


def unique_frame_name(png_path: Path) -> str:
    """firstframe_01.png -> firstframe_01_<32 hex>.png (index kept for debugging)."""
    stem = png_path.stem
    if stem.startswith("firstframe_"):
        stem = stem[len("firstframe_"):]
    return f"firstframe_{stem}_{uuid.uuid4().hex}.png"


async def url_serves_bytes(url: str, expected: bytes,
                           timeout: float = VERIFY_TIMEOUT_S) -> bool:
    """True iff GET url returns exactly `expected` (sha256). False on any error."""
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as c:
            r = await c.get(url)
            r.raise_for_status()
            return (
                hashlib.sha256(r.content).hexdigest()
                == hashlib.sha256(expected).hexdigest()
            )
    except Exception as e:
        print(f"[firstframe] verify GET failed for {url}: {type(e).__name__}: {e}")
        return False


async def upload_chain_frame(kie, png_path: Path, remote_dir: str) -> str:
    """Upload under a fresh unique name, read it back, retry once on mismatch.

    Returns the URL even if verification never passes (logged as a warning)
    so a flaky read-back can't block a render; the post-render seam check
    then reports whether Seedance honored the frame.
    """
    local = png_path.read_bytes()
    url = ""
    for attempt in (1, 2):
        url = await kie.upload_file(
            png_path, remote_dir=remote_dir,
            file_name=unique_frame_name(png_path),
        )
        if await url_serves_bytes(url, local):
            return url
        print(
            f"[firstframe] WARNING: uploaded {png_path.name} does not read "
            f"back identical from {url} (attempt {attempt}/2)"
        )
    print(
        f"[firstframe] WARNING: using unverified first-frame URL {url} "
        f"for {png_path.name}"
    )
    return url
