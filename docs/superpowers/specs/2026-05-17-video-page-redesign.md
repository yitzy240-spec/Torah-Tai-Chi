# Video page redesign — spec

> **Status:** Draft pending two things:
> 1. Yonah / Yitzy review (this doc).
> 2. Buffer `editPost` verification (see §13). Spec is conditional on the outcome; both branches are drawn out.
>
> **Brainstormed:** 2026-05-17 (with Yitzy on behalf of Yonah).
> **Kickoff plan:** `docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md`.
> **Memories drawn on:** `project_yonah_operator_patterns.md`, `project_dashboard_mobile_first.md`, `project_live_state_hides_edit_controls.md`, `feedback_no_estimates_in_action_labels.md`.
> **Mockups:** `.superpowers/brainstorm/1990-1779008428/content/` (referenced inline).
> **UX review pass:** applied 2026-05-17 — see review findings folded into §3, §5, §11.

## 1. Why this exists

The `/videos/[slug]` page has accreted ~12 features since editing-v2. On 2026-05-15 Yonah spent ~3 hours confused about which Bamidbar version was live (published the wrong one twice), and separately tried to *post* a video by clicking *Generate*, accidentally creating a new $1.20 / 30-min version. The redesign exists to eliminate both failure modes structurally, not just visually — and to do it on the iPhone, where he actually works.

## 2. North-star principles

These override every individual screen decision. If a future addition violates one, it doesn't ship.

1. **Live = read-only.** System-wide invariant. When a version is live (on the website OR on a social platform OR both), the page surface that represents it does NOT show edit / generate / regenerate controls. Editing requires explicit opt-in via "Replace with a new version" or "Edit on [platform]" — which then confirms that the live version stays live until the new one is published.
2. **Mobile-first.** iPhone is the canonical viewport. Desktop is the wider responsive case. Every decision (typography, spacing, hit targets, gesture, sticky elements) starts from a 390pt iPhone screen.
3. **Freshness > refresh.** "Wait + refresh" patterns are extinct. The screen always reflects current state via optimistic local updates + Supabase Realtime subscriptions + a fast initial server load.
4. **Honest labels.** Button labels are the action only. Costs and times are estimates — they live in soft secondary copy with an explicit "estimate" framing, never inside a CTA.
5. **Hide what's not relevant to the current state.** Progressive disclosure by page state, not by inline collapse. The page reshapes; it doesn't bury.

## 3. Top-level page architecture — 4 states

The page picks ONE of these states per parsha and renders the appropriate shell:

| State | Trigger | Shell | Edit UI? |
|---|---|---|---|
| **Empty** | No scripts, no video, no live | Single CTA: "Start your video" | n/a |
| **Draft in progress** | Has draft, nothing live | 5-phase guided workflow (§4) | Yes — inside the draft |
| **Live, at rest** | Has live version, no draft | Calm status display (§5) | **No** |
| **Live + draft in progress** | Both | Live status display + draft callout strip (§5) | Yes inside the draft, no outside |

State selection is deterministic from the data: `parshiot` → `jobs` → `videos.published_to_website` + `posts.status` for the parsha's latest published version, plus the existence (or not) of an in-progress draft (any job in `queued|generating_plan|verifying|stitching` OR a `clip_plans` row without an attached video).

### 3.1 Live status pinning (UX review fix — applied system-wide)

When a live version exists AND the user is inside a draft (i.e., the page is showing any of Phase 1-5 for an in-progress draft), a small persistent status strip is pinned to the top of every phase:

> 🟢 v2 still live on torahtaichi.com · TikTok · Instagram · YouTube  ·  [View →]

The strip is NOT shown on the live-at-rest state itself, because that whole state IS the live status display (§5.1). It only applies when the user is inside a draft AND a live version exists in parallel — i.e., the "Live + draft in progress" state from §3, across every phase view. Kills the Bamidbar 2026-05-15 confusion permanently: no matter where Yonah is in the draft flow, he sees what's live.

### 3.2 Draft callout default destination (UX review fix)

