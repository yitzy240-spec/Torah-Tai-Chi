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


from unittest.mock import patch, MagicMock
from tools.move_library import search_youtube


def test_search_youtube_returns_list_of_urls():
    fake_response = {
        "entries": [
            {"webpage_url": "https://www.youtube.com/watch?v=A"},
            {"webpage_url": "https://www.youtube.com/watch?v=B"},
            {"webpage_url": "https://www.youtube.com/watch?v=C"},
        ]
    }
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.extract_info.return_value = fake_response
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl):
        urls = search_youtube("cloud hands tai chi", n=3)
    assert urls == [
        "https://www.youtube.com/watch?v=A",
        "https://www.youtube.com/watch?v=B",
        "https://www.youtube.com/watch?v=C",
    ]


def test_search_youtube_skips_entries_without_url():
    fake_response = {
        "entries": [
            {"webpage_url": "https://www.youtube.com/watch?v=A"},
            {},  # broken entry
            {"webpage_url": "https://www.youtube.com/watch?v=C"},
        ]
    }
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.extract_info.return_value = fake_response
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl):
        urls = search_youtube("query", n=3)
    assert len(urls) == 2


from tools.move_library import download_candidate


def test_download_candidate_calls_ytdlp_with_correct_options(tmp_path):
    fake_ydl = MagicMock()
    fake_ydl.__enter__.return_value.download.return_value = 0
    # Simulate yt-dlp writing an output file with .mp4 extension
    (tmp_path / "x.mp4").write_bytes(b"dummy video data")
    with patch("tools.move_library.yt_dlp.YoutubeDL", return_value=fake_ydl) as ctor:
        out = download_candidate("https://youtube.com/watch?v=abc", tmp_path / "x.mp4")
    assert out.exists()
    assert out.parent == tmp_path
    opts = ctor.call_args[0][0]
    assert "format" in opts
    assert "outtmpl" in opts


from tools.move_library import extract_frames, FrameSample


def test_extract_frames_returns_n_samples(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=4, out_dir=tmp_path)
    assert len(samples) == 4
    assert all(isinstance(s, FrameSample) for s in samples)


def test_extract_frames_timestamps_evenly_spaced(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=4, out_dir=tmp_path)
    # 2-second video, 4 samples → timestamps roughly at 0.25, 0.75, 1.25, 1.75
    timestamps = [s.timestamp_sec for s in samples]
    assert timestamps[0] < 0.5
    assert timestamps[-1] > 1.0
    assert all(timestamps[i+1] > timestamps[i] for i in range(len(timestamps) - 1))


def test_extract_frames_produces_valid_images(sample_video, tmp_path):
    samples = extract_frames(sample_video, n=2, out_dir=tmp_path)
    for s in samples:
        assert s.image_path.exists()
        assert s.image_path.stat().st_size > 100  # non-trivial JPEG


from tools.move_library import (
    CandidateReview,
    build_review_prompt,
    parse_review_response,
    review_candidate,
)


def test_build_review_prompt_contains_move_info():
    move = Move(
        slug="single_whip",
        english="Single Whip",
        pinyin="Dān Biān",
        section="yang_24_form",
        order=9,
        priority="high",
        visual="Wide bow stance with arms extended...",
    )
    prompt = build_review_prompt(move)
    assert "Single Whip" in prompt
    assert "Dān Biān" in prompt
    assert "Wide bow stance" in prompt
    assert "matches" in prompt
    assert "fits_in_15s" in prompt
    assert "quality" in prompt
    assert "best_start_sec" in prompt
    assert "10-15" in prompt  # explicit duration requirement in new prompt


def test_parse_review_response_valid_json():
    raw = '{"matches": true, "fits_in_15s": true, "quality": 8, "best_start_sec": 3, "best_duration_sec": 12, "reason": "clean"}'
    r = parse_review_response(raw)
    assert r.matches is True
    assert r.fits_in_15s is True
    assert r.quality == 8
    assert r.best_start_sec == 3
    assert r.best_duration_sec == 12
    assert r.reason == "clean"


def test_parse_review_response_with_surrounding_prose():
    raw = 'Here is my review:\n```json\n{"matches": false, "fits_in_15s": false, "quality": 3, "best_start_sec": 0, "best_duration_sec": 10, "reason": "wrong move"}\n```\nDone.'
    r = parse_review_response(raw)
    assert r.matches is False
    assert r.fits_in_15s is False
    assert r.quality == 3


