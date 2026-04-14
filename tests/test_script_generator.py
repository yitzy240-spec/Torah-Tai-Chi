import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from src.script_generator import transform_draft_to_clip_plan, build_prompt
from src.models import ClipPlan


def test_build_prompt_includes_parsha_and_draft():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.\n[TEACHING]\nListen first.",
        target_duration=75, clip_count=8,
    )
    assert "Vayikra" in prompt
    assert "[HOOK]" in prompt
    assert "He called." in prompt
    assert "75" in prompt


@pytest.mark.asyncio
async def test_transform_draft_parses_claude_response():
    fake_json = {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "clips": [
            {"index": 0, "voiceover": "hi", "visual_prompt": "Rav Eli", "duration_s": 8}
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_json))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    plan = await transform_draft_to_clip_plan(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="modern", title="t",
        draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
        client=mock_client,
    )
    assert isinstance(plan, ClipPlan)
    assert plan.parsha == "Vayikra"
    assert plan.clips[0].duration_s == 8
