import pytest

# make_outro/make_outro_card import Pillow (PIL) at module load; CI installs
# only the lightweight `.[dev]` extras, so skip rather than fail collection.
pytest.importorskip("PIL")

from tools import make_outro, make_outro_card  # noqa: E402


def test_outro_generators_use_canonical_lowercase_domain():
    assert make_outro.OUTRO_URL == "TorahTaiChi.com"
    assert make_outro_card.OUTRO_URL == make_outro.OUTRO_URL
