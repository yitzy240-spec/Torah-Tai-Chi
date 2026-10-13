"""Offline checks for tools/schema_snapshot.py (the DB parts run in the
db-schema CI job)."""
import copy
import json

import pytest

from tools import schema_snapshot as ss


def test_replay_is_platform_bootstrap_then_migrations_only():
    """No schema shims: the migrations alone must reproduce prod."""
    plan = ss.replay_plan()
    labels = [label for label, _ in plan]
    assert labels[0] == "bootstrap"
    migs = labels[1:]
    assert migs == sorted(migs) and migs[0].startswith("0001_")
    assert all(path.parent == ss.MIGRATIONS_DIR for _, path in plan[1:])
    assert not (ss.SCHEMA_DIR / "prod_drift.sql").exists()
    assert not (ss.SCHEMA_DIR / "before").exists()


def test_backfill_guard_makes_lexical_order_safe():
    """20260517_backfill_videos_title sorts before video_page_redesign, which
    creates the columns it UPDATEs; the backfill now adds them itself."""
    labels = [label for label, _ in ss.replay_plan()]
    assert labels.index("20260517_backfill_videos_title.sql") < labels.index(
        "20260517_video_page_redesign.sql")
    sql = (ss.MIGRATIONS_DIR / "20260517_backfill_videos_title.sql").read_text(encoding="utf-8")
    assert sql.index("ADD COLUMN IF NOT EXISTS title") < sql.index("UPDATE videos")


@pytest.mark.parametrize("url", [
    "postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres",
    "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
])
def test_refuses_remote_databases(url, monkeypatch):
    monkeypatch.delenv("SCHEMA_SNAPSHOT_ALLOW_REMOTE", raising=False)
    with pytest.raises(SystemExit):
        ss._guard_scratch_db(url)


def test_allows_local_database():
    ss._guard_scratch_db("postgresql://postgres:postgres@localhost:5432/tt_schema")


def test_committed_snapshot_is_canonical_and_diff_detects_drift():
    committed = json.loads(ss.SNAPSHOT_PATH.read_text(encoding="utf-8"))
    assert ss.diff(committed, copy.deepcopy(committed)) == []
    fresh = copy.deepcopy(committed)
    fresh["tables"]["clips"]["columns"]["voiceover"]["nullable"] = True
    del fresh["tables"]["jobs"]["checks"]["jobs_kind_check"]
    out = ss.diff(committed, fresh)
    assert any(line.startswith("clips.voiceover") for line in out)
    assert any("jobs_kind_check" in line for line in out)
