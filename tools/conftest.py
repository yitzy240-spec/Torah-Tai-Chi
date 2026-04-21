import pytest
from pathlib import Path


@pytest.fixture
def sample_video(tmp_path):
    """Path to the 2-second fixture video used for ffmpeg tests."""
    src = Path(__file__).parent / "fixtures" / "sample.mp4"
    assert src.exists(), f"Missing fixture at {src}. Generate via Task 1."
    return src
