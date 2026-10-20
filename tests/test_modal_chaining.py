import pytest

# modal_app imports the `modal` SDK at module load; CI installs only the
# lightweight `.[dev]` extras, so skip this module there rather than fail
# collection. Runs locally where modal is installed.
pytest.importorskip("modal")

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


class _FakeKie:
    def __init__(self):
        self.names: list[str] = []

    async def upload_file(self, path, remote_dir="", file_name=None):
        self.names.append(file_name)
        return f"https://f/{file_name}"


@pytest.mark.asyncio
async def test_upload_first_frame_unique_name_and_keeps_seam_copy(
    tmp_path, monkeypatch,
):
    import modal_app
    import src.chain_frame as cf

    async def _always_ok(url, expected, timeout=10.0):
        return True
    monkeypatch.setattr(cf, "url_serves_bytes", _always_ok)

    png = tmp_path / "firstframe_01.png"
    png.write_bytes(b"png-bytes")
    kie = _FakeKie()
    u1 = await modal_app._upload_first_frame(kie, png)
    u2 = await modal_app._upload_first_frame(kie, png)
    assert u1 != u2 and len(set(kie.names)) == 2
    assert all(n.startswith("firstframe_01_") for n in kie.names)
    # Callers unlink png_path in finally; the seam copy must survive that.
    png.unlink()
    kept = modal_app._CHAIN_PNG_BY_URL.pop(u1)
    assert kept.read_bytes() == b"png-bytes"
    modal_app._CHAIN_PNG_BY_URL.pop(u2).unlink()
    kept.unlink()


def test_seedance_request_event_includes_first_frame_url(monkeypatch):
    import modal_app
    import src.events

    seen = {}
    monkeypatch.setattr(
        src.events, "log_event", lambda sb, **kw: seen.update(kw),
    )
    modal_app._log_seedance_request(
        None, "job-1", 1, "task-1",
        {"prompt": "p", "first_frame_url": "https://f/firstframe_01_x.png"},
    )
    assert seen["details"]["first_frame_url"] == "https://f/firstframe_01_x.png"
    assert seen["details"]["has_first_frame"] is True


@pytest.mark.parametrize("similarity,honored,level", [
    (0.97, True, "info"), (0.40, False, "warn"),
])
def test_chain_seam_check_logs_and_cleans_up(
    tmp_path, monkeypatch, similarity, honored, level,
):
    import modal_app
    import src.events
    import src.seam_check as sc

    chain_png = tmp_path / "seam_x.png"
    chain_png.write_bytes(b"chain")
    clip = tmp_path / "clip_01.mp4"
    clip.write_bytes(b"mp4")
    url = "https://f/firstframe_01_x.png"
    modal_app._CHAIN_PNG_BY_URL[url] = chain_png

    def _fake_extract(mp4, out):
        out.write_bytes(b"first")
        return out
    monkeypatch.setattr(sc, "extract_first_frame", _fake_extract)
    monkeypatch.setattr(sc, "frame_similarity", lambda a, b: similarity)
    seen = {}
    monkeypatch.setattr(src.events, "log_event", lambda sb, **kw: seen.update(kw))

    modal_app._chain_seam_check(None, "job-1", 1, url, clip)

    assert seen["event"] == "pipeline.chain_seam_check"
    assert seen["level"] == level
    assert seen["details"] == {
        "clip_index": 1, "job_id": "job-1", "similarity": similarity,
        "honored": honored, "first_frame_url": url,
    }
    assert not chain_png.exists()
    assert url not in modal_app._CHAIN_PNG_BY_URL


def test_chain_seam_check_never_raises(tmp_path, monkeypatch):
    import modal_app
    import src.seam_check as sc

    url = "https://f/firstframe_02_y.png"
    chain_png = tmp_path / "seam_y.png"
    chain_png.write_bytes(b"chain")
    modal_app._CHAIN_PNG_BY_URL[url] = chain_png

    def _boom(mp4, out):
        raise RuntimeError("ffmpeg exploded")
    monkeypatch.setattr(sc, "extract_first_frame", _boom)
    modal_app._chain_seam_check(None, "job-1", 2, url, tmp_path / "missing.mp4")
    # Unknown URL (no kept PNG): silent no-op.
    modal_app._chain_seam_check(
        None, "job-1", 2, "https://f/unknown", tmp_path / "x.mp4",
    )
    assert not chain_png.exists()
