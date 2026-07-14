from src.settings import (
    DOJO_ANCHOR_TEXT, OUTDOOR_ARCHETYPES, STYLE_LOCK, GUARDRAILS_TEXT,
)


def test_dojo_anchor_text_non_empty():
    assert isinstance(DOJO_ANCHOR_TEXT, str)
    assert len(DOJO_ANCHOR_TEXT) > 50


def test_outdoor_archetypes_at_least_eight():
    assert len(OUTDOOR_ARCHETYPES) >= 8
    for key, val in OUTDOOR_ARCHETYPES.items():
        assert key.isupper(), f"archetype id {key} must be UPPER_SNAKE"
        assert isinstance(val, str) and len(val) > 30


def test_outdoor_archetypes_required_ids_present():
    required = {
        "MOUNTAIN_RIDGE", "GARDEN_PATH", "RIVERSIDE_GROVE", "DESERT_OUTCROP",
        "FOREST_CLEARING", "SEASHORE", "ORCHARD", "HILLTOP_MEADOW",
    }
    assert required <= set(OUTDOOR_ARCHETYPES.keys())


def test_style_lock_mentions_character_and_voice():
    assert "Pixar" in STYLE_LOCK
    assert "yin-yang" in STYLE_LOCK
    assert "voice" in STYLE_LOCK.lower() or "timbre" in STYLE_LOCK.lower()


def test_style_lock_requires_uniform_navy_kippah_without_trim():
    text = STYLE_LOCK.lower()
    assert "uniform navy" in text
    assert "no trim" in text
    assert "decorative band" not in text
    assert "cream-colored" not in text


def test_style_lock_requires_exact_unchanged_shirt_and_logo():
    text = STYLE_LOCK.lower()
    assert "shirt and chest logo must remain unchanged" in text
    assert "match the canonical reference images exactly" in text
    assert "no added, removed, misspelled, rearranged, or duplicated lettering" in text
    assert "no alternate emblem" in text


def test_guardrails_forbids_text_in_frame():
    text = GUARDRAILS_TEXT.lower()
    assert "text" in text
    assert "letters" in text or "letter" in text
