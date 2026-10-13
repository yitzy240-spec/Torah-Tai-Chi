"""Noach 2026-10-13 clip 2: a chained clip hard-cut at ~4s from the chained
close-up to a full-body shot and invented short sleeves. Chained clips now
get a no-cut environment lock, and a clip whose successor chains from it
must end waist-up with the sleeves in frame (HANDOFF_FRAMING_LOCK)."""
import pytest

import src.video_generator as vg


def _modal_helpers():
    # modal_app imports `modal`, which CI's pytest job does not install;
    # the pure-prompt tests below still run there.
    pytest.importorskip("modal")
    import modal_app
    return modal_app
from src.models import Clip
from src.settings import (
    ENVIRONMENT_LOCK, ENVIRONMENT_LOCK_CHAINED, HANDOFF_FRAMING_LOCK,
)
from src.video_generator import build_seedance_input, prompt_lock_flags

CHAIN = "https://x/last_frame.png"
CHARS = [f"https://x/c{i}.png" for i in range(12)]
DOJOS = [f"https://x/d{i}.png" for i in range(4)]


def _clip(index=1, setting_id="DOJO", visual_prompt="Rav Eli speaks warmly.",
          motion_ref_slug=None):
    return Clip(
        index=index, voiceover="The flood was coming.",
        visual_prompt=visual_prompt, duration_s=8, setting_id=setting_id,
        motion_ref_slug=motion_ref_slug,
    )


def _prompt(first_frame_url=None, **kw) -> str:
    return build_seedance_input(
        _clip(), character_ref_urls=CHARS, dojo_ref_urls=DOJOS,
        first_frame_url=first_frame_url, audio_url=None, **kw,
    )["prompt"]


# ── (a) chained-clip camera lock ─────────────────────────────────────


def test_chained_env_lock_wording():
    t = ENVIRONMENT_LOCK_CHAINED
    assert "or the shot cuts cleanly" not in t
    assert "keep the camera continuous, no cuts or new shots" in t
    # The rest of the environment lock is kept.
    assert "never morph" in t
    assert "from the very first frame" in t
    assert "grey" in t and "backdrop" in t


@pytest.mark.parametrize("mode", ["first_frame", "reference"])
def test_chained_prompt_uses_chained_env_lock(monkeypatch, mode):
    monkeypatch.setattr(vg, "CHAIN_MODE", "first_frame")
    p = _prompt(first_frame_url=CHAIN, chain_mode=mode)
    assert ENVIRONMENT_LOCK_CHAINED in p
    assert ENVIRONMENT_LOCK not in p
    assert "or the shot cuts cleanly" not in p


def test_unchained_prompt_keeps_environment_lock():
    p = _prompt()
    assert ENVIRONMENT_LOCK in p
    assert ENVIRONMENT_LOCK_CHAINED not in p
    assert "or the shot cuts cleanly" in p


def test_motion_ref_drops_chain_so_env_lock_is_unchained():
    p = build_seedance_input(
        _clip(), CHARS, DOJOS, first_frame_url=CHAIN, audio_url=None,
        reference_video_url="https://x/move.mp4",
    )["prompt"]
    assert ENVIRONMENT_LOCK in p


# ── (b) waist-up handoff ─────────────────────────────────────────────


def test_handoff_wording():
    t = HANDOFF_FRAMING_LOCK.lower()
    assert "waist-up" in t
    assert "forearms" in t and "rolled sleeves" in t
    assert "never end on a head-and-shoulders or face close-up" in t
    assert "push-in stops at waist-up" in t


def test_handoff_only_when_followed_by_chained():
    assert HANDOFF_FRAMING_LOCK not in _prompt()
    assert HANDOFF_FRAMING_LOCK not in _prompt(first_frame_url=CHAIN)
    assert HANDOFF_FRAMING_LOCK in _prompt(followed_by_chained=True)
    chained = _prompt(first_frame_url=CHAIN, followed_by_chained=True)
    assert HANDOFF_FRAMING_LOCK in chained
    assert ENVIRONMENT_LOCK_CHAINED in chained


def test_unchained_default_prompt_unchanged_by_handoff_param():
    assert _prompt() == _prompt(followed_by_chained=False)


def test_prompt_lock_flags_handoff_and_env():
    flags = prompt_lock_flags(_prompt(first_frame_url=CHAIN, followed_by_chained=True))
    assert flags["handoff"] is True
    assert flags["environment_chained"] is True
    flags = prompt_lock_flags(_prompt())
    assert flags["handoff"] is False
    assert flags["environment_chained"] is False


# ── _would_chain truth table ─────────────────────────────────────────


@pytest.mark.parametrize(
    "prev_kw, next_setting, next_prompt, broken, motion, expected",
    [
        ({}, "DOJO", "Rav Eli nods.", False, None, True),
        ({}, "GARDEN", "Rav Eli nods.", False, None, False),
        ({}, "DOJO", "Rav Eli nods.", True, None, False),
        ({}, "DOJO", "Rav Eli nods.", False, "cloud-hands", False),
        # New ritual keyword the previous clip lacked: refs must flow.
        ({}, "DOJO", "Rav Eli lifts a kiddush cup.", False, None, False),
        # Same ritual keyword already in the previous clip: still chains.
        ({"vp": "A kiddush cup rests nearby."}, "DOJO",
         "Rav Eli lifts a kiddush cup.", False, None, True),
        # Room-scale ref can't inject on DOJO, so it must not break the chain.
        ({}, "DOJO", "Rav Eli recalls the sukkah.", False, None, True),
    ],
)
def test_would_chain_truth_table(prev_kw, next_setting, next_prompt, broken,
                                 motion, expected):
    prev = _clip(index=1, visual_prompt=prev_kw.get("vp", "Rav Eli speaks."))
    nxt = _clip(index=2, setting_id=next_setting, visual_prompt=next_prompt)
    assert _modal_helpers()._would_chain(prev, nxt, next_chain_broken=broken,
                        next_motion_slug=motion) is expected


def test_would_chain_accepts_dict_rows():
    prev_row = {"setting_id": "DOJO", "visual_prompt": "Rav Eli speaks."}
    assert _modal_helpers()._would_chain(prev_row, _clip(index=2)) is True
    assert _modal_helpers()._would_chain({"setting_id": "GARDEN"}, _clip(index=2)) is False


def test_next_clip_chains_in_plan():
    a, b = _clip(index=0), _clip(index=1)
    assert _modal_helpers()._next_clip_chains_in_plan([a, b], a) is True
    assert _modal_helpers()._next_clip_chains_in_plan([a, b], b) is False  # last clip
    moved = _clip(index=1, motion_ref_slug="cloud-hands")
    assert _modal_helpers()._next_clip_chains_in_plan([a, moved], a) is False
    rows = [
        {"index": 0, "setting_id": "DOJO", "visual_prompt": "x"},
        {"index": 1, "setting_id": "DOJO", "visual_prompt": "y",
         "chain_broken": True},
    ]
    assert _modal_helpers()._next_clip_chains_in_plan(rows, a) is False


# ── (c) probe guard ──────────────────────────────────────────────────


def test_probe_chain_mode_guard():
    assert _modal_helpers()._require_probe_chain_mode("reference") == "reference"
    assert _modal_helpers()._require_probe_chain_mode("first_frame") == "first_frame"
    with pytest.raises(ValueError):
        _modal_helpers()._require_probe_chain_mode("bogus")
