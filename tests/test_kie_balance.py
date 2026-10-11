"""Kie balance pre-flight: fail fast before spend, never block on a flaky check."""
import re
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import respx
from httpx import Response

from src.kie_balance import (
    DEFAULT_LOW_BALANCE_USD,
    InsufficientKieBalance,
    estimate_render_cost_usd,
    preflight_kie_balance,
    resolve_low_balance_threshold_usd,
    resolve_retry_factor,
)
from src.kie_client import KieClient

CREDIT_URL = "https://api.kie.ai/api/v1/chat/credit"


# ---------- fakes ------------------------------------------------------------

class _Query:
    def __init__(self, row, raise_exc=None):
        self._row, self._raise = row, raise_exc

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self._raise:
            raise self._raise
        return SimpleNamespace(data=self._row)


class FakeSB:
    def __init__(self, setting_value=None, raise_exc=None):
        self._row = {"value": setting_value} if setting_value is not None else None
        self._raise = raise_exc

    def table(self, name):
        assert name == "site_content"
        return _Query(self._row, self._raise)


class FakeKie:
    def __init__(self, credits=None, exc=None):
        self._credits, self._exc, self.calls = credits, exc, 0

    async def get_credits(self):
        self.calls += 1
        if self._exc:
            raise self._exc
        return self._credits


class EventLog:
    def __init__(self):
        self.events = []

    def __call__(self, sb, **kw):
        self.events.append(kw)

    def names(self):
        return [e["event"] for e in self.events]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("KIE_LOW_BALANCE_USD", raising=False)
    monkeypatch.delenv("KIE_BALANCE_PREFLIGHT_DISABLED", raising=False)


def _run(kie, durations=(12, 12), sb=None, tier="standard", res="720p"):
    log = EventLog()
    result = preflight_kie_balance(
        sb or FakeSB(), kie, job_id="job-1", durations_s=list(durations),
        model_tier=tier, resolution=res, log_event=log,
    )
    return result, log


# ---------- estimate ---------------------------------------------------------

def test_estimate_720p_standard_matches_seedance_per_second_rate():
    # 2 x 12s at $0.205/s — the ~$2.5/clip the cost_events history shows.
    assert estimate_render_cost_usd([12, 12], "standard", "720p") == pytest.approx(4.92)


def test_estimate_clamps_durations_like_the_renderer():
    # 3s -> 4s (Kie min), 20s -> 15s (Kie max)
    assert estimate_render_cost_usd([3, 20], "standard", "720p") == pytest.approx(19 * 0.205, abs=0.01)


def test_estimate_fast_tier_is_cheaper():
    assert estimate_render_cost_usd([10], "fast", "720p") == pytest.approx(1.65)


def test_estimate_unknown_combo_never_underestimates():
    # No 1080p on Fast: priced at the 1080p standard rate, not zero.
    assert estimate_render_cost_usd([10], "fast", "1080p") == pytest.approx(5.10)
    assert estimate_render_cost_usd([10], None, None) == pytest.approx(2.05)


# ---------- KieClient.get_credits -------------------------------------------

@pytest.mark.asyncio
async def test_get_credits_reads_bare_number():
    async with respx.mock() as mock:
        route = mock.get(CREDIT_URL).mock(
            return_value=Response(200, json={"code": 200, "msg": "success", "data": 1226.98})
        )
        assert await KieClient(api_key="k").get_credits() == pytest.approx(1226.98)
        assert route.calls[0].request.headers["authorization"] == "Bearer k"


@pytest.mark.asyncio
async def test_get_credits_reads_nested_shape():
    async with respx.mock() as mock:
        mock.get(CREDIT_URL).mock(
            return_value=Response(200, json={"code": 200, "data": {"credits": 500}})
        )
        assert await KieClient(api_key="k").get_credits() == 500.0


@pytest.mark.asyncio
@pytest.mark.parametrize("resp", [
    Response(200, json={"code": 401, "msg": "bad key"}),
    Response(200, json={"code": 200, "data": None}),
    Response(500, text="boom"),
])
async def test_get_credits_raises_on_bad_response(resp):
    async with respx.mock() as mock:
        mock.get(CREDIT_URL).mock(return_value=resp)
        with pytest.raises((RuntimeError, httpx.HTTPStatusError)):
            await KieClient(api_key="k").get_credits()


# ---------- threshold ---------------------------------------------------------

def test_threshold_defaults_to_20():
    assert resolve_low_balance_threshold_usd(FakeSB()) == DEFAULT_LOW_BALANCE_USD == 20.0


def test_threshold_setting_row_wins_over_env(monkeypatch):
    monkeypatch.setenv("KIE_LOW_BALANCE_USD", "50")
    assert resolve_low_balance_threshold_usd(FakeSB("35")) == 35.0
    assert resolve_low_balance_threshold_usd(FakeSB("$12.50")) == 12.5


def test_threshold_env_used_when_no_row_or_row_unreadable(monkeypatch):
    monkeypatch.setenv("KIE_LOW_BALANCE_USD", "50")
    assert resolve_low_balance_threshold_usd(FakeSB()) == 50.0
    assert resolve_low_balance_threshold_usd(FakeSB("not a number")) == 50.0
    assert resolve_low_balance_threshold_usd(FakeSB(raise_exc=RuntimeError("db down"))) == 50.0


# ---------- preflight ---------------------------------------------------------

def test_insufficient_balance_fails_fast_with_clear_message():
    kie = FakeKie(credits=600)  # $3.00 vs $4.92 x 1.5 = $7.38 needed
    with pytest.raises(InsufficientKieBalance) as ei:
        _run(kie)
    msg = str(ei.value)
    assert "Not enough Kie credits" in msg
    assert "$3.00" in msg and "$7.38" in msg and "2 clips" in msg
    assert "re-render" in msg
    assert "Nothing was rendered or charged" in msg
    assert "kie.ai/billing" in msg
    # Must not read like Kie's own 605 wording, which the dashboard
    # humanizes as a Kie-side billing fault.
    assert "balance is insufficient" not in msg.lower()
    assert "account" not in msg.lower()


