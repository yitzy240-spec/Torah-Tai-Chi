"""Resilient Claude caller: Kie primary with OpenRouter fallback.

Both `script_generator.transform_draft_to_clip_plan` and
`topic_pipeline.generate_draft_from_topic` need to call Claude through
Kie.ai's Anthropic-native /v1/messages endpoint. Kie occasionally has
short maintenance windows (a few minutes) during which the proxy 5xxs.
With a 3-attempt / 7-second retry budget, those windows previously
surfaced as "Generation failed" to Yonah.

This helper centralises the resilience policy:

1. Up to `max_kie_retries` attempts (default 5) against Kie with
   exponential backoff capped at 16s — total ~31s of patient retrying,
   long enough to ride through the typical maintenance window.
2. If Kie still fails AND `openrouter_api_key` is provided, fall back
   to OpenRouter for one attempt with the equivalent Claude model.
   OpenRouter routes to Anthropic directly, so this is genuine
   redundancy rather than a different provider in front of the same
   service.
3. Only 5xx and network-class errors retry. 4xx (auth, bad-request)
   bubble immediately — retrying won't change a bad API key.

The helper returns the raw text from Claude's response. JSON parsing /
code-fence stripping is the caller's job — this layer is purely about
"get the model's text output, somehow."

Video and image generation (Seedance) have no OpenRouter equivalent,
so they remain on the Kie-only retry pattern in their respective
modules. This helper is Claude-text-only.
"""
from __future__ import annotations

import asyncio

import httpx

KIE_CLAUDE_URL = "https://api.kie.ai/claude/v1/messages"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Backoff schedule for Kie retries: 1s, 2s, 4s, 8s, 16s (capped).
# Sum across the 5-attempt default budget = ~31s of patient retry,
# which covers short maintenance blips. For longer Kie outages the
# OpenRouter fallback kicks in once the Kie budget is exhausted.
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


