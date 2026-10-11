"""Kie balance pre-flight: refuse to start a render the account can't pay for.

On 2026-09-22 Yonah ran 16 renders back to back, the balance hit zero
mid-session, and the next five renders each waited minutes (createTask's
credits-insufficient retries) before failing with Kie's 605 "balance is
insufficient" — a raw traceback, five times. Every Kie render entry point
in modal_app.py now calls preflight_kie_balance() right after building its
KieClient and before any upload or createTask:

  - balance < estimated cost of the planned clips -> InsufficientKieBalance
    (a clear, operator-facing job error; nothing is rendered or charged)
  - the balance check itself fails -> warn and proceed. The check is a
    convenience; it must never be the reason a render didn't run.
  - balance below the low-balance threshold -> warn event, render proceeds.

NB: Kie's 605 has also fired on a HEALTHY balance (verified 2026-09-23,
see dashboard/src/lib/humanize-render-error.ts) — this check does not
replace that handling, it only catches the genuine "out of money" case
up front.
"""
from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from src.events import log_event as _default_log_event
from src.video_generator import clamp_duration_s

# $5 buys 1000 credits. Must match KIE_CREDITS_TO_USD in modal_app.py and
# the conversion in dashboard/src/app/api/kie-balance/route.ts.
KIE_CREDITS_TO_USD = 0.005

# Per-second USD, mirrored from dashboard/src/lib/seedance-pricing.ts (Kie
# pricing, April 2026). A 12-15s 720p standard clip is ~$2.5-3, which
# matches billed cost_events (e.g. 492 credits = $2.46).
SEEDANCE_USD_PER_SECOND: dict[str, dict[str, float]] = {
    "standard": {"480p": 0.095, "720p": 0.205, "1080p": 0.51},
    "fast": {"480p": 0.0775, "720p": 0.165},  # no 1080p on Fast
}

DEFAULT_LOW_BALANCE_USD = 20.0
# Operator-editable without a deploy: a row in site_content (the dashboard's
# kv settings store, same as settings.default_tier). Env is the fallback.
LOW_BALANCE_SETTING_KEY = "settings.kie_low_balance_usd"
LOW_BALANCE_ENV = "KIE_LOW_BALANCE_USD"
# Escape hatch if Kie's credit endpoint ever reports a wrong number and
# starts blocking renders that would succeed: set to 1/true/on in the
# Modal secret to skip the check entirely.
PREFLIGHT_DISABLED_ENV = "KIE_BALANCE_PREFLIGHT_DISABLED"
# Re-render headroom. The verify loop can re-render a clip once after a
# failed check, so a render can cost up to 2x the single-attempt estimate.
# Not every clip fails verify, so default to 1.5x (half the clips retried
# once) rather than a full 2x that would block renders that would succeed.
# Set KIE_PREFLIGHT_RETRY_FACTOR=2 for a worst-case guarantee, 1 to disable.
# Values < 1 or unparseable fall back to the default.
RETRY_FACTOR_ENV = "KIE_PREFLIGHT_RETRY_FACTOR"
DEFAULT_RETRY_FACTOR = 1.5


def resolve_retry_factor() -> float:
    """KIE_PREFLIGHT_RETRY_FACTOR env -> 1.5. Never raises; clamped to [1, 3]."""
    raw = os.environ.get(RETRY_FACTOR_ENV)
    if raw is None or not str(raw).strip():
        return DEFAULT_RETRY_FACTOR
    try:
        v = float(str(raw).strip())
    except ValueError:
        return DEFAULT_RETRY_FACTOR
    if v != v or v < 1.0:  # NaN or below one attempt
        return DEFAULT_RETRY_FACTOR
    return min(v, 3.0)


class InsufficientKieBalance(RuntimeError):
    """Raised before any spend when Kie can't cover the planned renders.

    str(exc) is written to jobs.error_message (prefixed with the class
    name) and humanized by the dashboard — keep it operator-readable.
    """


@dataclass
class BalanceCheck:
    checked: bool  # False = skipped or the balance call failed
    estimate_usd: float
    balance_credits: Optional[float] = None
    balance_usd: Optional[float] = None
    threshold_usd: float = DEFAULT_LOW_BALANCE_USD
    error: Optional[str] = None

    @property
    def sufficient(self) -> bool:
        return not self.checked or (self.balance_usd or 0.0) >= self.estimate_usd

    @property
    def low(self) -> bool:
        return self.checked and (self.balance_usd or 0.0) < self.threshold_usd


def estimate_render_cost_usd(
    durations_s: Iterable[Any], model_tier: Optional[str], resolution: Optional[str],
) -> float:
    """Estimated Seedance cost for one attempt at each clip.

    Durations are clamped exactly as the renderer clamps them. An unknown
    tier/resolution combo is priced at the most expensive known rate for
    that resolution (or 1080p standard) so we never under-estimate.
    """
    tier = (model_tier or "standard").lower()
    res = (resolution or "720p").lower()
    rate = SEEDANCE_USD_PER_SECOND.get(tier, {}).get(res)
    if rate is None:
        known = [r[res] for r in SEEDANCE_USD_PER_SECOND.values() if res in r]
        rate = max(known) if known else SEEDANCE_USD_PER_SECOND["standard"]["1080p"]
    total_s = sum(clamp_duration_s(d) for d in durations_s)
    return round(total_s * rate, 2)


