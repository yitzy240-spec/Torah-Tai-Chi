"""Pure helpers for resolving `videos.spoken_script` at stitch time.

Why this module exists:
    The dashboard's "Edit teaching text" action (dashboard/src/app/
    actions/update-teaching-text.ts) writes operator-edited
    `videos.spoken_script` and its docstring promises that edit
    survives across (un)publish toggles and re-stitches.

    But Modal's stitch-time writers (clips_only_job, regen_clip_from_text,
    compose_video in modal_app.py) used to UNCONDITIONALLY overwrite
    `spoken_script` with a freshly-built string from the current clip
    voiceovers — wiping out any operator hand-edit on every re-render.

    The pure-helper extraction (mirroring src/operator_overrides.py) lets
    the "prior non-empty wins, else fall back to fresh build" decision be
    unit-tested in isolation without standing up a Supabase mock.

    The matching Supabase carry-forward fetch lives in
    `modal_app._resolve_video_title_fields`, which now also returns a
    `spoken_script` key (prior row value, or None when there's no prior).
"""
from __future__ import annotations


def _pick_spoken_script(carried: str | None, fresh: str) -> str:
    """Decide which `spoken_script` to persist on a videos row.

    "Prior non-empty wins" — matches the carry-forward semantics used for
    title / subtitle / description / website_caption in
    `_resolve_video_title_fields`. The Phase 5 site-card edits and the
    teaching-text edit share the same survival contract: operator wins
    over a fresh script-derived default.

    Args:
        carried: the prior videos row's spoken_script (or None when
            there is no prior row). Empty / whitespace-only strings are
            treated as "no override" so a stray clear doesn't silently
            blank the teaching text after a re-render.
        fresh: the freshly-built string from the just-stitched clips
            (output of `modal_app._build_spoken_script`). Used as the
            fallback when there's no usable carried value.

    Returns:
        `carried` when it's a non-whitespace string; otherwise `fresh`.
    """
    if carried and isinstance(carried, str) and carried.strip():
        return carried
    return fresh
