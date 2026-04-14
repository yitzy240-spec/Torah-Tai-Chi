import pytest
from pathlib import Path
from src.parsha_data import load_parshiot, get_parsha, get_parsha_script

FIXTURE = Path(__file__).parent / "fixtures" / "parshiot_sample.json"


def test_load_parshiot_returns_dict():
    parshiot = load_parshiot(FIXTURE)
    assert "Vayikra" in parshiot
    assert parshiot["Vayikra"]["book"] == "Leviticus"


def test_get_parsha_hit():
    p = get_parsha("Vayikra", FIXTURE)
    assert p["name"] == "Vayikra"
    assert p["order"] == 25


def test_get_parsha_miss_raises():
    with pytest.raises(KeyError):
        get_parsha("DoesNotExist", FIXTURE)


def test_get_parsha_case_insensitive():
    p = get_parsha("vayikra", FIXTURE)
    assert p["name"] == "Vayikra"


def test_get_parsha_script_option_a():
    s = get_parsha_script("Vayikra", "A", FIXTURE)
    assert s["title"] == "The Call Behind the Call"
    assert "[HOOK]" in s["draft"]


def test_get_parsha_script_missing_option_raises():
    with pytest.raises(KeyError):
        get_parsha_script("Vayikra", "Z", FIXTURE)