def test_parse_review_response_clamps_duration_to_15():
    raw = '{"matches": true, "fits_in_15s": true, "quality": 9, "best_start_sec": 0, "best_duration_sec": 30, "reason": "ok"}'
    r = parse_review_response(raw)
    assert r.best_duration_sec == 15  # clamped


def test_parse_review_response_missing_fits_field_defaults_false():
    # older responses without the new field default to fits_in_15s=False (safe)
    raw = '{"matches": true, "quality": 7, "best_start_sec": 0, "best_duration_sec": 12, "reason": "old schema"}'
    r = parse_review_response(raw)
    assert r.fits_in_15s is False


def test_review_candidate_posts_video_to_openrouter(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    move = Move(
        slug="x", english="X", pinyin="X", section="bonus", order=1,
        priority="low", visual="V",
    )
    # Minimal "video" file — content is base64-encoded but never actually decoded by test
    video_path = tmp_path / "candidate.mp4"
    video_path.write_bytes(b"fake-mp4-bytes")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": '{"matches": true, "fits_in_15s": true, "quality": 8, "best_start_sec": 0, "best_duration_sec": 12, "reason": "ok"}'}}]
    }
    mock_resp.raise_for_status = MagicMock()
    with patch("tools.move_library.httpx.post", return_value=mock_resp) as mock_post:
        r = review_candidate(move, video_path, model="google/gemini-3.1-pro-preview")
    assert r.quality == 8
    assert r.fits_in_15s is True
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["headers"]["Authorization"] == "Bearer fake-key"
    # Verify the content block uses video_url with the expected data-URL prefix
    content = call_kwargs["json"]["messages"][0]["content"]
    video_block = next(c for c in content if c.get("type") == "video_url")
    assert video_block["video_url"]["url"].startswith("data:video/mp4;base64,")
    # Verify max_tokens is bumped to 6000
    assert call_kwargs["json"]["max_tokens"] == 6000


from tools.move_library import trim_and_encode


def test_trim_and_encode_produces_output(sample_video, tmp_path):
    out = tmp_path / "trimmed.mp4"
    trim_and_encode(sample_video, out, start_sec=0, duration_sec=1)
    assert out.exists()
    assert out.stat().st_size > 1000


def test_trim_and_encode_duration_enforced(sample_video, tmp_path):
    out = tmp_path / "trimmed.mp4"
    trim_and_encode(sample_video, out, start_sec=0, duration_sec=1)
    # Check duration via ffprobe
    from tools.move_library import get_video_duration
    d = get_video_duration(out)
    assert 0.8 <= d <= 1.2


from tools.move_library import process_move, PipelineResult


def test_process_move_picks_highest_quality_above_threshold(tmp_path, monkeypatch):
    move = Move(slug="test", english="Test Move", pinyin="T", section="bonus",
                order=1, priority="high", visual="V")

    lib_root = tmp_path / "tai_chi_moves"

    monkeypatch.setattr("tools.move_library.search_youtube",
                        lambda q, n, max_duration_sec=120: ["url1", "url2"])

    dl_paths = [lib_root / ".candidates" / "test" / "1.mp4",
                lib_root / ".candidates" / "test" / "2.mp4"]
    for p in dl_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"fake")

    monkeypatch.setattr("tools.move_library.download_candidate",
                        lambda url, out_path: out_path)

    reviews = iter([
        CandidateReview(matches=True, fits_in_15s=True, quality=5, best_start_sec=0, best_duration_sec=10, reason="ok"),
        CandidateReview(matches=True, fits_in_15s=True, quality=9, best_start_sec=2, best_duration_sec=12, reason="great"),
    ])
    monkeypatch.setattr("tools.move_library.review_candidate",
                        lambda m, video_path, model: next(reviews))
    monkeypatch.setattr("tools.move_library.trim_and_encode",
                        lambda src, dst, start_sec, duration_sec: dst.write_bytes(b"trimmed") or dst)

    result = process_move(move, library_root=lib_root, candidates=2,
                          min_quality=7, model="google/gemini-3.1-pro-preview")

    assert result.status == "completed"
    assert result.chosen_quality == 9
    assert result.final_clip_path.exists()


