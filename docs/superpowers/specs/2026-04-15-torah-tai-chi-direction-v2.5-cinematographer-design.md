# Torah Tai Chi — Direction v2.5: Cinematographer Claude

> **Status:** Approved for planning. Supersedes the v2.4 direction (which ships
> but was judged incomprehensible due to over-constrained voiceover trimming).
> **Date:** 2026-04-15

## 1. Why This Spec Exists

v2.2 produced rushed speech (Claude paraphrased Yonah's draft to fit short clips, Seedance TTS delivered at ~230 wpm). We added a hard 2.0 wps density cap in v2.4. Bereishit v2.4 came back **worse** — Claude trimmed aggressively to comply, the language cut into short awkward phrases, and the result was incomprehensible. The density cap fixed the wrong problem.

The root cause, now recognized: we were treating Claude as a co-writer with too much rewriting authority AND too many rigid rules on how to rewrite. The constraints contradicted each other (preserve brand voice / fit short duration / sage pace / full content) and nothing could simultaneously satisfy all four.

**The fix is a philosophy reset.** Yonah's draft is the content. Claude is the cinematographer, not a co-writer. Video length emerges naturally from script length at natural speaking pace. Iteration happens on the *script* side (Yonah adjusts next week's draft to hit desired length), not on the *prompt-constraint* side (us tightening Claude).

## 2. Goals

- **Yonah's voiceover text is preserved verbatim** across all clips.
- Claude produces scene direction (setting, camera, action, mood, emotive cues) and decides clip boundaries based on natural delivery time.
- Video length is emergent — typically 30-90 seconds depending on draft size. No forced trimming.
- Per-platform **post captions** generated in the same pass (TikTok, Instagram Reels, YouTube Shorts, Facebook).
- Subtle **on-screen captions** burned into the final mp4, dynamically positioned per clip, synced to speech via forced alignment.
- Strip the overcomplicated SYSTEM prompt (~84KB → ~6KB). Fewer rules, better output.
- Dojo → outdoor block structure preserved; clip count per block flexes.

## 3. Non-Goals

- **Not** changing the video engine (Seedance 2.0 via Kie.ai stays).
- **Not** rewriting Yonah's draft at the model layer. If a draft is too long for a weekly format, Yonah shortens it; we don't paper over length with AI rewrites.
- **Not** adding voice cloning / `@Audio1` lock in this phase. Still deferred until we ship 3+ parshiot and observe week-to-week drift.
- **Not** building a caption style editor UI. One subtle default style for v2.5; customization comes in the dashboard (CMS Slice 3+).
- **Not** redesigning the CMS architecture. The dashboard plan stays. Just upgrading the pipeline that feeds it.

## 4. Content Philosophy — "Cinematographer Claude"

The mental model shifts. Claude's job description becomes:

> *"You are the cinematographer, editor, and caption writer for a short-form weekly video based on an already-written dvar torah script. You do not rewrite the script. You decide how to shoot each phrase, where the camera goes, what the character does, what setting each beat plays out in, how the video cuts together, and what captions sit on top."*

### What Claude decides
- How many clips (3-8)
- What portion of the script goes in each clip
- Each clip's duration, computed from its word count at ~2.3 wps natural sage pace (rounded to Seedance's 4-15s bounds)
- How to split script into clips at natural phrase boundaries, preserving speech flow
- Setting block assignments (which clips are dojo, which are outdoor) — always dojo first, then outdoor
- Which single outdoor archetype fits the parsha
- Each clip's visual_prompt (setting anchor, subject action, camera direction, lighting)
- Each clip's optional emotive note (directorial cue about tone — "speak this reverently", "this lands with a pause")
- Each clip's caption position (`"bottom"`, `"top"`, `"middle"`) based on where the subject sits in frame
- Four per-platform post captions

