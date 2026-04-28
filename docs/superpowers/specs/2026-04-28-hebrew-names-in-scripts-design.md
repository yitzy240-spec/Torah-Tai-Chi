# Hebrew Names in Rav Eli's Scripts — Design

Date: 2026-04-28
Status: Approved

## Problem

The Torah Tai Chi videos speak to an Orthodox audience. Rav Eli currently
narrates lines like "In Genesis, chapter 2..." or "Moses wrote himself
small...". This sounds wrong for the audience — Orthodox listeners use the
Hebrew names (Bereishit, Moshe, Avraham) and hearing the secular English
names breaks credibility.

The English-name policy is hardcoded in two AI prompts:
- [src/script_generator.py:77-99](src/script_generator.py#L77-L99) — the live script generator
- [tools/rewrite_scripts.py:46-64](tools/rewrite_scripts.py#L46-L64) — the bulk rewrite tool

Both currently instruct the model: "Bereishit → Genesis, Moshe → Moses,
Avraham → Abraham...". This was originally added to dodge Seedance TTS
mispronunciation. That tradeoff is wrong: the TTS phonetic safe list
already handles Hebrew names correctly (Bereishit → "Beh-ray-SHEET",
Moshe → "MOH-sheh"), so we can keep Hebrew names AND get correct
pronunciation.

## The principle

Two distinct rules, applied separately:

1. **Hebrew NAMES — always use them.** Books, parshas, patriarchs,
   prophets, and biblical figures must be referred to by their Hebrew
   names. Never substitute "Genesis" for Bereishit, "Moses" for Moshe,
   etc. This is non-negotiable for the Orthodox audience.

2. **Hebrew-origin words that have natural English pronunciations** —
   Eden, Adam, Israel, Torah, Sabbath. Leave them in plain English
   spelling. Don't invent a Hebrew phonetic for these — the natural
   English pronunciation is recognizable, and forcing a thick Hebrew
   accent through TTS often mis-renders. (The current prompt already
   has this rule for Eden / Adam / Israel — keep it.)

## Changes

### 1. Replace the "avoid Hebrew" block in src/script_generator.py

Replace lines ~77-99 ("Hebrew vocabulary policy — avoid unless necessary"
through the patriarch English-name mapping) with the new "Always use
Hebrew names" policy + the Hebrew-origin English-words carve-out.

### 2. Expand the phonetic safe list in src/script_generator.py

Add the names that aren't yet in the safe list:

- Books: `Shemot → "Sheh-MOTE"`, `Bamidbar → "Bah-mid-BAR"`,
  `Devarim → "Deh-vah-REEM"`
- Patriarchs: `Avraham → "AHV-rah-hahm"`, `Yitzchak → "Yits-HAHK"`,
  `Yaakov → "Yah-ah-KOV"`, `Yosef → "Yo-SEF"`,
  `Aharon → "Ah-ha-RONE"`

(Bereishit, Vayikra, Moshe are already in the safe list.)

### 3. Mirror the policy edit in tools/rewrite_scripts.py

Replace lines ~46-64 with the same "always use Hebrew names" wording,
adapted for the rewriter's tighter prompt format. The rewriter doesn't
do TTS phonetics — that happens in the downstream script generator —
so the rewriter's note about Hebrew names just needs to instruct the
model to keep them in standard transliteration form (Bereishit, Moshe).

### 4. Re-run the rewriter to clean up existing DB scripts

After the prompt edits land, run:

```
python -m tools.rewrite_scripts --apply
```

This regenerates every existing draft so existing "Genesis" / "Moses"
references get replaced with Hebrew names. ~$1-2 in tokens, ~5 min.
Cosmetic-only — the next time those scripts are used downstream, the
script generator would have caught it anyway, but doing it now means
Yonah doesn't see the old English names when reviewing in the dashboard.

## Out of scope

- The `"book"` field in `parshiot.json` (e.g., `"Bereishit (Genesis)"`).
  This is metadata, not voiceover. Not user-facing in videos.
- `style_note` references like "Genesis 2:7" inside `parshiot.json`. This
  is AI direction metadata that the model interprets, not voiceover.
- The `dashboard/src/components/videos-filter.tsx` English→Hebrew alias
  map. That's a legacy-data normalizer for the filter UI; it must keep
  working for old DB rows that still have English book labels.

## Validation

After applying:

1. Spot-check 2-3 rewritten scripts in the DB — confirm "Genesis",
   "Moses", "Abraham" etc. are absent and replaced with Hebrew.
2. Generate one fresh video script via the dashboard and confirm the
   ClipPlan voiceover uses the phonetic Hebrew (e.g., "Beh-ray-SHEET")
   for book names.
3. Confirm Eden / Adam / Israel still appear as plain English in
   voiceover (not "Eh-den"), per the carve-out.