When the user taps the "Continue draft v3" callout from the live + draft state, the page lands them on:

- The **most recent completed phase** of the draft, OR
- Phase 1 if no phase is yet complete.

"Most recent completed" is defined by the data: Phase 4 if a stitched video exists for the draft; else Phase 3 if any clip is rendered; else Phase 2 if a clip_plan exists; else Phase 1.

He has to tap forward to reach Generate / Re-render UI. This adds one tap of friction before destructive controls become reachable — by design.

## 4. The 5-phase draft workflow

The draft state shows a compressed mobile stepper at the top:

```
Phase X of 5: <name>
█ █ █ █ █   (5 segments; completed = green, current = navy, pending = grey)
```

Tap "▾ steps" to expand the full step list with names. The persistent live-status strip (§3.1) sits ABOVE the stepper when a live version exists.

Forward navigation is guided. Backward navigation is always available via "← back to <previous phase>".

### Phase 1 — Script

**Body:** A-tight script loads directly into a full-width edit textarea (16pt min). Live word-count + estimated duration + words-per-second + "fits 60s ✓" feedback below the textarea. A small "try another script" link in the header reveals the carousel; default behavior never shows it.

**Primary action:** "Next: review clip plan →" (sticky bottom).
**Secondary action:** "Try another script" (small text link).
**Mockup:** `11-phase1-scripts.html` option B.

### Phase 2 — Plan review (NEW CHECKPOINT)

This is the new step that the current pipeline does not expose. Modal generates the clip plan only (no clip rendering), the page renders it, Yonah reviews/edits, then either generates per-clip or all-clips.

**Body:** Per-clip cards stacked vertically. Each card has:
- Clip number + duration
- Voiceover field (16pt textarea)
- Word count + wps indicator ("28 words · 2.8 wps ⚠ tight")
- Scene direction field (16pt textarea)
- **Tai Chi move picker** (defaults to "No move assigned"; tap opens a bottom-sheet move library — see §6.5)
- Per-card "Generate this clip" button (outlined / secondary — see CTA hierarchy below)

**Primary action (sticky bottom):** "Generate all 4 clips →" (filled / primary).
**Secondary action:** "← Back to script".
**CTA hierarchy fix (UX review):** per-card "Generate this clip" must be visually demoted relative to "Generate all" — outlined vs filled, never two competing primary navys.
**Mockup:** `03-five-phase-flow-v2.html`, `10-mobile-first.html` (mobile).

**Backend dependency:** Modal pipeline must support `plan-only` mode. See §11.1.

### Phase 3 — Clips

Same card layout as Phase 2, but each card has rendered media inline.

**Per-card structure when clip exists:**
- Mini-player (9:16 thumbnail with tap-to-play) — full-width on mobile
- Version picker (v1 / v2 / v3 dropdown) — the version picker IS the undo mechanism
- Outlined "Re-render" button
- Voiceover + scene direction (collapsed by default; tap to expand for editing)
- **Tai Chi move picker** (same component as Phase 2 — see §6.5). Changing the move marks the clip "stale" and the per-card button changes to "Re-render with new move" (still outlined / secondary). The change only takes effect on regeneration.

**Post-rerender behavior:** the card's mini-player updates in place (no navigation, no compare view, no full-video scroll). The mockup `12-post-regen-view.html` option A is canonical.

**Primary action (sticky bottom):** "Preview stitched video →".
**Mockup:** `12-post-regen-view.html` option A.

### Phase 4 — Stitched video

**Body:** Full-bleed 9:16 video player with custom captions track (preserves the VTT-from-clip-plan behavior at lines 62-111 of the current `page.tsx`). Scrub bar with clip-boundary markers — tap a marker to jump.

**Primary action (sticky bottom):** "Continue to posting →".
**Secondary action:** "← Back to clips" (tap a clip marker, or use back link).

### Phase 5 — Post

**Body:** Stack of per-platform cards. Top of section shows progress strip: "Posted: 1 of 5 · Site ✓ · TikTok ✓ · IG, YT, X remaining".

