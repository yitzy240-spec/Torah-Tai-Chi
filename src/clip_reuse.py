"""Reuse a clip a job already rendered instead of paying Kie for it again.

clips_only_job used to re-render every target clip on a re-run. Its only
resume path fires when a row has a Kie task_id but NO stored mp4, so a job
whose clips all landed but whose stitch failed re-rendered, and re-billed,
every finished clip when the operator pressed Retry (~$2.87 per 720p clip).

A clip is reusable only when THIS job's row for that index is a finished
render of exactly the clip about to be rendered: status 'done', an mp4 in
Storage, and the same voiceover / visual_prompt / setting / duration /
motion ref. A job row pins its clip_plan_id, so job + index identifies the
plan clip; the text comparison catches operator edits made between runs.
"""
from __future__ import annotations

from typing import Optional

REUSE_SELECT = (
    "id, status, storage_path, voiceover, visual_prompt, setting_id, "
    "duration_s, motion_ref_slug"
)


def reusable_storage_path(row: Optional[dict], clip, motion_ref_slug: Optional[str]) -> Optional[str]:
    """The row's storage_path when it is a finished render of `clip`
    (after operator overrides) with `motion_ref_slug`; else None."""
    if not row or row.get("status") != "done" or not row.get("storage_path"):
        return None
    if (
        row.get("voiceover") != clip.voiceover
        or row.get("visual_prompt") != clip.visual_prompt
        or row.get("setting_id") != clip.setting_id
        or row.get("duration_s") != clip.duration_s
        or (row.get("motion_ref_slug") or None) != (motion_ref_slug or None)
    ):
        return None
    return row["storage_path"]


def find_reusable_clip(sb, job_id: str, clip, motion_ref_slug: Optional[str]) -> Optional[str]:
    """Look up job_id's own row for clip.index; see reusable_storage_path."""
    resp = (
        sb.table("clips").select(REUSE_SELECT)
        .eq("job_id", job_id).eq("index", clip.index)
        .maybe_single().execute()
    )
    row = resp.data if resp is not None else None  # maybe_single: None on 0 rows
    return reusable_storage_path(row, clip, motion_ref_slug)