def test_process_move_rejects_candidates_that_dont_fit(tmp_path, monkeypatch):
    """The right move demonstrated too slowly (fits_in_15s=False) must be rejected."""
    move = Move(slug="slow_move", english="Slow Move", pinyin="S", section="bonus",
                order=1, priority="high", visual="V")
    lib_root = tmp_path / "tai_chi_moves"

    monkeypatch.setattr("tools.move_library.search_youtube",
                        lambda q, n, max_duration_sec=120: ["url1", "url2"])
    monkeypatch.setattr("tools.move_library.download_candidate",
                        lambda url, out_path: out_path.parent.mkdir(parents=True, exist_ok=True) or out_path.write_bytes(b"fake") or out_path)
    reviews = iter([
        # Right move, demonstrated too slowly — must not win
        CandidateReview(matches=True, fits_in_15s=False, quality=0, best_start_sec=0, best_duration_sec=10, reason="move always exceeds 15s"),
        CandidateReview(matches=True, fits_in_15s=False, quality=0, best_start_sec=0, best_duration_sec=10, reason="partial reps only"),
    ])
    monkeypatch.setattr("tools.move_library.review_candidate",
                        lambda m, video_path, model: next(reviews))

    result = process_move(move, library_root=lib_root, candidates=2,
                          min_quality=7, model="google/gemini-3.1-pro-preview")

    assert result.status == "needs_review"
    assert "fits" in result.notes.lower() or "window" in result.notes.lower()


def test_process_move_leaves_review_md_when_all_fail(tmp_path, monkeypatch):
    move = Move(slug="test", english="Test", pinyin="T", section="bonus",
                order=1, priority="low", visual="V")
    lib_root = tmp_path / "tai_chi_moves"

    monkeypatch.setattr("tools.move_library.search_youtube",
                        lambda q, n, max_duration_sec=120: ["url1", "url2"])
    monkeypatch.setattr("tools.move_library.download_candidate",
                        lambda url, out_path: out_path.parent.mkdir(parents=True, exist_ok=True) or out_path.write_bytes(b"fake") or out_path)
    reviews = iter([
        CandidateReview(matches=False, fits_in_15s=False, quality=2, best_start_sec=0, best_duration_sec=10, reason="wrong"),
        CandidateReview(matches=False, fits_in_15s=False, quality=3, best_start_sec=0, best_duration_sec=10, reason="nope"),
    ])
    monkeypatch.setattr("tools.move_library.review_candidate",
                        lambda m, video_path, model: next(reviews))

    result = process_move(move, library_root=lib_root, candidates=2,
                          min_quality=7, model="google/gemini-3.1-pro-preview")

    assert result.status == "needs_review"
    review_md = lib_root / ".candidates" / "test" / "review.md"
    assert review_md.exists()
    text = review_md.read_text()
    assert "quality" in text
    assert "fits_in_15s" in text


from tools.move_library import describe_clip, write_sidecar, run_describe_pass
import json as _json


def test_describe_clip_posts_video_and_returns_description(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    move = Move(slug="x", english="Single Whip", pinyin="Dān Biān",
                section="yang_24_form", order=9, priority="high",
                visual="Wide bow stance...")
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake-mp4")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": '{"motion_description": "Right hand rises past the face, extends left as the body rotates 45 degrees."}'}}]
    }
    mock_resp.raise_for_status = MagicMock()
    with patch("tools.move_library.httpx.post", return_value=mock_resp) as mock_post:
        desc = describe_clip(move, video, model="google/gemini-3.1-pro-preview")
    assert "rises past the face" in desc
    content = mock_post.call_args.kwargs["json"]["messages"][0]["content"]
    video_block = next(c for c in content if c.get("type") == "video_url")
    assert video_block["video_url"]["url"].startswith("data:video/mp4;base64,")


def test_write_sidecar_creates_parseable_json(tmp_path):
    move = Move(slug="white_crane_spreads_wings",
                english="White Crane Spreads Its Wings",
                pinyin="Báihè Liàngchì",
                section="yang_24_form", order=3, priority="high",
                visual="Stands on right leg...")
    sidecar = write_sidecar(move, "Right hand rises above forehead.", tmp_path)
    assert sidecar.exists()
    data = _json.loads(sidecar.read_text(encoding="utf-8"))
    assert data["slug"] == "white_crane_spreads_wings"
    assert data["english"] == "White Crane Spreads Its Wings"
    assert data["pinyin"] == "Báihè Liàngchì"
    assert data["motion_description"] == "Right hand rises above forehead."


