"""Money-path hardening: once Kie has billed a task, a transient failure
in poll / download / DB write must not lose the render, and a final
failure must leave a structured recovery trail (task_id + result URLs).
"""
from pathlib import Path

import httpx
import pytest
import respx
from httpx import Response

import src.kie_task_persist as ktp
from src.kie_client import KieClient, KieTaskFailed
from src.kie_task_persist import (
    build_done_clip_row,
    record_kie_task_created,
    retry_db_write,
    save_paid_clip,
    unsaved_render_logger,
)
from src.models import Clip
from src.video_generator import KieRenderNotSaved, generate_clip_with_meta

RESULT = '{"resultUrls": ["https://cdn/out.mp4"]}'


def _clip() -> Clip:
    return Clip(index=2, voiceover="Shalom.", visual_prompt="Rav Eli bows",
                duration_s=8, setting_id="DOJO")


@pytest.fixture
def events(monkeypatch):
    got: list = []
    monkeypatch.setattr(ktp, "log_event", lambda sb, **kw: got.append(kw))
    return got


@pytest.fixture
def no_download_waits(monkeypatch):
    monkeypatch.setattr(KieClient, "DOWNLOAD_RETRY_WAITS_S", (0, 0, 0))


# ── poll: garbled resultJson on a billed success is transient ───────────

async def test_poll_retries_unparseable_result_json():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-rj").mock(side_effect=[
            Response(200, json={"code": 200, "data": {
                "state": "success", "resultJson": '{"resultUrls": ["https://cdn/'}}),
            Response(200, json={"code": 200, "data": {
                "state": "success", "resultJson": RESULT}}),
        ])
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, _ = await client.poll_task("t-rj")
    assert urls == ["https://cdn/out.mp4"]


async def test_poll_retries_non_object_body():
    async with respx.mock(assert_all_called=False) as mock:
        mock.get(url__regex=r".*recordInfo.*taskId=t-list").mock(side_effect=[
            Response(200, json=["not", "an", "object"]),
            Response(200, json={"code": 200, "data": {
                "state": "success", "resultJson": RESULT}}),
        ])
        client = KieClient(api_key="k", poll_interval_s=0, poll_timeout_s=30)
        urls, _ = await client.poll_task("t-list")
    assert urls == ["https://cdn/out.mp4"]


# ── download: retries transient failures, never leaves a partial file ───

async def test_download_retries_5xx_then_succeeds(tmp_path, no_download_waits):
    dest = tmp_path / "clip.mp4"
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.get("https://cdn/out.mp4").mock(side_effect=[
            Response(503), httpx.ReadTimeout("slow"), Response(200, content=b"mp4"),
        ])
        await KieClient(api_key="k").download("https://cdn/out.mp4", dest)
    assert route.call_count == 3
    assert dest.read_bytes() == b"mp4"
    assert not (tmp_path / "clip.mp4.part").exists()


async def test_download_retries_empty_body(tmp_path, no_download_waits):
    dest = tmp_path / "clip.mp4"
    async with respx.mock(assert_all_called=False) as mock:
        mock.get("https://cdn/out.mp4").mock(side_effect=[
            Response(200, content=b""), Response(200, content=b"mp4"),
        ])
        await KieClient(api_key="k").download("https://cdn/out.mp4", dest)
    assert dest.read_bytes() == b"mp4"


async def test_download_raises_after_exhausting_retries(tmp_path, no_download_waits):
    dest = tmp_path / "clip.mp4"
    async with respx.mock(assert_all_called=False) as mock:
        route = mock.get("https://cdn/out.mp4").mock(return_value=Response(502))
        with pytest.raises(httpx.HTTPStatusError):
            await KieClient(api_key="k").download("https://cdn/out.mp4", dest)
    assert route.call_count == len(KieClient.DOWNLOAD_RETRY_WAITS_S) + 1
    assert not dest.exists()


# ── generate_clip_with_meta: post-billing failures are recoverable ──────

