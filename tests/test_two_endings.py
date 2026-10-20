"""Per-platform endings (2026-10-20): every final video ships twice from one
stitched content timeline — a Follow-ending cut (videos.mp4_path; FB / IG /
TikTok / X) and a Subscribe-ending cut (videos.mp4_subscribe_path; YouTube).
"""
import re
import subprocess
from pathlib import Path

import pytest

from src import stitcher
from src.db_rows import build_video_row, video_complete_payload, video_storage_paths
from tests.fakes.fake_supabase import FakeSupabase

ROOT = Path(__file__).resolve().parent.parent
MODAL_SRC = (ROOT / "modal_app.py").read_text(encoding="utf-8")
JOB = "00000000-0000-4000-8000-0000000000f1"
VIDEO = "00000000-0000-4000-8000-0000000000f2"


# ── outro generator ─────────────────────────────────────────────────────────

def test_outro_variants_differ_only_in_the_cta_verb():
    pytest.importorskip("PIL")
    from tools import make_outro

    follow_lines, follow_mp4, _ = make_outro.VARIANTS["follow"]
    sub_lines, sub_mp4, sub_png = make_outro.VARIANTS["subscribe"]
    assert follow_lines == ("Follow for a new lesson", "every week")
    assert sub_lines == ("Subscribe for a new lesson", "every week")
    assert follow_mp4.name == "outro.mp4"  # the live follow asset keeps its path
    assert sub_mp4.name == "outro_subscribe.mp4"
    assert sub_png.name == "outro_subscribe_card.png"
    assert sub_mp4.parent == follow_mp4.parent


def test_both_outro_assets_are_committed():
    brand = ROOT / "references" / "_brand"
    assert (brand / "outro.mp4").is_file()
    assert (brand / "outro_subscribe.mp4").is_file()


def test_stitcher_maps_each_ending_to_its_outro():
    assert stitcher.OUTRO_VARIANTS[stitcher.FOLLOW] == stitcher.BRANDED_OUTRO_PATH
    assert stitcher.OUTRO_VARIANTS[stitcher.SUBSCRIBE].name == "outro_subscribe.mp4"


# ── row / path / payload builders ───────────────────────────────────────────

def test_storage_paths_are_named_after_the_parsha():
    assert video_storage_paths(JOB, "noach") == {
        "follow": f"jobs/{JOB}/noach-follow.mp4",
        "subscribe": f"jobs/{JOB}/noach-subscribe.mp4",
    }


def test_storage_paths_sanitize_and_fall_back():
    assert video_storage_paths(JOB, "Lech Lecha!")["follow"] == f"jobs/{JOB}/lech-lecha-follow.mp4"
    assert video_storage_paths(JOB, None)["subscribe"] == f"jobs/{JOB}/torah-tai-chi-subscribe.mp4"


def test_video_row_always_carries_the_subscribe_column():
    assert build_video_row(JOB, "a.mp4") == {
        "job_id": JOB, "mp4_path": "a.mp4", "mp4_subscribe_path": None,
    }
    assert build_video_row(JOB, "a.mp4", "b.mp4")["mp4_subscribe_path"] == "b.mp4"


def test_video_row_with_subscribe_path_matches_the_schema():
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB)
    sb.table("videos").upsert(
        build_video_row(JOB, "jobs/x/noach-follow.mp4", "jobs/x/noach-subscribe.mp4"),
        on_conflict="job_id",
    ).execute()
    row = sb.table("videos").select("*").eq("job_id", JOB).execute().data[0]
    assert row["mp4_path"] == "jobs/x/noach-follow.mp4"
    assert row["mp4_subscribe_path"] == "jobs/x/noach-subscribe.mp4"


def test_rerender_without_subscribe_clears_the_stale_one():
    sb = FakeSupabase()
    sb.seed("jobs", id=JOB)
    sb.seed("videos", id=VIDEO, job_id=JOB, mp4_path="old-follow.mp4",
            mp4_subscribe_path="old-subscribe.mp4")
    sb.table("videos").upsert(build_video_row(JOB, "new-follow.mp4"), on_conflict="job_id").execute()
    row = sb.table("videos").select("*").eq("job_id", JOB).execute().data[0]
    assert row["mp4_path"] == "new-follow.mp4"
    assert row["mp4_subscribe_path"] is None


def test_webhook_payload_reports_both_endings():
    assert video_complete_payload(JOB, VIDEO, "f.mp4", "s.mp4") == {
        "jobId": JOB, "videoId": VIDEO, "mp4Path": "f.mp4", "mp4SubscribePath": "s.mp4",
    }


# ── modal_app wiring (structural: modal isn't importable in CI) ─────────────

def test_every_stitch_site_produces_both_endings():
    # run_pipeline, regen_smart, regen_clip, regen_agent, regen_single_clip,
    # clips_only_job, regen_clip_from_text, compose_video.
    assert len(re.findall(r"= _stitch_and_upload_final\(", MODAL_SRC)) == 8
    assert "concat_final_video(ordered" not in MODAL_SRC
    assert not re.search(r'f"jobs/\{\w+\}/final\.mp4"', MODAL_SRC)


def test_every_video_complete_webhook_reports_both_endings():
    posts = re.findall(r"""f"\{dashboard_url\.rstrip\('/'\)\}/api/pipeline/video-complete\"""", MODAL_SRC)
    payloads = re.findall(r"json=video_complete_payload\(", MODAL_SRC)
    assert len(posts) == len(payloads) == 8
    assert '"videoId": video_id}' not in MODAL_SRC


def test_every_videos_write_carries_the_subscribe_path():
    rows = re.findall(r"build_video_row\(\s*job_id,\s*\w+,\s*subscribe_storage_path", MODAL_SRC)
    assert len(rows) == 7
    assert '"mp4_subscribe_path": subscribe_storage_path' in MODAL_SRC  # compose UPDATE


