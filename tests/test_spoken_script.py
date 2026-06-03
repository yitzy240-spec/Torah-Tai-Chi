"""Unit tests for `src.spoken_script._pick_spoken_script`.

The "prior non-empty wins" decision was extracted from the three stitch-
time writers in modal_app.py (clips_only_job, regen_clip_from_text,
compose_video) so it could be tested in isolation — no Supabase mock
required. See src/spoken_script.py for the why-this-exists block.

Test matrix mirrors the carry-forward semantics of the existing
title / subtitle / description / website_caption fields in
`_resolve_video_title_fields` (Phase 0.4, 2026-06-03).
"""
from __future__ import annotations

import pytest

from src.spoken_script import _pick_spoken_script


def test_no_carried_value_falls_back_to_fresh_build():
    # No prior videos row → resolver returns None → use fresh.
    assert _pick_spoken_script(None, "fresh built script") == "fresh built script"


def test_non_empty_carried_value_wins_over_fresh_build():
    # Prior row has Yonah's hand-edited teaching text.
    carried = "Yonah's hand-edited teaching text\n\nSecond paragraph."
    fresh = "Auto-built from clip voiceovers"
    assert _pick_spoken_script(carried, fresh) == carried


def test_empty_string_carried_falls_back_to_fresh_build():
    # Empty carried value is treated as "no override". Mirrors the
    # whitespace-trimming guard in _resolve_video_title_fields's
    # carry-forward loop (the field is skipped if str.strip() is empty).
    assert _pick_spoken_script("", "fresh") == "fresh"


def test_whitespace_only_carried_falls_back_to_fresh_build():
    # Operator who accidentally cleared the field shouldn't blank the
    # teaching text on the public site.
    assert _pick_spoken_script("   \n\t  ", "fresh built") == "fresh built"


def test_carried_value_with_surrounding_whitespace_is_returned_as_is():
    # We trim for the EMPTINESS CHECK only — actual carried value is
    # returned verbatim. Matches "prior non-empty wins" semantics on
    # the other carry-forward fields, which also return verbatim.
    carried = "\nActual content\n"
    assert _pick_spoken_script(carried, "fresh") == carried


def test_non_string_carried_falls_back_to_fresh_build():
    # Defensive: a corrupt prior row (e.g. JSON parse weirdness)
    # shouldn't crash the stitch. Anything not-a-string → use fresh.
    assert _pick_spoken_script(123, "fresh") == "fresh"  # type: ignore[arg-type]
    assert _pick_spoken_script({"x": 1}, "fresh") == "fresh"  # type: ignore[arg-type]


def test_fresh_empty_string_is_returned_when_no_carried():
    # Edge case: clips with all-empty voiceovers → fresh is "". We
    # still return that (better an empty string than crash); the
    # absence-of-carried path is the dominant one here.
    assert _pick_spoken_script(None, "") == ""


def test_carried_wins_even_when_fresh_is_long_and_carried_is_short():
    # No length heuristic — non-empty carried wins regardless of size.
    carried = "Short."
    fresh = "A very long auto-built script " * 20
    assert _pick_spoken_script(carried, fresh) == carried


class _FakeQuery:
    """Minimal stand-in for supabase-py's query-builder chain.

    Only implements the methods used by `_resolve_video_title_fields`:
    .select, .eq, .order, .limit, .maybe_single, .single, .execute.
    Each instance is configured with a fixed `data` payload, returned
    from .execute().
    """

    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):  # noqa: D401 - tiny shim
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def single(self):
        return self

    def execute(self):
        class _R:
            pass
        r = _R()
        r.data = self._data
        return r


class _FakeSupabase:
    """Routes `.table(name)` calls to per-table _FakeQuery payloads.

    Tests pass a {table_name: payload_or_list} dict. For tables that get
    .order().limit() (the videos carry-forward query), pass a LIST that
    the query returns; for single-row lookups (jobs, scripts, parshiot)
    pass a DICT or None.
    """

    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name))


def _resolver():
    """Import `_resolve_video_title_fields` from modal_app, stubbing out
    `modal` + `fastapi` since neither is installed in the local dev env
    (both only run inside Modal's sandbox image). Doing the stubbing
    here, lazily, keeps test collection clean for tests that don't need
    modal_app — only the resolver tests pay the import cost.
    """
    import sys
    import types

    if "modal" not in sys.modules:
        class _Permissive:
            """No-op stub for the parts of the `modal` SDK that fire at
            module-import time on modal_app: App(), App.function(...) as
            a decorator factory, Image.debian_slim().apt_install()....

            Rules:
              - any attribute access returns another _Permissive
              - calling it returns _Permissive UNLESS the only arg is
                callable (decorator-application case: return the fn
                untouched so @app.function()(fn) yields fn).
            """

            def __init__(self, *_a, **_k):
                pass

            def __call__(self, *args, **_kwargs):
                if len(args) == 1 and not _kwargs and callable(args[0]):
                    # Decorator application: pass through the function.
                    return args[0]
                return _Permissive()

            def __getattr__(self, _name):
                return _Permissive()

        modal_stub = types.ModuleType("modal")
        modal_stub.App = _Permissive
        modal_stub.Image = _Permissive()
        modal_stub.Secret = _Permissive()
        modal_stub.fastapi_endpoint = _Permissive()
        # Catch-all: any other attribute access on the module also
        # returns a _Permissive (e.g. modal.gpu, modal.Volume, etc.).
        modal_stub.__getattr__ = lambda _name: _Permissive()  # type: ignore[attr-defined]
        sys.modules["modal"] = modal_stub

    if "fastapi" not in sys.modules:
        fastapi_stub = types.ModuleType("fastapi")

        class _HTTPException(Exception):
            def __init__(self, *_a, **_k):
                super().__init__()

        class _Request:
            pass

        fastapi_stub.HTTPException = _HTTPException
        fastapi_stub.Request = _Request
        sys.modules["fastapi"] = fastapi_stub

    from modal_app import _resolve_video_title_fields
    return _resolve_video_title_fields


