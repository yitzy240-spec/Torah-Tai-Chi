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


from tools.move_library import parse_args


def test_parse_args_defaults():
    args = parse_args([])
    assert args.slug is None
    assert args.priority is None
    assert args.redo is None
    assert args.candidates == 5
    assert args.min_quality == 7
    assert args.model == "google/gemini-3.1-pro-preview"
    assert args.query_override is None


def test_parse_args_slug():
    args = parse_args(["--slug", "single_whip"])
    assert args.slug == "single_whip"


def test_parse_args_priority():
    args = parse_args(["--priority", "high"])
    assert args.priority == "high"


def test_parse_args_redo():
    args = parse_args(["--redo", "cloud_hands"])
    assert args.redo == "cloud_hands"


def test_parse_args_candidates_and_quality():
    args = parse_args(["--candidates", "10", "--min-quality", "5"])
    assert args.candidates == 10
    assert args.min_quality == 5


def test_parse_args_model():
    args = parse_args(["--model", "google/gemini-2.5-pro"])
    assert args.model == "google/gemini-2.5-pro"


def test_parse_args_query_override():
    args = parse_args(["--query-override", "single_whip=single whip fast tai chi"])
    assert args.query_override == "single_whip=single whip fast tai chi"


from unittest.mock import patch
from tools.move_library import check_dependencies, MissingDependencyError


def test_check_dependencies_all_present_returns_none():
    with patch("tools.move_library.shutil.which", return_value="/usr/bin/ffmpeg"), \
         patch("tools.move_library.importlib.util.find_spec", return_value=object()):
        check_dependencies()  # should not raise


def test_check_dependencies_raises_when_ffmpeg_missing():
    with patch("tools.move_library.shutil.which", return_value=None), \
         patch("tools.move_library.importlib.util.find_spec", return_value=object()):
        with pytest.raises(MissingDependencyError) as exc:
            check_dependencies()
        assert "ffmpeg" in str(exc.value)


def test_check_dependencies_raises_when_python_pkg_missing():
    with patch("tools.move_library.shutil.which", return_value="/usr/bin/ffmpeg"), \
         patch("tools.move_library.importlib.util.find_spec", return_value=None):
        with pytest.raises(MissingDependencyError) as exc:
            check_dependencies()
        assert "pip install" in str(exc.value)