async def claude_call(
    *,
    messages: list[dict],
    system: str,
    model: str = "claude-opus-4-6",
    kie_api_key: str,
    openrouter_api_key: str | None = None,
    max_kie_retries: int = 5,
    timeout_s: float = 180.0,
    max_tokens: int = 8000,
    log_prefix: str = "[claude_call]",
) -> str:
    """Call Claude via Kie with retries; fall back to OpenRouter on persistent failure.

    Returns the raw text from the model's first response block. The
    caller is responsible for JSON parsing or code-fence stripping if
    the prompt expected structured output.

    Raises the LAST error encountered if all attempts fail. If
    OpenRouter was tried, the raised error is from OpenRouter (the
    most recent failure). If only Kie was tried (no OR key), the raised
    error is from Kie's last attempt.

    Args:
        messages: Anthropic-format messages list (`[{"role": "user",
            "content": "..."}]`). System prompt is passed separately
            via `system` for the Kie/Anthropic API; for OpenRouter we
            prepend it as a system-role message in the chat list.
        system: System prompt string.
        model: Kie/Anthropic-format model id (e.g. `claude-opus-4-6`).
            Auto-translated to OpenRouter format when falling back.
        kie_api_key: Kie API key. Required.
        openrouter_api_key: OpenRouter key. If None, no fallback is
            attempted — Kie failures propagate.
        max_kie_retries: Number of Kie attempts before giving up
            (default 5; ~31s total wait across attempts).
        timeout_s: Per-request HTTP timeout.
        max_tokens: Max output tokens.
        log_prefix: Prefix for log lines so call sites can be
            distinguished in Modal logs (e.g. `[script_generator]`).
    """
    last_kie_exc: Exception | None = None

    async with httpx.AsyncClient(timeout=timeout_s) as http:
        # ---- Phase 1: Kie with retries ----
        for attempt in range(1, max_kie_retries + 1):
            print(f"{log_prefix} kie attempt {attempt}/{max_kie_retries}")
            try:
                r = await _call_kie_once(
                    http=http,
                    api_key=kie_api_key,
                    model=model,
                    system=system,
                    messages=messages,
                    max_tokens=max_tokens,
                )
            except (
                httpx.ConnectError,
                httpx.ReadError,
                httpx.ReadTimeout,
                httpx.RemoteProtocolError,
            ) as net_err:
                last_kie_exc = net_err
                if attempt < max_kie_retries:
                    backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                    print(
                        f"{log_prefix} kie network error attempt "
                        f"{attempt}/{max_kie_retries}: "
                        f"{type(net_err).__name__}: {net_err} "
                        f"sleeping={backoff}s"
                    )
                    await asyncio.sleep(backoff)
                    continue
                # Final attempt — fall through to OpenRouter phase.
                break

            if r.status_code >= 500:
                err = httpx.HTTPStatusError(
                    f"Kie Claude 5xx: {r.status_code} {r.text[:200]}",
                    request=r.request,
                    response=r,
                )
                last_kie_exc = err
                if attempt < max_kie_retries:
                    backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                    print(
                        f"{log_prefix} kie 5xx attempt "
                        f"{attempt}/{max_kie_retries}: "
                        f"status={r.status_code} sleeping={backoff}s"
                    )
                    await asyncio.sleep(backoff)
                    continue
                break

            if r.status_code >= 400:
                # 4xx — auth / bad-request. Don't retry, don't fall
                # back to OpenRouter (the same payload would fail there
                # too with the same auth/shape problem).
                print(
                    f"{log_prefix} kie 4xx attempt {attempt}: "
                    f"status={r.status_code} — not retrying"
                )
                # Calling raise_for_status() preserves httpx's normal
                # error semantics for 4xx so callers can branch on
                # status_code if they want.
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

            # Empty/whitespace text on a 2xx response: Kie does this
            # during partial maintenance windows. Treat as transient
            # (like a 5xx) so we retry the call and eventually fall
            # back to OpenRouter rather than passing "" downstream where
            # json.loads will crash with a confusing line-1 error.
            if not text or not text.strip():
                err = RuntimeError(
                    f"Kie returned 2xx with empty content; "
                    f"raw={str(data)[:200]}"
                )
                last_kie_exc = err
                if attempt < max_kie_retries:
                    backoff = min(2 ** (attempt - 1), _BACKOFF_CAP_S)
                    print(
                        f"{log_prefix} kie empty content attempt "
                        f"{attempt}/{max_kie_retries} sleeping={backoff}s"
                    )
                    await asyncio.sleep(backoff)
                    continue
                break

            return text

        # ---- Phase 2: OpenRouter fallback (one attempt) ----
        if openrouter_api_key is None:
            print(
                f"{log_prefix} kie exhausted after {max_kie_retries} "
                f"attempts; no openrouter key configured — raising"
            )
            assert last_kie_exc is not None
            raise last_kie_exc

        print(
            f"{log_prefix} kie exhausted after {max_kie_retries} "
            f"attempts; falling back to openrouter"
        )
        try:
            r = await _call_openrouter_once(
                http=http,
                api_key=openrouter_api_key,
                model=model,
                system=system,
                messages=messages,
                max_tokens=max_tokens,
            )
            r.raise_for_status()
            data = r.json()
            choices = data.get("choices") or []
            if not choices:
                # OR can return an empty choices list under heavy
                # provider moderation or routing failure.
                raise RuntimeError(
                    f"OpenRouter returned no choices: {str(data)[:200]}"
                )
            content = choices[0].get("message", {}).get("content")
            if not content:
                finish = choices[0].get("finish_reason", "?")
                raise RuntimeError(
                    f"OpenRouter returned empty content "
                    f"(finish_reason={finish}): {str(data)[:200]}"
                )
            print(f"{log_prefix} openrouter attempt: ok")
            return content
        except Exception as or_err:
            # OpenRouter failed too. Per the helper's contract, raise
            # the LAST error — which is OR's, since it's most recent.
            # This makes the failure mode visible in Modal logs as an
            # OpenRouter problem (vs Kie), which is diagnostically
            # important: if OR is also failing, the cause is broader
            # than a Kie maintenance window.
            print(
                f"{log_prefix} openrouter failed: "
                f"{type(or_err).__name__}: {or_err}"
            )
            raise