def test_insufficient_balance_is_logged_to_execution_events():
    log = EventLog()
    with pytest.raises(InsufficientKieBalance):
        preflight_kie_balance(
            FakeSB(), FakeKie(credits=0), job_id="job-9", durations_s=[12],
            model_tier="standard", resolution="720p", log_event=log,
        )
    (ev,) = log.events
    assert ev["event"] == "kie.balance_insufficient"
    assert ev["level"] == "error"
    assert ev["subject_type"] == "job" and ev["subject_id"] == "job-9"
    assert ev["details"]["estimate_usd"] == pytest.approx(3.69)
    assert ev["details"]["single_attempt_usd"] == pytest.approx(2.46)
    assert ev["details"]["retry_factor"] == pytest.approx(1.5)
    assert ev["details"]["balance_usd"] == 0


def test_balance_check_error_warns_and_proceeds():
    kie = FakeKie(exc=httpx.ConnectError("kie down"))
    result, log = _run(kie)
    assert result.checked is False and result.sufficient
    assert "ConnectError" in result.error
    assert log.names() == ["kie.balance_check_failed"]
    assert log.events[0]["level"] == "warn"


def test_low_balance_warns_but_renders():
    # $15 balance: enough for $4.92 of clips, under the $20 default threshold.
    result, log = _run(FakeKie(credits=3000))
    assert result.checked and result.sufficient and result.low
    assert log.names() == ["kie.balance_low"]
    assert log.events[0]["level"] == "warn"


def test_healthy_balance_is_silent():
    result, log = _run(FakeKie(credits=8500))  # $42.50
    assert result.sufficient and not result.low
    assert log.events == []


def test_threshold_from_settings_drives_low_warning():
    result, log = _run(FakeKie(credits=8500), sb=FakeSB("100"))
    assert result.low and log.names() == ["kie.balance_low"]


def test_exact_balance_is_enough():
    # 1476 credits = $7.38 = 2 x 12s ($4.92) x default 1.5 retry headroom.
    result, _ = _run(FakeKie(credits=1476))
    assert result.sufficient


def test_single_attempt_balance_is_not_enough_with_default_headroom():
    # $4.92 covers one attempt per clip but not the re-render headroom.
    with pytest.raises(InsufficientKieBalance):
        _run(FakeKie(credits=984))


def test_retry_factor_env_is_applied(monkeypatch):
    monkeypatch.setenv("KIE_PREFLIGHT_RETRY_FACTOR", "1")
    result, _ = _run(FakeKie(credits=984))
    assert result.sufficient and result.estimate_usd == pytest.approx(4.92)
    monkeypatch.setenv("KIE_PREFLIGHT_RETRY_FACTOR", "2")
    with pytest.raises(InsufficientKieBalance):
        _run(FakeKie(credits=1476))


@pytest.mark.parametrize("raw,expected", [
    (None, 1.5), ("", 1.5), ("abc", 1.5), ("0.5", 1.5), ("nan", 1.5),
    ("1", 1.0), ("2", 2.0), (" 1.25 ", 1.25), ("10", 3.0),
])
def test_resolve_retry_factor(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("KIE_PREFLIGHT_RETRY_FACTOR", raising=False)
    else:
        monkeypatch.setenv("KIE_PREFLIGHT_RETRY_FACTOR", raw)
    assert resolve_retry_factor() == pytest.approx(expected)


def test_no_clips_to_render_skips_the_call():
    kie = FakeKie(credits=0)
    result, log = _run(kie, durations=())
    assert kie.calls == 0 and result.sufficient and log.events == []


def test_kill_switch_skips_the_check(monkeypatch):
    monkeypatch.setenv("KIE_BALANCE_PREFLIGHT_DISABLED", "1")
    kie = FakeKie(credits=0)
    result, _ = _run(kie)
    assert kie.calls == 0 and result.sufficient


# ---------- wiring: every Kie render entry point runs the pre-flight first ----

SRC = (Path(__file__).resolve().parent.parent / "modal_app.py").read_text(encoding="utf-8")


def _render_function_bodies():
    """Yield (name, body) for every top-level function that renders via Kie."""
    defs = list(re.finditer(r"^(?:async )?def (\w+)\(", SRC, re.M))
    for i, m in enumerate(defs):
        end = defs[i + 1].start() if i + 1 < len(defs) else len(SRC)
        body = SRC[m.start():end]
        if "KieClient(api_key=" in body and "generate_clip_with_meta(" in body:
            yield m.group(1), body


def test_every_render_entry_point_is_covered():
    names = {n for n, _ in _render_function_bodies()}
    assert names >= {
        "run_pipeline", "regen_smart", "regen_clip", "regen_agent",
        "regen_single_clip", "clips_only_job", "regen_clip_from_text",
    }


@pytest.mark.parametrize("name,body", list(_render_function_bodies()))
def test_preflight_runs_before_any_kie_upload_or_render(name, body):
    kie_at = body.index("KieClient(api_key=")
    assert "preflight_kie_balance(" in body, f"{name} renders without a balance pre-flight"
    pre_at = body.index("preflight_kie_balance(")
    first_spend = min(
        body.index(tok, kie_at) for tok in ("_upload_dir(kie", "generate_clip_with_meta(")
        if tok in body[kie_at:]
    )
    assert kie_at < pre_at < first_spend, (
        f"{name}: preflight_kie_balance must run after KieClient() and before "
        f"the first Kie upload/render"
    )