def test_resolver_returns_spoken_script_key_even_when_no_script_id():
    # job has no script_id and no parent → bail early, all-None dict.
    sb = _FakeSupabase({
        "jobs": {"script_id": None, "parsha_id": None, "regen_of_job_id": None},
    })
    out = _resolver()(sb, "job-x")
    assert "spoken_script" in out
    assert out["spoken_script"] is None


def test_resolver_carries_forward_prior_spoken_script():
    # Prior videos row has the operator's hand-edited teaching text.
    # Resolver must surface it under "spoken_script".
    sb = _FakeSupabase({
        "jobs": {
            "script_id": "script-1",
            "parsha_id": "parsha-1",
            "regen_of_job_id": None,
        },
        "scripts": {"title": "Test Script", "tldr": "tl;dr"},
        "parshiot": {"name": "Bamidbar"},
        "videos": [{
            "title": "Bamidbar",
            "subtitle": "Test Script",
            "description": "tl;dr",
            "website_caption": "operator caption",
            "spoken_script": "Yonah's edited teaching text.",
        }],
    })
    out = _resolver()(sb, "job-x")
    assert out["spoken_script"] == "Yonah's edited teaching text."
    # Cross-check: existing 4 fields still carry forward.
    assert out["title"] == "Bamidbar"
    assert out["subtitle"] == "Test Script"
    assert out["description"] == "tl;dr"
    assert out["website_caption"] == "operator caption"


def test_resolver_empty_prior_spoken_script_returns_none():
    # Empty / whitespace-only carried value falls through the loop's
    # `if isinstance(v, str) and not v.strip(): continue` guard, leaving
    # spoken_script at its initial None. The writer-side
    # _pick_spoken_script then falls back to the fresh build.
    sb = _FakeSupabase({
        "jobs": {
            "script_id": "script-1",
            "parsha_id": "parsha-1",
            "regen_of_job_id": None,
        },
        "scripts": {"title": "T", "tldr": "d"},
        "parshiot": {"name": "P"},
        "videos": [{
            "title": "T", "subtitle": None,
            "description": None, "website_caption": None,
            "spoken_script": "   \n  ",
        }],
    })
    out = _resolver()(sb, "job-x")
    assert out["spoken_script"] is None


def test_resolver_null_prior_spoken_script_returns_none():
    # Most common case: prior row exists but spoken_script column is
    # NULL (never had an operator edit). Carry-forward leaves it None.
    sb = _FakeSupabase({
        "jobs": {
            "script_id": "script-1",
            "parsha_id": "parsha-1",
            "regen_of_job_id": None,
        },
        "scripts": {"title": "T", "tldr": "d"},
        "parshiot": {"name": "P"},
        "videos": [{
            "title": "T", "subtitle": None,
            "description": None, "website_caption": None,
            "spoken_script": None,
        }],
    })
    out = _resolver()(sb, "job-x")
    assert out["spoken_script"] is None


def test_resolver_no_prior_video_row_returns_none_spoken_script():
    # First-ever render for this parsha — no prior videos row.
    sb = _FakeSupabase({
        "jobs": {
            "script_id": "script-1",
            "parsha_id": "parsha-1",
            "regen_of_job_id": None,
        },
        "scripts": {"title": "T", "tldr": "d"},
        "parshiot": {"name": "P"},
        "videos": [],
    })
    out = _resolver()(sb, "job-x")
    assert out["spoken_script"] is None


def test_clips_only_job_pattern_prior_wins_over_fresh():
    """Integration-style: simulate the clips_only_job writer path.

    Synthetic prior row + new clips → assert prior spoken_script wins.
    Mirrors the plan's "synthetic prior row + new clips → assert prior
    spoken_script wins" acceptance criterion.
    """
    sb = _FakeSupabase({
        "jobs": {
            "script_id": "s1", "parsha_id": "p1", "regen_of_job_id": None,
        },
        "scripts": {"title": "T", "tldr": "d"},
        "parshiot": {"name": "Bamidbar"},
        "videos": [{
            "title": "Bamidbar", "subtitle": "T",
            "description": "d", "website_caption": None,
            "spoken_script": "Hand-edited by Yonah after publish.",
        }],
    })
    title_fields = _resolver()(sb, "job-x")
    # Now simulate the writer's fresh-build (from the just-stitched
    # new clips):
    fresh = "Newly auto-rebuilt from the new clip voiceovers."
    chosen = _pick_spoken_script(
        title_fields.get("spoken_script"), fresh,
    )
    assert chosen == "Hand-edited by Yonah after publish."
