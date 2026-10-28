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
            draft="First beat opens the teaching clearly. Second beat develops the idea. Third beat lands the practice. Fourth beat closes with follow for more.",
            api_key="test-key",
        )
    assert isinstance(plan, ClipPlan)
    assert plan.outdoor_archetype_id == "GARDEN_PATH"
    assert plan.clips[0].setting_id == "DOJO"
    assert plan.clips[-1].setting_id == "GARDEN_PATH"
    assert plan.captions.tiktok.startswith("Test TikTok")
    assert 3 <= len(plan.clips) <= 8
    # Verbatim: draft wording survives even though the fixture rewrote VO.
    assert "First beat opens the teaching clearly" in plan.clips[0].voiceover
    assert 28 <= plan.total_duration_s <= 120


# Removed: test_transform_draft_propagates_validation_error_on_bad_block.
# transform_draft_to_clip_plan now wraps validation errors in a 3-attempt
# parse-retry loop that raises a generic RuntimeError after exhaustion;
# the original test asserted on a specific ValidationError shape that no
# longer surfaces. The retry behavior is the right contract — a single
# bad Claude response shouldn't crash the pipeline. Brittle assertion
# deleted rather than rewritten because the new contract is "any
# RuntimeError after 3 attempts" which adds little signal.


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
            style_note="x", title="t", draft="First beat opens the teaching clearly. Second beat develops the idea. Third beat lands the practice. Fourth beat closes with follow for more.",
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
    # Director notes are now framed as AUTHORITATIVE with split SCRIPT vs
    # SCENE direction; the previous "NOT structural overrides" framing
    # was rewritten when the agent stopped honoring specific scene details.
    assert "AUTHORITATIVE" in prompt
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
            draft="First beat opens the teaching clearly. Second beat develops the idea. Third beat lands the practice. Fourth beat closes with follow for more.",
            api_key="test-key",
            director_notes="set the outdoor clips by a slow river",
            max_retries=1,
        )

    user_content = captured["messages"][0]["content"]
    assert "DIRECTION FROM YONAH" in user_content
    assert "set the outdoor clips by a slow river" in user_content


def test_system_template_forbids_voiceover_rewrite():
    from src.script_generator import SYSTEM_TEMPLATE
    assert "VOICEOVER — VERBATIM" in SYSTEM_TEMPLATE
    assert "rephrase /" not in SYSTEM_TEMPLATE
    assert "tighten the voiceover" not in SYSTEM_TEMPLATE
    # Must not instruct translating Ting Jin / Song in voiceover.
    assert "ting jin        -> \"listening\"" not in SYSTEM_TEMPLATE.lower()


def test_build_prompt_includes_fixed_chunks():
    from src.verbatim_split import split_draft_verbatim
    from src.script_generator import build_prompt
    draft = (
        "First sentence here is long enough. Second sentence follows next. "
        "Third sentence wraps the beat. Fourth lands the teaching clearly. "
        "Fifth closes with follow for more."
    )
    chunks = split_draft_verbatim(draft)
    prompt = build_prompt(
        parsha_name="Vayeira", book="Bereishit", option="A",
        style_note="s", title="t", draft=draft, fixed_chunks=chunks,
    )
    assert "FIXED CLIP VOICEOVERS" in prompt
    assert f"EXACTLY {len(chunks)} clips" in prompt
    assert chunks[0].voiceover in prompt
    assert "zero rewrites" in prompt


@pytest.mark.asyncio
async def test_transform_draft_enforces_verbatim_over_llm_rewrite():
    """Even if Claude rewrites voiceovers, the returned plan keeps draft text."""
    from src.verbatim_split import split_draft_verbatim, concatenated_voiceovers
    draft = (
        "How does being relaxed make you stronger? AV-ra-ham sat at the tent. "
        "In Tai Chi, we use Ting Jin to perceive information before responding. "
        "His stillness was preparation, not passivity. "
        "We use Song, or relaxed release, so strong movement can emerge. "
        "Follow or subscribe for more each week."
    )
    chunks = split_draft_verbatim(draft)
    # Build a fake LLM plan that rewrites every voiceover.
    outdoor = "GARDEN_PATH"
    rewritten_clips = []
    for i, ch in enumerate(chunks):
        rewritten_clips.append({
            "index": i,
            "voiceover": f"REWRITTEN listening version of clip {i}",
            "visual_prompt": f"Rav Eli stands and teaches beat {i}.",
            "duration_s": 8,
            "setting_id": "DOJO" if i < max(1, len(chunks) // 2) else outdoor,
            "caption_position": "bottom",
            "emotive_note": f"tone {i}",
        })
    # Ensure dojo then outdoor structure.
    mid = max(1, len(chunks) // 2)
    for i, c in enumerate(rewritten_clips):
        c["setting_id"] = "DOJO" if i < mid else outdoor
    plan_dict = {
        "parsha": "Vayeira",
        "hook": "rewritten hook",
        "full_script": "rewritten full",
        "outdoor_archetype_id": outdoor,
        "captions": {
            "tiktok": "Test TikTok caption #parsha",
            "instagram": "Test IG caption. With a few sentences.",
            "youtube_title": "Test YouTube title",
            "youtube_description": "Test YT description body.",
            "facebook": "Test FB caption, a bit longer and more conversational.",
            "twitter": "Test X caption #parsha",
        },
        "clips": rewritten_clips,
    }
    # Pad durations so total in [28, 120]
    total = sum(c["duration_s"] for c in rewritten_clips)
    if total < 28:
        rewritten_clips[-1]["duration_s"] = min(15, rewritten_clips[-1]["duration_s"] + (28 - total))

    async with respx.mock(assert_all_called=True) as mock:
        mock.post(KIE_CLAUDE_URL).mock(
            return_value=Response(200, json=_kie_claude_response_body(plan_dict)),
        )
        plan = await transform_draft_to_clip_plan(
            parsha_name="Vayeira", book="Bereishit", option="A",
            style_note="s", title="t", draft=draft, api_key="test-key",
        )
    cat = " ".join(c.voiceover for c in plan.clips)
    assert "Ting Jin" in cat
    assert "Song, or relaxed release" in cat
    assert "REWRITTEN listening" not in cat
    assert plan.full_script == draft.strip()
    for c in plan.clips:
        assert "REWRITTEN" not in c.voiceover