Each card is independent — owns its own caption / hashtags / title, has its own post button, and its own schedule-for-later option. No combined "post everywhere" CTA. The cards are listed in a stable order: Site, TikTok, Instagram, YouTube Short, Facebook, X.

Per-platform field schemas in §6. Live-as-read-only rules per card in §5.

**Mockup:** `09-phase5-fully-editable.html`, `10-mobile-first.html` (mobile).

## 5. Live-as-read-only — applied to every surface

This is where the UX review's central critique gets resolved. The invariant applies system-wide:

### 5.1 The page itself

If a live version exists and no draft is in progress → status display with no edit UI (mockup `06-live-state-views.html` top). Only actions: "View on torahtaichi.com" (safe), "Download mp4" (≥44pt button), "Replace with a new version" (outlined secondary, opens bottom sheet confirm — "v2 stays live on the website and all platforms until you publish v3").

### 5.2 The Site card in Phase 5 (UX review fix)

When the website is **already live**, the Site card mirrors the page-level rule:
- Read-only display of current title / sub-title / description.
- Primary action: "View page →".
- Secondary action: "Replace site version" (outlined, opens confirm).

When the website is **not yet live** (or Yonah opted in to replacing), the Site card shows the editable fields with "Publish to torahtaichi.com" as the primary CTA.

Same data, two card variants based on live state. Solves: Yonah accidentally republishing while editing what he thought was a draft caption.

### 5.3 Already-posted social cards (UX review fix)

When a card is **already posted** to its platform:
- Card collapses to a summary row: "● Posted Wed · 2.4k views · View on TikTok →".
- Tap to expand → read-only view of the posted caption + an outlined "Edit on TikTok" action.
- Tapping "Edit on TikTok" opens an explicit edit flow (bottom sheet) that warns about the editPost behavior on that platform (see §13).

When a card is **not yet posted**, it's open by default with all fields editable + "Post to [platform]" as the primary CTA (matching `09-phase5-fully-editable.html`).

### 5.4 The "Replace with a new version" flow

Opens a bottom sheet (mobile pattern, not a dialog). Copy:

> Start a new draft of Bamidbar?
>
> v2 stays live on torahtaichi.com + TikTok, Instagram, YouTube until you publish the new one.
>
> The new draft starts from the same script as v2. You can change it.
>
> [Start a new draft]    Cancel

On confirm → creates a new draft (no Modal job yet — Phase 1 with the prior script pre-loaded), advances to Phase 1.

## 6. Per-platform field schemas (Phase 5)

Confirmed against Buffer's GraphQL schema and the existing `lib/buffer.ts` / `lib/youtube.ts` clients. Subject to §13 verification.

| Card | Editable fields | Backend |
|---|---|---|
| 🌐 Site | Title · Sub-title · Description | `videos.title` / `videos.subtitle` / `videos.description` (new columns — see §11.6) |
| 📱 TikTok | Caption body · Hashtags (split as UI convenience; concat on save into Buffer `text`) | Buffer `createPost` / `editPost` |
| 📷 Instagram | Caption body · Hashtags · First comment (flagged "may not appear on IG" per Buffer report) · Reel/Post toggle (`metadata.instagram.type`) | Buffer with `metadata.instagram.{type, shouldShareToFeed, firstComment}` |
| ▶️ YouTube Short | Title · Description · Tags · Cover thumbnail (frame-picker from video) | Direct YouTube Data API v3 (`lib/youtube.ts`); tags currently hardcoded — exposed as editable; thumbnail uses a new frame-picker UI feeding `thumbnailUrl` |
| 📘 Facebook | Caption body · Hashtags · First comment · Reel/Post toggle | Buffer with `metadata.facebook.{type, firstComment}` |
| 𝕏 X | Tweet text only | Buffer (`text`); thread continuation deferred per kickoff out-of-scope |

**Common card behavior:**
- All text inputs ≥16pt to prevent iOS auto-zoom.
- localStorage drafts on every field (preserves current `d16a44e` behavior, expanded to all fields).
- Optimistic UI on edits — local update instant, save in background, revert with visible toast on error.
- Sticky bottom action bar on mobile when card is in primary-CTA state.

