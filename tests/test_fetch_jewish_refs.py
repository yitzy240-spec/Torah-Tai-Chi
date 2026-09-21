"""Guards for the Sukkot / Simchat Torah reference pack.

Everything here is pure — no network, no Kie, no modal. The pack's real
hazards are all decided before a single byte is downloaded:

  * a non-free image slipping through the license gate
  * a keyword that can never match because it isn't lowercase
  * a bare "torah" keyword, which would inject on half the series

so those are what this file pins down.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.fetch_jewish_refs import (
    SLOTS,
    CommonsFile,
    license_verdict,
    registry_snippets,
    sources_entry,
)

# ------------------------------------------------------------- license


@pytest.mark.parametrize(
    "code",
    [
        "pd",
        "pd-old",
        "pd-self",
        "cc0",
        "cc-by-2.0",
        "cc-by-3.0",
        "cc-by-4.0",
        "cc-by-sa-3.0",
        "cc-by-sa-4.0",
        "cc-by-sa-3.0,2.5,2.0,1.0",
        "gfdl",
    ],
)
def test_free_licenses_clear(code):
    free, _ = license_verdict(code, code.upper())
    assert free, f"{code} is free and should clear"


@pytest.mark.parametrize(
    "code",
    [
        "cc-by-nc-2.0",
        "cc-by-nc-sa-4.0",
        "cc-by-nd-3.0",
        "cc-by-nc-nd-4.0",
    ],
)
def test_nc_and_nd_are_refused(code):
    free, reason = license_verdict(code, code.upper())
    assert not free
    assert "NonCommercial" in reason or "NoDerivatives" in reason


def test_unknown_license_is_refused_not_assumed():
    """An unrecognised code means go read the file page, not proceed."""
    free, reason = license_verdict("some-bespoke-museum-terms", "Museum terms")
    assert not free
    assert "check the file page" in reason


def test_missing_license_is_refused():
    free, reason = license_verdict("", "")
    assert not free
    assert "no license information" in reason

    free, reason = license_verdict("", "CC BY-SA 3.0")
    assert not free, "a short name with no machine code is not good enough"
    assert "CC BY-SA 3.0" in reason


def test_verdict_is_case_insensitive():
    assert license_verdict("CC-BY-SA-4.0", "CC BY-SA 4.0")[0]


# ---------------------------------------------------------------- slots


def test_slot_ids_and_filenames_are_sane():
    seen: set[str] = set()
    for slot_id, slot in SLOTS.items():
        assert slot_id.replace("_", "").isalnum(), f"{slot_id} is not a safe ref_id"
        assert slot_id == slot_id.lower()
        assert slot.filename not in seen, f"duplicate filename {slot.filename}"
        seen.add(slot.filename)
        assert Path(slot.filename).suffix in {".jpg", ".jpeg", ".png"}
        assert slot.must_show, f"{slot_id} needs a must_show so the fetcher can be judged"
        assert slot.label, f"{slot_id} needs a picker label"


def test_in_house_slots_are_png():
    """Generated renders come back from gpt-image-2 as PNG, like shofar_held."""
    for slot_id, slot in SLOTS.items():
        if slot.in_house:
            assert slot.filename.endswith(".png"), slot_id


def test_every_keyword_is_lowercase():
    """_jewish_refs_for_clip lowercases the prompt and does `kw in prompt`.

    An uppercase character anywhere in a keyword makes it dead on
    arrival — it can never match. Silent, and invisible until a render
    comes back without its reference.
    """
    for slot_id, slot in SLOTS.items():
        for kw in slot.keywords:
            assert kw == kw.lower(), f"{slot_id} keyword {kw!r} can never match"
            assert kw.strip() == kw, f"{slot_id} keyword {kw!r} has loose whitespace"
            assert kw, f"{slot_id} has an empty-string keyword, which matches everything"


def test_no_bare_torah_keyword():
    """The show is *about* Torah — a bare "torah" keyword is unusable.

    "he explains what the Torah asks of us" is an ordinary scene
    direction. Registering bare "torah" would inject scroll references
    into a large fraction of every episode, crowd the 3-per-clip cap,
    and dilute the character and dojo anchors. Same reasoning as the
    existing registry note about not registering bare "horn".
    """
    for slot_id, slot in SLOTS.items():
        for kw in slot.keywords:
            assert kw != "torah", f"{slot_id} registers bare 'torah'"
            if "torah" in kw:
                assert " " in kw, (
                    f"{slot_id} keyword {kw!r} is a single torah-ish token; "
                    "torah keywords must be multi-word phrases"
                )


def test_no_keyword_appears_in_the_dojo_anchor_text():
    """The dojo's wall logo spells out TORAH in cedar letters.

    Keyword matching currently runs on clip.visual_prompt alone, so the
    anchor text can't false-match. This test fails the moment a pack
    keyword would collide if that ever changed — cheap insurance on a
    landmine that would otherwise inject refs into every dojo clip in
    the series.
    """
    from src.settings import DOJO_ANCHOR_TEXT

    anchor = DOJO_ANCHOR_TEXT.lower()
    collisions = [
        (slot_id, kw)
        for slot_id, slot in SLOTS.items()
        for kw in slot.keywords
        if kw in anchor
    ]
    assert not collisions, f"keywords present in DOJO_ANCHOR_TEXT: {collisions}"


def test_object_and_grip_share_keywords():
    """The shofar lesson: the object photo and the held render must
    inject together, or the model gets the object right and the grip
    wrong. shofar_held copies shofar's keywords for exactly this."""
    assert set(SLOTS["lulav_held"].keywords) & {"lulav", "etrog"}
    assert set(SLOTS["torah_held"].keywords) & set(SLOTS["torah_dressed"].keywords)


