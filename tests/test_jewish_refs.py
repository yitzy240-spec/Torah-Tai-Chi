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
    _jewish_ref_ids_in_prompt,
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