@pytest.fixture
def modal_app(monkeypatch):
    pytest.importorskip("modal")
    import modal_app as m
    monkeypatch.setattr(m.time, "sleep", lambda s: None)
    monkeypatch.setattr(m, "_resolve_parsha_slug", lambda sb, job_id: "noach")
    return m


def _fake_variants(clips, dests, cut_types=None, **_kw):
    for name, d in dests.items():
        d.write_bytes(name.encode())
    return dests


def test_stitch_and_upload_uploads_both_endings(modal_app, monkeypatch, tmp_path):
    monkeypatch.setattr(stitcher, "concat_final_variants", _fake_variants)
    sb = FakeSupabase()
    follow, subscribe = modal_app._stitch_and_upload_final(
        sb, [tmp_path / "c0.mp4"], tmp_path / "final.mp4", JOB,
    )
    assert follow == f"jobs/{JOB}/noach-follow.mp4"
    assert subscribe == f"jobs/{JOB}/noach-subscribe.mp4"
    assert [(b, p) for b, p, _ in sb.uploads] == [("videos", follow), ("videos", subscribe)]
    assert (tmp_path / "final.mp4").read_bytes() == b"follow"  # thumbnail source


def test_subscribe_failure_still_ships_the_follow_cut(modal_app, monkeypatch, tmp_path):
    def boom(*_a, **_kw):
        raise FileNotFoundError("outro_subscribe.mp4 missing")

    def follow_only(clips, dest, cut_types=None, **_kw):
        dest.write_bytes(b"follow")
        return dest

    monkeypatch.setattr(stitcher, "concat_final_variants", boom)
    monkeypatch.setattr(stitcher, "concat_final_video", follow_only)
    sb = FakeSupabase()
    follow, subscribe = modal_app._stitch_and_upload_final(
        sb, [tmp_path / "c0.mp4"], tmp_path / "final.mp4", JOB,
    )
    assert subscribe is None
    assert [p for _, p, _ in sb.uploads] == [follow]


# ── real ffmpeg: one content timeline, two endings ──────────────────────────

def _clip(path: Path, seconds: float, color: str, size: str = "320x240") -> Path:
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c={color}:s={size}:d={seconds}",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        str(path),
    ], check=True, capture_output=True)
    return path


def _frame_rgb(mp4: Path, at_s: float) -> tuple[int, int, int]:
    """Mean colour of the frame at `at_s` (frame scaled to 1x1). Compared
    with a tolerance: the final x264 pass may quantize a content frame a
    hair differently when a different outro follows it (lookahead)."""
    r = subprocess.run([
        "ffmpeg", "-v", "error", "-ss", f"{at_s:.3f}", "-i", str(mp4),
        "-frames:v", "1", "-vf", "scale=1:1:flags=area",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ], check=True, capture_output=True)
    return tuple(r.stdout[:3])


def _same(a, b, tol: int = 6) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def _duration(mp4: Path) -> float:
    r = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp4),
    ], check=True, capture_output=True, text=True)
    return float(r.stdout.strip())


@pytest.mark.slow
def test_variants_share_content_and_differ_only_in_the_outro(tmp_path):
    clips = [_clip(tmp_path / "c0.mp4", 2, "blue"), _clip(tmp_path / "c1.mp4", 2, "red")]
    outros = {
        stitcher.FOLLOW: _clip(tmp_path / "of.mp4", 1.5, "white"),
        stitcher.SUBSCRIBE: _clip(tmp_path / "os.mp4", 1.5, "yellow"),
    }
    dests = stitcher.variant_dests(tmp_path / "out" / "final.mp4")
    out = stitcher.concat_final_variants(clips, dests, outros=outros)

    follow, subscribe = out[stitcher.FOLLOW], out[stitcher.SUBSCRIBE]
    assert follow.name == "final.mp4" and subscribe.name == "final_subscribe.mp4"
    assert abs(_duration(follow) - _duration(subscribe)) < 0.05
    # Same content frames...
    assert _same(_frame_rgb(follow, 1.0), _frame_rgb(subscribe, 1.0))
    assert _same(_frame_rgb(follow, 3.0), _frame_rgb(subscribe, 3.0))
    # ...different ending (white vs yellow card: blue channel ~255 vs ~0).
    end = _duration(follow) - 0.3
    assert _frame_rgb(follow, end)[2] - _frame_rgb(subscribe, end)[2] > 100


@pytest.mark.slow
def test_single_variant_matches_concat_final_video(tmp_path):
    clips = [_clip(tmp_path / "c0.mp4", 2, "blue"), _clip(tmp_path / "c1.mp4", 2, "red")]
    outro = _clip(tmp_path / "of.mp4", 1.5, "white")
    a = stitcher.concat_final_video(clips, tmp_path / "a" / "final.mp4", outro_path=outro)
    b = stitcher.concat_final_variants(
        clips, {stitcher.FOLLOW: tmp_path / "b" / "final.mp4"},
        outros={stitcher.FOLLOW: outro},
    )[stitcher.FOLLOW]
    assert abs(_duration(a) - _duration(b)) < 0.05
    for t in (0.5, 2.5, _duration(a) - 0.3):
        assert _same(_frame_rgb(a, t), _frame_rgb(b, t))


def test_missing_outro_is_reported_per_variant(tmp_path):
    with pytest.raises(FileNotFoundError, match="subscribe"):
        stitcher.concat_final_variants(
            [tmp_path / "c0.mp4"], {stitcher.SUBSCRIBE: tmp_path / "x.mp4"},
            outros={stitcher.SUBSCRIBE: tmp_path / "nope.mp4"},
        )
