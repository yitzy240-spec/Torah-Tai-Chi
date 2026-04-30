import pytest
import json
import respx
from httpx import Response
from src.script_generator import (
    transform_draft_to_clip_plan, build_prompt, KIE_CLAUDE_URL,
)
from src.models import ClipPlan


@pytest.fixture(autouse=True)
def _force_kie_primary(monkeypatch):
    """Pin the Claude helper to Kie-primary so respx mocks of the Kie
    URL still match. The production default is now ``openrouter``;
    these tests predate the switch and only mock the Kie URL.
    """
    monkeypatch.setenv("CLAUDE_PRIMARY_PROVIDER", "kie")


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
    assert "outdoor_archetype_id" in prompt or "DOJO" in prompt or "captions" in prompt


def _kie_claude_response_body(plan_dict: dict) -> dict:
    """Kie.ai proxies Claude with the Anthropic-native /v1/messages response
    shape, plus a `credits_consumed` field we don't depend on. Fixture matches
    what we saw live from https://api.kie.ai/claude/v1/messages.
    """
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": json.dumps(plan_dict)}],
        "model": "claude-opus-4-6",
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 10},
        "credits_consumed": 0.01,
    }


def _fake_plan_with_captions(outdoor_archetype_id: str = "GARDEN_PATH") -> dict:
    return {
        "parsha": "Vayikra",
        "hook": "He called",
        "full_script": "full",
        "outdoor_archetype_id": outdoor_archetype_id,
        "captions": {
            "tiktok": "Test TikTok caption #parsha",
            "instagram": "Test IG caption. With a few sentences.",
            "youtube_title": "Test YouTube title",
            "youtube_description": "Test YT description body.",
            "facebook": "Test FB caption, a bit longer and more conversational.",
            "twitter": "Test X caption #parsha",
        },
        "clips": [
            {"index": 0, "voiceover": "a", "visual_prompt": "prompt",
             "duration_s": 8, "setting_id": "DOJO", "caption_position": "bottom"},
            {"index": 1, "voiceover": "b", "visual_prompt": "prompt",
             "duration_s": 9, "setting_id": "DOJO", "caption_position": "bottom"},
            {"index": 2, "voiceover": "c", "visual_prompt": "prompt",
             "duration_s": 9, "setting_id": outdoor_archetype_id, "caption_position": "top"},
            {"index": 3, "voiceover": "d", "visual_prompt": "prompt",
             "duration_s": 8, "setting_id": outdoor_archetype_id, "caption_position": "bottom"},
        ],
    }


@pytest.mark.asyncio
async def test_transform_draft_returns_valid_v2_plan():
    async with respx.mock(assert_all_called=True) as mock:
        mock.post(KIE_CLAUDE_URL).mock(
            return_value=Response(200, json=_kie_claude_response_body(_fake_plan_with_captions())),
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
    assert plan.captions.tiktok.startswith("Test TikTok")
    assert plan.clips[2].caption_position == "top"
    assert 28 <= plan.total_duration_s <= 90


@pytest.mark.asyncio
async def test_transform_draft_propagates_validation_error_on_bad_block():
    fake = _fake_plan_with_captions()
    fake["clips"][0]["setting_id"] = "GARDEN_PATH"  # breaks dojo-first
    from pydantic import ValidationError
    async with respx.mock() as mock:
        mock.post(KIE_CLAUDE_URL).mock(
            return_value=Response(200, json=_kie_claude_response_body(fake)),
        )
        with pytest.raises(ValidationError):
            await transform_draft_to_clip_plan(
                parsha_name="Vayikra", book="Leviticus", option="A",
                style_note="x", title="t", draft="x",
                api_key="test-key",
            )


@pytest.mark.asyncio
async def test_transform_draft_strips_json_fence_wrapper():
    fake = _fake_plan_with_captions("MOUNTAIN_RIDGE")
    fenced = "```json\n" + json.dumps(fake) + "\n```"
    async with respx.mock() as mock:
        mock.post(KIE_CLAUDE_URL).mock(
            return_value=Response(200, json={
                "id": "msg", "type": "message", "role": "assistant",
                "content": [{"type": "text", "text": fenced}],
                "model": "claude-opus-4-6", "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 10},
                "credits_consumed": 0.01,
            }),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="x", title="t", draft="x",
            api_key="test-key",
        )
    assert plan.outdoor_archetype_id == "MOUNTAIN_RIDGE"


def test_build_prompt_without_selected_move_has_no_featured_block():
    from src.script_generator import build_prompt
    prompt = build_prompt(
        parsha_name="X", book="Y", option="A",
        style_note="", title="t", draft="draft text",
    )
    assert "FEATURED TAI CHI MOVE" not in prompt


def test_build_prompt_with_selected_move_appends_featured_block():
    from src.script_generator import build_prompt
    move = {
        "slug": "white_crane_spreads_wings",
        "english": "White Crane Spreads Its Wings",
        "pinyin": "Báihè Liàngchì",
        "visual": "stands on right leg, left toe touching, right hand above head",
        "motion_description": "torso rotates 90 degrees to the left as weight shifts onto the right leg...",
    }
    prompt = build_prompt(
        parsha_name="X", book="Y", option="A",
        style_note="", title="t", draft="draft text",
        selected_move=move,
    )
    assert "FEATURED TAI CHI MOVE" in prompt
    assert "White Crane Spreads Its Wings" in prompt
    assert "Báihè Liàngchì" in prompt
    assert "torso rotates" in prompt
    assert "motion_ref_slug" in prompt
    assert "white_crane_spreads_wings" in prompt


def test_build_prompt_omits_director_notes_block_when_none():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes=None,
    )
    assert "DIRECTION FROM YONAH" not in prompt


def test_build_prompt_omits_director_notes_block_when_empty():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes="   ",
    )
    assert "DIRECTION FROM YONAH" not in prompt


def test_build_prompt_includes_director_notes_block_when_provided():
    prompt = build_prompt(
        parsha_name="Vayikra", book="Leviticus",
        option="A", style_note="practical modern lens",
        title="The Call Behind the Call",
        draft="[HOOK]\nHe called.",
        director_notes="set the outdoor clips by a slow river",
    )
    assert "DIRECTION FROM YONAH" in prompt
    assert "set the outdoor clips by a slow river" in prompt
    assert "NOT structural overrides" in prompt
    assert prompt.index("DIRECTION FROM YONAH") < prompt.index("Produce the ClipPlan JSON now")


@pytest.mark.asyncio
async def test_transform_draft_forwards_director_notes_to_prompt():
    """transform_draft_to_clip_plan must forward director_notes into the
    Claude request body so the agent sees the DIRECTION FROM YONAH block."""
    captured: dict = {}

    def _record(request):
        body = json.loads(request.content)
        captured["messages"] = body["messages"]
        return Response(200, json=_kie_claude_response_body(_fake_plan_with_captions()))

    async with respx.mock() as mock:
        mock.post(KIE_CLAUDE_URL).mock(side_effect=_record)
        await transform_draft_to_clip_plan(
            parsha_name="Vayikra", book="Leviticus", option="A",
            style_note="lens", title="t",
            draft="[HOOK]\nHe called.",
            api_key="test-key",
            director_notes="set the outdoor clips by a slow river",
            max_retries=1,
        )

    user_content = captured["messages"][0]["content"]
    assert "DIRECTION FROM YONAH" in user_content
    assert "set the outdoor clips by a slow river" in user_content
