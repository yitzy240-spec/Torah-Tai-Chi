"""Resilient Claude caller: configurable primary provider with fallback.

Both `script_generator.transform_draft_to_clip_plan` and
`topic_pipeline.generate_draft_from_topic` need to call Claude. We have
two relays available:

- **Kie.ai** — cheaper per-token, but at times unreliable (proxy 5xxs,
  malformed truncation, hung connections, 200s with empty content).
- **OpenRouter** — ~25-40% pricier but routes directly to Anthropic with
  noticeably better stability under long-prompt load.

The primary provider is chosen via the `CLAUDE_PRIMARY_PROVIDER`
environment variable (default: ``openrouter``). The OTHER provider runs
once as fallback if the primary's retry budget is exhausted.

Resilience policy:

1. **Primary**: N retries against the chosen provider with capped
   exponential backoff. Default budgets:
     - openrouter: 3 attempts (~7s wait — OR is generally more stable)
     - kie:         5 attempts (~31s wait — needs more patience)
2. Both phases retry on the same conditions:
     - network errors (ConnectError, ReadError, ReadTimeout,
       RemoteProtocolError)
     - HTTP status >= 500
     - 2xx responses with empty/whitespace content (provider misbehavior
       under load — neither relay is immune)
3. **Never** retry on 4xx — auth/bad-request shape problems won't
   improve, and the same payload will fail the fallback the same way.
4. **Fallback**: one attempt against the OTHER provider, sharing the
   same empty-content guard. If fallback also fails, raise the PRIMARY's
   last error (most recent and diagnostically meaningful — the user
   chose that provider).
5. If the primary's API key is missing, raise immediately. The fallback
   provider's key is optional; without it, primary failures propagate.

Returns the raw text from Claude's response. JSON parsing /
code-fence stripping is the caller's job — this layer is purely about
"get the model's text output, somehow."

Video and image generation (Seedance) have no OpenRouter equivalent,
so they remain on the Kie-only retry pattern in their respective
modules. This helper is Claude-text-only.
"""
from __future__ import annotations

import asyncio
import os

import httpx

KIE_CLAUDE_URL = "https://api.kie.ai/claude/v1/messages"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Backoff schedule shared by both providers: 1s, 2s, 4s, 8s, 16s
# (capped). Sum across the 5-attempt Kie default = ~31s; sum across the
# 3-attempt OpenRouter default = ~7s.
_BACKOFF_CAP_S = 16.0


def _to_openrouter_model(model: str) -> str:
    """Map a Kie/Anthropic-style model id to an OpenRouter model id.

    OpenRouter uses dotted versions (`anthropic/claude-opus-4.6`) where
    Kie uses dashed versions (`claude-opus-4-6`). If the caller already
    passed a slash-prefixed id (e.g. `anthropic/claude-opus-4.6` or
    `openai/gpt-5`), we trust it as-is.

    Only Claude family ids are auto-translated. A non-Claude id without
    a provider prefix (e.g. `gpt-5`) raises — pre-prefix it yourself.

    Examples:
        claude-opus-4-6   -> anthropic/claude-opus-4.6
        claude-sonnet-4-6 -> anthropic/claude-sonnet-4.6
        anthropic/claude-opus-4.6 -> anthropic/claude-opus-4.6 (passthrough)
        gpt-5             -> ValueError
    """
    if "/" in model:
        return model
    parts = model.split("-")
    if not parts or parts[0] != "claude":
        raise ValueError(
            f"non-Claude model {model!r} cannot be auto-translated for "
            "OpenRouter; pass a slash-prefixed id like 'openai/gpt-5'"
        )
    # Convert the trailing "-X-Y" version segment to "X.Y" if it
    # matches the Anthropic family naming pattern. Conservatively only
    # rewrite the LAST two dash-joined numeric segments — this matches
    # claude-opus-4-6 → claude-opus-4.6 without mangling other names.
    if (
        len(parts) >= 2
        and parts[-1].isdigit()
        and parts[-2].isdigit()
    ):
        head = "-".join(parts[:-2])
        tail = f"{parts[-2]}.{parts[-1]}"
        normalized = f"{head}-{tail}" if head else tail
    else:
        normalized = model
    return f"anthropic/{normalized}"


