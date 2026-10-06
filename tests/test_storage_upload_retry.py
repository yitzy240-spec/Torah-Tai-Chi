"""Guards for mp4 uploads to the videos bucket.

Every mp4 upload in modal_app.py happens AFTER Kie has billed the render.
Bereishit 2026-10-05: clip 5's re-render was saved, then the stitched-preview
upload hit a one-off empty-body error from Supabase Storage ("JSONDecodeError:
Expecting value"), the job went 'failed', and the dashboard hid the paid clip.
All uploads now go through _upload_mp4, which retries.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

RAW_UPLOAD = re.compile(r'\.storage\.from_\("videos"\)\.upload\(')


def test_only_the_helper_uploads_to_the_videos_bucket():
    text = (ROOT / "modal_app.py").read_text(encoding="utf-8")
    helper = text.index("def _upload_mp4(")
    helper_end = text.index("\ndef ", helper + 1)
    hits = [
        text[: m.start()].count("\n") + 1
        for m in RAW_UPLOAD.finditer(text)
        if not helper <= m.start() < helper_end
    ]
    assert not hits, (
        f"modal_app.py: raw videos-bucket upload at lines {hits} — use "
        f"_upload_mp4() so a storage blip doesn't fail a paid render"
    )


class _FlakyBucket:
    def __init__(self, failures: int):
        self.failures = failures
        self.calls = []

    def upload(self, path, data, file_options=None):
        self.calls.append((path, file_options))
        if len(self.calls) <= self.failures:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return {"Key": path}


class _FakeSb:
    def __init__(self, bucket):
        self.bucket = bucket
        self.storage = self

    def from_(self, name):
        assert name == "videos"
        return self.bucket


@pytest.fixture
def upload(monkeypatch):
    pytest.importorskip("modal")
    import modal_app
    monkeypatch.setattr(modal_app.time, "sleep", lambda s: None)
    return modal_app._upload_mp4


def test_retries_a_transient_failure_then_succeeds(upload):
    bucket = _FlakyBucket(failures=2)
    upload(_FakeSb(bucket), "jobs/x/final.mp4", b"mp4")
    assert len(bucket.calls) == 3
    path, opts = bucket.calls[-1]
    assert path == "jobs/x/final.mp4"
    assert opts == {"content-type": "video/mp4", "upsert": "true"}


def test_gives_up_after_three_attempts(upload):
    bucket = _FlakyBucket(failures=99)
    with pytest.raises(ValueError):
        upload(_FakeSb(bucket), "jobs/x/final.mp4", b"mp4")
    assert len(bucket.calls) == 3
