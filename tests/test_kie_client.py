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
        urls = await client.poll_task("t-1")
        assert urls == ["https://cdn/v.mp4"]


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