class _Kie:
    def __init__(self, poll_exc=None, download_exc=None):
        self.poll_exc, self.download_exc = poll_exc, download_exc

    async def create_task(self, model, payload):
        return "t-9"

    async def poll_task(self, task_id):
        if self.poll_exc:
            raise self.poll_exc
        return ["https://cdn/out.mp4"], {"state": "success", "resultJson": RESULT}

    async def download(self, url, dest):
        if self.download_exc:
            raise self.download_exc
        Path(dest).write_bytes(b"mp4")


async def _gen(kie, tmp_path, **kw):
    return await generate_clip_with_meta(
        kie, _clip(), character_ref_urls=[], dojo_ref_urls=[],
        dest=tmp_path / "clip.mp4", **kw,
    )


async def test_download_failure_raises_with_task_id_and_urls(tmp_path):
    seen: list = []
    with pytest.raises(KieRenderNotSaved) as ei:
        await _gen(
            _Kie(download_exc=httpx.ReadTimeout("cdn")), tmp_path,
            on_unsaved=lambda tid, meta, err: seen.append((tid, meta, err)),
        )
    assert ei.value.task_id == "t-9"
    assert ei.value.result_urls == ["https://cdn/out.mp4"]
    assert "t-9" in str(ei.value)  # lands in jobs.error_message
    [(tid, meta, err)] = seen
    assert tid == "t-9" and meta["state"] == "success"
    assert isinstance(err, httpx.ReadTimeout)


async def test_poll_timeout_raises_with_task_id(tmp_path):
    seen: list = []
    with pytest.raises(KieRenderNotSaved) as ei:
        await _gen(
            _Kie(poll_exc=TimeoutError("poll timeout")), tmp_path,
            on_unsaved=lambda tid, meta, err: seen.append((tid, meta)),
        )
    assert ei.value.task_id == "t-9"
    assert ei.value.result_urls == []
    assert seen == [("t-9", None)]


async def test_definitive_kie_failure_is_not_wrapped(tmp_path):
    seen: list = []
    with pytest.raises(KieTaskFailed):
        await _gen(
            _Kie(poll_exc=KieTaskFailed("X: bad prompt")), tmp_path,
            on_unsaved=lambda *a: seen.append(a),
        )
    assert seen == []


async def test_broken_on_unsaved_hook_does_not_mask_error(tmp_path):
    def boom(*a):
        raise RuntimeError("hook broke")

    with pytest.raises(KieRenderNotSaved):
        await _gen(_Kie(download_exc=httpx.ReadError("x")), tmp_path, on_unsaved=boom)


async def test_unsaved_render_logger_writes_error_event(tmp_path, events):
    with pytest.raises(KieRenderNotSaved):
        await _gen(
            _Kie(download_exc=httpx.ReadError("x")), tmp_path,
            on_unsaved=unsaved_render_logger(None, "job-1", 2),
        )
    [ev] = events
    assert ev["level"] == "error"
    assert ev["event"] == "kie.paid_render_unsaved"
    assert ev["details"]["task_id"] == "t-9"
    assert ev["details"]["clip_index"] == 2
    assert ev["details"]["job_id"] == "job-1"
    assert ev["details"]["result_urls"] == ["https://cdn/out.mp4"]


# ── DB write retries ────────────────────────────────────────────────────

def test_retry_db_write_retries_then_returns():
    calls = {"n": 0}
    sleeps: list = []

    def write():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("JSONDecodeError: Expecting value")
        return "ok"

    assert retry_db_write(write, label="t", waits=(1, 2, 3), sleep=sleeps.append) == "ok"
    assert calls["n"] == 3
    assert sleeps == [1, 2]


def test_save_paid_clip_logs_recovery_trail_on_final_failure(events):
    def write():
        raise RuntimeError("503 from PostgREST")

    with pytest.raises(RuntimeError):
        save_paid_clip(
            None, "job-1", 4, "t-9", {"resultJson": RESULT}, write,
            waits=(0, 0), sleep=lambda s: None,
        )
    [ev] = events
    assert ev["event"] == "kie.paid_render_unsaved"
    assert ev["details"]["task_id"] == "t-9"
    assert ev["details"]["result_urls"] == ["https://cdn/out.mp4"]