def test_write_sidecar_preserves_existing_fields(tmp_path):
    move = Move(slug="x", english="X", pinyin="X", section="bonus",
                order=1, priority="low", visual="V")
    # First write adds a custom field
    initial = tmp_path / "x.json"
    initial.write_text(_json.dumps({"source_url": "https://youtu.be/abc",
                                    "quality_score": 9,
                                    "motion_description": "old"}),
                       encoding="utf-8")
    # Re-run describe — should update motion_description but keep source_url/quality_score
    write_sidecar(move, "new description", tmp_path)
    data = _json.loads(initial.read_text(encoding="utf-8"))
    assert data["motion_description"] == "new description"
    assert data["source_url"] == "https://youtu.be/abc"
    assert data["quality_score"] == 9


def test_call_openrouter_retries_on_5xx(tmp_path, monkeypatch):
    """Two 502s then a 200 -> helper retries transparently and returns the content."""
    from tools.move_library import _call_openrouter
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    monkeypatch.setattr("tools.move_library.time.sleep", lambda s: None)  # skip backoff in tests

    # Response sequence: 502, 502, 200-with-choices
    bad_resp = MagicMock()
    bad_resp.status_code = 502
    bad_resp.text = "Bad Gateway"

    good_resp = MagicMock()
    good_resp.status_code = 200
    good_resp.raise_for_status = MagicMock()
    good_resp.json.return_value = {
        "choices": [{"message": {"content": '{"ok": true}'}}]
    }

    with patch("tools.move_library.httpx.post",
               side_effect=[bad_resp, bad_resp, good_resp]) as mock_post:
        result = _call_openrouter(model="google/gemini-3.1-pro-preview",
                                   content=[{"type": "text", "text": "hi"}])
    assert result == '{"ok": true}'
    assert mock_post.call_count == 3


def test_call_openrouter_retries_on_missing_choices(tmp_path, monkeypatch):
    """200 OK but no 'choices' key -> retry."""
    from tools.move_library import _call_openrouter
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    monkeypatch.setattr("tools.move_library.time.sleep", lambda s: None)

    no_choices = MagicMock()
    no_choices.status_code = 200
    no_choices.raise_for_status = MagicMock()
    no_choices.json.return_value = {"error": "filtered"}  # no 'choices' key

    good_resp = MagicMock()
    good_resp.status_code = 200
    good_resp.raise_for_status = MagicMock()
    good_resp.json.return_value = {
        "choices": [{"message": {"content": "recovered"}}]
    }

    with patch("tools.move_library.httpx.post",
               side_effect=[no_choices, good_resp]) as mock_post:
        result = _call_openrouter(model="google/gemini-3.1-pro-preview",
                                   content=[{"type": "text", "text": "hi"}])
    assert result == "recovered"
    assert mock_post.call_count == 2


def test_call_openrouter_raises_after_attempts_exhausted(tmp_path, monkeypatch):
    """All attempts return 500 -> helper raises RuntimeError, attempts times."""
    from tools.move_library import _call_openrouter
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-key")
    monkeypatch.setattr("tools.move_library.time.sleep", lambda s: None)

    bad = MagicMock()
    bad.status_code = 500
    bad.text = "Internal Server Error"

    with patch("tools.move_library.httpx.post",
               return_value=bad) as mock_post:
        with pytest.raises(RuntimeError, match="failed after 3 attempts"):
            _call_openrouter(model="google/gemini-3.1-pro-preview",
                              content=[{"type": "text", "text": "hi"}])
    assert mock_post.call_count == 3


def test_run_describe_pass_skips_moves_without_clip(tmp_path, monkeypatch):
    # Set up a library_root with moves.yaml but no clips
    lib = tmp_path / "library"
    lib.mkdir()
    yaml = lib / "moves.yaml"
    yaml.write_text("moves:\n"
                    "  - slug: a\n    english: A\n    pinyin: A\n"
                    "    section: bonus\n    order: 1\n    priority: low\n"
                    "    visual: V\n    query: null\n", encoding="utf-8")
    # No clips on disk → describe pass is a no-op
    calls = []
    monkeypatch.setattr("tools.move_library.describe_clip",
                        lambda m, v, model: calls.append(m.slug) or "desc")
    rc = run_describe_pass(lib, model="google/gemini-3.1-pro-preview")
    assert rc == 0
    assert calls == []