def _parse_usd(raw: Any) -> Optional[float]:
    try:
        v = float(str(raw).strip().lstrip("$"))
    except (TypeError, ValueError):
        return None
    return v if v >= 0 else None


def resolve_low_balance_threshold_usd(sb: Any) -> float:
    """site_content setting -> KIE_LOW_BALANCE_USD env -> $20. Never raises."""
    try:
        res = (
            sb.table("site_content").select("value")
            .eq("key", LOW_BALANCE_SETTING_KEY).maybe_single().execute()
        )
        v = _parse_usd(((res and res.data) or {}).get("value"))
        if v is not None:
            return v
    except Exception as e:
        print(f"[kie_balance] threshold setting read failed: {type(e).__name__}: {e}")
    v = _parse_usd(os.environ.get(LOW_BALANCE_ENV))
    return v if v is not None else DEFAULT_LOW_BALANCE_USD


def insufficient_message(check: BalanceCheck, n_clips: int,
                         model_tier: str, resolution: str) -> str:
    # Wording deliberately avoids Kie's own 605 phrasing ("balance is
    # insufficient ... top up your account") so the dashboard humanizer
    # can't mistake this for the Kie-side billing fault.
    est_credits = check.estimate_usd / KIE_CREDITS_TO_USD
    return (
        f"Not enough Kie credits to start this render. Kie has "
        f"{check.balance_credits:,.0f} credits (${check.balance_usd:.2f}) left, "
        f"but {n_clips} clip{'s' if n_clips != 1 else ''} at {resolution} "
        f"{model_tier} would cost about ${check.estimate_usd:.2f} "
        f"({est_credits:,.0f} credits, including headroom for re-renders). Nothing was rendered or charged. "
        f"Top up at kie.ai/billing, then try again."
    )


def preflight_kie_balance(
    sb: Any,
    kie: Any,
    *,
    job_id: str,
    durations_s: list[Any],
    model_tier: Optional[str],
    resolution: Optional[str],
    log_event: Callable[..., None] = _default_log_event,
) -> BalanceCheck:
    """Check Kie can pay for the planned clips. Raises InsufficientKieBalance.

    Call synchronously from a Modal worker, before the first Kie upload or
    createTask. Any failure other than a confirmed shortfall is logged and
    swallowed so a flaky balance endpoint can't block renders.
    """
    tier = (model_tier or "standard").lower()
    res = (resolution or "720p").lower()
    n = len(durations_s)
    single_attempt = estimate_render_cost_usd(durations_s, tier, res)
    retry_factor = resolve_retry_factor()
    # Headroom for verify-loop re-renders (see DEFAULT_RETRY_FACTOR).
    estimate = round(single_attempt * retry_factor, 2)
    ev = dict(subject_type="job", subject_id=job_id)

    if n == 0:
        return BalanceCheck(checked=False, estimate_usd=0.0, error="no clips to render")
    if (os.environ.get(PREFLIGHT_DISABLED_ENV) or "").strip().lower() in ("1", "true", "yes", "on"):
        print(f"[kie_balance] pre-flight disabled via {PREFLIGHT_DISABLED_ENV}")
        return BalanceCheck(checked=False, estimate_usd=estimate, error="disabled")

    threshold = resolve_low_balance_threshold_usd(sb)
    try:
        credits = asyncio.run(kie.get_credits())
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[kie_balance] balance check failed, proceeding: {err}")
        log_event(
            sb, actor="modal", level="warn", event="kie.balance_check_failed",
            message=f"Couldn't read the Kie balance before rendering ({err}); rendering anyway",
            details={"estimate_usd": estimate, "clips": n, "error": err}, **ev,
        )
        return BalanceCheck(checked=False, estimate_usd=estimate,
                            threshold_usd=threshold, error=err)

    check = BalanceCheck(
        checked=True, estimate_usd=estimate, balance_credits=credits,
        balance_usd=round(credits * KIE_CREDITS_TO_USD, 2), threshold_usd=threshold,
    )
    details = {
        "balance_credits": credits, "balance_usd": check.balance_usd,
        "estimate_usd": estimate, "single_attempt_usd": single_attempt,
        "retry_factor": retry_factor, "clips": n, "model_tier": tier,
        "resolution": res, "threshold_usd": threshold,
    }
    print(f"[kie_balance] job={job_id} {details}")

    if not check.sufficient:
        msg = insufficient_message(check, n, tier, res)
        log_event(sb, actor="modal", level="error", event="kie.balance_insufficient",
                  message=msg, details=details, **ev)
        raise InsufficientKieBalance(msg)

    if check.low:
        log_event(
            sb, actor="modal", level="warn", event="kie.balance_low",
            message=(
                f"Kie balance is low: ${check.balance_usd:.2f} left "
                f"(warning threshold ${threshold:.2f}). This render "
                f"(~${estimate:.2f}) will proceed — top up soon."
            ),
            details=details, **ev,
        )
    return check
