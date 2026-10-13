import pytest
import respx
from httpx import Response
from src.kie_client import KieClient, KieTaskFailed


@pytest.mark.asyncio
async def test_create_task_returns_task_id():
    pytest.importorskip("respx")
    async with respx.mock(assert_all_called=False) as mock:
        mock.post("https://api.kie.ai/api/v1/jobs/createTask").mock(
            return_value=Response(200, json={"code": 200, "data": {"taskId": "t-123"}})
        )
        client = KieClient(api_key="k", timeout_s=5)
        tid = await client.create_task(model="seedance-2-0", input_payload={"prompt": "hi"})
        assert tid == "t-123"


@pytest.mark.asyncio
async def test_poll_until_success_returns_result_urls():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r"https://api\.kie\.ai/api/v1/jobs/recordInfo\?taskId=t-1").mock(
            side_effect=[
                Response(200, json={"code": 200, "data": {"state": "waiting"}}),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/v.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0)
        urls, meta = await client.poll_task("t-1")
        assert urls == ["https://cdn/v.mp4"]
        # poll_task now also returns Kie's full task dict so callers can
        # extract real cost (credits_consumed / costCredits / etc).
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_raises_on_fail_state():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*").mock(
            return_value=Response(200, json={"code": 200, "data": {
                "state": "fail", "failCode": "X", "failMsg": "bad prompt"
            }})
        )
        client = KieClient(api_key="k", poll_interval_s=0)
        with pytest.raises(KieTaskFailed):
            await client.poll_task("t-2")


@pytest.mark.asyncio
async def test_poll_retries_on_read_timeout():
    """Poll should retry ReadTimeout errors with backoff."""
    import httpx
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-retry").mock(
            side_effect=[
                httpx.ReadTimeout("timeout 1"),
                httpx.ReadTimeout("timeout 2"),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/retry.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, meta = await client.poll_task("t-retry")
        assert urls == ["https://cdn/retry.mp4"]
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_retries_on_5xx():
    """Poll should retry HTTP 5xx errors with backoff."""
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-5xx").mock(
            side_effect=[
                Response(500, text="Internal Server Error"),
                Response(503, text="Service Unavailable"),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/5xx.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, meta = await client.poll_task("t-5xx")
        assert urls == ["https://cdn/5xx.mp4"]
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_retries_on_429():
    """Poll should retry HTTP 429 (rate limit) errors."""
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-429").mock(
            side_effect=[
                Response(429, text="Too Many Requests"),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/429.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, meta = await client.poll_task("t-429")
        assert urls == ["https://cdn/429.mp4"]
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_retries_on_non_json_response():
    """Poll should retry when response is not valid JSON."""
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-json").mock(
            side_effect=[
                Response(200, text="<html>error page</html>"),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/json.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, meta = await client.poll_task("t-json")
        assert urls == ["https://cdn/json.mp4"]
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_retries_on_empty_data():
    """Poll should retry when response has empty data field."""
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-empty").mock(
            side_effect=[
                Response(200, json={"code": 200, "data": None}),
                Response(200, json={"code": 200}),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/empty.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, meta = await client.poll_task("t-empty")
        assert urls == ["https://cdn/empty.mp4"]
        assert meta["state"] == "success"


@pytest.mark.asyncio
async def test_poll_does_not_retry_terminal_failure():
    """Poll should NOT retry when task reaches definitive failure state."""
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-fail").mock(
            return_value=Response(200, json={"code": 200, "data": {
                "state": "fail", "failCode": "BAD_PROMPT", "failMsg": "Invalid prompt"
            }})
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        with pytest.raises(KieTaskFailed) as exc_info:
            await client.poll_task("t-fail")
        assert "BAD_PROMPT" in str(exc_info.value)
        assert "Invalid prompt" in str(exc_info.value)


@pytest.mark.asyncio
async def test_poll_timeout_after_retries():
    """Poll should timeout if all retries fail within the poll window."""
    import httpx
    async with respx.mock(assert_all_called=False) as mock:
        # Always return errors - should exhaust the poll timeout
        mock.get(url__regex=r".*recordInfo.*taskId=t-timeout").mock(
            side_effect=[httpx.ReadTimeout("timeout")] * 100
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=2)
        with pytest.raises(TimeoutError) as exc_info:
            await client.poll_task("t-timeout")
        assert "poll timeout" in str(exc_info.value)
        assert "t-timeout" in str(exc_info.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("exc_name", [
    "WriteTimeout", "LocalProtocolError", "ProxyError", "WriteError",
    "ConnectTimeout", "PoolTimeout",
])
async def test_poll_retries_every_transport_error(exc_name, monkeypatch):
    """Any httpx.TransportError mid-poll is transient: retry it rather than
    escape the poll and fail an already-billed render as not-saved."""
    import asyncio

    import httpx
    import src.kie_client as kc

    real_sleep = asyncio.sleep
    monkeypatch.setattr(kc.asyncio, "sleep", lambda s: real_sleep(0))
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-tx").mock(
            side_effect=[
                getattr(httpx, exc_name)("blip"),
                Response(200, json={"code": 200, "data": {
                    "state": "success",
                    "resultJson": '{"resultUrls": ["https://cdn/tx.mp4"]}'
                }}),
            ]
        )
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, _meta = await client.poll_task("t-tx")
        assert urls == ["https://cdn/tx.mp4"]