def test_picker_only_slots_have_no_keywords():
    """Empty keyword list is the picker-only contract."""
    for slot_id in ("lulav_shaking", "torah_dancing"):
        assert SLOTS[slot_id].keywords == [], slot_id


def test_pack_covers_both_festivals():
    assert {"sukkah_exterior", "sukkah_schach", "etrog_closeup"} <= set(SLOTS)
    assert {"torah_dressed", "torah_open", "aron_kodesh", "hakafot"} <= set(SLOTS)


# --------------------------------------------------------------- output


def _fake_file() -> CommonsFile:
    return CommonsFile(
        title="File:Open Torah scroll.jpg",
        url="https://upload.wikimedia.org/wikipedia/commons/a/ab/Open_Torah_scroll.jpg",
        width=2048,
        height=1365,
        license_code="cc-by-sa-4.0",
        license_short="CC BY-SA 4.0",
        artist="Some Photographer",
        description="An open Torah scroll on a reading table.",
    )


def test_sources_entry_carries_url_license_and_author():
    entry = sources_entry("torah_open", SLOTS["torah_open"], _fake_file())
    assert entry.startswith("## torah_open.jpg")
    assert "https://upload.wikimedia.org/" in entry
    assert "CC BY-SA 4.0" in entry
    assert "Some Photographer" in entry
    assert "2048x1365" in entry


def test_sources_entry_flags_picker_only_slots():
    entry = sources_entry("torah_dancing", SLOTS["torah_dancing"], _fake_file())
    assert "picker-only" in entry


def test_registry_snippets_cover_all_three_sites():
    snip = registry_snippets("torah_open", SLOTS["torah_open"])
    assert "JEWISH_REF_FILENAMES" in snip
    assert "JEWISH_REF_KEYWORDS" in snip
    assert "ref-image-library.ts" in snip
    assert '"torah_open": "torah_open.jpg",' in snip
    assert "refs/jewish/torah_open.jpg" in snip
    assert '"open torah"' in snip


def test_registry_snippet_for_picker_slot_has_empty_list():
    snip = registry_snippets("torah_dancing", SLOTS["torah_dancing"])
    assert '"torah_dancing": [],' in snip


def test_registry_snippet_warns_about_insertion_order():
    """Dict position is the cap's priority order — the snippet has to say
    so, because pasting at the bottom is the natural thing to do and is
    wrong for subject refs."""
    snip = registry_snippets("torah_dressed", SLOTS["torah_dressed"])
    assert "cap" in snip.lower()
