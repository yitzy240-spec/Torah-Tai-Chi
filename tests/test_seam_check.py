from pathlib import Path

import pytest

from src.seam_check import HONORED_THRESHOLD, frame_similarity
from src.settings import CHAIN_CONTINUITY_LOCK

Image = pytest.importorskip("PIL.Image")
ImageDraw = pytest.importorskip("PIL.ImageDraw")


def _close_up(path: Path) -> Path:
    # Big head-and-shoulders blob filling the frame.
    im = Image.new("RGB", (720, 1280), (200, 190, 170))
    d = ImageDraw.Draw(im)
    d.ellipse((60, 200, 660, 1100), fill=(30, 30, 40))
    im.save(path)
    return path


def _wide(path: Path) -> Path:
    # Small full-body figure in a bright room.
    im = Image.new("RGB", (720, 1280), (245, 245, 240))
    d = ImageDraw.Draw(im)
    d.rectangle((320, 500, 400, 1000), fill=(200, 60, 40))
    im.save(path)
    return path


def test_identical_frames_score_one(tmp_path):
    a = _close_up(tmp_path / "a.png")
    assert frame_similarity(a, a) == pytest.approx(1.0)


def test_different_shots_score_below_threshold(tmp_path):
    a = _close_up(tmp_path / "a.png")
    b = _wide(tmp_path / "b.png")
    assert frame_similarity(a, b) < HONORED_THRESHOLD == 0.92


def test_jpeg_noise_still_counts_as_honored(tmp_path):
    a = _close_up(tmp_path / "a.png")
    noisy = tmp_path / "a.jpg"
    Image.open(a).resize((480, 854)).save(noisy, quality=40)
    assert frame_similarity(a, noisy) >= HONORED_THRESHOLD


def test_chain_continuity_lock_opens_on_first_frame():
    assert CHAIN_CONTINUITY_LOCK.startswith(
        "Begin exactly on the provided first frame, at the same framing and "
        "camera distance, then hold that framing"
    )
    assert "CONTINUITY: this clip continues directly" in CHAIN_CONTINUITY_LOCK
