from pathlib import Path
import pytest
from tools.move_library import Move, load_moves


MOVES_YAML = Path(__file__).parent.parent / "references" / "tai_chi_moves" / "moves.yaml"


def test_load_moves_returns_all_41_entries():
    moves = load_moves(MOVES_YAML)
    assert len(moves) == 41


def test_load_moves_returns_move_instances():
    moves = load_moves(MOVES_YAML)
    assert all(isinstance(m, Move) for m in moves)


def test_move_has_required_fields():
    moves = load_moves(MOVES_YAML)
    single_whip = next(m for m in moves if m.slug == "single_whip")
    assert single_whip.english == "Single Whip"
    assert single_whip.pinyin == "Dān Biān"
    assert single_whip.section == "yang_24_form"
    assert single_whip.priority == "high"
    assert single_whip.visual.startswith("Wide bow stance")
    assert single_whip.query == "single whip tai chi yang style demonstration"


def test_move_query_defaults_to_english_plus_suffix_when_null():
    moves = load_moves(MOVES_YAML)
    wuji = next(m for m in moves if m.slug == "commencing_form")
    assert wuji.query is None  # stored as None in yaml
    assert wuji.effective_query == "Commencing Form tai chi demonstration"


def test_move_effective_query_uses_override_when_set():
    moves = load_moves(MOVES_YAML)
    sw = next(m for m in moves if m.slug == "single_whip")
    assert sw.effective_query == "single whip tai chi yang style demonstration"


def test_slugs_are_unique():
    moves = load_moves(MOVES_YAML)
    slugs = [m.slug for m in moves]
    assert len(slugs) == len(set(slugs)), "Duplicate slugs detected"


def test_priority_values_are_valid():
    moves = load_moves(MOVES_YAML)
    for m in moves:
        assert m.priority in ("high", "medium", "low"), f"Bad priority on {m.slug}: {m.priority}"


def test_section_values_are_valid():
    moves = load_moves(MOVES_YAML)
    for m in moves:
        assert m.section in ("yang_24_form", "bonus", "warmups_and_stances"), f"Bad section on {m.slug}"
