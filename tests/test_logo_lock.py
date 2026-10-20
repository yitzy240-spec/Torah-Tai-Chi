"""a5689b42 clip 2: the chest logo morphed ("TORSA"/"TORAA") as the camera
pushed in on a chained clip. Covers the logo lock text, the chain-frame
upscale, and the extra seedance_request / chain_decision logging."""
import hashlib
import subprocess
from pathlib import Path

import pytest

from src.frame_extract import probe_size, upscale_chain_frame, upscaled_size
from src.models import Clip
from src.settings import LOGO_LOCK, STYLE_LOCK, WARDROBE_LOCK
from src.video_generator import build_seedance_input, prompt_lock_flags

CLIP = Clip(index=1, voiceover="He was silent.",
            visual_prompt="Slow push-in on Rav Eli.", duration_s=11,
            setting_id="DOJO")
CHAIN = "https://x/last_frame.png"


def _payload(**kw):
    kw.setdefault("first_frame_url", None)
    return build_seedance_input(
        CLIP, character_ref_urls=["https://x/c.png"],
        dojo_ref_urls=["https://x/d.png"], audio_url=None,
        resolution="720p", **kw,
    )


def test_logo_lock_describes_the_real_logo():
    t = LOGO_LOCK
    assert "yin-yang" in t and "circular" in t
    assert "'TORAH'" in t and "'TAI CHI'" in t and "above" in t and "below" in t
    assert "wearer's left" in t and "viewer's right" in t and "placket" in t
    assert "light grey" in t and "one sixth of the chest width" in t
    assert "six-pointed Star of David" in t and "light half" in t
    assert "navy outline" in t and "same shape" in t
    assert "camera moves closer" in t and "legible spelling" in t


def test_logo_lock_is_inside_wardrobe_and_style_locks():
    assert LOGO_LOCK in WARDROBE_LOCK
    assert WARDROBE_LOCK in STYLE_LOCK


@pytest.mark.parametrize("kw", [{}, {"first_frame_url": CHAIN},
                                {"first_frame_url": CHAIN, "chain_mode": "reference"}])
def test_logo_lock_in_every_prompt(kw):
    prompt = _payload(**kw)["prompt"]
    assert prompt.count(LOGO_LOCK) == 1
    assert prompt_lock_flags(prompt)["logo"] is True


def test_upscaled_size_keeps_aspect_exact():
    assert upscaled_size(720, 1280) == (1080, 1920)
    assert upscaled_size(1280, 720) == (1920, 1080)
    assert upscaled_size(1080, 1920) is None
    assert upscaled_size(1440, 2560) is None
    assert upscaled_size(721, 1283) is None  # no exact ratio → leave alone


def _png(path: Path, size: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                    f"testsrc=s={size}:d=1", "-frames:v", "1", str(path)],
                   check=True, capture_output=True)


@pytest.mark.slow
def test_upscale_chain_frame_720p(tmp_path):
    p = tmp_path / "f.png"
    _png(p, "720x1280")
    assert upscale_chain_frame(p) == p
    assert probe_size(p) == (1080, 1920)
    assert p.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert not (tmp_path / "f_up.png").exists()


@pytest.mark.slow
def test_upscale_chain_frame_leaves_large_frames(tmp_path):
    p = tmp_path / "f.png"
    _png(p, "1080x1920")
    before = p.read_bytes()
    upscale_chain_frame(p)
    assert p.read_bytes() == before


class _FakeKie:
    def __init__(self):
        self.uploaded = None

    async def upload_file(self, path, remote_dir="x"):
        self.uploaded = (probe_size(path), path.suffix, remote_dir)
        return "https://kie/ff.png"


@pytest.mark.slow
@pytest.mark.asyncio
async def test_upload_first_frame_upscales_before_kie(tmp_path):
    pytest.importorskip("modal")
    from modal_app import _upload_first_frame
    p = tmp_path / "firstframe_01.png"
    _png(p, "720x1280")
    kie = _FakeKie()
    assert await _upload_first_frame(kie, p) == "https://kie/ff.png"
    assert kie.uploaded == ((1080, 1920), ".png", "torah-tai-chi-firstframes")


def test_seedance_request_logs_frame_url_and_prompt_hash():
    pytest.importorskip("modal")
    from modal_app import _log_seedance_request
    from tests.fakes.fake_supabase import FakeSupabase
    sb = FakeSupabase()
    payload = _payload(first_frame_url=CHAIN)
    _log_seedance_request(sb, "job-1", 1, "task-1", payload)
    (ev,) = [r for r in sb.rows["execution_events"]
             if r["event"] == "pipeline.seedance_request"]
    d = ev["details"]
    assert d["first_frame_url"] == CHAIN
    assert d["prompt_sha256"] == hashlib.sha256(
        payload["prompt"].encode()).hexdigest()
    assert d["prompt_head"] == payload["prompt"][:500]
    assert d["lock_flags"]["logo"] is True


@pytest.mark.asyncio
async def test_chain_decision_logged_under_child_job():
    pytest.importorskip("modal")
    from modal_app import _resolve_regen_first_frame
    from tests.fakes.fake_supabase import FakeSupabase
    sb = FakeSupabase()
    await _resolve_regen_first_frame(
        sb=sb, parent_job_id="parent", clip_index=0, clip_visual_prompt="",
        clip_setting_id="DOJO", motion_ref_slug=None, kie=None,
        work_dir=None, job_id="child",
    )
    (ev,) = [r for r in sb.rows["execution_events"]
             if r["event"] == "pipeline.chain_decision"]
    assert ev["details"]["job_id"] == "child"
    assert ev["details"]["parent_job_id"] == "parent"