async def _call_kie_once(
    *,
    http: httpx.AsyncClient,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    max_tokens: int,
) -> httpx.Response:
    """Single Kie POST. No retry, no error translation — caller decides."""
    return await http.post(
        KIE_CLAUDE_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
        },
    )


async def _call_openrouter_once(
    *,
    http: httpx.AsyncClient,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    max_tokens: int,
) -> httpx.Response:
    """Single OpenRouter POST in chat/completions format."""
    or_model = _to_openrouter_model(model)
    body = {
        "model": or_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    return await http.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter analytics best-practice headers — harmless if
            # missing but better included so the project shows up in OR
            # dashboards as itself rather than as anonymous traffic.
            "HTTP-Referer": "https://github.com/yitzy240-spec/Torah-Tai-Chi",
            "X-Title": "torah-tai-chi-pipeline",
        },
        json=body,
    )


_RETRYABLE_NET_ERRORS = (
    httpx.ConnectError,
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)


async def _kie_phase(
    *,
    http: httpx.AsyncClient,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    max_tokens: int,
    max_attempts: int,
    log_prefix: str,
) -> tuple[str | None, Exception | None]:
    """Run the Kie retry phase.

    Returns ``(text, None)`` on success or ``(None, last_exc)`` on
    exhaustion. 4xx responses raise immediately (no retry, no fallback) —
    the same payload would fail the alternate provider with the same
    auth/shape problem.
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        print(f"{log_prefix} kie attempt {attempt}/{max_attempts}")
        try:
            r = await _call_kie_once(
                http=http,
                api_key=api_key,
                model=model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
            )
        except _RETRYABLE_NET_ERRORS as net_err:
            last_exc = net_err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} kie network error attempt "
                    f"{attempt}/{max_attempts}: "
                    f"{type(net_err).__name__}: {net_err} "
                    f"sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        if r.status_code >= 500:
            err = httpx.HTTPStatusError(
                f"Kie Claude 5xx: {r.status_code} {r.text[:200]}",
                request=r.request,
                response=r,
            )
            last_exc = err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} kie 5xx attempt "
                    f"{attempt}/{max_attempts}: "
                    f"status={r.status_code} sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        if r.status_code >= 400:
            # 4xx — auth / bad-request. Don't retry, don't fall back.
            print(
                f"{log_prefix} kie 4xx attempt {attempt}: "
                f"status={r.status_code} — not retrying"
            )
            r.raise_for_status()

        # 2xx — parse and return.
        data = r.json()
        try:
            text = data["content"][0]["text"]
        except (KeyError, IndexError, TypeError) as parse_err:
            # Malformed Kie response — surface clearly. Treat as a
            # terminal Kie error (no point retrying the same prompt).
            raise RuntimeError(
                f"Kie Claude response missing content[0].text: "
                f"{type(parse_err).__name__}: {parse_err}; "
                f"raw={str(data)[:200]}"
            ) from parse_err

        # Empty/whitespace text on a 2xx response: Kie does this during
        # partial maintenance windows. Treat as transient (like a 5xx)
        # so we retry rather than passing "" downstream where
        # json.loads will crash with a confusing line-1 error.
        if not text or not text.strip():
            err = RuntimeError(
                f"Kie returned 2xx with empty content; "
                f"raw={str(data)[:200]}"
            )
            last_exc = err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} kie empty content attempt "
                    f"{attempt}/{max_attempts} sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        return text, None

    return None, last_exc


async def _openrouter_phase(
    *,
    http: httpx.AsyncClient,
    api_key: str,
    model: str,
    system: str,
    messages: list[dict],
    max_tokens: int,
    max_attempts: int,
    log_prefix: str,
) -> tuple[str | None, Exception | None]:
    """Run the OpenRouter retry phase.

    Mirrors `_kie_phase` retry semantics:
    - Retry on network errors and 5xx
    - Don't retry on 4xx (raises immediately)
    - Treat empty content / empty choices on 2xx as transient and retry

    Returns ``(text, None)`` on success or ``(None, last_exc)`` on
    exhaustion.
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        print(f"{log_prefix} openrouter attempt {attempt}/{max_attempts}")
        try:
            r = await _call_openrouter_once(
                http=http,
                api_key=api_key,
                model=model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
            )
        except _RETRYABLE_NET_ERRORS as net_err:
            last_exc = net_err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} openrouter network error attempt "
                    f"{attempt}/{max_attempts}: "
                    f"{type(net_err).__name__}: {net_err} "
                    f"sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        if r.status_code >= 500:
            err = httpx.HTTPStatusError(
                f"OpenRouter 5xx: {r.status_code} {r.text[:200]}",
                request=r.request,
                response=r,
            )
            last_exc = err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} openrouter 5xx attempt "
                    f"{attempt}/{max_attempts}: "
                    f"status={r.status_code} sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        if r.status_code >= 400:
            # 4xx — auth / bad-request. Don't retry, don't fall back.
            print(
                f"{log_prefix} openrouter 4xx attempt {attempt}: "
                f"status={r.status_code} — not retrying"
            )
            r.raise_for_status()

        # 2xx — parse and return.
        data = r.json()
        choices = data.get("choices") or []
        if not choices:
            # OR can return empty choices under heavy provider
            # moderation or routing failure. Treat as transient.
            err = RuntimeError(
                f"OpenRouter returned no choices: {str(data)[:200]}"
            )
            last_exc = err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} openrouter empty choices attempt "
                    f"{attempt}/{max_attempts} sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        content = choices[0].get("message", {}).get("content")
        if not content or not content.strip():
            finish = choices[0].get("finish_reason", "?")
            err = RuntimeError(
                f"OpenRouter returned empty content "
                f"(finish_reason={finish}): {str(data)[:200]}"
            )
            last_exc = err
            if attempt < max_attempts:
                backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                print(
                    f"{log_prefix} openrouter empty content attempt "
                    f"{attempt}/{max_attempts} sleeping={backoff}s"
                )
                await asyncio.sleep(backoff)
                continue
            break

        return content, None

    return None, last_exc