**Card states:**
- **Open + editable** (not yet posted): fields shown, primary CTA "Post to [platform]".
- **In flight** (post submitted, awaiting Buffer / platform confirmation): card shows spinner + "Posting to TikTok…" without time estimate.
- **Posted + collapsed**: summary row.
- **Posted + expanded** (tapped to view/edit): read-only fields + "Edit on [platform]" outlined CTA.
- **Edit flow open** (tapped Edit on a posted card): fields editable + "Update on [platform]" CTA, with §13-conditional warning copy.

## 6.5 Tai Chi move picker (Phase 2 + Phase 3)

Each clip card in Phase 2 and Phase 3 carries a motion-ref picker that maps to `clips.motion_ref_slug` (new column — see §11.7). Default is "No move assigned" — the AI does NOT suggest a move during plan generation; Yonah picks per clip explicitly.

**Picker UI:**
- Inline on the card: `🥋 White Crane Spreads Wings ▾` (or `No move assigned ▾`).
- Tap opens a bottom sheet listing all rows from `tai_chi_moves`:
  - "No move on this clip" option pinned at the top.
  - One row per move: small video thumbnail (autoplay muted when visible), English name, pinyin.
  - Simple in-memory text filter input if the library exceeds 15 entries (deferred until needed).
- Tap a move → selects, sheet closes, card updates optimistically.
- Saving writes `clips.motion_ref_slug` via the `save-plan-clip-motion` server action.

**Phase 3 staleness behavior:** if Yonah changes a move on a clip that's already rendered, the card surfaces an inline "Move changed — re-render to apply" hint, and the per-card button label becomes "Re-render with new move." Until he re-renders, the played mp4 reflects the OLD move (the change is metadata-only).

**Pipeline behavior:** `clips-only` reads `clips.motion_ref_slug` first; if null, falls back to `scripts.motion_ref_slug` (preserves legacy behavior for in-flight plans created before this redesign). When both are null, no motion reference is passed to Seedance.

## 7. Cross-cutting pillar — mobile-first

Per `project_dashboard_mobile_first.md`:

- **Single column** at every viewport <768pt. Side-by-side patterns (voiceover | scene direction) stack vertically below 768pt.
- **16pt minimum** on all text inputs.
- **44pt minimum** on all interactive controls, including secondary "Schedule for later," "Download mp4," "Unpublish" actions. No 12pt text-link CTAs. Secondary actions become outlined buttons, not inline links, at mobile width.
- **Sticky bottom action bar** for the primary CTA of each phase, with safe-area-inset padding for the iPhone home indicator.
- **Bottom sheets** for destructive confirms (not modal dialogs). Drag-down to dismiss; primary action at the bottom for thumb reach.
- **Compressed stepper** ("Phase X of 5: <name>" + 5-segment progress) with tap-to-expand for the full list.
- **No hover-only affordances.** Every action is visible by default or behind a clear tap.

Desktop (≥768pt) is the wider responsive case. Where there's screen room, Phase 2 / 3 can show voiceover and scene direction side-by-side, and Phase 5 can show 2-3 cards per row. Mobile remains canonical.

## 8. Cross-cutting pillar — freshness

Three sub-pillars, all required.

### 8.1 Optimistic UI for own edits

Every user-initiated edit updates local state immediately. The save call fires in the background. On error, the field reverts with a visible inline toast ("Couldn't save — please retry") so the user is never surprised.

Applies to: voiceover, scene direction, script, every Phase 5 caption / hashtag / title / description field, Reel/Post toggles, tag editor.

### 8.2 Supabase Realtime subscriptions

The page subscribes to row changes on `jobs`, `clips`, `videos`, `posts` filtered by the parsha's id. When Modal completes a clip, when Buffer publishes a post, when the website-published flag flips — the page updates within ~1 second with no refresh.

Auth: run as authed user (the dashboard requires login; RLS policies are per-user). No service-role Realtime on the client. The existing `jobs` realtime subscription (per kickoff) is the pattern; extend to the other three tables.

