import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from src.script_generator import transform_draft_to_clip_plan, build_prompt
from src.models import ClipPlan


def test_build_prompt_includes_archetypes_and_guardrails():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.\n[TEACHING]\nListen first.",
    )
    assert "Vayikra" in prompt
    assert "[HOOK]" in prompt
    assert "He called." in prompt
    assert "outdoor_archetype_id" in prompt or "DOJO" in prompt


@pytest.mark.asyncio
async def test_transform_draft_returns_valid_v2_plan():
    fake_plan = {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "outdoor_archetype_id": "GARDEN_PATH",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "Rav Eli sits, dolly in, soft morning light",
             "duration_s": 8, "setting_id": "DOJO"},
            {"index": 1, "voiceover": "b", "visual_prompt": "Rav Eli rises, push in, soft morning light",
             "duration_s": 9, "setting_id": "DOJO"},
            {"index": 2, "voiceover": "c", "visual_prompt": "Rav Eli walks the path, lateral tracking shot, dappled afternoon",
             "duration_s": 9, "setting_id": "GARDEN_PATH"},
            {"index": 3, "voiceover": "d", "visual_prompt": "Rav Eli pauses, slow orbit, dappled afternoon",
             "duration_s": 8, "setting_id": "GARDEN_PATH"},
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_plan))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    plan = await transform_draft_to_clip_plan(
        parsha_name="Vayikra", book="Leviticus", option="A",
        style_note="modern", title="t",
        draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
        client=mock_client,
    )
    assert isinstance(plan, ClipPlan)
    assert plan.outdoor_archetype_id == "GARDEN_PATH"
    assert plan.clips[0].setting_id == "DOJO"
    assert plan.clips[3].setting_id == "GARDEN_PATH"
    assert 28 <= plan.total_duration_s <= 45


@pytest.mark.asyncio
async def test_transform_draft_propagates_validation_error_on_bad_block():
    fake_plan = {
        "parsha": "Vayikra", "hook": "x", "full_script": "x",
        "outdoor_archetype_id": "GARDEN_PATH",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "p", "duration_s": 8, "setting_id": "GARDEN_PATH"},
            {"index": 1, "voiceover": "b", "visual_prompt": "p", "duration_s": 8, "setting_id": "GARDEN_PATH"},
            {"index": 2, "voiceover": "c", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
            {"index": 3, "voiceover": "d", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
        ],
    }
    mock_msg = MagicMock()
    mock_msg.content = [MagicMock(text=json.dumps(fake_plan))]
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=mock_msg)

    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="x", title="t", draft="x",
            client=mock_client,
        )
