# Handoff — Hebrew pronunciation (the "chet") vs lip-sync vs cinematic video

_Created 2026-06-17. Captures a long investigation so a fresh session can resume without re-deriving it._

## The goal
Yonah wants Rav Eli to **pronounce Hebrew correctly** — especially the guttural **chet/chaf (ח/כ, /χ/)** in names like Korach (קֹרַח), Pinchas (פִּינְחָס), Chanukah (חֲנֻכָּה), Pesach (פֶּסַח). Today Seedance's native voice softens the chet to an /h/. The catch is we must keep **both** of the things that make the videos good: **frame-accurate lip-sync** and the **dynamic cinematic video** (forest walks, tai chi motion, camera moves — not a static talking head).

## The core finding (definitive, multi-source)
**You cannot get correct-chet + frame-accurate-lip-sync + cinematic-video from any single tool.** They come bundled:

| Approach | Chet | Frame-accurate lip-sync | Cinematic video |
|---|---|---|---|
| **Seedance native (today)** | ✗ soft/wrong | ✓ | ✓ |
| **Seedance + our ElevenLabs audio** | ✓ | ✗ (see below) | ✓ |
| **Dedicated lip-sync/avatar model** | ✓ | ✓ | ✗ static talking head |

**Why Seedance + external audio fails on lip-sync:** Seedance's `reference_audio_urls` / `[Audio1]` is a **style/rhythm/timbre reference, NOT a lip-sync driver** — confirmed by (a) ByteDance/fal/Replicate/Kie schemas (no dedicated driving-audio input), (b) a community skill doc ("treat [Audio1] as a rhythm/pacing/tone reference"), and (c) **our own** `docs/direction/seedance_prompting_guide.md` §3.1 ("reference_audio_urls currently unused in production; Seedance generates audio natively"). Seedance's lip-sync is **video-leads-audio**: it generates the mouth, then times its *own* generated voice to the mouth. With `generate_audio=false` the output is **silent** and the mouth is NOT locked to our track, so muxing our audio drifts/offsets. The marketed "Seedance + ElevenLabs lip-sync" is Seedance video + a **separate** lip-sync step, not one model.

## What we PROVED works (the chet itself)
- **ElevenLabs v3 makes the chet correctly.** Model `elevenlabs/text-to-dialogue-v3` via Kie. Hebrew name in **Hebrew script** (with niqqud), `language_code="en"`, stability 0.5. `multilingual_v2` does NOT support Hebrew — must be v3.
- **Voice locked: "James"** (`EkK5I93UQWFDigLMpZcX`) — a Kie-allowlisted voice. Yonah approved the sound.
- Inline single-word code-switching is unreliable on v3; the **whole-sentence-with-Hebrew-script** form ("wholecall_en") is what Yonah approved.
- All of this runs on our **existing `KIE_AI_API_KEY`** — no new accounts.

## What we tried and ruled out
1. **Seedance `generate_audio=false` + `reference_audio_urls=[our mp3]` + `[Audio1]` in prompt** → silent video, mouth not synced (drift/offset). Tried duration-matching (pad audio to whole second), stripping prompt, the documented `[Audio1]` syntax, best-practice stable framing — none fixed it because it's not a lip-sync mechanism. (Stable framing "fixed" sync only by making it a static talking head, which Yonah rejected.)
2. **Dedicated avatar/lip-sync models on Kie** — `kling/ai-avatar-pro` (image+audio→talking video, real lip-sync; **already prototyped in `tools/test_decoupled_audio.py`**) and InfiniteTalk. Both are **image→talking-head**: good chet + good lip-sync but **lose the cinematography**. Yonah rejected static heads.
3. **Voice creation** — Kie has **no** voice-design/cloning (it restricts `voice` to a curated allowlist; e.g. "Adam" was rejected, "James" accepted). OpenRouter has `openai/gpt-audio` (TTS) but it needs `stream:true` and is OpenAI preset voices. A custom/designed/cloned Rav Eli voice would require a **direct ElevenLabs account** — vetoed (no new accounts for Yonah).

## The ONE unexplored lever (start here next session)
A **video-to-video lip-sync** model: takes the *finished dynamic Seedance clip* + our ElevenLabs audio and **re-syncs only the mouth, preserving all the motion/camera/scene**. That would give all three. Status:
- Examples in the wild: **sync.so (lipsync-2)**, **LatentSync**, lipsync.video.
- **Not found on Kie** under standard slugs (probed: sync/lipsync, latentsync, musetalk, wav2lip, kling/lip-sync — all "not supported"). Confirmed-present on Kie: `kling/ai-avatar-pro` (image-driven), `runway/act-one` (character perf), InfiniteTalk (image-driven).
- Open questions: Does Kie host a **video-input** lip-sync model under a non-obvious slug? (Pull Kie's FULL catalog — we never enumerated it definitively.) If not, would sync.so/LatentSync be acceptable despite (a) a new account/cost and (b) **uncertain quality on a Pixar-style 3D face + moving camera** (these models are trained on real faces)?

## Decision the next session must drive to
1. **Status quo** — keep Seedance native, accept the soft chet (Yonah's original fallback: "use the soft H, people understand"). Zero cost, keeps everything else. *Currently the honest recommendation.*
2. **Per-clip hybrid** — Kling Avatar (correct chet + lip-sync, static) only for pure talking-to-camera clips (e.g. the intro where names are said); Seedance native for motion/tai-chi clips. Accept visual inconsistency between clip types. (This is what `test_decoupled_audio.py` was probing.)
3. **Video-to-video lip-sync** — the only path to "all three," pending the catalog check + a quality test on our 3D style. Likely a new tool/account.

## Repo assets / key facts
- `tools/spike_hebrew_voice.py` — the full spike (TTS variants, Seedance audio-drive, mux). Throwaway.
- `tools/test_decoupled_audio.py` — ElevenLabs TTS → `kling/ai-avatar-pro` decoupled prototype (pre-existing).
- `work/spike/` — generated audio/video artifacts from the spike (gitignored scratch).
- `docs/direction/seedance_prompting_guide.md` §3.1 — confirms reference_audio is unused / native audio.
- API: Seedance = `bytedance/seedance-2` (`reference_audio_urls`=timbre, `generate_audio` bool, `[Audio1]`=rhythm ref, lip-sync to its OWN audio). ElevenLabs = `elevenlabs/text-to-dialogue-v3`. Kling avatar = `kling/ai-avatar-pro` (`image_url`+`audio_url`). Local ffmpeg installed via winget (Gyan.FFmpeg.Essentials); `imageio-ffmpeg`+`numpy` in the Python env for audio analysis.
- Constraints: all via existing `KIE_AI_API_KEY`; **no new accounts for Yonah**; ~$2 per Seedance render so test sparingly.

## Related work shipped during this investigation (not the chet)
Stitcher trailing-sound fix, plan-job dedup + spinner escape hatch, storage orphan sweep, Buffer rate-limit fix — all live. And a **separate** bug surfaced and is spec'd: chained clips ignore scene direction → `docs/superpowers/specs/2026-06-17-chaining-aware-plan-generation-design.md` (design approved, implementation pending).
