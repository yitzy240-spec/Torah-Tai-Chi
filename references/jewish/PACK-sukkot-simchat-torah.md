# Reference pack: Sukkot + Simchat Torah

Status board and build spec for the Sukkot / Simchat Torah reference
images. Written 2026-09-21 when Yonah asked to start a Sukkot and
Simchat Torah project and the library turned out to hold two Sukkot
photos and nothing at all for Simchat Torah.

Fetch the Commons slots with:

    python tools/fetch_jewish_refs.py --browse "Category:Hakafot"
    python tools/fetch_jewish_refs.py --fetch hakafot="File:<chosen>.jpg"

The tool resolves the real direct URL, license and author from the
Commons API, refuses anything that isn't free, writes the SOURCES.md
entry, and prints the exact registry lines to paste. It needs network
access to commons.wikimedia.org — the Claude Code container's egress
proxy blocks it, so run it locally or anywhere with plain internet.

## Why a pack and not one photo at a time

Rosh Hashanah 2026 taught this the expensive way: Seedance improvised
unusable shofars for two straight attempts because the prompt said
"shofar" and nothing anchored what one looks like. The fix needed two
kinds of reference, not one:

- an **object** photo (`shofar.jpg`) — what the thing is
- a **grip** render (`shofar_held.png`) — how a person holds it, at
  what scale, relative to a body

Both are registered on the same keywords so they inject together. Every
ritual object below gets the same treatment, because the lulav and the
sefer Torah are harder to hold convincingly than a shofar, not easier.

## Slot table

`auto` = registered with keywords, injects whenever a clip's
visual_prompt matches. `picker` = registered with an EMPTY keyword list,
so it never auto-injects and the operator pins it per clip via "+ Refs".

### Sukkot

| slot | file | status | mode | must show |
|---|---|---|---|---|
| `sukkah_interior` | `sukkah_interior.jpg` | **have** | auto | inside a decorated sukkah, schach overhead, table |
| `lulav_etrog` | `lulav_etrog.jpg` | **have** | auto | four species laid out: lulav, hadass, aravah, etrog |
| `sukkah_exterior` | `sukkah_exterior.jpg` | **have** | auto | a freestanding sukkah seen from outside — walls, doorway, roof edge, and enough surroundings to read as temporary |
| `sukkah_schach` | `sukkah_schach.jpg` | **have** (see note) | auto | schach roofs — cut palm fronds, bamboo mats, plywood laid over sukkah frames — so the model learns what the covering is made of. The view from underneath is already in `sukkah_interior.jpg` |
| `etrog_closeup` | `etrog_closeup.jpg` | **have** | auto | one etrog filling the frame, bumpy rind and pitam visible |
| `lulav_held` | `lulav_held.png` | in-house | auto | Rav Eli holding the bundle: lulav upright in the right hand, spine toward him, etrog in the left, both at chest height |
| `lulav_shaking` | `lulav_shaking.png` | in-house | picker | the same grip mid-na'anuim, bundle extended and tilted away from the body |

### Simchat Torah

Before 2026-09-21 the library had no Torah scroll in any form. The five
Commons slots landed that day; the two character renders are still to do.

| slot | file | status | mode | must show |
|---|---|---|---|---|
| `torah_dressed` | `torah_dressed.jpg` | **have** | auto | a dressed sefer Torah — velvet mantle, breastplate and yad, close enough to read the embroidery. A detail shot; the full carried-scroll silhouette is in `hakafot.jpg` |
| `torah_open` | `torah_open.jpg` | **have** | auto | an open scroll, both rollers visible, columns of hand-written parchment legible as columns (not a flat scan) |
| `torah_yad` | `torah_yad.jpg` | **have** | auto | a silver yad by itself, close enough to read the hand shape |
| `aron_kodesh` | `aron_kodesh.jpg` | **have** | auto | the ark in a synagogue wall — red parochet with a Magen David, columns, luchot, ner tamid |
| `hakafot` | `hakafot.jpg` | **have** | auto | men dancing with dressed Torah scrolls held upright against their shoulders — also the best grip-and-scale input for the `torah_held` render |
| `torah_held` | `torah_held.png` | in-house | auto | Rav Eli cradling a dressed sefer Torah upright against his right shoulder, left arm supporting underneath, mid-speech |
| `torah_dancing` | `torah_dancing.png` | in-house | picker | the same hold mid-turn, scroll leaning back, weight on the ball of one foot |

## Keyword rules

Two hard rules, both learned from existing entries.

**1. Never register a bare word the scripts already use.** The existing
registry has a note about not registering bare `"horn"` because it
false-matches "hornbeam". `"torah"` is far worse: this show is *about*
Torah and a visual_prompt saying "he explains what the Torah asks of us"
is completely ordinary. Every Torah slot therefore keys on multi-word
phrases only — `"sefer torah"`, `"torah scroll"`, `"open torah"`,
`"torah reading"`, `"holding the torah"`. Never `"torah"`.