async def claude_call(
    *,
    messages: list[dict],
    system: str,
    model: str = "claude-opus-4-6",
    kie_api_key: str,
    openrouter_api_key: str | None = None,
    max_kie_retries: int = 5,
    max_or_retries: int = 3,
    timeout_s: float = 180.0,
    max_tokens: int = 8000,
    log_prefix: str = "[claude_call]",
) -> str:
    """Call Claude via the configured primary provider; fall back to the other on persistent failure.

    The primary provider is chosen by the ``CLAUDE_PRIMARY_PROVIDER``
    environment variable. Default: ``openrouter`` (Kie's relay has been
    unreliable on long-prompt calls; OR routes directly to Anthropic).
    Set ``CLAUDE_PRIMARY_PROVIDER=kie`` to flip back to legacy
    Kie-primary behavior.

    Returns the raw text from the model's first response block. The
    caller is responsible for JSON parsing or code-fence stripping if
    the prompt expected structured output.

    Raises the LAST error encountered if all attempts fail. The raised
    error is from the PRIMARY provider's final attempt (most recent
    and diagnostically meaningful — that's the one the user chose).

    Args:
        messages: Anthropic-format messages list (`[{"role": "user",
            "content": "..."}]`). System prompt is passed separately
            via `system` for the Kie/Anthropic API; for OpenRouter we
            prepend it as a system-role message in the chat list.
        system: System prompt string.
        model: Kie/Anthropic-format model id (e.g. `claude-opus-4-6`).
            Auto-translated to OpenRouter format when calling OR.
        kie_api_key: Kie API key. Required when Kie is primary OR when
            OR is primary and Kie is the desired fallback. If Kie is
            primary, this MUST be set.
        openrouter_api_key: OpenRouter key. If OR is primary, this MUST
            be set (raises ValueError otherwise). If OR is fallback,
            None disables fallback — primary failures propagate.
        max_kie_retries: Number of Kie attempts (default 5; ~31s total
            wait across attempts when Kie is primary).
        max_or_retries: Number of OpenRouter attempts (default 3; ~7s
            total wait when OR is primary). Fallback always runs once
            regardless of these counts.
        timeout_s: Per-request HTTP timeout.
        max_tokens: Max output tokens.
        log_prefix: Prefix for log lines so call sites can be
            distinguished in Modal logs (e.g. `[script_generator]`).
    """
    primary = os.environ.get("CLAUDE_PRIMARY_PROVIDER", "openrouter").lower()
    # Anything other than the explicit "kie" opt-in means OpenRouter
    # primary — silently treat unknown values as the safe default
    # rather than crashing the pipeline on a typo.
    if primary != "kie":
        primary = "openrouter"

    # Validate the primary's key is present. Fallback's key is optional.
    if primary == "openrouter" and openrouter_api_key is None:
        raise ValueError(
            "CLAUDE_PRIMARY_PROVIDER=openrouter requires openrouter_api_key; "
            "either pass the key or set CLAUDE_PRIMARY_PROVIDER=kie"
        )
    if primary == "kie" and not kie_api_key:
        raise ValueError(
            "CLAUDE_PRIMARY_PROVIDER=kie requires kie_api_key"
        )

    async with httpx.AsyncClient(timeout=timeout_s) as http:
        if primary == "openrouter":
            assert openrouter_api_key is not None
            text, primary_exc = await _openrouter_phase(
                http=http,
                api_key=openrouter_api_key,
                model=model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
                max_attempts=max_or_retries,
                log_prefix=log_prefix,
            )
            if text is not None:
                return text

            # OpenRouter exhausted. Fall back to Kie if we have a key.
            if not kie_api_key:
                print(
                    f"{log_prefix} openrouter exhausted after "
                    f"{max_or_retries} attempts; no fallback configured "
                    f"— raising"
                )
                assert primary_exc is not None
                raise primary_exc

            print(
                f"{log_prefix} openrouter exhausted after "
                f"{max_or_retries} attempts; falling back to kie"
            )
            text, _fallback_exc = await _kie_phase(
                http=http,
                api_key=kie_api_key,
                model=model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
                max_attempts=1,
                log_prefix=log_prefix,
            )
            if text is not None:
                return text
            # Both failed. Raise the PRIMARY's last error — that's
            # what the user is currently relying on, and it makes the
            # failure mode visible as an OR problem in Modal logs.
            print(
                f"{log_prefix} kie fallback also failed; raising "
                f"openrouter's last error"
            )
            assert primary_exc is not None
            raise primary_exc

        # primary == "kie" — legacy behavior preserved.
        text, primary_exc = await _kie_phase(
            http=http,
            api_key=kie_api_key,
            model=model,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
            max_attempts=max_kie_retries,
            log_prefix=log_prefix,
        )
        if text is not None:
            return text

        # Kie exhausted. Fall back to OpenRouter if we have a key.
        if openrouter_api_key is None:
            print(
                f"{log_prefix} kie exhausted after {max_kie_retries} "
                f"attempts; no fallback configured — raising"
            )
            assert primary_exc is not None
            raise primary_exc

        print(
            f"{log_prefix} kie exhausted after {max_kie_retries} "
            f"attempts; falling back to openrouter"
        )
        text, fallback_exc = await _openrouter_phase(
            http=http,
            api_key=openrouter_api_key,
            model=model,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
            max_attempts=1,
            log_prefix=log_prefix,
        )
        if text is not None:
            return text
        # Both failed. Match historic behavior for the kie-primary
        # path: raise the most-recent error (OR's, since it ran last).
        # This keeps the legacy diagnostic signal — "OR also failed,
        # so the cause is broader than a Kie maintenance window."
        print(
            f"{log_prefix} openrouter fallback also failed; "
            f"raising openrouter's last error"
        )
        assert fallback_exc is not None
        raise fallback_exc
