import pytest
import json
import respx
from httpx import Response
from src.script_generator import (
    transform_draft_to_clip_plan, build_prompt, ANTHROPIC_URL,
)
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


def _anthropic_response_body(plan_dict: dict) -> dict:
    """Shape of Anthropic's /v1/messages response."""
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": json.dumps(plan_dict)}],
        "model": "claude-opus-4-6",
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


@pytest.mark.asyncio
async def test_transform_draft_returns_valid_v2_plan():
    fake_plan = {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "outdoor_archetype_id": "GARDEN_PATH",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "Rav Eli sits, slow push in, soft morning light",
             "duration_s": 8, "setting_id": "DOJO"},
            {"index": 1, "voiceover": "b", "visual_prompt": "Rav Eli rises, static medium shot, soft morning light",
             "duration_s": 9, "setting_id": "DOJO"},
            {"index": 2, "voiceover": "c", "visual_prompt": "Rav Eli walks the path, lateral tracking shot, dappled afternoon",
             "duration_s": 9, "setting_id": "GARDEN_PATH"},
            {"index": 3, "voiceover": "d", "visual_prompt": "Rav Eli pauses, slow orbit, dappled afternoon",
             "duration_s": 8, "setting_id": "GARDEN_PATH"},
        ],
    }
    async with respx.mock(assert_all_called=True) as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json=_anthropic_response_body(fake_plan)),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="modern", title="t",
            draft="[HOOK]\nHi.\n[TEACHING]\nOk.",
            api_key="test-key",
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
    from pydantic import ValidationError
    async with respx.mock() as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json=_anthropic_response_body(fake_plan)),
        )
        with pytest.raises(ValidationError):
            await transform_draft_to_clip_plan(
                parsha_name="Vayikra", book="Leviticus", option="A",
                style_note="x", title="t", draft="x",
                api_key="test-key",
            )


@pytest.mark.asyncio
async def test_transform_draft_strips_json_fence_wrapper():
    fake_plan = {
        "parsha": "Vayikra", "hook": "x", "full_script": "x",
        "outdoor_archetype_id": "MOUNTAIN_RIDGE",
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
            {"index": 1, "voiceover": "b", "visual_prompt": "p", "duration_s": 8, "setting_id": "DOJO"},
            {"index": 2, "voiceover": "c", "visual_prompt": "p", "duration_s": 8, "setting_id": "MOUNTAIN_RIDGE"},
            {"index": 3, "voiceover": "d", "visual_prompt": "p", "duration_s": 8, "setting_id": "MOUNTAIN_RIDGE"},
        ],
    }
    fenced = "```json\n" + json.dumps(fake_plan) + "\n```"
    async with respx.mock() as mock:
        mock.post(ANTHROPIC_URL).mock(
            return_value=Response(200, json={
                "id": "msg", "type": "message", "role": "assistant",
                "content": [{"type": "text", "text": fenced}],
                "model": "claude-opus-4-6", "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 10},
            }),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="x", title="t", draft="x",
            api_key="test-key",
        )
    assert plan.outdoor_archetype_id == "MOUNTAIN_RIDGE"