### 8.3 Server-side perf

Today the page does ~12 sequential Supabase queries (parsha → defaultTier → doneJobs → per-version: clip_plans + clips + feedback → displayedClipId resolution → recentPosts). Plan:

1. **Parallelize** independent queries with `Promise.all`. Estimate: cuts ~600ms.
2. **Consolidate** per-version queries — fetch clip_plans + clips + feedback in one batched call indexed by job_id.
3. **Stream the shell** via Next.js `Suspense` boundaries. First paint shows the header + stepper + live-status strip immediately; per-phase body streams in.
4. **Target:** first paint <500ms on a 4G iPhone, full data <1.5s.

## 9. Cross-cutting pillar — honest labels

Per `feedback_no_estimates_in_action_labels.md`:

- Button labels = action only. "Generate this clip" — NOT "Generate this clip ($1.20)".
- Cost shown softly elsewhere with explicit estimate framing: "Estimated cost: ~$4.80 at 720p Fast" in the Phase 2 header strip.
- Time estimates are not shown for Kie-backed actions because queue time is unknowable.
- Realized cost (after a job completes) IS exact — shown as "This video cost $4.62 to produce" (preserves the existing cost whisper at `page.tsx` line 1205).

**Mockup fix:** existing mockups that still carry `($1.20)` etc. in button labels are pre-review. The spec's button labels are the source of truth.

## 10. Error / loading / empty states (UX review missing-decisions)

### 10.1 Error state — clip generation fails

The clip card shows:
- Red left border + warning icon (color + icon — never color-only per UX review).
- Error message in plain language ("Generation failed — Kie returned 'queue full' after 9 minutes").
- Two actions: outlined "Retry" + text "View logs →" (links to `/jobs/[id]` for the technical detail).

If the failure is downstream of our retry policy, an "Auto-retry in 30s…" countdown appears, with a cancel option.

### 10.2 In-flight clip card

Card shows:
- Spinner + "Generating…" status.
- Sub-line: "queued at Kie · waiting" (honest about what's blocking).
- After 5 minutes without progress: "This is taking longer than usual — Kie's queue is busy."
- After 12 minutes: "Still queued — you can leave this page and come back, or [cancel and retry]."

No time estimates. Status changes are driven by Realtime subscriptions (§8.2), not polling.

### 10.3 Empty state — "Start your video"

Single full-width CTA on a calm card:
- Parsha name + Hebrew name in the standard header.
- Below: "Bamidbar doesn't have a video yet. The script generates automatically — review it, then we'll make the clips."
- Big primary "Start scripting" button (full-width on mobile, sticky bottom).
- On tap: triggers script generation if scripts don't exist; advances to Phase 1.

### 10.4 Offline behavior on iPhone

- localStorage drafts on every editable field — not just captions (current behavior expanded).
- Save failures (network error) → toast "Saving paused — will retry when you're back online" + the local edit stays in place.
- When network returns, queued saves fire automatically with a confirmation toast on success.
- Optimistic UI reverts (per §8.1) are visible and accompanied by an inline message — the user is never surprised by silent reversion.

## 11. Backend changes required

### 11.1 Modal pipeline — plan-only mode

The current `modal_app.py` runs script → clip plan → clips → stitch as one job. We need:

- **New job kind:** `plan-only`. Generates the clip_plan row + inserts one `clips` row per planned clip (with voiceover, visual_prompt, duration_s populated; **`motion_ref_slug` left null** — Yonah picks per clip in Phase 2). Then exits as `done`. No clip rendering, no stitching.
- **New job kind:** `clips-only` (parameterized by `clip_plan_id` and an optional `clip_indexes` subset). Renders clips for an existing plan; can render a single clip or all. Reads `clips.motion_ref_slug` per clip; falls back to `scripts.motion_ref_slug` if null (legacy compat); passes nothing to Seedance if both are null.
- **Stitch** is already a separate step (compose); preserved as-is.

Job state transitions: `plan-only.done` → user reviews in Phase 2 → triggers `clips-only.done` per-clip or bulk → stitches → Phase 4.

**Gate:** the rest of the rework does NOT ship without this backend work. If it slips, the rework slips.

### 11.2 Per-platform structured caption data

Today: `clip_plans.captions` is a JSON blob with flat strings per platform (`tiktok: "caption + #tags"`, `instagram: "..."`, etc.). The new design needs per-platform structured fields.

**Decision:** keep flat string in `clip_plans.captions` (no schema migration), and do the body/hashtag/first-comment/type split entirely in the client UI. On save, the client concatenates back into the flat string Buffer expects. The flat string remains canonical; the UI split is presentation.

This avoids a non-trivial DB migration and keeps the backend interface unchanged. The trade is that hashtags / first-comments aren't queryable as discrete fields — acceptable for now (we don't query them).

