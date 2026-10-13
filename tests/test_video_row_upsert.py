"""Re-rendering a job never deletes or duplicates its videos row.

run_pipeline used to DELETE the job's videos row before rendering.
posts.video_id and feedback.video_id are ON DELETE CASCADE, so a retry of
a job that already had a video silently deleted its posts and feedback,
and a failed re-render left no video at all. The regen/clips-only paths
INSERTed, so a retry after a post-insert failure paid Kie again and then
died on videos_job_id_key (23505).
"""
import re
from pathlib import Path

from src.db_rows import build_video_row
from tests.fakes.fake_supabase import FakeSupabase

MODAL_SRC = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(encoding="utf-8")
JOB = "00000000-0000-4000-8000-0000000000e1"
VIDEO = "00000000-0000-4000-8000-0000000000e2"


def test_modal_never_deletes_a_videos_row():
    assert not re.search(r'table\("videos"\)\s*\.delete\(', MODAL_SRC)


def test_every_modal_videos_row_write_is_an_upsert_on_job_id():
    assert not re.search(r'table\("videos"\)\s*\.insert\(', MODAL_SRC)
    upserts = re.findall(r'table\("videos"\)\s*\.upsert\(video_row, on_conflict="job_id"\)', MODAL_SRC)
    assert len(upserts) == 7  # run_pipeline, 4 regen paths, clips_only, regen_clip_from_text


def test_rerender_keeps_the_video_id_so_posts_stay_attached():
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB)
    sb.seed("videos", id=VIDEO, job_id=JOB, mp4_path=f"jobs/{JOB}/final.mp4",
            published_to_website=True)
    sb.seed("posts", video_id=VIDEO, platform="youtube", status="published", caption="c")

    row = {**build_video_row(JOB, f"jobs/{JOB}/final.mp4"), "thumb_path": f"jobs/{JOB}/thumb.png"}
    sb.table("videos").upsert(row, on_conflict="job_id").execute()

    videos = sb.table("videos").select("*").eq("job_id", JOB).execute().data
    assert [v["id"] for v in videos] == [VIDEO]
    assert videos[0]["thumb_path"] == f"jobs/{JOB}/thumb.png"
    assert videos[0]["published_to_website"] is True  # unsent columns untouched
    assert sb.table("posts").select("*").eq("video_id", VIDEO).execute().data
