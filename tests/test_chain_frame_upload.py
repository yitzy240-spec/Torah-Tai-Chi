"""Chain frames upload under unique Kie names and are read back before use
(Noach 2026-10-13: chained clip 1 opened on a different shot; every chain
frame used to share firstframe_{index:02d}.png across all jobs)."""
import json
from pathlib import Path

import pytest
import respx
from httpx import Response

from src.chain_frame import unique_frame_name, upload_chain_frame, url_serves_bytes
from src.kie_client import KieClient

UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload"


def _png(tmp_path: Path) -> Path:
    p = tmp_path / "firstframe_01.png"
    p.write_bytes(b"\x89PNG-chain-frame-bytes")
    return p


def _ok(url: str) -> Response:
    return Response(200, json={"success": True, "data": {"downloadUrl": url}})


def test_unique_frame_name_keeps_index_and_differs_per_call(tmp_path):
    p = _png(tmp_path)
    a, b = unique_frame_name(p), unique_frame_name(p)
    assert a != b
    assert a.startswith("firstframe_01_") and a.endswith(".png")


@pytest.mark.asyncio
async def test_upload_file_defaults_to_path_name_and_honors_file_name(tmp_path):
    p = _png(tmp_path)
    kie = KieClient(api_key="x")
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.post(UPLOAD).mock(return_value=_ok("https://f/x.png"))
        await kie.upload_file(p, remote_dir="d")
        await kie.upload_file(p, remote_dir="d", file_name="custom.png")
    names = [json.loads(c.request.content)["fileName"] for c in route.calls]
    assert names == ["firstframe_01.png", "custom.png"]


@pytest.mark.asyncio
async def test_two_uploads_of_same_path_use_different_names(tmp_path):
    p = _png(tmp_path)
    kie = KieClient(api_key="x")
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.post(UPLOAD).mock(
            side_effect=[_ok("https://f/a.png"), _ok("https://f/b.png")]
        )
        mock.get("https://f/a.png").mock(return_value=Response(200, content=p.read_bytes()))
        mock.get("https://f/b.png").mock(return_value=Response(200, content=p.read_bytes()))
        assert await upload_chain_frame(kie, p, "dir") == "https://f/a.png"
        assert await upload_chain_frame(kie, p, "dir") == "https://f/b.png"
    names = [json.loads(c.request.content)["fileName"] for c in route.calls]
    assert len(names) == 2 and names[0] != names[1]
    assert all(n.startswith("firstframe_01_") for n in names)


@pytest.mark.asyncio
async def test_mismatch_retries_once_with_fresh_name(tmp_path):
    p = _png(tmp_path)
    kie = KieClient(api_key="x")
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.post(UPLOAD).mock(
            side_effect=[_ok("https://f/stale.png"), _ok("https://f/good.png")]
        )
        mock.get("https://f/stale.png").mock(return_value=Response(200, content=b"OLD"))
        mock.get("https://f/good.png").mock(return_value=Response(200, content=p.read_bytes()))
        url = await upload_chain_frame(kie, p, "dir")
    assert url == "https://f/good.png"
    names = [json.loads(c.request.content)["fileName"] for c in route.calls]
    assert len(names) == 2 and names[0] != names[1]


@pytest.mark.asyncio
async def test_persistent_mismatch_still_returns_url(tmp_path, capsys):
    p = _png(tmp_path)
    kie = KieClient(api_key="x")
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.post(UPLOAD).mock(
            side_effect=[_ok("https://f/a.png"), _ok("https://f/b.png")]
        )
        mock.get("https://f/a.png").mock(return_value=Response(404))
        mock.get("https://f/b.png").mock(return_value=Response(200, content=b"nope"))
        url = await upload_chain_frame(kie, p, "dir")
    assert url == "https://f/b.png"
    assert route.call_count == 2  # exactly one retry
    assert "unverified" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_url_serves_bytes_error_is_false():
    import httpx
    async with respx.mock(assert_all_called=False) as mock:
        mock.get("https://f/x.png").mock(side_effect=httpx.ConnectError("down"))
        assert await url_serves_bytes("https://f/x.png", b"abc") is False