YouTube tags and the Reel/Post type toggle DO need new persistence (today tags are hardcoded). Two new fields are needed somewhere in the data model:
- `youtube_tags` (string array)
- `social_metadata` (JSON) — `{instagram: {type: 'reel'|'post', firstComment?: string}, facebook: {...}}`

Implementation question for the plan: do these live on `clip_plans` (shared across compose/regen jobs that reuse the parent's plan) or on a new per-version metadata table? Default: `clip_plans` (matches caption locality), with the understanding that caption metadata is version-agnostic for this product — Yonah crafts the caption for the parsha, not per version. Revisit if that proves wrong.

### 11.3 Supabase Realtime subscriptions

Enable Realtime on `jobs`, `clips`, `videos`, `posts` (if not already). Add row-level filtering in the client subscription by `parsha_id` (jobs/videos) and via the parsha's `job_id` chain (clips/posts).

### 11.4 Server query parallelization

Refactor the data-fetch section of the new `page.tsx` (lines 119-528 of the current page) to:
- `Promise.all` over independent queries.
- Consolidate per-version fetches into batched queries indexed by `job_id`.
- Push presentational work (clip plan parsing, captions VTT building) below `Suspense` boundaries.

### 11.5 Buffer thumbnail path bugfix (separate small fix)

`lib/buffer.ts` line 196 uses `assets.videos[0].thumbnailUrl`. Buffer's May 12 2026 schema overhaul moved this to `assets[i].video.thumbnailUrl`. Fix the path. Currently no harm (we pass `undefined` per the IG-rejection workaround at lines 200-208) but future thumbnail work needs the new path.

Pair with: thumbnail generator update in `modal_app.py extract_thumbnail` to output 1080×1920 JPG (currently produces PNG at source resolution). Required before re-enabling `thumbnailUrl` on IG/TikTok.

### 11.6 `videos.title` snapshot — kills anon-RLS-blocks-chain-walk

Add columns to `videos`:
- `videos.title TEXT` (snapshot of the title at stitch time)
- `videos.subtitle TEXT`
- `videos.description TEXT`

At stitch time (in `compose-video.ts` or the equivalent Modal step), populate these from the chosen script. The public website's `getParshaBySlug` reads `videos.title` directly — no longer walks `videos.job_id → jobs.script_id`, no longer falls back to A-tight when anon RLS blocks `jobs`. Solves kickoff doc bug 7 cleanly. The chain-walk code path is removed from `dashboard/src/lib/parsha-website.ts` and the `website/` consumer.

### 11.7 Per-clip Tai Chi move assignment

Add a column to `clips`:
- `clips.motion_ref_slug TEXT` (nullable; references `tai_chi_moves.slug`)

`clip_plans.plan_json.clips[].motion_ref_slug` is NOT used — the slug lives directly on the `clips` row so per-clip updates are atomic and Realtime-friendly. `scripts.motion_ref_slug` stays untouched and serves as the legacy fallback in `clips-only` (see §11.1).

The bottom-sheet picker in §6.5 reads the move library from `tai_chi_moves` (`slug, english, pinyin, mp4_storage_path`), unchanged.

## 12. Migration — feature flag, not /v2

Per UX review feedback: don't use `/videos/[slug]/v2` as a parallel route — Yonah will forget and report bugs against the wrong page.

**Approach:**
- New page is built at `dashboard/src/app/videos/[slug]/page-new.tsx` (filename only, NOT a route).
- The route file at `page.tsx` becomes a thin dispatcher: it reads a feature flag (`site_content` table key `settings.video_page_v2`) and renders either the old code (preserved as `page-legacy.tsx`) or the new code.
- Flag defaults to `true` for Yonah's user ID, `false` for everyone else (just safety — he's the only operator).
- Once validated (2-3 weeks), the flag is removed, `page-legacy.tsx` is deleted, `page-new.tsx` becomes `page.tsx`.

