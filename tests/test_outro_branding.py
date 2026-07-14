from tools import make_outro, make_outro_card


def test_outro_generators_use_canonical_lowercase_domain():
    assert make_outro.OUTRO_URL == "TorahTaiChi.com"
    assert make_outro_card.OUTRO_URL == make_outro.OUTRO_URL