def test_save_paid_clip_success_logs_nothing(events):
    assert save_paid_clip(None, "job-1", 4, "t-9", None, lambda: 7,
                          waits=(0,), sleep=lambda s: None) == 7
    assert events == []


def test_save_paid_clip_uploads_once_and_retries_only_the_row(events):
    uploads, writes = [], []

    def write():
        writes.append(1)
        if len(writes) < 3:
            raise RuntimeError("503 from PostgREST")
        return "row"

    assert save_paid_clip(
        None, "job-1", 4, "t-9", None, write, upload=lambda: uploads.append(1),
        waits=(0, 0), sleep=lambda s: None,
    ) == "row"
    assert uploads == [1], "a row-write blip must not re-upload the mp4"
    assert len(writes) == 3
    assert events == []


def test_save_paid_clip_upload_failure_skips_row_and_logs_trail(events):
    writes = []

    def upload():
        raise ValueError("Expecting value")

    with pytest.raises(ValueError):
        save_paid_clip(
            None, "job-1", 4, "t-9", {"resultJson": RESULT},
            lambda: writes.append(1), upload=upload,
            waits=(0, 0), sleep=lambda s: None,
        )
    assert writes == []
    [ev] = events
    assert ev["event"] == "kie.paid_render_unsaved"
    assert ev["details"]["task_id"] == "t-9"


def test_modal_upload_is_never_nested_in_a_row_retry():
    """Static guard: _upload_mp4 already retries; inside a save_paid_clip
    write thunk it would be retried again per row attempt."""
    import re
    text = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(
        encoding="utf-8")
    hits = []
    for m in re.finditer(r"\n(\s+)def (_save_\w*)\(", text):
        indent = m.group(1)
        end = re.compile(rf"\n{indent}\S").search(text, m.end())
        body = text[m.end(): end.start() if end else len(text)]
        if "_upload_mp4(" in body:
            hits.append((text[: m.start()].count("\n") + 2, m.group(2)))
    assert not hits, f"upload inside a row-write thunk: {hits}"


def test_upload_paid_clip_logs_recovery_trail_and_reraises(events):
    calls = []

    def boom():
        calls.append(1)
        raise ValueError("Expecting value")

    meta = {"resultJson": RESULT}
    with pytest.raises(ValueError):
        ktp.upload_paid_clip(None, "job-1", 3, "t-7", meta, boom)
    assert calls == [1], "upload() brings its own retries — call it once"
    assert [e["event"] for e in events] == ["kie.paid_render_unsaved"]
    details = events[0]["details"]
    assert details["task_id"] == "t-7"
    assert details["clip_index"] == 3
    assert details["result_urls"] == ["https://cdn/out.mp4"]


def test_upload_paid_clip_success_logs_nothing(events):
    ktp.upload_paid_clip(None, "job-1", 3, "t-7", {}, lambda: None)
    assert events == []


def test_verify_loop_upload_leaves_a_recovery_trail():
    """Static guard: the verify loop's per-attempt upload runs after Kie
    billed the attempt, so it must go through upload_paid_clip."""
    text = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(
        encoding="utf-8")
    start = text.index("async def _generate_clip_with_verify(")
    body = text[start: text.index("\ndef ", start + 1)]
    assert "upload_paid_clip," in body or "upload_paid_clip(" in body
    assert "lambda: _upload_mp4(" in body
    assert body.count("_upload_mp4(") == 1, "unwrapped upload in verify loop"


def test_record_kie_task_created_event(events):
    record_kie_task_created(None, "job-1", 5, "t-9")
    [ev] = events
    assert ev["level"] == "info"
    assert ev["event"] == "kie.task_created"
    assert ev["subject_id"] == "job-1"
    assert ev["details"] == {"task_id": "t-9", "clip_index": 5, "job_id": "job-1"}