This way Yonah only ever sees ONE URL per parsha. Rollback is a single config change, not a URL switch.

## 13. Open verification task — Buffer `editPost`

The "Edit on [platform]" behavior depends on whether Buffer's `editPost` mutation (added Apr 22 2026) works on already-published posts. Buffer's public docs don't say. Two branches of the spec:

### Branch A — editPost works on published posts

The "Edit on [platform]" tap from §5.3 takes the user from the read-only expanded view into the editable state. Saving via "Update on [platform]" calls Buffer's `editPost` mutation, which propagates the change to the platform. Confirmation copy: "Saving will update the post on [platform]." No unpost/repost; engagement is preserved.

### Branch B — editPost does NOT work on published posts

The "Edit on [platform]" tap from §5.3 opens a bottom sheet with explicit warning before entering the editable state:

> Editing this post will unpost it from [platform] and post the new version. The original post's likes and comments will be lost.
>
> [Edit and re-post] [Cancel]

If confirmed, the card enters the editable state. Saving via "Update on [platform]" triggers an unpost + repost sequence via Buffer's `deletePost` + `createPost`. Card UI shows "Reposting…" during the swap.

YouTube tier is unaffected — YouTube Data API supports `videos.update` cleanly, so YouTube edits never trigger unpost+repost regardless of branch.

### Verification script

A small Node script at `tools/test_buffer_edit_post.ts` (or `.js`) that:

1. Loads `BUFFER_ACCESS_TOKEN` from `.env`.
2. Schedules a test post via `createPost` (Buffer queue, NOT shared immediately).
3. Waits ~10 minutes for Buffer to publish.
4. Calls `editPost` with a modified caption.
5. Polls the platform-direct URL via `getPostExternalLinks` for ~5 min to see if the change propagates.
6. Unposts the test post.

I'll write this script as part of the first implementation task. Result determines which branch becomes canonical. The spec doesn't ship to implementation until verification is in.

## 14. What the design preserves from the current page

