"""Offline checks for tools/schema_snapshot.py (the DB parts run in the
db-schema CI job)."""
import copy
import json

import pytest

from tools import schema_snapshot as ss


def test_replay_plan_order():
    labels = [label for label, _ in ss.replay_plan()]
    assert labels[0] == "bootstrap"
    assert labels[-1] == "prod_drift"
    migs = [lbl for lbl in labels if not lbl.startswith(("before/", "bootstrap", "prod_drift"))]
    assert migs == sorted(migs) and migs[0].startswith("0001_")
    # Replay-order shim lands immediately before its migration.
    i = labels.index("before/20260517_backfill_videos_title.sql")
    assert labels[i + 1] == "20260517_backfill_videos_title.sql"
    assert labels.index("20260517_video_page_redesign.sql") > i + 1


def test_every_before_shim_matches_a_real_migration():
    names = {p.name for p in ss.MIGRATIONS_DIR.glob("*.sql")}
    for shim in ss.BEFORE_DIR.glob("*.sql"):
        assert shim.name in names, f"orphan replay shim {shim.name}"


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