def test_every_modal_render_call_leaves_a_recovery_trail():
    """Static guard: every generate_clip_with_meta call in modal_app.py must
    record the billed task_id before polling (on_task_created) and log a
    recovery event if poll/download fails (on_unsaved)."""
    import re
    text = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(
        encoding="utf-8")
    calls = list(re.finditer(r"generate_clip_with_meta\(", text))
    assert calls, "no render calls found — guard is stale"
    missing = []
    for m in calls:
        # Slice the call's full argument list by paren balance.
        depth, i = 0, m.end() - 1
        while True:
            depth += {"(": 1, ")": -1}.get(text[i], 0)
            if depth == 0:
                break
            i += 1
        call = text[m.start(): i + 1]
        line = text[: m.start()].count("\n") + 1
        for hook in ("on_task_created=", "on_unsaved="):
            if hook not in call:
                missing.append((line, hook))
    assert not missing, f"modal_app.py render calls missing hooks: {missing}"


def test_modal_paid_clip_saves_never_drop_the_task_id():
    """Static guard: a done clip row / paid-clip save must carry the billed
    Kie task_id — passing None leaves seedance_task_id NULL and the
    kie.paid_render_unsaved event without a recoverable handle."""
    import re
    text = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(
        encoding="utf-8")
    hits = [
        text[: m.start()].count("\n") + 1
        for m in re.finditer(
            r"build_done_clip_row\([^)]*task_id=None"
            r"|save_paid_clip\(\s*sb,\s*job_id,\s*[\w.]+,\s*None\b",
            text,
        )
    ]
    assert not hits, f"modal_app.py drops the Kie task_id at lines {hits}"
    # Every verify-loop seedance_call must hand the task_id back.
    returns = re.findall(
        r"async def _seedance_for_clip\(c\):.*?\n\s+return ([^\n]+)", text,
        flags=re.S,
    )
    assert returns and all(r.count(",") == 2 for r in returns), returns


def test_done_row_carries_all_not_null_columns():
    row = build_done_clip_row(
        "job-1", _clip(), task_id="t-9", storage_path="jobs/j/clips/clip_02.mp4",
        cost_usd=2.87, regen_of_clip_id="c-1",
    )
    for col in ("job_id", "index", "voiceover", "visual_prompt", "setting_id", "duration_s"):
        assert row[col] is not None, col
    assert row["status"] == "done"
    assert row["seedance_task_id"] == "t-9"
    assert row["mp4_path"] == row["storage_path"]
    assert row["regen_of_clip_id"] == "c-1"
    assert "regen_of_clip_id" not in build_done_clip_row(
        "job-1", _clip(), task_id=None, storage_path="p", cost_usd=0,
    )


def test_done_row_verification_fields_only_when_given():
    row = build_done_clip_row(
        "job-1", _clip(), task_id="t-9", storage_path="p", cost_usd=1.0,
        verification_status="failed", verification_attempts=3,
        verification_notes={"checks": []},
    )
    assert (row["verification_status"], row["verification_attempts"],
            row["verification_notes"]) == ("failed", 3, {"checks": []})
    bare = build_done_clip_row("job-1", _clip(), task_id="t-9",
                               storage_path="p", cost_usd=1.0)
    assert not any(k.startswith("verification_") for k in bare)



# Retry helpers that time.sleep() between attempts.
_SLEEPING_HELPERS = {
    "retry_db_write", "save_paid_clip", "upload_paid_clip", "_upload_mp4",
}


def test_no_sleeping_retry_helper_runs_on_the_event_loop():
    """Static guard: run_pipeline renders clips concurrently under
    asyncio.gather, so a time.sleep retry called straight from an
    async def freezes polling/downloads for every other clip. Call these
    via asyncio.to_thread (or from a sync def)."""
    import ast
    tree = ast.parse((Path(__file__).resolve().parent.parent / "modal_app.py")
                     .read_text(encoding="utf-8"))
    hits = []

    def visit(node, in_async):
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, ast.AsyncFunctionDef):
                visit(ch, True)
            elif isinstance(ch, (ast.FunctionDef, ast.Lambda)):
                visit(ch, False)
            else:
                if (in_async and isinstance(ch, ast.Call)
                        and isinstance(ch.func, ast.Name)
                        and ch.func.id in _SLEEPING_HELPERS):
                    hits.append((ch.lineno, ch.func.id))
                visit(ch, in_async)

    visit(tree, False)
    assert not hits, f"blocking retry helper called in async code: {hits}"
