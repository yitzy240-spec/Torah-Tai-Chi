"""Early Kie task_id persistence — a billed render must stay recoverable.

Regression for the clips_only_job bug where a bare
{job_id, index, seedance_task_id} upsert ran AFTER polling and 23502'd
on NOT NULL voiceover for a fresh job, losing a paid render.
"""
from pathlib import Path

import pytest

import src.kie_task_persist as ktp
from src.kie_task_persist import (
    build_pending_clip_row,
    kie_result_urls,
    log_paid_render_unsaved,
    persist_kie_task_id,
)
from src.models import Clip
from src.video_generator import generate_clip_with_meta


def _clip() -> Clip:
    return Clip(index=3, voiceover="Shalom.", visual_prompt="Rav Eli bows, dolly in",
                duration_s=8, setting_id="DOJO")


class _FakeKie:
    """Records call order; never touches the network."""

    def __init__(self, calls: list):
        self.calls = calls

    async def create_task(self, model, payload):
        self.calls.append("create_task")
        return "t-123"

    async def poll_task(self, task_id):
        self.calls.append(f"poll_task:{task_id}")
        return ["https://cdn/clip.mp4"], {"state": "success"}

    async def download(self, url, dest):
        self.calls.append("download")
        Path(dest).write_bytes(b"video")


class _FakeQuery:
    def __init__(self, sb, table):
        self.sb, self.table = sb, table

    def upsert(self, row, on_conflict=None):
        self.sb.upserts.append((self.table, row, on_conflict))
        return self

    def insert(self, row):
        self.sb.inserts.append((self.table, row))
        return self

    def execute(self):
        if self.sb.fail_tables and self.table in self.sb.fail_tables:
            raise RuntimeError('23502 null value in column "voiceover"')
        return None


class _FakeSB:
    def __init__(self, fail_tables=()):
        self.upserts: list = []
        self.inserts: list = []
        self.fail_tables = set(fail_tables)

    def table(self, name):
        return _FakeQuery(self, name)


async def _gen(client, tmp_path, **kw):
    return await generate_clip_with_meta(
        client, _clip(),
        character_ref_urls=["https://x/c.png"],
        dojo_ref_urls=["https://x/d.png"],
        dest=tmp_path / "clip.mp4",
        **kw,
    )


# ── generate_clip_with_meta callback ordering ────────────────────────────

async def test_sync_callback_invoked_after_create_before_poll(tmp_path):
    calls: list = []
    _, _, task_id = await _gen(
        _FakeKie(calls), tmp_path,
        on_task_created=lambda tid: calls.append(f"cb:{tid}"),
    )
    assert task_id == "t-123"
    assert calls == ["create_task", "cb:t-123", "poll_task:t-123", "download"]


async def test_async_callback_awaited_before_poll(tmp_path):
    calls: list = []

    async def cb(tid):
        calls.append(f"cb:{tid}")

    await _gen(_FakeKie(calls), tmp_path, on_task_created=cb)
    assert calls.index("cb:t-123") < calls.index("poll_task:t-123")


async def test_callback_not_invoked_on_resume(tmp_path):
    calls: list = []
    await _gen(
        _FakeKie(calls), tmp_path, resume_task_id="t-old",
        on_task_created=lambda tid: calls.append(f"cb:{tid}"),
    )
    assert calls == ["poll_task:t-old", "download"]


# ── persist row shape ────────────────────────────────────────────────────

def test_pending_row_carries_all_not_null_columns():
    row = build_pending_clip_row("job-1", _clip(), "t-123", "bow", "https://m/bow.mp4")
    assert row["voiceover"] == "Shalom."
    assert row["visual_prompt"] == "Rav Eli bows, dolly in"
    assert row["setting_id"] == "DOJO"
    assert row["duration_s"] == 8
    assert row["seedance_task_id"] == "t-123"
    assert row["motion_ref_slug"] == "bow"
    assert row["motion_ref_url"] == "https://m/bow.mp4"
    assert row["status"] == "pending"
    # Must not clobber a prior storage_path with NULL.
    assert "storage_path" not in row


def test_persist_upserts_full_row_with_voiceover():
    sb = _FakeSB()
    assert persist_kie_task_id(sb, "job-1", _clip(), "t-123") is True
    [(table, row, conflict)] = sb.upserts
    assert table == "clips"
    assert conflict == "job_id,index"
    assert row["voiceover"] == "Shalom."
    assert row["seedance_task_id"] == "t-123"


async def test_persist_wired_as_callback_runs_before_poll(tmp_path):
    calls: list = []
    sb = _FakeSB()

    def cb(tid):
        persist_kie_task_id(sb, "job-1", _clip(), tid)
        calls.append("persisted")

    await _gen(_FakeKie(calls), tmp_path, on_task_created=cb)
    assert calls.index("persisted") < calls.index("poll_task:t-123")
    assert sb.upserts[0][1]["voiceover"] == "Shalom."


# ── best-effort: persist failure never aborts the render ────────────────

async def test_persist_failure_does_not_abort_render(tmp_path, monkeypatch):
    events: list = []
    monkeypatch.setattr(ktp, "log_event", lambda sb, **kw: events.append(kw))
    calls: list = []
    sb = _FakeSB(fail_tables={"clips"})

    path, meta, task_id = await _gen(
        _FakeKie(calls), tmp_path,
        on_task_created=lambda tid: persist_kie_task_id(sb, "job-1", _clip(), tid),
    )

    assert task_id == "t-123"
    assert meta["state"] == "success"
    assert path.read_bytes() == b"video"
    assert "poll_task:t-123" in calls
    [ev] = events
    assert ev["level"] == "warn"
    assert ev["event"] == "kie.task_id_persist_failed"
    assert ev["details"]["task_id"] == "t-123"


# ── paid-render-unsaved recovery trail ──────────────────────────────────

def test_kie_result_urls_handles_string_dict_and_garbage():
    assert kie_result_urls({"resultJson": '{"resultUrls": ["a", "b"]}'}) == ["a", "b"]
    assert kie_result_urls({"resultJson": {"resultUrls": ["c"]}}) == ["c"]
    assert kie_result_urls({"resultJson": "not json"}) == []
    assert kie_result_urls(None) == []


def test_log_paid_render_unsaved_records_recovery_details(monkeypatch):
    events: list = []
    monkeypatch.setattr(ktp, "log_event", lambda sb, **kw: events.append(kw))
    log_paid_render_unsaved(
        None, "job-1", 3, "t-123",
        {"resultJson": '{"resultUrls": ["https://kie/out.mp4"]}'},
        RuntimeError("upload failed"),
    )
    [ev] = events
    assert ev["level"] == "error"
    assert ev["event"] == "kie.paid_render_unsaved"
    d = ev["details"]
    assert d["task_id"] == "t-123"
    assert d["clip_index"] == 3
    assert d["job_id"] == "job-1"
    assert d["result_urls"] == ["https://kie/out.mp4"]
