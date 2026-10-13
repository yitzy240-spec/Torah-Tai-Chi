"""A clips-only re-run reuses clips the job already rendered.

Retry after a stitch failure used to re-render, and re-bill, every
finished clip: the only resume path needed a task_id with NO stored mp4.
"""
from pathlib import Path

import pytest

from src.clip_reuse import find_reusable_clip, reusable_storage_path
from src.kie_task_persist import build_done_clip_row, build_pending_clip_row
from src.models import Clip
from tests.fakes.fake_supabase import FakeSupabase

JOB = "00000000-0000-4000-8000-0000000000b1"
OTHER_JOB = "00000000-0000-4000-8000-0000000000b2"
SP = f"jobs/{JOB}/clips/clip_01.mp4"
CLIP = Clip(index=1, voiceover="Breathe in.", visual_prompt="Rav Eli raises his arms",
            duration_s=8, setting_id="DOJO")
MODAL_SRC = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(encoding="utf-8")


def _sb(*rows: dict) -> FakeSupabase:
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB, kind="clips-only")
    sb.seed("jobs", id=OTHER_JOB, kind="clips-only")
    for r in rows:
        sb.seed("clips", **r)
    return sb


def _done(job=JOB, clip=CLIP, slug=None, sp=SP) -> dict:
    return build_done_clip_row(job, clip, task_id="t-1", storage_path=sp,
                               cost_usd=2.87, motion_ref_slug=slug)


def test_done_unchanged_clip_is_reused():
    assert find_reusable_clip(_sb(_done()), JOB, CLIP, None) == SP


def test_same_motion_slug_is_reused():
    assert find_reusable_clip(_sb(_done(slug="bow")), JOB, CLIP, "bow") == SP


@pytest.mark.parametrize("change", [
    {"voiceover": "Breathe out."},
    {"visual_prompt": "Rav Eli lowers his arms"},
    {"duration_s": 6},
    {"setting_id": "GARDEN"},
])
def test_edited_clip_is_rerendered(change):
    edited = CLIP.model_copy(update=change)
    assert find_reusable_clip(_sb(_done()), JOB, edited, None) is None


def test_changed_motion_ref_is_rerendered():
    assert find_reusable_clip(_sb(_done(slug="bow")), JOB, CLIP, "wave") is None
    assert find_reusable_clip(_sb(_done()), JOB, CLIP, "wave") is None


def test_pending_row_is_not_reused():
    """Task id but no mp4: that's the resume path's job, not reuse."""
    assert find_reusable_clip(_sb(build_pending_clip_row(JOB, CLIP, "t-1")), JOB, CLIP, None) is None


def test_done_row_without_storage_is_not_reused():
    assert reusable_storage_path({**_done(), "storage_path": None}, CLIP, None) is None


def test_another_jobs_clip_is_not_reused():
    assert find_reusable_clip(_sb(_done(job=OTHER_JOB)), JOB, CLIP, None) is None


def test_no_row_is_not_reused():
    assert find_reusable_clip(_sb(), JOB, CLIP, None) is None


# ── clips_only_job wiring (modal isn't importable here) ──────────────────

CLIPS_ONLY_SRC = MODAL_SRC[MODAL_SRC.index("def clips_only_job("):]


def _run_group_src() -> str:
    start = CLIPS_ONLY_SRC.index("        async def _run_group(group: list)")
    return CLIPS_ONLY_SRC[start:CLIPS_ONLY_SRC.index("        async def _gather_all_groups", start)]


def test_reuse_is_tried_before_any_first_frame_or_render_work():
    body = _run_group_src()
    reuse = body.index("await _reuse_done_clip(c)")
    assert reuse < body.index("_extract_last_frame(")
    assert reuse < body.index("_resolve_regen_first_frame(")
    assert reuse < body.index("await _render_one(")


def test_a_rerendered_clip_stops_reuse_for_the_rest_of_its_chain():
    body = _run_group_src()
    assert "if not chain_rerendered:" in body
    assert body.index("chain_rerendered = True") < body.index("await _render_one(")


def test_reused_clip_is_not_billed():
    start = CLIPS_ONLY_SRC.index("        async def _reuse_done_clip(c)")
    body = CLIPS_ONLY_SRC[start:CLIPS_ONLY_SRC.index("        async def _run_group", start)]
    assert "find_reusable_clip" in body
    assert "log_cost(" not in body and "generate_clip_with_meta(" not in body