Worth knowing why this is safe at all: `_jewish_refs_for_clip` and
`_jewish_ref_ids_in_prompt` match against `clip.visual_prompt` by
itself, not the assembled render prompt. `DOJO_ANCHOR_TEXT` describes
the dojo's wall logo — including the word `TORAH` in the cedar letters —
and if that string were part of the matched text, any `"torah"` keyword
would inject on literally every dojo clip in the series. It isn't. Keep
it that way: if anything ever starts prepending anchor text to
`visual_prompt` before matching, these keywords need re-auditing.

**2. Same keywords on the object and the grip render, on purpose.**
`lulav_held` carries the same keywords as `lulav_etrog`, and
`torah_held` the same as `torah_dressed`, so object and grip inject
together. This is the challah and shofar precedent.

Proposed keyword lists:

```
"sukkah_exterior":  ["sukkah from outside", "outside the sukkah",
                     "approaches the sukkah", "courtyard sukkah",
                     "sukkah in the yard"]
"sukkah_schach":    ["schach", "s'chach", "bamboo roof", "branches overhead",
                     "roof of the sukkah", "stars through the roof"]
"etrog_closeup":    ["etrog", "citron"]
"lulav_held":       ["lulav", "etrog", "four species", "arba minim"]
"lulav_shaking":    []
"torah_dressed":    ["sefer torah", "torah scroll", "torah mantle",
                     "torah crown", "rimonim", "breastplate"]
"torah_open":       ["open torah", "unrolled torah", "unrolls the torah",
                     "torah reading", "columns of parchment", "laining"]
"torah_yad":        ["the yad", "a yad", "silver yad", "torah pointer",
                     "silver pointer"]
"aron_kodesh":      ["aron kodesh", "holy ark", "torah ark", "parochet",
                     "ark curtain"]
"hakafot":          ["hakafot", "hakafah", "hakafos", "seven circuits",
                     "dancing with the torah", "simchat torah"]
"torah_held":       ["sefer torah", "torah scroll", "holding the torah",
                     "carries the torah", "cradles the torah"]
"torah_dancing":    []
```

Note `sukkah_exterior` deliberately does **not** claim bare `"sukkah"` —
that already belongs to `sukkah_interior`, and letting both answer to it
would spend two of the three available slots on the venue. `"schach"`
currently sits on `sukkah_interior` and stays there; `sukkah_schach`
claims it too, so a roof line pulls the close-up and the room together.

## Insertion order matters — read before editing the registry

`_jewish_refs_for_clip` walks `JEWISH_REF_KEYWORDS` in **declaration
order** and `break`s the moment it has `MAX_JEWISH_REFS_PER_CLIP` (3)
matches. There is no relevance ranking. Dict position *is* the priority.

A Simchat Torah clip can easily match five slots at once — a prompt
mentioning an open scroll, the ark and the dancing hits `torah_dressed`,
`torah_open`, `torah_held`, `aron_kodesh` and `hakafot`. Three win, and
which three is decided purely by where they sit in the dict.

The rule that follows: **subject beats setting.** The object the clip is
about must appear above the room it happens in. So insert all `torah_*`
slots and `lulav_held` / `etrog_closeup` *above* `sukkah_interior`, and
put `sukkah_exterior`, `sukkah_schach`, `aron_kodesh` and `hakafot`
below the object slots.

Insert new entries at the right position — do **not** reorder any two
entries that are already there. Every existing pair keeps its current
relative order, so no Shabbat or Rosh Hashanah clip changes behavior.
Adding entries is additive; moving them is a regression waiting to
happen, and Yonah renders against this registry.

Leave `MAX_JEWISH_REFS_PER_CLIP` at 3. The cap exists because more ref
images dilute the character and dojo anchors, and the fix for crowding
is ordering, not a bigger budget.

## Registering: order of operations

CI enforces the sequence. `tests/test_jewish_refs.py` has
`test_every_registered_ref_image_exists_on_disk`, which fails the build
if a ref_id names a file that isn't in `references/jewish/`. At runtime
`_upload_jewish_refs` merely prints and skips a missing file, so a
premature registration is not a production hazard — but it is a red
build, so:

1. land the image bytes in `references/jewish/`
2. add the `JEWISH_REF_FILENAMES` + `JEWISH_REF_KEYWORDS` pair
   (both dicts, or `test_filenames_and_keywords_dicts_are_in_lockstep`
   fails)
3. add the `RAW_REFS` entry in
   `dashboard/src/lib/ref-image-library.ts` so it shows in "+ Refs"