### What Claude does NOT decide
- **The voiceover text itself.** Yonah's draft is split across clips but never paraphrased, never shortened, never reordered. Hebrew terms written phonetically in the voiceover field (existing rule kept).
- Duration cap (none imposed by the SYSTEM prompt — only Seedance's per-clip 4-15s hard limit).
- Word density (no cap — natural speech varies).

### What this eliminates
- The v2.4 density trap. No `MAX_WORDS_PER_SECOND` validator.
- The "rewrite for video pacing" permission that led Claude to trim substance.
- The tension between "preserve Yonah's words" and "fit 45s" that made every ClipPlan a compromise.

## 5. Structural Changes

### ClipPlan — flex the rigid counts

```python
class ClipPlan(BaseModel):
    parsha: str
    hook: str
    full_script: str
    outdoor_archetype_id: str
    clips: list[Clip] = Field(min_length=3, max_length=8)  # was min=max=4
    captions: PlatformCaptions  # NEW
    
    @property
    def total_duration_s(self) -> int: ...
    
    @model_validator(mode="after")
    def _check_structure(self):
        # outdoor_archetype_id must be in OUTDOOR_ARCHETYPES
        # FIRST N clips must be setting_id == "DOJO" (at least 1, at most len-1)
        # LAST M clips must be setting_id == outdoor_archetype_id (at least 1)
        # Dojo block comes first; outdoor block comes second; no interleaving
        # Total duration 28-90 seconds (was 28-50)
```

### Clip — new fields

```python
class Clip(BaseModel):
    index: int
    voiceover: str  # VERBATIM from Yonah's draft — only split, never modified
    visual_prompt: str
    duration_s: int = Field(ge=4, le=15)  # Seedance bounds unchanged
    setting_id: str
    caption_position: Literal["bottom", "top", "middle"] = "bottom"  # NEW
    emotive_note: str | None = None  # NEW — directorial cue for tone/pacing
    motion_ref_url: str | None = None
    
    # DROP the density validator — no MAX_WORDS_PER_SECOND check
```

### PlatformCaptions — new type

```python
class PlatformCaptions(BaseModel):
    tiktok: str           # punchy, hashtag-heavy, <=150 chars
    instagram: str        # story-driven, hashtags at end, <=2200 chars practical ~300
    youtube_title: str    # click-through optimized, <=100 chars
    youtube_description: str  # 1-3 sentence context, <=5000 chars practical ~400
    facebook: str         # conversational, 1-3 sentences
```

### SYSTEM prompt — strip to essentials

Current: 84KB (67KB research guide + 17KB core rules).
Target: **~6KB**.

**Keep in SYSTEM:**
- Character identity anchor (one short paragraph)
- DOJO_ANCHOR_TEXT (unchanged; still tight geometry)
- OUTDOOR_ARCHETYPES menu
- Block structure rule (dojo first, outdoor second, 3-8 clips total)
- Phonetic Hebrew rules (this works)
- No-in-frame-text guardrail
- No-prescriptive-tai-chi guardrail
- Permitted camera verbs list
- Output schema
- **Two worked examples** (down from five in the guide)

**Remove from SYSTEM:**
- The 67KB `docs/direction/seedance_prompting_guide.md` preamble
- Word density math / "target 1.8 wps" / "cap at 2.0 wps" rules
- Rewriting permission ("trim secondary lines", "rewrite for video rhythm")
- The three-beat temporal structure requirement (keep optional for instructional clips)
- Most of the positive-constraint-closer / compound-camera-ban / slow-orbit caution detail (these stay in settings.py GUARDRAILS_TEXT but are trimmed to terse bullet points)

The research guide isn't deleted — it moves to `docs/direction/seedance_prompting_guide.md` as a reference document humans can consult, but is NOT loaded into the runtime prompt. Claude gets the essentials, not the encyclopedia.

## 6. On-Screen Caption System (new)

New pipeline step after `concat_clips`:

```
work/<run>/clip_*.mp4  →  stitcher (xfade)  →  work/<run>/stitched.mp4
                                                      ↓
                                              caption_burner.burn(...)
                                                      ↓
                                          output/<parsha>-<option>-v2.mp4
```

### New module: `src/caption_burner.py`

```python
def burn_captions(
    stitched_mp4: Path,
    plan: ClipPlan,
    dest: Path,
) -> Path:
    """Burn word-timed subtitles onto the stitched video.
    
    Uses Whisper forced alignment on the known voiceover text for precise
    word-level timing (more accurate than blind transcription because we
    already know what was said).
    
    Phrase grouping: 3-6 words per cue, breaking at natural pause markers
    (commas, ellipses, em-dashes, periods) from the voiceover text.
    
    Position per clip: from plan.clips[i].caption_position field.
    
    Silent embodiment beats (detected from visual_prompt containing 'silent',
    'no speech', or 'breath' in the final N seconds of a clip): no caption
    rendered for that segment.
    """
    ...
```

### Dependencies
- `whisperx` or `openai-whisper` (forced alignment)
- ffmpeg subtitle burn (`-vf subtitles=caps.ass` with ASS format for styling)

### Caption style (ASS defaults)
- Font: Inter Medium (system fallback: Helvetica, Arial)
- Size: ~5% of video height (36pt at 720p 9:16)
- Color: white with 2px black stroke + subtle drop shadow
- Background: none (clean, not a pill or box)
- Animation: simple fade in/out (100ms) per cue — no bouncy/pop

### Position logic
- Claude sets `caption_position` per clip in the ClipPlan
- `"bottom"` = ~85% from top (5% above screen edge) — default for close/medium shots of Rav Eli
- `"top"` = ~15% from top — for wide shots where Rav Eli is in lower frame
- `"middle"` = ~50% — for beats with minimal on-screen action (rare)

### Silent-beat handling
- If a clip's visual_prompt contains keywords "silent", "no speech", "breathes silently", or similar, AND that silent moment falls in the final portion of the clip per temporal markers, caption fades out before the silent beat begins
- Viewer gets the words they need, then is left with breath

## 7. Architecture Changes Summary

| File | Change |
|---|---|
| `src/models.py` | Flex clip count (3-8), bump total duration (28-90s), add `captions` field, add `caption_position` + `emotive_note` per Clip, **remove** `MAX_WORDS_PER_SECOND` validator |
| `src/settings.py` | Trim `GUARDRAILS_TEXT` to terse bullets (still cover: no in-frame text, no prescriptive tai chi, permitted camera verbs, Hebrew phonetics). Keep `DOJO_ANCHOR_TEXT`, `OUTDOOR_ARCHETYPES`, `STYLE_LOCK` unchanged. |
| `src/script_generator.py` | **Stop loading** `docs/direction/seedance_prompting_guide.md`. Replace SYSTEM_TEMPLATE with a tight ~6KB version emphasizing cinematographer-not-rewriter philosophy. Add captions schema to output. |
| `src/caption_burner.py` | **NEW.** Whisper forced alignment + ASS generation + ffmpeg burn. |
| `src/video_generator.py` | No change (no new fields affect Seedance payload). |
| `src/stitcher.py` | No change. |
| `src/frame_extract.py` | No change (still unused in hot path, kept for future). |
| `tools/generate.py` | Insert `caption_burner.burn(...)` step between stitcher and final output path. |
| `docs/direction/seedance_prompting_guide.md` | Keep as reference material (not deleted). Add header note: "Not loaded at runtime. Human-consult only." |

### Dependencies added

```
openai-whisper  # OR faster-whisper (CPU-only)
# plus system ffmpeg (already have it)
```

## 8. Output Characteristics (Expected)

For a typical Yonah draft of ~130 words at ~2.3 wps:
- Total duration: ~57 seconds
- Likely clip distribution: 2 dojo clips (~22s combined) + 3 outdoor clips (~35s combined) = 5 clips
- Each clip 8-13 seconds
- Natural speech variance (some clips at 1.8 wps, some at 2.6 wps, reflecting emotional function)
- On-screen captions: bottom-positioned for most clips, top for any wide establishing shot Claude writes
- Post captions: 4 per-platform versions auto-generated from script + parsha context

For a shorter ~80-word draft:
- Total duration: ~35s
- Clip distribution: likely 1 dojo + 2 outdoor = 3 clips
- Still branded (dojo first) but tighter

If a draft is too long (>200 words producing >90s), validation fails — Yonah sees a clear error asking for a shorter draft. **Feedback loop at the content side, not the prompt side.**

## 9. Testing Strategy

Unit level:
- `test_models.py`: extended for new fields (`caption_position`, `emotive_note`, `captions`), new count bounds (3-8 clips, 28-90s), DROP the density test (that validator is gone)
- `test_script_generator.py`: mock Claude response with new schema, verify parsing; verify captions field populated
- `test_caption_burner.py` (NEW): test phrase splitting logic, position mapping, `@pytest.mark.slow` tests run the actual Whisper+ffmpeg chain on a tiny fixture

Integration:
- First Bereishit v2.5 run end-to-end (paid) — compare subjective feel to v2.4
- Second parsha (Noach likely — riverside fits) for drift check

## 10. Success Criteria

A v2.5 video is successful if:
1. Yonah's draft words are spoken verbatim in order, correctly pronounced (Hebrew phonetics work)
2. Speech cadence feels natural (varies; not rushed, not choppy)
3. Content is fully comprehensible on first watch
4. On-screen captions are readable without being distracting
5. Dojo looks consistent across clips within one video
6. Character (Rav Eli) stays consistent within and across videos
7. Video length emerges naturally from script length and lands in 30-90s range

Specifically fixing from prior versions:
- v2.2 rushed speech → gone (no more forced trim-to-fit)
- v2.4 choppy/incomprehensible → gone (no density cap forcing trim)

## 11. Migration / Rollout

### Code-level
- Strip `MAX_WORDS_PER_SECOND`, trim SYSTEM prompt, relax clip-count validators, add caption fields, add caption_burner. One bundled commit.

### Content-level
- First v2.5 run will be Noach (or Bereishit v2.5 for A/B against v2.4). No change to parshiot.json.
- If output length feels too long/short, Yonah iterates on the draft for that parsha — not on the prompt.

### Versioning
- Output filename: `output/<parsha>-<option>-v2.mp4` stays — v2.5 is a direction-philosophy change within the v2 pipeline, not a breaking architecture change.
- Work dir: `work/<date>-<parsha>-<option>-v2/` unchanged.

## 12. Open Questions (flag for implementation)

1. **Whisper model size:** `small` (~500MB, ~30s on CPU for a 45s clip) is probably right; `medium` (~1.4GB, slower, more accurate) might be worth it for Hebrew phonetic words. Decide during implementation.
2. **Forced alignment library:** `whisperx` is Python-native and handles alignment well, but depends on pyannote. `openai-whisper` with a manual alignment pass is simpler but less accurate. Pick during Task 1.
3. **Caption font:** Inter Medium is the pick but we need to verify it's available via the ffmpeg subtitle renderer or bundle a `.ttf`. If bundling is painful, fall back to Helvetica/Arial.
4. **Silent-beat detection:** keyword-based on visual_prompt is fragile. If it proves unreliable, switch to explicit `silent_tail_s: float = 0` field on Clip that Claude sets when appropriate.
5. **Does Seedance TTS ignore or respect some of our pause markers** (ellipses vs em-dashes)? Pose-compose for first v2.5 run, then tune.
