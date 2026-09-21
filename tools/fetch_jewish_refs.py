"""Source Jewish-ritual reference photos from Wikimedia Commons.

    python tools/fetch_jewish_refs.py --list
    python tools/fetch_jewish_refs.py --browse "Category:Hakafot"
    python tools/fetch_jewish_refs.py --resolve "File:Open Torah scroll.jpg"
    python tools/fetch_jewish_refs.py --fetch torah_open="File:Open Torah scroll.jpg"

WHY THIS EXISTS
---------------
The first eight jewish refs were downloaded by hand and their SOURCES.md
entries written by hand. That worked for eight and does not scale to the
Sukkot + Simchat Torah pack, and hand-transcription gets two things
wrong in ways nobody notices until much later:

  * The direct URL. Commons file URLs carry an MD5-derived path prefix
    (.../commons/7/76/Shofar-16-Zachi-Evenor.jpg). It cannot be derived
    from the filename by eye or by guess. A wrong URL in SOURCES.md is
    worse than no URL, because the next person trusts it.
  * The license. SOURCES.md already warns that most of these are CC
    BY-SA and carry attribution + share-alike obligations before any
    commercial use of derived video. Deciding that by glancing at a file
    page is how a non-free image ends up in a published render.

So this reads both straight from the Commons API, refuses anything that
is not free, and writes the SOURCES.md entry itself.

It also prints the exact registry lines to paste, because registration
is a four-file dance (two dicts in modal_app.py, the dashboard picker
library, SOURCES.md) and CI fails the build if the dicts and the on-disk
files drift apart.

NETWORK
-------
Needs plain access to commons.wikimedia.org. The Claude Code container's
egress proxy blocks Wikimedia, so run this on a normal machine — or via
.github/workflows/fetch-refs.yml, which runs it on a GitHub runner and
commits the result.

See references/jewish/PACK-sukkot-simchat-torah.md for what each slot
has to show, the keyword rules, and why insertion order in
JEWISH_REF_KEYWORDS decides which refs survive the 3-per-clip cap.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
JEWISH_DIR = ROOT / "references" / "jewish"
SOURCES_MD = JEWISH_DIR / "SOURCES.md"

API = "https://commons.wikimedia.org/w/api.php"

# Wikimedia asks every client to identify itself and rate-limits the ones
# that don't. Keep this honest and contactable.
USER_AGENT = (
    "TorahTaiChi-RefFetcher/1.0 "
    "(https://github.com/yitzy240-spec/Torah-Tai-Chi; reference sourcing)"
)


# ---------------------------------------------------------------- slots


@dataclass(frozen=True)
class Slot:
    """One reference image the pack wants.

    keywords == [] means picker-only: registered so the operator can pin
    it per clip via "+ Refs", never auto-injected. Same convention as
    shofar_raised / shofar_blowing / shofar_at_side.
    """

    filename: str
    label: str
    must_show: str
    keywords: list[str] = field(default_factory=list)
    in_house: bool = False
    category: str = "jewish"


# Order here is presentation only. The order that MATTERS is the order of
# JEWISH_REF_KEYWORDS in modal_app.py, which decides which refs win the
# 3-per-clip cap — see the pack doc's "Insertion order matters" section.
SLOTS: dict[str, Slot] = {
    # ---- Sukkot
    "sukkah_exterior": Slot(
        filename="sukkah_exterior.jpg",
        label="Sukkah — exterior",
        must_show=(
            "a freestanding sukkah from outside: walls, doorway, roof edge, "
            "enough surroundings to read as temporary"
        ),
        keywords=[
            "sukkah from outside",
            "outside the sukkah",
            "approaches the sukkah",
            "courtyard sukkah",
            "sukkah in the yard",
        ],
    ),
    "sukkah_schach": Slot(
        filename="sukkah_schach.jpg",
        label="Sukkah — schach roof",
        must_show=(
            "the roof from underneath, looking up: cut branches or bamboo "
            "mat with daylight through the gaps"
        ),
        keywords=[
            "schach",
            "s'chach",
            "bamboo roof",
            "branches overhead",
            "roof of the sukkah",
            "stars through the roof",
        ],
    ),
    "etrog_closeup": Slot(
        filename="etrog_closeup.jpg",
        label="Etrog — close-up",
        must_show="one etrog filling the frame, bumpy rind and pitam visible",
        keywords=["etrog", "citron"],
    ),
    "lulav_held": Slot(
        filename="lulav_held.png",
        label="Rav Eli — holding lulav & etrog",
        must_show=(
            "lulav upright in the right hand with its spine toward him, "
            "etrog in the left, both at chest height"
        ),
        # Same keywords as lulav_etrog on purpose: object + grip inject
        # together, the challah and shofar_held precedent.
        keywords=["lulav", "etrog", "four species", "arba minim"],
        in_house=True,
    ),
    "lulav_shaking": Slot(
        filename="lulav_shaking.png",
        label="Rav Eli — shaking lulav",
        must_show="the same grip mid-na'anuim, bundle extended away from the body",
        keywords=[],
        in_house=True,
    ),
    # ---- Simchat Torah
    "torah_dressed": Slot(
        filename="torah_dressed.jpg",
        label="Sefer Torah — dressed",
        must_show=(
            "a closed sefer Torah standing dressed: mantle, atzei chayim "
            "handles, and at least one of crown / rimonim / breastplate"
        ),
        keywords=[
            "sefer torah",
            "torah scroll",
            "torah mantle",
            "torah crown",
            "rimonim",
            "breastplate",
        ],
    ),
    "torah_open": Slot(
        filename="torah_open.jpg",
        label="Sefer Torah — open",
        must_show=(
            "an open scroll, both rollers visible, hand-written parchment "
            "legible as columns (a photograph, not a flat scan)"
        ),
        keywords=[
            "open torah",
            "open scroll",
            "unrolled scroll",
            "torah reading",
            "columns of parchment",
            "laining",
        ],
    ),
    "torah_yad": Slot(
        filename="torah_yad.jpg",
        label="Yad (Torah pointer)",
        must_show="a silver yad on or pointing at parchment text, hand shape readable",
        keywords=["yad", "torah pointer", "silver pointer"],
    ),
    "aron_kodesh": Slot(
        filename="aron_kodesh.jpg",
        label="Aron kodesh (ark)",
        must_show="the ark in a synagogue wall, parochet curtain or carved doors",
        keywords=["aron kodesh", "holy ark", "the ark", "parochet"],
    ),
    "hakafot": Slot(
        filename="hakafot.jpg",
        label="Hakafot procession",
        must_show=(
            "people carrying dressed Torah scrolls in procession, scrolls "
            "upright against shoulders"
        ),
        keywords=[
            "hakafot",
            "hakafah",
            "hakafos",
            "seven circuits",
            "dancing with the torah",
            "simchat torah",
        ],
    ),
    "torah_held": Slot(
        filename="torah_held.png",
        label="Rav Eli — holding sefer Torah",
        must_show=(
            "dressed sefer Torah upright against his right shoulder, left "
            "arm supporting underneath, mid-speech"
        ),
        keywords=[
            "sefer torah",
            "torah scroll",
            "holding the torah",
            "carries the torah",
            "cradles the torah",
        ],
        in_house=True,
    ),
    "torah_dancing": Slot(
        filename="torah_dancing.png",
        label="Rav Eli — dancing with the Torah",
        must_show="the same hold mid-turn, scroll leaning back, weight on one foot",
        keywords=[],
        in_house=True,
    ),
}


# -------------------------------------------------------------- license

# Machine-readable codes from the Commons API's extmetadata.License.
# Anything not cleared here is refused rather than downloaded. The whole
# point of the gate is that "probably fine" never reaches a render.
_FREE_STANDALONE = {"pd", "cc0", "cc-zero", "attribution"}


def license_verdict(machine_code: str, short_name: str = "") -> tuple[bool, str]:
    """(free, reason) for a Commons license.

    Clears public domain, CC0, and any CC BY / CC BY-SA version. Refuses
    NonCommercial and NoDerivatives outright, and refuses anything it
    cannot positively identify — an unrecognised code is a reason to go
    read the file page, not a reason to proceed.
    """
    code = (machine_code or "").strip().lower()
    # Some files list several versions: "cc-by-sa-3.0,2.5,2.0,1.0".
    code = code.split(",")[0].strip()

    if not code:
        if short_name:
            return False, f"no machine-readable license code (page says {short_name!r})"
        return False, "no license information returned by the API"

    tokens = code.split("-")

    if {"nc", "nd"} & set(tokens):
        kind = "NonCommercial" if "nc" in tokens else "NoDerivatives"
        return False, f"{short_name or code} is {kind} — not usable here"

    if tokens[0] in _FREE_STANDALONE or code in _FREE_STANDALONE:
        return True, short_name or code

    if code.startswith("pd"):
        return True, short_name or code

    if tokens[0] == "cc" and "by" in tokens:
        return True, short_name or code

    if tokens[0] in {"gfdl", "fal"}:
        return True, short_name or code

    return False, f"unrecognised license {short_name or code!r} — check the file page"


# ---------------------------------------------------------------- api


def _strip_html(s: str) -> str:
    """Commons returns Artist and ImageDescription as HTML fragments."""
    if not s:
        return ""
    text = re.sub(r"<[^>]+>", " ", s)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=60.0,
        follow_redirects=True,
    )


@dataclass
class CommonsFile:
    title: str
    url: str
    width: int
    height: int
    license_code: str
    license_short: str
    artist: str
    description: str

    @property
    def page_url(self) -> str:
        return "https://commons.wikimedia.org/wiki/" + self.title.replace(" ", "_")

    @property
    def verdict(self) -> tuple[bool, str]:
        return license_verdict(self.license_code, self.license_short)


def _meta(ext: dict, key: str) -> str:
    """Pull one extmetadata value. Commons nests every field under 'value'."""
    return str((ext.get(key) or {}).get("value", "") or "")


def _parse_pages(payload: dict) -> list[CommonsFile]:
    out: list[CommonsFile] = []
    pages = (payload.get("query") or {}).get("pages") or {}
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        ext = info.get("extmetadata") or {}

        def meta(key: str, _ext: dict = ext) -> str:
            return _meta(_ext, key)

        out.append(
            CommonsFile(
                title=page.get("title", ""),
                url=info.get("url", ""),
                width=int(info.get("width") or 0),
                height=int(info.get("height") or 0),
                license_code=meta("License"),
                license_short=meta("LicenseShortName"),
                artist=_strip_html(meta("Artist")),
                description=_strip_html(meta("ImageDescription")),
            )
        )
    out.sort(key=lambda f: f.title)
    return out


_IIPROP = "url|size|extmetadata"
_IIFILTER = "License|LicenseShortName|Artist|ImageDescription"


def resolve(titles: list[str]) -> list[CommonsFile]:
    with _client() as c:
        r = c.get(
            API,
            params={
                "action": "query",
                "format": "json",
                "formatversion": "1",
                "titles": "|".join(titles),
                "prop": "imageinfo",
                "iiprop": _IIPROP,
                "iiextmetadatafilter": _IIFILTER,
            },
        )
        r.raise_for_status()
        return _parse_pages(r.json())


def browse(category: str, limit: int = 50) -> list[CommonsFile]:
    if not category.lower().startswith("category:"):
        category = "Category:" + category
    with _client() as c:
        r = c.get(
            API,
            params={
                "action": "query",
                "format": "json",
                "formatversion": "1",
                "generator": "categorymembers",
                "gcmtitle": category,
                "gcmtype": "file",
                "gcmlimit": str(limit),
                "prop": "imageinfo",
                "iiprop": _IIPROP,
                "iiextmetadatafilter": _IIFILTER,
            },
        )
        r.raise_for_status()
        return _parse_pages(r.json())


def download(f: CommonsFile, dest: Path) -> int:
    written = 0
    with _client() as c, c.stream("GET", f.url) as r:
        r.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as fh:
            for chunk in r.iter_bytes(65536):
                fh.write(chunk)
                written += len(chunk)
    return written


# ------------------------------------------------------------- output


def sources_entry(slot_id: str, slot: Slot, f: CommonsFile) -> str:
    """A SOURCES.md section in the same shape as the hand-written ones."""
    lines = [
        f"## {slot.filename}",
        f"Source: {f.page_url}",
        f"Direct URL: {f.url}",
        f"License: {f.license_short or f.license_code}",
    ]
    if f.artist:
        lines.append(f"Author: {f.artist}")
    lines.append(f"Resolution: {f.width}x{f.height}")
    lines.append(f"Slot: {slot_id} — {slot.must_show}")
    if f.description:
        lines.append(f"Notes: {f.description}")
    if not slot.keywords:
        lines.append(
            "Notes: picker-only — registered with an EMPTY keyword list so it "
            "never auto-injects; the operator pins it per clip via \"+ Refs\"."
        )
    lines.append(
        "Fetched by tools/fetch_jewish_refs.py (license verified against the "
        "Commons API at download time)."
    )
    return "\n".join(lines) + "\n"


def registry_snippets(slot_id: str, slot: Slot) -> str:
    """The exact lines to paste into the three registration sites."""
    kw = ", ".join(f'"{k}"' for k in slot.keywords)
    kw_line = f'    "{slot_id}": [{kw}],' if kw else f'    "{slot_id}": [],'
    return "\n".join(
        [
            "# 1/3 modal_app.py -> JEWISH_REF_FILENAMES",
            f'    "{slot_id}": "{slot.filename}",',
            "",
            "# 2/3 modal_app.py -> JEWISH_REF_KEYWORDS",
            "#     Position decides priority under the 3-per-clip cap:",
            "#     subject above setting, and never reorder existing pairs.",
            kw_line,
            "",
            "# 3/3 dashboard/src/lib/ref-image-library.ts -> RAW_REFS",
            (
                f"  {{ path: 'refs/jewish/{slot.filename}',"
                f" label: '{slot.label}', category: '{slot.category}' }},"
            ),
        ]
    )


def _fmt(f: CommonsFile) -> str:
    free, reason = f.verdict
    mark = "FREE  " if free else "REFUSE"
    head = f"  [{mark}] {f.title}  ({f.width}x{f.height})"
    body = [f"           license: {reason}"]
    if f.artist:
        body.append(f"           author:  {f.artist}")
    body.append(f"           url:     {f.url}")
    if f.description:
        body.append(f"           desc:    {f.description[:160]}")
    return "\n".join([head, *body])


# --------------------------------------------------------------- cmds


def cmd_list() -> int:
    print("Sukkot / Simchat Torah reference pack\n")
    have_all = True
    for slot_id, slot in SLOTS.items():
        on_disk = (JEWISH_DIR / slot.filename).is_file()
        if not on_disk:
            have_all = False
        status = "on disk" if on_disk else "MISSING"
        how = "in-house render" if slot.in_house else "commons"
        mode = "picker-only" if not slot.keywords else "auto-inject"
        print(f"  {slot_id:<18} {status:<8} {how:<16} {mode}")
        print(f"  {'':<18} {slot.filename}")
        print(f"  {'':<18} needs: {slot.must_show}")
        print()
    print(
        "in-house slots can't come from Commons — generate them from "
        "references/_canonical/rav_eli_canonical.png plus the object photo.\n"
        "See references/jewish/PACK-sukkot-simchat-torah.md."
    )
    return 0 if have_all else 1


def cmd_browse(category: str, limit: int) -> int:
    files = browse(category, limit)
    if not files:
        print(f"no files in {category}")
        return 1
    free = [f for f in files if f.verdict[0]]
    print(f"{category}: {len(files)} files, {len(free)} with a free license\n")
    for f in files:
        print(_fmt(f))
        print()
    print(
        "Pick a clean isolated object over a busy scene — that is why "
        "shofar.jpg beat the alternatives. Skip engravings and paintings."
    )
    return 0


def cmd_resolve(titles: list[str]) -> int:
    files = resolve(titles)
    if not files:
        print("nothing resolved — check the exact File: titles")
        return 1
    for f in files:
        print(_fmt(f))
        print()
    return 0


def cmd_fetch(pairs: list[str], force: bool) -> int:
    requests: list[tuple[str, str]] = []
    for pair in pairs:
        if "=" not in pair:
            print(f"error: --fetch wants slot=File:Title, got {pair!r}")
            return 2
        slot_id, title = pair.split("=", 1)
        slot_id, title = slot_id.strip(), title.strip()
        if slot_id not in SLOTS:
            print(f"error: unknown slot {slot_id!r}. Known: {', '.join(SLOTS)}")
            return 2
        if SLOTS[slot_id].in_house:
            print(
                f"error: {slot_id} is an in-house render, not a Commons file. "
                "Generate it from the canonical character ref instead."
            )
            return 2
        requests.append((slot_id, title))

    resolved = {f.title: f for f in resolve([t for _, t in requests])}
    failures = 0
    written: list[str] = []

    for slot_id, title in requests:
        slot = SLOTS[slot_id]
        f = resolved.get(title) or next(
            (v for k, v in resolved.items() if k.lower() == title.lower()), None
        )
        if f is None or not f.url:
            print(f"[{slot_id}] could not resolve {title!r} — skipped")
            failures += 1
            continue

        free, reason = f.verdict
        if not free:
            print(f"[{slot_id}] REFUSED {f.title}: {reason}")
            failures += 1
            continue

        dest = JEWISH_DIR / slot.filename
        if dest.exists() and not force:
            print(f"[{slot_id}] {dest.name} already exists — pass --force to replace")
            failures += 1
            continue

        size = download(f, dest)
        print(f"[{slot_id}] {f.title} -> {dest.relative_to(ROOT)} ({size:,} bytes, {reason})")

        entry = sources_entry(slot_id, slot, f)
        with SOURCES_MD.open("a", encoding="utf-8") as fh:
            fh.write("\n" + entry)
        written.append(slot_id)

    if written:
        print(f"\nappended {len(written)} entr{'y' if len(written) == 1 else 'ies'} "
              f"to {SOURCES_MD.relative_to(ROOT)}\n")
        for slot_id in written:
            print(f"--- register {slot_id} " + "-" * 40)
            print(registry_snippets(slot_id, SLOTS[slot_id]))
            print()
        print(
            "Then run: pytest tests/test_jewish_refs.py\n"
            "CI fails if a ref is registered without its file on disk, so "
            "land the bytes before the dicts."
        )

    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Source Sukkot / Simchat Torah reference photos from Wikimedia Commons.",
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--list", action="store_true", help="show the pack slots and what is on disk")
    g.add_argument("--browse", metavar="CATEGORY", help='e.g. "Category:Hakafot"')
    g.add_argument("--resolve", nargs="+", metavar="TITLE", help='e.g. "File:Sukkah.jpg"')
    g.add_argument("--fetch", nargs="+", metavar="SLOT=TITLE", help="download into a pack slot")
    p.add_argument("--limit", type=int, default=50, help="max files for --browse (default 50)")
    p.add_argument("--force", action="store_true", help="replace an existing file on --fetch")
    a = p.parse_args(argv)

    try:
        if a.list:
            return cmd_list()
        if a.browse:
            return cmd_browse(a.browse, a.limit)
        if a.resolve:
            return cmd_resolve(a.resolve)
        return cmd_fetch(a.fetch, a.force)
    except httpx.HTTPError as e:
        print(f"network error talking to Commons: {e}")
        print(
            "This needs plain access to commons.wikimedia.org. The Claude "
            "Code container's egress proxy blocks it — run this locally or "
            "via the fetch-refs workflow."
        )
        return 3


if __name__ == "__main__":
    sys.exit(main())