4. add the SOURCES.md entry — `--fetch` does this for you
5. run `pytest tests/test_jewish_refs.py`

Modal picks the files up with no extra step: `modal_app.py` builds its
image with `.add_local_dir("references", remote_path="/root/references")`,
so anything committed here is on Modal the next deploy.

The dashboard picker thumbnails are a separate path — they read Supabase
Storage under `refs/jewish/<filename>` via `publicVideoUrl`, and Modal
uploads refs to Kie rather than to Storage. A newly added ref will
render as a text placeholder in the picker until its file is also in the
Storage `videos` bucket. Harmless, and it does not affect rendering.

## The in-house renders

`lulav_held`, `lulav_shaking`, `torah_held` and `torah_dancing` can't be
sourced from Commons — they need our character. Generate them the way
`shofar_held.png` was made (`tools/fix_char_crest_gptimage.py` is the
closest pattern): gpt-image-2 via Kie, with
`references/_canonical/rav_eli_canonical.png` plus the object photo as
image inputs, so the output is a derivative that inherits the object
photo's attribution.

The shofar pose took three iterations and only landed once Yitzy
supplied a real photograph of the correct grip to art-direct from. Both
of these are harder:

- **Lulav.** The bundle is held with the spine of the lulav facing the
  holder, the aravah and hadass bound on either side, and the etrog in
  the other hand — get the orientation wrong and it reads as someone
  holding a plant. Worth a real reference photo before generating.
- **Sefer Torah.** A scroll is heavy and is carried upright against the
  shoulder with one arm underneath. Models routinely render it as a
  rolled paper held out in two hands like a diploma. This one will
  likely need the most iterations, and a wrong-looking sefer Torah is
  more conspicuous to this audience than a wrong-looking candle.

Do these last, after the Commons object photos exist, so they can be
used as the object input.

## What landed (2026-09-21)

Sourced by `.github/workflows/fetch-refs.yml` from a browse of eight
Commons categories (417 free-licensed candidates), picked from captions,
then checked by eye after download. Sources, licences and authors are in
`SOURCES.md`. Every file was then normalised in place: EXIF orientation
baked into the pixels (the ark photo was stored sideways with a rotation
tag, which not every consumer honours), longest side capped at 3000 px,
JPEG quality 88 — so nothing here is over 1.5 MB, in line with the
existing refs.

| slot | Commons file | what it actually shows |
|---|---|---|
| `sukkah_exterior` | Canvas sukkah in the street | canvas-walled sukkah with printed Jerusalem-window panels, bamboo schach, in a parking area between apartment blocks. Exactly the slot. |
| `sukkah_schach` | Sukkah Roofs | several sukkah roofs from above — palm fronds, bamboo mat, plywood. **Not** the from-underneath view the slot first asked for; kept because it teaches what schach is made of, and `sukkah_interior.jpg` already shows the roof from inside. Only 1179×780. |
| `etrog_closeup` | Etrog5812 | one ripe yellow etrog on wood, pitam at the top, gartel ridge, bumpy rind. Exactly the slot. |
| `torah_dressed` | Ingwiller Synagoge 736 | tight detail of a dressed scroll: burgundy velvet mantle with gold embroidery (lion, flowers), silver breastplate, silver yad hanging on a chain. Handles and crown are out of frame — it is a detail shot. |
| `torah_open` | Open Torah scroll (Lawrie Cate) | open scroll on a reading table, both wooden rollers with silver finials, three columns of text, a yad lying on the parchment. Exactly the slot. |
| `torah_yad` | Jüdisches Museum München 3 | CC0 museum close-up of a yad on its own. Replaced the first pick, which was the `torah_open` scene again with the yad a few dozen pixels wide. |
| `aron_kodesh` | Hobart Synagogue Aron Kodesh | classical ark: red velvet parochet with an embroidered Magen David, turned wooden columns with gilt capitals, gilt cornice, luchot on either side, ner tamid chain. Exactly the slot. |
| `hakafot` | PikiWiki Israel 51038 simchat torah 2017 | hasidic men dancing in a beit midrash holding two dressed scrolls upright on the shoulder — one in a blue mantle with a crown motif, one in a cylindrical tik. Exactly the slot, and the best real-world reference for how a scroll is carried. |

Selection rule that held up: a clean isolated object on a plain
background beats a busy scene (the etrog and the yad), a single clear
subject in context is next (the ark, the open scroll), a crowd scene is
fine when the crowd *is* the subject (hakafot). Engravings and paintings
were skipped on sight — `File:Simchat torah Picart.png` is in the
category and would teach a drawing style, not an object.

Two of the eight were mis-picked from captions alone and caught only by
looking at the download (the yad, the schach). Captions are not enough;
budget a look at every file before wiring it.
