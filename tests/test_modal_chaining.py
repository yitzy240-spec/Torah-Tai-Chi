import pytest

from modal_app import _resolve_regen_first_frame


@pytest.mark.asyncio
async def test_resolve_regen_first_frame_honors_operator_chain_break():
    """A chain break must stop before any DB, download, or Kie work."""
    result = await _resolve_regen_first_frame(
        sb=None,
        parent_job_id="parent-job",
        clip_index=1,
        clip_visual_prompt="same dojo",
        clip_setting_id="DOJO",
        motion_ref_slug=None,
        chain_broken=True,
        kie=None,
        work_dir=None,
    )

    assert result is None
