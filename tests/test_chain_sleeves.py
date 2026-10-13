"""Noach 2026-10-13: the clip-1 re-render came back with wrist-length,
unrolled sleeves (clip 0 had them rolled to mid-forearm), and the text
lock allowed both. Also covers SEEDANCE_CHAIN_MODE=reference, which sends
the chain frame as reference image 1 so the identity refs ride along."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

import src.video_generator as vg
from src.models import Clip
from src.settings import (
    CHAIN_CONTINUITY_LOCK, CHAIN_REFERENCE_LOCK, WARDROBE_LOCK,
)
from src.video_generator import (
    MAX_REFS, build_seedance_input, parse_chain_mode, prompt_lock_flags,
)

CLIP = Clip(
    index=1,
    voiceover="When God tells Noah a flood will destroy humanity, he was silent.",
    visual_prompt="Rav Eli stands on the indigo runner, expression grave.",
    duration_s=11, setting_id="DOJO",
)
REPO_ROOT = Path(__file__).resolve().parent.parent
CHAIN = "https://x/last_frame.png"
CHARS = [f"https://x/c{i}.png" for i in range(12)]
DOJOS = [f"https://x/d{i}.png" for i in range(4)]


def _payload(first_frame_url=None, audio_url=None, **kw):
    return build_seedance_input(
        CLIP, character_ref_urls=CHARS, dojo_ref_urls=DOJOS,
        first_frame_url=first_frame_url, audio_url=audio_url,
        resolution="720p", **kw,
    )


def _reference_fields(p: dict) -> list[str]:
    return [k for k in p if k.startswith("reference_")]


# ── sleeve lock ───────────────────────────────────────────────────────


def test_sleeve_lock_pins_one_style():
    t = WARDROBE_LOCK.lower()
    assert "mid-forearm" in t
    assert "turned-back cuff" in t
    assert "both arms" in t
    assert "never unrolled to the wrist" in t
    assert "never wrist-length" in t
    assert "never short sleeves" in t and "never sleeveless" in t
    # The ambiguous PR #20 wording must be gone.
    assert "forearm or wrist" not in t
    assert "trousers" in t and "shoes" in t and "costume" in t


# ── default mode: unchanged ───────────────────────────────────────────


def test_default_mode_is_first_frame(monkeypatch):
    monkeypatch.setattr(vg, "CHAIN_MODE", "first_frame")
    p = _payload(first_frame_url=CHAIN)
    assert p["first_frame_url"] == CHAIN
    assert _reference_fields(p) == []
    assert CHAIN_CONTINUITY_LOCK in p["prompt"]
    assert CHAIN_REFERENCE_LOCK not in p["prompt"]


# ── reference mode ────────────────────────────────────────────────────


@pytest.mark.parametrize("via", ["env", "override"])
def test_reference_mode_sends_chain_frame_as_image_1(monkeypatch, via):
    if via == "env":
        monkeypatch.setattr(vg, "CHAIN_MODE", "reference")
        p = _payload(first_frame_url=CHAIN)
    else:
        monkeypatch.setattr(vg, "CHAIN_MODE", "first_frame")
        p = _payload(first_frame_url=CHAIN, chain_mode="reference")
    assert "first_frame_url" not in p
    refs = p["reference_image_urls"]
    assert refs[0] == CHAIN
    assert len(refs) <= MAX_REFS
    assert refs[1:] == vg._select_refs(CHARS, DOJOS, "DOJO")[:MAX_REFS - 1]
    assert CHAIN_REFERENCE_LOCK in p["prompt"]
    assert CHAIN_CONTINUITY_LOCK not in p["prompt"]
    assert WARDROBE_LOCK in p["prompt"]
    assert "@Image1" in CHAIN_REFERENCE_LOCK


def test_reference_mode_caps_override_refs_and_keeps_chain_first():
    override = [f"https://x/o{i}.png" for i in range(12)]
    p = _payload(first_frame_url=CHAIN, chain_mode="reference",
                 override_ref_urls=override)
    refs = p["reference_image_urls"]
    assert refs[0] == CHAIN
    assert len(refs) == MAX_REFS
    assert refs[1:] == override[:MAX_REFS - 1]


def test_reference_mode_does_not_duplicate_chain_frame():
    p = _payload(first_frame_url=CHAIN, chain_mode="reference",
                 override_ref_urls=["https://x/a.png", CHAIN])
    assert p["reference_image_urls"] == [CHAIN, "https://x/a.png"]


def test_motion_ref_clip_does_not_chain_in_reference_mode():
    p = _payload(first_frame_url=CHAIN, chain_mode="reference",
                 reference_video_url="https://x/move.mp4")
    assert "first_frame_url" not in p
    assert CHAIN not in p["reference_image_urls"]
    assert CHAIN_REFERENCE_LOCK not in p["prompt"]
    assert CHAIN_CONTINUITY_LOCK not in p["prompt"]


def test_unchained_clip_identical_in_both_modes():
    a = _payload(chain_mode="first_frame")
    b = _payload(chain_mode="reference")
    assert a == b
    assert CHAIN_REFERENCE_LOCK not in a["prompt"]


# ── Seedance mutex ────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", ["first_frame", "reference"])
@pytest.mark.parametrize("ff", [None, CHAIN])
@pytest.mark.parametrize("motion", [None, "https://x/move.mp4"])
@pytest.mark.parametrize("override", [None, ["https://x/o.png"]])
def test_never_first_frame_with_reference_fields(mode, ff, motion, override):
    p = _payload(first_frame_url=ff, chain_mode=mode,
                 reference_video_url=motion, override_ref_urls=override)
    assert not ("first_frame_url" in p and _reference_fields(p))


def test_audio_with_first_frame_is_unchanged_in_first_frame_mode():
    # Pre-existing behaviour, documented not endorsed: reference_audio_urls
    # rides alongside first_frame_url. Audio handling is out of scope here.
    p = _payload(first_frame_url=CHAIN, audio_url="https://x/a.mp3",
                 chain_mode="first_frame")
    assert p["first_frame_url"] == CHAIN
    assert p["reference_audio_urls"] == ["https://x/a.mp3"]
    assert "reference_image_urls" not in p


def test_audio_with_chain_in_reference_mode_keeps_mutex():
    p = _payload(first_frame_url=CHAIN, audio_url="https://x/a.mp3",
                 chain_mode="reference")
    assert "first_frame_url" not in p
    assert p["reference_audio_urls"] == ["https://x/a.mp3"]
    assert p["reference_image_urls"][0] == CHAIN


# ── env var parsing ───────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    (None, "first_frame"), ("", "first_frame"), ("bogus", "first_frame"),
    ("first_frame", "first_frame"), ("reference", "reference"),
    (" Reference ", "reference"),
])
def test_parse_chain_mode(raw, expected):
    assert parse_chain_mode(raw) == expected


def _module_chain_mode(env_value):
    # Fresh interpreter: reloading src.video_generator in-process would
    # redefine its exception classes under other tests' feet.
    env = {k: v for k, v in os.environ.items() if k != "SEEDANCE_CHAIN_MODE"}
    if env_value is not None:
        env["SEEDANCE_CHAIN_MODE"] = env_value
    out = subprocess.run(
        [sys.executable, "-c",
         "import src.video_generator as v; print(v.CHAIN_MODE)"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, check=True,
    )
    return out.stdout.strip().splitlines()[-1]


@pytest.mark.parametrize("raw,expected", [
    (None, "first_frame"), ("reference", "reference"),
    ("nonsense", "first_frame"),
])
def test_env_var_sets_module_chain_mode(raw, expected):
    assert _module_chain_mode(raw) == expected


def test_invalid_override_falls_back_to_first_frame():
    p = _payload(first_frame_url=CHAIN, chain_mode="bogus")
    assert p["first_frame_url"] == CHAIN


# ── prompt_lock_flags ─────────────────────────────────────────────────


def test_prompt_lock_flags():
    chained = prompt_lock_flags(_payload(first_frame_url=CHAIN,
                                         chain_mode="first_frame")["prompt"])
    assert chained == {"wardrobe": True, "lip_sync": True,
                       "chain_continuity": True, "chain_reference": False,
                       "environment_chained": True, "handoff": False}
    ref = prompt_lock_flags(_payload(first_frame_url=CHAIN,
                                     chain_mode="reference")["prompt"])
    assert ref["chain_reference"] and not ref["chain_continuity"]
    assert prompt_lock_flags("") == {
        "wardrobe": False, "lip_sync": False,
        "chain_continuity": False, "chain_reference": False,
        "environment_chained": False, "handoff": False,
    }


# ── modal_app: chain decisions are logged ─────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("kw,reason", [
    ({"chain_broken": True}, "operator_chain_broken"),
    ({"clip_index": 0}, "first_clip"),
    ({"motion_ref_slug": "wave"}, "motion_ref"),
    ({}, "prev_clip_not_rendered"),
])
async def test_resolve_regen_first_frame_logs_chain_decision(kw, reason):
    pytest.importorskip("modal")
    from modal_app import _resolve_regen_first_frame
    from tests.fakes.fake_supabase import FakeSupabase

    sb = FakeSupabase()
    args = dict(
        sb=sb, parent_job_id="parent-job", clip_index=1,
        clip_visual_prompt="same dojo", clip_setting_id="DOJO",
        motion_ref_slug=None, kie=None, work_dir=None,
    )
    args.update(kw)
    assert await _resolve_regen_first_frame(**args) is None

    events = [r for r in sb.rows["execution_events"]
              if r["event"] == "pipeline.chain_decision"]
    assert len(events) == 1
    d = events[0]["details"]
    assert d["chained"] is False
    assert d["reason"] == reason
    assert d["clip_index"] == args["clip_index"]
    assert d["chain_mode"] in vg.CHAIN_MODES
    assert events[0]["subject_type"] == "clip"


@pytest.mark.asyncio
async def test_chain_decision_logging_never_raises():
    pytest.importorskip("modal")
    from modal_app import _resolve_regen_first_frame

    # sb=None: log_event's insert fails, the gate must still return None.
    assert await _resolve_regen_first_frame(
        sb=None, parent_job_id="p", clip_index=1, clip_visual_prompt="",
        clip_setting_id="DOJO", motion_ref_slug=None, kie=None,
        work_dir=None, chain_broken=True,
    ) is None