Explicitly NOT breaking (from kickoff doc's "what works" list):

- **Save-before-render race fix** (commit `5b0b14c`): every "Generate this clip" / "Re-render" action flushes pending debounced saves first.
- **WPS auto-extend on render** (commit `f8ecace`): Modal bumps `duration_s` to fit voiceover at 2.6 wps. Preserved.
- **Live WPS indicator on textareas** (commit `5f4acc6`): visible on every voiceover textarea, exact position migrated.
- **Stitch-time `videos.spoken_script`** (commits `5f12cd5`, `d870e4b`): rewritten at every stitch with proper Hebrew + tai-chi transliterations. Unchanged.
- **`getCanonicalClipPlan` helper**: continues to be the only path for caption / script lookup. All new code uses it.
- **Caption draft localStorage**: extended to every editable field, not just captions.
- **Per-clip regen preserves compose picks** (commit `eb70776`): re-render of one clip keeps other clips at the compose's selections. Preserved at the data layer; new UI surface respects it.
- **Auto-unpublish sibling on publish** (`set-video-published.ts` invariant 1): only ONE video per parsha is on torahtaichi.com at a time. The new "Replace site version" flow uses this primitive.

## 15. Definition of done

From kickoff doc + UX review:

- Yonah can take a fresh parsha from "no video yet" to "published on torahtaichi.com + posted to all configured platforms" without asking anyone what to click, on his iPhone, in one sitting.
- He can iterate on a single clip (edit text + scene + tone, re-render) and visually confirm the new clip on the same screen before moving on.
- He can revert a per-clip regen via the version picker without any manual SQL or page refresh.
- He never sees a "Generate" button on the page while a version is live (anywhere — page level, draft callout destination, site card, posted social cards).
- The persistent live-status strip is visible on every screen where a live version exists.
- No new bandaid fixes are needed in the 30 days after launch.
- The plan in `2026-05-22-video-page-redesign-kickoff.md`, plus the rethink doc, plus `editing-v2` plan are stale and can be archived.

## 16. Out of scope (deferring per kickoff doc)

- Twitter thread continuation (Buffer supports it; design when Yonah asks)
- Kie account mismatch (already mitigated)
- TTC inbox forwarding (DNS issue on `torahtaichi.com`, not dashboard)
- Per-video title customization separate from script title (current model fine)

## 17. Resolved defaults (for the record)

For ambiguities the spec resolves with sensible defaults. Yonah / Yitzy override any of these in spec review:

| Decision | Default chosen |
|---|---|
| Destructive confirm pattern | iOS-style bottom sheet, explicit "stays live until you publish new" copy |
| Error-state UX (clip generation fails) | Red border + plain-language error + Retry + "View logs →" + auto-retry countdown if applicable |
| In-flight clip card | Spinner + "Generating…" + "queued at Kie"; no time estimate; "taking longer than usual" at 5min, "still queued" at 12min |
| Empty-state | Single CTA "Start scripting" — auto-generates script if missing then advances to Phase 1 |
| Undo (per-clip regen) | Version picker IS the undo, indefinite (every distinct render kept) |
| Offline | localStorage drafts on every field; "Saving paused" toast; auto-retry on reconnect; visible revert messaging |
| Realtime auth | Authed-user (per existing RLS) |
| Schedule-for-later | Bottom sheet with native date+time pickers per-platform; surfaces as "Scheduled for [date]" pill on the per-platform card |
| `videos.title` snapshot | Yes — kills A-tight fallback simply (§11.6) |
| Migration mechanism | Feature flag at same URL (§12), not `/v2` URL |
| Plan-only Modal split | Gate the rework on this (§11.1) — no graceful degraded path |
| editPost verification | Run before implementation; spec carries both branches (§13) |

## 18. Reference

### Mockups (`.superpowers/brainstorm/1990-1779008428/content/`)

| File | What it shows |
|---|---|
| `01-phased-vs-disclosure.html` | Initial A/B framing (B locked, evolved into 5-phase) |
| `02-regen-prominence.html` | Regen CTA model (locked: demoted, in clip card) |
| `03-five-phase-flow-v2.html` | Phase 2 mockup (desktop) |
| `04-honest-labels-and-freshness.html` | Honest-label clip card + freshness pillar |
| `05-whats-live-surfacing.html` | "What's live" options (superseded by §3 4-state model) |
| `06-live-state-views.html` | Live, at rest + live+draft mockups |
| `07-publish-post-coupling.html` | Publish + post (locked: per-platform individual) |
| `08-phase5-per-platform.html` | Phase 5 v1 |
| `09-phase5-fully-editable.html` | Phase 5 with every component editable |
| `10-mobile-first.html` | iPhone frames for Phase 2 + Phase 5 |
| `11-phase1-scripts.html` | Phase 1 (locked: B, default A-tight in editor) |
| `12-post-regen-view.html` | Post-regen view (locked: A, inline mini-player) |

### Memories drawn on

- `project_yonah_operator_patterns.md`
- `project_dashboard_mobile_first.md`
- `project_live_state_hides_edit_controls.md`
- `feedback_no_estimates_in_action_labels.md`
- `project_video_page_ux_rethink.md`
- `project_video_page_redesign_kickoff.md`

### Related plans

- `docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md` — entry point
- `docs/superpowers/plans/2026-05-15-video-page-ux-rethink.md` — diagnosis
- `docs/superpowers/plans/2026-05-04-editing-v2.md` — what was deliberately designed in the prior iteration
