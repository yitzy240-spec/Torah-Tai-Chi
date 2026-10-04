"""Guards for the Jewish ritual reference library.

The two registration dicts (filenames + keywords) and the on-disk images
must stay in lockstep — a typo'd ref_id or missing file fails SILENTLY
at render time (_upload_jewish_refs just prints and skips). Added when
shofar joined the library (Rosh Hashanah 2026: Seedance improvised
unusable shofars until a reference photo anchored it).
"""
from pathlib import Path

import pytest

pytest.importorskip("modal")

from modal_app import (  # noqa: E402
    JEWISH_REF_FILENAMES,
    JEWISH_REF_KEYWORDS,
    ROOM_SCALE_JEWISH_REFS,
    _jewish_ref_ids_in_prompt,
    _jewish_refs_for_clip,
)

ROOT = Path(__file__).resolve().parent.parent


def test_filenames_and_keywords_dicts_are_in_lockstep():
    assert set(JEWISH_REF_FILENAMES) == set(JEWISH_REF_KEYWORDS), (
        "every jewish ref needs BOTH a filename and a keyword list"
    )


def test_every_registered_ref_image_exists_on_disk():
    missing = [
        f"{ref_id} -> references/jewish/{fn}"
        for ref_id, fn in JEWISH_REF_FILENAMES.items()
        if not (ROOT / "references" / "jewish" / fn).is_file()
    ]
    assert not missing, f"registered but missing from disk: {missing}"


def test_shofar_keyword_triggers_ref_and_chain_break():
    """'shofar' in a scene direction must match the shofar ref — which
    also makes the chain gates break first-frame chaining so the ref
    images can actually flow (refs and first_frame are mutex)."""
    ids = _jewish_ref_ids_in_prompt(
        "Rav Eli raises a small shofar to his lips at dawn"
    )
    assert "shofar" in ids

    assert _jewish_ref_ids_in_prompt("he walks the mountain path") == set()


# ── room-scale refs stay off DOJO clips ─────────────────────────────────────
#
# Yonah, Bereishit 2026-10-04: clip 1 morphed its background mid-clip. A room
# photo next to the dojo refs gives Seedance two places to reconcile.

class _Clip:
    def __init__(self, visual_prompt, setting_id, index=0):
        self.visual_prompt = visual_prompt
        self.setting_id = setting_id
        self.index = index


ALL_REF_URLS = {ref_id: f"https://kie/{ref_id}" for ref_id in JEWISH_REF_FILENAMES}


def test_room_scale_set_names_only_registered_refs():
    assert ROOM_SCALE_JEWISH_REFS <= set(JEWISH_REF_FILENAMES)


def test_simchat_torah_on_a_dojo_clip_does_not_bring_in_the_crowded_shul():
    # Bereishit is read the Shabbat after Simchat Torah; a dojo line that
    # says so used to pull in the hakafot photo — a full shul.
    clip = _Clip("In the dojo, Rav Eli recalls simchat torah and smiles", "DOJO")
    urls = _jewish_refs_for_clip(clip, ALL_REF_URLS)
    assert "https://kie/hakafot" not in urls


def test_sukkah_on_a_dojo_clip_injects_no_room():
    clip = _Clip("Rav Eli in the dojo speaks of the sukkah and its schach", "DOJO")
    urls = _jewish_refs_for_clip(clip, ALL_REF_URLS)
    assert not ({f"https://kie/{r}" for r in ROOM_SCALE_JEWISH_REFS} & set(urls))


def test_object_refs_still_inject_on_a_dojo_clip():
    clip = _Clip("Rav Eli in the dojo lifts a shofar", "DOJO")
    urls = _jewish_refs_for_clip(clip, ALL_REF_URLS)
    assert "https://kie/shofar" in urls


def test_room_refs_still_inject_outdoors():
    clip = _Clip("Rav Eli sits inside the sukkah under the schach", "FOREST_PATH")
    urls = _jewish_refs_for_clip(clip, ALL_REF_URLS)
    assert "https://kie/sukkah_interior" in urls


def test_a_room_keyword_does_not_break_a_dojo_chain():
    # The ref can't inject into a dojo clip, so it must not cost the clip
    # its first-frame anchor either.
    assert _jewish_ref_ids_in_prompt("he mentions the sukkah", "DOJO") == set()
    assert "sukkah_interior" in _jewish_ref_ids_in_prompt("he mentions the sukkah", "FOREST_PATH")
    # Default (no setting) is unchanged for any other caller.
    assert "sukkah_interior" in _jewish_ref_ids_in_prompt("he mentions the sukkah")
