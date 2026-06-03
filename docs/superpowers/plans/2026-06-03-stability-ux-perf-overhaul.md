# Stability + UX + Perf Overhaul Plan

**Date:** 2026-06-03
**Status:** Approved for execution
**Audit sources:**
- Code: `tasks/wxg48n8zc.output` (120 agents, 53/54 verified findings)
- UX: `tasks/wbcd8ztf4.output` (149 agents, 64/68 verified findings)
- Perf: `tasks/wwx8y1x7i.output` (134 agents, 59/60 verified findings)

## Goal

Move the project from "shipping-fast-but-fragile" to "shipping-fast-AND-trustworthy" without rewriting the stack. Concretely: stop the silent-data-loss bug class, kill the dead-code/stub UI that lies to Yonah, consolidate the 7128-line `modal_app.py`, and ship the cheap perf wins that make the dashboard usable on iPhone over cellular.

## Pre-Execution Corrections (added 2026-06-03 after adversarial review)

Adversarial reviewer flagged: **4 show-stoppers** sharpened in-place below (0.3, 0.5, 0.7, 0.11); **4 sequencing fixes** added to Dependencies section; **3 hidden couplings** patched into the affected items; **scope corrections** to 0.2, 0.4, 0.10, 1.1, 4.3. **Phase 2 false positive removed:** `components/tai-chi-move-picker.tsx` is NOT zero-importer — it's used by [compose/ai-video-panel.tsx:5,231](dashboard/src/app/compose/ai-video-panel.tsx#L5) so deletion moves to **Phase 1.16** as a migration step. **Item 1.9 dropped** (the button it wires up is in `phase-3-clips.tsx` which 1.5 deletes).

### Per-Phase-0-item Smoke Tests (mandatory before merge)

| Item | "How to know it worked" |
|---|---|
| 0.1 | Today page shows correct Hebrew name for slugs `vayeira`, `vayeishev`, `beha-alotcha`, `re-eh`, `ha-azinu`. Public website's current-week pill matches. |
| 0.2 | Edit voiceover on clip 2 → click "Regen with feedback" → rendered clip 2's `clips.voiceover` DB row contains the edit text (not the stale plan_json text). Repeat for regen_smart, regen_agent, regen_single_clip paths. |
| 0.3 | Type-clear-retype a voiceover in Phase 2 → no error toasts → final value in DB matches what was typed (including intermediate clear state). |
| 0.4 | Edit teaching text → trigger re-stitch → `videos.spoken_script` post-stitch matches the edit (not the freshly-computed text from clip voiceovers). |
| 0.5 | Edit IG caption in posting card → reload torahtaichi.com homepage → IG caption text appears in `videos.website_caption` AND the website carousel. |
| 0.6 | Pick YT thumb → reload page → picked thumb URL still present in YouTube card. Click "Post all" → live YouTube video uses picked thumb. |
| 0.7 | Edit posted IG caption → tap Update → Buffer GraphQL receives the EDITED text. Verify via Buffer dashboard (or mock in test). |
| 0.8 | Open Post-all sheet → see truncated caption preview per platform → primary button is red/destructive → tap fires real Buffer. |
| 0.9 | Tap Cancel scheduled post → Buffer post is actually deleted (or button is hidden/replaced with Edit-in-Buffer link). |
| 0.10 | Trigger a render error → tap "Reload this page" → URL goes to `/videos/{slug}` (no `?phase=N`) and state re-resolves cleanly. |
| 0.11 | Modal Function execution succeeds with rotated secret; old secret rejected. |

### Rollback Strategy

**Phase 0 items ship straight to prod** (no feature flag, no canary). Rollback path = `git revert <commit> && git push` + redeploy. Vercel auto-deploys; Modal needs `modal deploy modal_app.py`. **0.2 + 0.5 + 0.7 could optionally be gated behind the existing `?v2=1` flag** ([page.tsx:488](dashboard/src/app/videos/[slug]/page.tsx#L488)) to limit blast radius during initial soak — Yonah already uses v2 by cookie so this is effectively dark-launch.

For 0.11 secret rotation specifically: see sharpened 6-step procedure below — partial rollback (re-add old value to torah-tai-chi-env) is supported through step 5 but NOT after step 6.

## Scoreboard

| Pillar | Critical | Important | Nits | Estimated effort |
|---|---|---|---|---|
| Code (stability + cleanup) | 6 | 24 | 13 | ~3 weeks |
| UX (navigation + flows + mobile) | 6 | 31 | 19 | ~2.5 weeks |
| Performance | 6 | 19 | 19 | ~2 weeks |
| **Cross-pillar merged** | **~16** | **~62** | **~50** | **~5-6 weeks** |

## Headline Themes

1. **Source-of-truth gaps cause silent data loss.** Five of six critical code findings + one critical UX finding share one shape: multiple writers + readers for the same logical field (`clips.voiceover`, `clip_plans.plan_json.captions`, YouTube thumbnail URL, `videos.spoken_script`, regen `plan_json` overlay). Operator's edits vanish. Memory's top-priority feedback `writers_and_readers_must_share_source` was prophetic — the pattern is pervasive, not isolated.

2. **Old code rots into stubs and orphans.** V1→V2 cutover left ~1,500 LOC dead. Five `Cancel scheduled post` buttons are `alert('coming soon')` stubs. Help doc references a button that doesn't exist. `/videos/[slug]/edit` redirects to a dead anchor. Phase 3 retired but the stepper still renders 5 segments. Three dashboard URL conventions in flight.

3. **`modal_app.py` (7,128 LOC) is the project's worst debug hotspot.** 32 inline `create_client()` calls, 10+ identical `set_status` closures (one already drifted — omits `mode` field, likely cause of stuck spinners), 4 identical 60-line fail-job scaffolds, 7 bare `except Exception: pass` in cleanup paths. Atomic Modal deploys + zero tests = every regen path is its own production incident.

4. **iPhone-primary client treated as second-class.** 9 of 14 nav destinations unreachable on mobile. Destructive actions ("Replace," "Unpublish," "Cancel render") styled as primary CTAs. Phase 2 chips at 32px (below iOS HIG 44pt). MotionPicker autoplays 50 MB of full-res MP4 over cellular on every open. RefPicker downloads 30 MB of full-res PNGs into 64-76 px tiles.

5. **Caching + parallelization left on the table.** 4 sequential Supabase waves on `/videos/[slug]` outside Suspense. Jobs table never added to `supabase_realtime` publication, so 5 client listeners are dead and 30-48 polls/min are doing 100% of the work. `revalidatePath('/', 'layout')` fires on every keystroke in 16+ server actions. ~150 KB of unused phase-tree code shipped on every page.

6. **Integration seams are brittle.** Buffer GraphQL is hand-rolled against a vendor that's already shipped breaking changes. Env-var contract: 8+ vars read in source missing from `.env.local.example`. Bang-asserted env reads turn missing config into opaque 500s mid-request. Service-role key used in 44 dashboard files that mostly already have cookie auth.

---

# Execution Sequence

Each item: **[priority]** title — *[effort, source]*
- **Why:** 1-sentence symptom
- **Files:** key file:line refs
- **Fix:** concrete change
- **Depends:** items that must land first

---

## Phase 0 — Stop the Bleeding (Week 1, ~3 days)

The silent-data-loss bugs + the alert-stub UI lies. Land before any cleanup, refactor, or perf work.

### 0.1 Lift the dashboard's hebcal-slug fix into the website
- [ ] **C-CRIT** *[half-day, code+ux]*
- **Why:** Same Korach-instead-of-Beha'alotcha bug we fixed in dashboard last session is still live on torahtaichi.com. 10 slugs diverge from DB; no curly-apostrophe normalization; stale `hebrew-names.ts` silently renders empty Hebrew names for 10 parshiot.
- **Files:** [website/src/lib/hebcal.ts](website/src/lib/hebcal.ts), [website/src/data/hebrew-names.ts](website/src/data/hebrew-names.ts)
- **Fix:** Copy [dashboard/src/lib/hebcal-slug.ts](dashboard/src/lib/hebcal-slug.ts) (HEBCAL_TO_SLUG + PARSHA_DB_SLUGS + normalizeHebcalName + resolveParshaSlug) verbatim. Source `hebrew_name` from `parshiot.hebrew_name` DB column (already exists). Add CI grep that fails when the two HEBCAL_TO_SLUG dicts diverge.

### 0.2 Hoist clip-overlay into shared helper for all 4 regen paths
- [ ] **C-CRIT** *[day, code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** `clips_only_job` was fixed for the 2026-05-28 incident, but 4 other regen entrypoints (`regen_clip`, `regen_smart`, `regen_agent`, `regen_single_clip`) still pass stale `plan_json` to Claude. Any "Regen with feedback" after a voiceover edit silently overwrites operator work.
- **Files (use-sites):** [modal_app.py:3184](modal_app.py#L3184) (regen_clip surgery), [:5067-5076](modal_app.py#L5067) (regen_single_clip), [:2754](modal_app.py#L2754) (regen_smart calls `_smart_edit_plan(parent_plan_dict=...)`), [:4248](modal_app.py#L4248) (regen_agent), template at [:5762-5790](modal_app.py#L5762)
- **Files (fetch-sites — must overlay BEFORE these read into `parent_plan_dict`):** modal_app.py:3174 (regen_clip), :4238 (regen_agent), :2744 (regen_smart), :5057 (regen_single_clip)
- **Fix:** Extract `_apply_operator_overrides(plan, sb, parent_job_id, indices)`. Inject between every fetch of `clip_plans.plan_json` and every USE of `parent_plan_dict`. Note: `regen_smart` uses `_smart_edit_plan(parent_plan_dict=...)` while others embed inline — same overlay applies to both shapes.

### 0.3 Collapse two `clips.voiceover/visual_prompt` writers into one
- [x] **C-CRIT** *[half-day, code]* ⚠️ *Reviewer-sharpened 2026-06-03* — **Shipped commit `60f714e` via Path B (no migration); see scope note below**

**Scope decision (2026-06-03):** Implementer chose Path B (simpler — relax `updateClipText` to silently skip empty fields, leverage Phase 0.2's `_overlay_edits_onto_plan` for render-time fallback) over Path A (new `clips.voiceover_status` column). Path A would have required either relaxing the `clips.voiceover` NOT NULL constraint OR storing status without storing the empty content (defeating the column). Path B reuses Phase 0.2's overlay fallback as the render-time gate. Net: 3-file commit, no migration, no manual prod step.


- **Why:** `savePlanClip` (used by phase-2) has no validation, no zero-row guard, will silently write whitespace. `updateClipText` has all three guards.
- **Files:** [save-plan-clip.ts:13-28](dashboard/src/app/actions/video-page/save-plan-clip.ts#L13), [update-clip-text.ts:17-70](dashboard/src/app/actions/update-clip-text.ts#L17), [phase-2-plan-review.tsx:719,728,780](dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx#L719)
- **⚠️ Signature & behavior conflict:**
  - `savePlanClip(clipId, {voiceover, visual_prompt, duration_s})` — snake_case fields, accepts empty strings
  - `updateClipText({clipId, voiceover, visualPrompt})` — camelCase fields, **throws "Voiceover cannot be empty"** on empty string
  - Phase 2 inputs autosave on every keystroke via `useOptimisticSave` → first time Yonah selects-all + deletes to retype, every autosave keystroke between clear and retype will toast an error.
- **Fix (corrected):**
  1. Pick `updateClipText` as the survivor (better guards). Rename internal field to `visual_prompt` to match DB column convention.
  2. **Relax empty-string rejection** — currently throws hard; change to: empty allowed during edit, but mark `clips.voiceover_status='draft-empty'` so render-time gate refuses to feed Seedance. Operator sees no error toast while clearing-and-retyping; downstream pipeline still protected.
  3. Add `duration_s` as optional patch field.
  4. Repoint phase-2-plan-review.tsx:719,728,780 + delete save-plan-clip.ts.
  5. Note: `regen-clip-from-text.ts:50` also reads `clips.voiceover` — verify the "draft-empty" state is handled in the regen path (refuse-to-render if all clips draft-empty).
- **Depends:** 0.2 (overlay helper merges them anyway). **MUST sequence after Phase 2 dead-code purge OR else editable-clip-card.tsx:226,303 also need updating** (they import updateClipText today but Phase 2 deletes them).

### 0.4 Add `spoken_script` to videos carry-forward block
- [ ] **C-CRIT** *[half-day, code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** [update-teaching-text.ts:29](dashboard/src/app/actions/update-teaching-text.ts#L29) promises edit survival across re-stitches but `_resolve_video_title_fields` omits `spoken_script` from the carry-forward — every compose/clips_only path unconditionally regenerates it.
- **Files:** [modal_app.py:1374-1502](modal_app.py#L1374) (resolver), [:6111-6116](modal_app.py#L6111) + [:6978-6989](modal_app.py#L6978) (writers), [:1370-1371](modal_app.py#L1370) (`_build_spoken_script` source)
- **⚠️ Hidden coupling:** The carry-forward block at :1447-1452 returns `{title, subtitle, description, website_caption}` only — `spoken_script` isn't even a key. So fixing this requires BOTH:
  1. Adding `spoken_script` to the carry-forward dict (with "prior non-empty wins"), AND
  2. Modifying the writers at :6111-6116 + :6978-6989 to PREFER the carried value over the freshly-computed `_build_spoken_script(spoken_clips)` output.
- **Fix:** Both changes in one commit. Plus add a `clips_only_job` test case (synthetic prior row + new clips → assert prior spoken_script wins).

### 0.5 Instagram caption mirror to `videos.website_caption`
- [ ] **C-CRIT** *[half-day, code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** `save-platform-caption.ts` writes IG to `clip_plans.plan_json.captions` only. The website reads from `videos.website_caption`. Yonah's IG edits in the new editor are phantoms on torahtaichi.com.
- **Files:** [save-platform-caption.ts:31-37](dashboard/src/app/actions/video-page/save-platform-caption.ts#L31), [update-caption.ts:67-79](dashboard/src/app/actions/update-caption.ts#L67) (block to inline), [captions-list.tsx:164](dashboard/src/app/videos/[slug]/_components/captions-list.tsx#L164) (caller of dying action)
- **⚠️ Hidden detail the reviewer caught:** The mirror block isn't a one-liner. It (a) does a parsha-fanout — walks `jobs` by `parsha_id` to find ALL job rows so it updates EVERY `videos` row for the parsha (not just the current), and (b) is gated on `field === 'instagram'` because `save-platform-caption` is ALSO called with `'youtube_title'`/`'youtube_description'` from youtube-card.tsx (which are not real Buffer platforms).
- **Fix (corrected):**
  1. Confirm `save-platform-caption` and `update-caption` target the SAME `clip_plans` row (verify `getCanonicalClipPlan` returns the same row both writers use — they should, but assert in code).
  2. Inline the parsha-fanout block from update-caption.ts:67-79 verbatim into save-platform-caption.ts, **guarded by `if (platform === 'instagram')`** (keep guard exactly — handles the youtube-title/youtube-description callers safely).
  3. **Delete update-caption.ts** (currently used by captions-list.tsx:164 which Phase 2 deletes — so 0.5 must merge captions-list deletion check OR leave the action callable until 2.1 runs).
- **Depends:** Phase 2 deletion of `captions-list.tsx` must follow or be coordinated. Safest: ship 0.5 with action kept callable, let Phase 2 delete both together.

### 0.6 Persist YouTube picked thumbnail
- [ ] **C-CRIT** *[half-day, code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** Pick thumbnail → reload → auto-extracted thumb ships. "Post all" doesn't even accept `youtubeThumbnailUrl`, so it always drops the operator's pick.
- **Files:** new migration; [save-youtube-thumbnail.ts](dashboard/src/app/actions/video-page/save-youtube-thumbnail.ts), [youtube-card.tsx:64](dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx#L64), [post-all-platforms.ts:25-31](dashboard/src/app/actions/video-page/post-all-platforms.ts#L25), [auto-post.ts:412](dashboard/src/lib/auto-post.ts#L412)
- **Fix:** Add `youtube_thumbnail_url` column to `videos`. Persist from `saveYouTubeThumbnail`. Seed `pickedThumbUrl` from DB. Forward through `postAllPlatforms`, or have `auto-post.ts` read the column when the arg is undefined.
- **⚠️ Sequence migration FIRST:** `supabase db push` (or whatever you use) the column-add migration to prod BEFORE deploying the code that reads the column. Otherwise the first render after deploy errors trying to read a column that doesn't exist. Schema migrations are not auto-applied by Vercel deploys.

### 0.7 Posting-card "Update" button captures edited text, not stale prop
- [ ] **U-CRIT** *[1h, ux+code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** Yonah edits a posted caption in the platform card, taps Update — Buffer Branch B deletes the live post and re-publishes with the STALE prop value. Likes/comments gone, wrong text live.
- **Files:** [instagram-card.tsx:131](dashboard/src/app/videos/[slug]/_components/posting-cards/instagram-card.tsx#L131), facebook-card.tsx:124, x-card.tsx:103, tiktok-card.tsx:133, [edit-posted.ts:47,86](dashboard/src/app/actions/video-page/edit-posted.ts#L47)
- **⚠️ Reviewer rejection of original fix:** "Lift edit value into card state" requires `CaptionAndHashtags` to become controlled (currently uncontrolled — no value/onChange exposed). That's a deeper refactor across 5 cards.
- **Fix (corrected — pick the server-side path):**
  - In `edit-posted.ts`, ignore the `newText` arg from the client. Re-fetch the canonical caption from `clip_plans.plan_json.captions[platform]` server-side after the user clicks Update.
  - The Edit-In-Place input has already autosaved through `savePlatformCaption` (per the existing autosave flow), so the canonical row is current by the time Update fires.
  - 5-line change to `edit-posted.ts`, zero card changes. Apply to all 4 cards' callers automatically.
- **Required check before merging:** verify that the autosave debounce window is < the time between typing and clicking Update. If autosave is on blur (it currently is), this works. If it's on a 2s debounce, add a flush-on-click before Update fires.
- **Test:** Type new caption, click Update without losing focus, assert Buffer mutation receives typed text. Integration test with Buffer mocked.

### 0.8 Post-all confirm sheet shows caption preview + destructive styling
- [ ] **U-CRIT** *[half-day, ux]*
- **Why:** The single most consequential action in the app — publishing to ALL live social accounts in one tap — shows only platform display names with no caption preview and no destructive styling.
- **Files:** [phase-5-post.tsx:177-197](dashboard/src/app/videos/[slug]/_components/phase-5-post.tsx#L177), template at [schedule-all-sheet.tsx:500-565](dashboard/src/components/schedule-all-sheet.tsx#L500)
- **Fix:** Render per-platform rows with truncated caption preview. Set `primaryAction destructive:true`. Rename trigger to "Post to all N platforms…" with ellipsis. Alternative: delete the Post-all sheet entirely and route through `schedule-all-sheet` with `mode='now'`.

### 0.9 Wire OR remove all 5 `Cancel scheduled post` alert stubs
- [ ] **U-CRIT** *[half-day, ux+code]*
- **Why:** Yonah scheduled a post for the wrong day, taps Cancel, gets `alert('coming soon')` — the post still fires. He wakes up to wrong content on Rav Eli's accounts. `deletePostBuffer()` already exists.
- **Files:** instagram-card.tsx:93, facebook-card.tsx:89, x-card.tsx:70, youtube-card.tsx:101, tiktok-card.tsx:83; [buffer.ts:369](dashboard/src/lib/buffer.ts#L369)
- **Fix (a):** Wire onClick to a new `cancelScheduledPost` server action calling `deletePostBuffer({postId})`, flip `posts.status` to 'unposted'. **OR (b):** Hide the button when `post.status === 'scheduled'` and replace with `Edit in Buffer →` deep-link. Do NOT keep `alert()` stubs.

### 0.10 Phase-error-boundary uses router.push, not window.location.reload
- [ ] **U-CRIT** *[1h, ux]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** If a render error inside any phase is caused by phase/state drift (the most common cause on this project), tapping "Reload this page" pins Yonah to the same broken `?phase=N` URL — infinite loop with no escape on iPhone.
- **Files (5+ files change, not 1):** [phase-error-boundary.tsx:43](dashboard/src/app/videos/[slug]/_components/phase-error-boundary.tsx#L43) + every wrapper that uses it: `phase-1-script-connected.tsx`, `phase-2-plan-review-connected.tsx`, `phase-3-clips-connected.tsx` (if 1.5 hasn't deleted yet), `phase-4-stitched-connected.tsx`, `phase-5-post-connected.tsx`, plus connected wrappers for live-at-rest and any other phase-error-boundary consumers.
- **Fix:** Add `parshaSlug` to PhaseErrorBoundary's prop signature. Update all 5+ wrappers to pass it (route param `slug` is already in scope from each connected wrapper). Replace `window.location.reload()` with `router.push('/videos/${parshaSlug}')` + `router.refresh()`. Optional secondary fallback link "Or hard reload" for environmental glitches.
- **Memory:** `feedback_phase_nav_via_url_not_reload`

### 0.11 Rotate `PIPELINE_TRIGGER_SECRET` out of leaked Modal bundle
- [ ] **C-CRIT (security)** *[half-day, code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** [modal_app.py:107](modal_app.py#L107) admits the secret leaked into `torah-tai-chi-env` and is being shadowed-not-removed. `.env.example` documents the leaked bundle as source.
- **⚠️ Original "1h, just rotate" undersells the dance.** Dashboard reads `process.env.PIPELINE_TRIGGER_SECRET` on every Modal dispatch; both sides must agree on the value continuously.
- **Fix (sequenced 6 steps — partial rollback supported through step 5, NOT step 6):**
  1. Generate new secret value.
  2. Add new secret to Vercel env (`PIPELINE_TRIGGER_SECRET_NEW`) on dashboard project. Deploy. Dashboard still sends old secret.
  3. Add new secret to Modal `torah-tai-chi-pipeline-secrets` bundle alongside old.
  4. Deploy Modal with a transitional `_accept_either_secret(request_secret)` that accepts old OR new. Both sides now safe.
  5. Switch dashboard env so `PIPELINE_TRIGGER_SECRET` = new value (rename `_NEW` → primary). Redeploy dashboard. Dashboard now sends NEW; Modal accepts either.
  6. Remove old secret from `torah-tai-chi-env`. Remove transitional accept-either code from Modal. Redeploy Modal. Update `.env.example` to point to `torah-tai-chi-pipeline-secrets`.
- **Rollback up to step 5:** revert dashboard env to old secret, Modal still accepts both.
- **No rollback after step 6:** must regenerate + redeploy if needed.
- **Schedule:** do this on a Tuesday morning when Yonah is unlikely to be actively triggering jobs.

**Phase 0 wrap-up:** smoke-test on staging, deploy, verify no regressions on Today / Live-at-Rest / Phase-5 / Live website pages.

---

## Phase 1 — UX Consistency Sweep (Week 1-2, ~4 days)

Visual + flow fixes that align operator expectations. Most are 1h-half-day; high ROI per hour for Yonah's daily use.

### 1.1 Mobile tabbar: add "More" tab opening 9-destination sheet
- [ ] **U-CRIT** *[half-day, ux]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** Dashboard is iPhone-primary but Yonah's phone has no nav to /compose, /parshiot, /articles, /site-content, /settings, /help. Empty state on /videos directs him to unreachable pages.
- **Files:** [sidebar-nav.tsx:24-71](dashboard/src/components/sidebar-nav.tsx#L24)
- **Fix:** Add "More" as 5th `MOBILE_ITEMS` slot opening full-screen `BottomSheet` listing 9 hidden destinations. Keep primary 4 = Today/Videos/Channels/Analytics; demote Calendar to More.
- **⚠️ Auth-model scope removed:** Original draft said "hide /admin/* behind role check" — but no role check exists in the codebase today (no `usePermission` or similar). Adding one is its own feature, not a sub-bullet here. **For now:** include /admin links in the More sheet alongside the others. **Spin off:** "Add roles for /admin/*" as a separate item in Phase 5 backlog if Yonah objects to seeing diagnostics in his daily nav.

### 1.2 Wire SignOutButton behind the decorative avatar
- [ ] **U-IMP** *[1h, ux]*
- **Why:** `components/header.tsx` + `sign-out-button.tsx` are dead code. The top-bar avatar div has `cursor:'pointer'` but no onClick. No in-UI sign-out anywhere on iPhone.
- **Files:** [layout.tsx:148-167](dashboard/src/app/layout.tsx#L148), [sign-out-button.tsx](dashboard/src/components/sign-out-button.tsx)
- **Fix:** Convert avatar div to `<button>` opening a dropdown with userName + Sign out + Settings link. Delete `components/header.tsx`.

### 1.3 Fix help article that references nonexistent button
- [ ] **U-CRIT** *[1h, ux]*
- **Why:** /help/generate-video tells Yonah to click "Approve · generate video" — that button doesn't exist. Real Phase 1 CTA is "Generate clip plan →". Yonah follows docs literally.
- **Files:** [help/generate-video/page.tsx:39](dashboard/src/app/help/generate-video/page.tsx#L39), audit all other /help/* articles in same pass
- **Fix:** Rewrite Step 3 to match real 5-phase flow. Add note distinguishing free Claude from paid Seedance actions. Audit edit-homepage, publish-article, schedule-posts, stance, troubleshooting.

### 1.4 Add "cancelled" branch to realtime listeners (scoped to surviving files)
- [ ] **U-IMP** *[half-day, ux+code]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Why:** If Yonah cancels a plan-only/clips/compose job, the /videos/[slug] page never clears its spinner — listeners only branch on done/failed. Same memory pattern as `feedback_realtime_listeners_need_both_terminal_states`.
- **Files (SURVIVING — Phase 2 deletes the rest):** plan-generating-card.tsx:42-74, phase-3-clips.tsx:251 *(but Phase 3 itself is deleted by 1.5 — skip if 1.5 ran first)*, phase-4-stitched.tsx:54-83, job-progress.tsx
- **⚠️ DO NOT modify:** `regen-in-progress-banner.tsx:52`, `editable-clip-card.tsx:21`, `editable-clip-list.tsx:31` — Phase 2 deletes these (wasted work to patch).
- **Fix:** Create `dashboard/src/lib/job-status.ts` exporting `TERMINAL_JOB_STATUSES = new Set(['done','failed','cancelled'])` + `IN_FLIGHT_JOB_STATUSES`. Import in surviving files only. Add cancelled branch mirroring [phase-2-plan-review.tsx:624-631](dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx#L624).
- **Sequence:** ideally run AFTER Phase 2 dead-code purge — then this item touches its final file list cleanly. If running before, scope to the surviving files explicitly.

### 1.5 Phase 3 retirement aftermath: drop from stepper + back-button labels
- [ ] **U-IMP** *[half-day, ux+code]*
- **Why:** Phase 2 advances to ?phase=4 and Phase 4 "Back to clips" lands at ?phase=2, but `compressed-stepper` still shows 5 equal segments with "Phase 3 of 5: Clips" and Phase 4's back-button says "Back to clips" while landing on Plan.
- **Files:** [compressed-stepper.tsx:10,48,57-72](dashboard/src/app/videos/[slug]/_components/compressed-stepper.tsx#L10), [phase-4-stitched.tsx:66](dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx#L66), phase-5-post.tsx:277 (missing ← arrow), [phase-3-clips.tsx](dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx) + connected (delete)
- **Fix:** PHASE_NAMES = `['Script','Plan','Stitched video','Post']` (4 phases). Phase 4 back → "Back to plan". Add ← prefix to Phase 5 back. Delete phase-3-clips files (~200 LOC).

### 1.6 Demote destructive actions on live pages
- [ ] **U-IMP** *[half-day, ux]*
- **Why:** "Replace with a new version" + "Replace site version" render as 44px navy CTAs identical to benign "Edit on Instagram". Memory pattern `project_live_state_hides_edit_controls`.
- **Files:** [live-at-rest.tsx:417](dashboard/src/app/videos/[slug]/_components/live-at-rest.tsx#L417), [site-card.tsx:88](dashboard/src/app/videos/[slug]/_components/site-card.tsx#L88), [live-site-cms-card.tsx:462-480](dashboard/src/app/videos/[slug]/_components/live-site-cms-card.tsx#L462) (Unpublish)
- **Fix:** Demote Replace + Unpublish triggers to small italic underlined ghost links matching the "Back to script" style. Optionally tuck behind `<details>Advanced</details>`. Keep destructive BottomSheet confirms.

### 1.7 Demote "Cancel render" + promote it above noise floor
- [ ] **U-IMP** *[1h, ux]*
- **Why:** "Cancel render" (kills paid Kie job) is currently 11.5px italic underline next to navy "Re-render". On iPhone it's fat-finger miss. Escape is harder to find than the spend.
- **Files:** [phase-2-plan-review.tsx:1383-1400](dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx#L1383), :1239-1256
- **Fix:** Restyle Cancel as 40px outline button matching Re-render chrome. Add pre-action copy "Cancelling won't refund credits spent so far."

### 1.8 Standardize verbs: Generate, Post, Cancel, Replace, Try again
- [ ] **U-IMP** *[half-day, ux]*
- **Why:** "Cancel" overloaded across 13+ surfaces with different blast radii (dismiss sheet vs kill paid job vs alert-stub). "Generate" covers 5 buttons across 3 cost classes. "Try again" means free retry in one place and paid Kie re-render in another.
- **Fix:**
  - `Cancel` = dismiss sheet only. Rename "Cancel render" → "Stop this render". Rename edit-field cancels-with-dirty → "Discard edits".
  - Spend indicator (⚡ icon or tassel-red 4px left bar) on any button firing Modal/Kie/Seedance: [phase-2-plan-review.tsx:386,1375](dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx#L386), [compose ai-video-panel.tsx:249](dashboard/src/app/compose/ai-video-panel.tsx#L249), [ai-image-panel.tsx:255](dashboard/src/app/compose/ai-image-panel.tsx#L255). Add inline `Renders N clips at ~$X total` above sticky.
  - `Try again` reserved for FREE retries (error boundaries). Paid retries become `Re-render` or `Re-trigger pipeline (~$X)`.
  - Post-all: "Post to all N platforms" (consistent verb+scope).

### ~~1.9 Wire Phase 3 stuck-job Cancel-and-retry button~~ — **DROPPED 2026-06-03**
- ~~The button lives in `phase-3-clips.tsx:388-407` — but Phase 3 is being deleted by 1.5. Wiring this up is throwaway work.~~
- **If equivalent UI needs to exist in Phase 2** post-1.5, add a new item under Phase 2 work referencing the canonical pattern at `cancel-job.ts:46` + `phase-2-plan-review.tsx:1255`.

### 1.10 Sidebar meta strings: remove or wire to live data
- [ ] **U-IMP** *[1h, ux]*
- **Why:** Hardcoded `'4 / 5'`, `'4 ahead'`, `'54'`, `'now'` already contradict live data. Calendar H1 says "Six weeks ahead", sidebar says 4.
- **Files:** [sidebar-nav.tsx:8-15](dashboard/src/components/sidebar-nav.tsx#L8)
- **Fix (cheap):** Remove `meta` props entirely. **(Better):** Server-fetch counts and pass as prop.

### 1.11 /videos: surface "Stuck" tab for 2h-stale in-flight jobs
- [ ] **U-IMP** *[half-day, ux]*
- **Why:** Jobs stuck >2h vanish silently from /videos. Yonah has no signal. Only /admin/events shows them — not in mobile tabbar.
- **Files:** [videos/page.tsx:19,21-24,110-113](dashboard/src/app/videos/page.tsx#L19), [videos-dashboard.tsx:38-45](dashboard/src/app/videos/videos-dashboard.tsx#L38)
- **Fix:** Add Stuck tab between Generating and Ready. Build `stuckCards` array. Card shows original status + time-since-trigger + "Mark failed & retry" button calling new `markJobFailed` action.

### 1.12 Centralize /videos/[slug] URL building (6 hand-rolled shapes)
- [ ] **U-IMP** *[half-day, ux+code]*
- **Why:** 6 different query shapes (?phase=, ?v=, ?continue=, ?v2=, bare). ?v= is dead param. ?v2=1 gets dropped by in-page router.push (memory pattern).
- **Files:** page.tsx:244, calendar/page.tsx:189/220, draft-callout-strip.tsx:53, job-progress.tsx:1138, start-next-video-picker.tsx:212/550, all phase-N-connected.tsx files, phase-1-script-connected.tsx:47
- **Fix:** Create `dashboard/src/lib/video-routes.ts` exporting `videoPageHref(slug, opts)`. Migrate all call sites. Move ?v2=1 to a middleware cookie. Drop dead ?v= param or wire it.

### 1.13 Articles vs Videos filter mechanism unified (URL state)
- [ ] **U-IMP** *[half-day, ux]*
- **Why:** /articles uses ?category= URL state (shareable, SSR-friendly). /videos uses useState (resets every visit, not shareable).
- **Files:** [VideosFilter.tsx:64,101-114](website/src/components/VideosFilter.tsx#L64), [articles/page.tsx:85-100](website/src/app/articles/page.tsx#L85) (template)
- **Fix:** Convert VideosFilter to server-aware: searchParams.get('book'), pills as `<Link>`, lift filter into /videos/page.tsx server component.

### 1.14 WatchOnRow + ShareRow both visible on website /videos/[slug]
- [ ] **U-IMP** *[1h, ux]*
- **Why:** Once dashboard auto-posts to platforms, ShareRow (WhatsApp/X/FB/Copy) disappears in favor of WatchOnRow — losing organic share affordance on exactly the videos worth sharing.
- **Files:** [website/src/app/videos/[slug]/page.tsx:224-232](website/src/app/videos/[slug]/page.tsx#L224)
- **Fix:** Render BOTH. WatchOnRow primary ("Watch on"), ShareRow secondary below ("Share this teaching"), 32px gap, weight differentiation.

### 1.15 Sheet primitive consolidation: BottomSheet for ScheduleAll + ParshaPicker
- [ ] **U-IMP** *[day, ux]*
- **Why:** ScheduleAllSheet (highest-stakes confirm) is centered modal, no safe-area-inset, no escape handler. ParshaPickerSheet has no Dialog.Title/aria/focus trap/escape. 13+ other sheets use canonical BottomSheet.
- **Files:** [schedule-all-sheet.tsx:251-265](dashboard/src/components/schedule-all-sheet.tsx#L251), [start-next-video-picker.tsx:111-160](dashboard/src/components/start-next-video-picker.tsx#L111), bottom-sheet.tsx (canonical)
- **Fix:** Migrate ScheduleAllSheet to compose BottomSheet (priority — most consequential). Then ParshaPicker. Drop ad-hoc Sheet at start-next-video-picker.

### 1.16-bis Migrate `/compose` from TaiChiMovePicker → MotionPickerSheet
- [ ] **U-IMP** *[half-day, code+ux]* ⚠️ *Added 2026-06-03 — reviewer caught Phase-2-delete false positive*
- **Why:** `tai-chi-move-picker.tsx` was on Phase 2's delete list but is actively used by `/compose/ai-video-panel.tsx`. Two parallel pickers + two parallel `TaiChiMove` types of the same DB row.
- **Files:** [compose/ai-video-panel.tsx:5,231](dashboard/src/app/compose/ai-video-panel.tsx#L5), [components/tai-chi-move-picker.tsx](dashboard/src/components/tai-chi-move-picker.tsx)
- **Fix:** Lift `listTaiChiMoves()` fetch to compose parent server component, replace TaiChiMovePicker import with MotionPickerSheet. Consolidate TaiChiMove type at `@/lib/tai-chi-moves`. Delete `components/tai-chi-move-picker.tsx` as the final commit-step.
- **Sequence:** must complete BEFORE Phase 2's bundled delete commit, OR move this file's deletion to a follow-up commit after Phase 2.

### 1.16 MotionPickerSheet + TierPickerSheet: drop "Cancel" primary
- [ ] **U-IMP** *[1h, ux]*
- **Why:** Picker commits on tap. The visually dominant 48px navy primary slot doing "Cancel" inverts the contract every other sheet establishes.
- **Files:** [motion-picker-sheet.tsx:52](dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx#L52), [tier-picker-sheet.tsx:45](dashboard/src/app/videos/[slug]/_components/_shared/tier-picker-sheet.tsx#L45), [bottom-sheet.tsx:94-111](dashboard/src/app/videos/[slug]/_components/bottom-sheet.tsx#L94)
- **Fix:** Drop primaryAction (items commit on tap). Cancel/Done → secondaryAction. Extend BottomSheet API for primary-less variants.

### 1.17 Mobile tap-target audit: chips, version chips, chain-toggle links, × remove
- [ ] **U-IMP** *[1h, ux]*
- **Why:** Phase 2 chips 32px tall with 6px gap (below iOS HIG 44pt). Version chips mis-tap silently switches `selectedClipId`. Break/Restore chain at 11.5px italic. Per-card × Remove glyph mis-reads as "collapse."
- **Files:** phase-2-plan-review.tsx:1493 (Chip), :1137 (version chips), :1030-1066 (chain toggles), :888-910 (× Remove)
- **Fix:** Bump Chip minHeight 32→40. Increase version-chip gap 6→8. Convert chain-toggle from text links to chip-style buttons (36-40px). Move × Remove out of row header into chip menu as final tassel-red "× Remove this clip" chip.

### 1.18 Standardize empty/loading/error states
- [ ] **U-IMP** *[half-day, ux]*
- **Why:** 5 distinct empty-state visuals; youtube-comments returns silent null on auth fail (can't distinguish "broken" from "no comments").
- **Files:** [youtube-comments.tsx:29](dashboard/src/app/videos/[slug]/_components/youtube-comments.tsx#L29), videos-dashboard.tsx, articles/page.tsx, events-viewer.tsx, messages/page.tsx, empty-state.tsx
- **Fix:** Create `components/empty-state-card.tsx` with 3 variants (no-yet, no-filter-match, actionable+CTA). Replace silent null in youtube-comments with read-only variant + reconnect CTA.

### 1.19 Standardize server-action return shape: `Result<T>`
- [ ] **U-IMP** *[day, ux+code]*
- **Why:** 60+ server actions return mixed shapes (`{error}` vs `{ok,error?}` vs `{ok}|{error}`). Forces consumers to check `'error' in result` AND `res.error` AND `!result.ok`. New consumer = silent break.
- **Fix:** `dashboard/src/lib/result.ts` exporting `type Result<T> = {ok:true; data:T} | {ok:false; error:string}`. Migrate top 5 most-called actions first. Document 3-tier error surface in AGENTS.md.

### 1.20 Delete /videos/[slug]/edit orphan route + stale revalidatePath
- [ ] **U-IMP** *[1h, ux+code]*
- **Files:** [videos/[slug]/edit/page.tsx:7](dashboard/src/app/videos/[slug]/edit/page.tsx#L7), [submit-clip-feedback.ts:172](dashboard/src/app/actions/submit-clip-feedback.ts#L172)
- **Fix:** Delete edit/ directory entirely. Remove stale revalidatePath.
- **Depends:** Phase 2 (bundled with dead-code purge).

### 1.21 Add /settings/youtube to /channels + /settings nav
- [ ] **U-IMP** *[1h, ux]*
- **Files:** [channels/page.tsx:329-350](dashboard/src/app/channels/page.tsx#L329) (template), [settings/page.tsx:297-365](dashboard/src/app/settings/page.tsx#L297)
- **Fix:** Add "Set up YouTube" card to /channels mirroring Buffer pattern. Add YouTube row to Connected accounts on /settings.

### 1.22 Unify post-all + schedule-all wrappers behind one fanout action
- [ ] **U-IMP** *[1h, code]*
- **Why:** Same "Post all" name, different behavior (one auto-publishes site, one doesn't).
- **Files:** [schedule-all.ts:50-71](dashboard/src/app/actions/schedule-all.ts#L50), [post-all-platforms.ts:25-31](dashboard/src/app/actions/video-page/post-all-platforms.ts#L25)
- **Fix:** Decide product semantics with Yonah. Fold scheduleAll into postAllPlatforms with explicit `publishToSite` flag.

### 1.23 Analytics table mobile-overflow fix
- [ ] **U-IMP** *[1h, ux]*
- **Files:** [analytics/page.tsx:620-624,642](dashboard/src/app/analytics/page.tsx#L620)
- **Fix:** Change wrapper `overflow:'hidden'` → `overflow-x:'auto'` with `WebkitOverflowScrolling:'touch'`. Replace table with stacked card rows below 480px.

### 1.24 Consolidate Phase 2 "Starting clip plan…" duplicate shell
- [ ] **U-IMP** *[1h, ux+code]*
- **Why:** [page.tsx:325-376](dashboard/src/app/videos/[slug]/page.tsx#L325) inline-renders a server-side spinner with no realtime, no failure, no timeout — visually mimics PlanGeneratingCard.
- **Fix:** Route through PlanGeneratingCard with sentinel `jobId='pending'` OR convert to `<PlanGeneratingFallback>` client component that polls for `draftJobId` every 2s and surfaces failure after 30s.

---

## Phase 2 — Dead Code Purge (Week 2, ~1 day)

One bundled commit. Closed import islands, verified zero external importers. Reduces noise for all subsequent phases.

### 2.1 Bundle delete: ~1,500 LOC of dead editor + version-compare
- [ ] **C-IMP** *[1h, code+ux]*
- **Files to delete:** 
  - video-versions-view.tsx, version-selector.tsx, compare-view.tsx, video-feedback.tsx, regen-in-progress-banner.tsx
  - editable-clip-card.tsx, editable-clip-list.tsx, actions/update-clip-text.ts (after 0.3 collapses writer)
  - teaching-text-editor.tsx, actions/update-teaching-text.ts, actions/update-script-meta.ts
  - captions-list.tsx, actions/update-caption.ts (after 0.5 absorbs mirror)
  - publish-to-site-toggle.tsx, publish-confirm-dialog.tsx
  - components/header.tsx, cost-totals.tsx (after 1.2 wires SignOutButton)
  - components/parsha-picker.tsx, editing-help-modal.tsx
  - lib/active-version.ts, lib/health.ts, lib/dedupe-clips.ts
  - actions/submit-clip-feedback.ts, add-move-to-script.ts, generate-custom-script.ts
  - phase-3-clips.tsx + phase-3-clips-connected.tsx (after 1.5)
  - videos/[slug]/edit/ directory (after 1.20)
  - ~~components/tai-chi-move-picker.tsx~~ — **NOT zero-importer.** Imported by [compose/ai-video-panel.tsx:5,231](dashboard/src/app/compose/ai-video-panel.tsx#L5). Moved to **Phase 1.16-bis** below as a migration step (compose must migrate to MotionPickerSheet first, THEN file can be deleted in a follow-up commit).
  - components/posting-cards/tiktok-card.tsx (TikTok removed but file remains)
  - `.fab-btn`/`.fab-tooltip` CSS rules at globals.css:148-159
- **KEEP:** regen-clip-from-text.ts (still imported by phase-3-clips.tsx — verify after 1.5 lands)
- **Fix:** One commit. Run `next build` + `tsc` to catch survivors.
- **Depends:** All Phase 0 + 1.5 + 1.16 + 1.20 must land first.

---

## Phase 3 — Module Consolidation (Week 2-3, ~5 days)

The "stop the pasting" work. Each extraction kills 200-500 LOC and gives one place to fix bugs that today must be fixed N times.

### 3.1 Extract `src/supabase_client.py` → kills 30+ inline `create_client()` pairs
- [ ] **C-IMP** *[half-day, code]*
- **Files:** [modal_app.py](modal_app.py) (32 sites), tools/sync_moves_to_supabase.py, tools/rewrite_scripts.py, src/thumbnails.py
- **Fix:** Create `src/supabase_client.py` exposing `service_client()`. Replace inline calls. Drop hardcoded prod URL literals in tools/backfill_script_tldrs.py + tools/seed_supabase.py + inspect_recent_regens.mjs.

### 3.2 Extract `make_status_setter` + `make_cost_logger` + `_fail_job`
- [ ] **C-IMP** *[half-day, code]*
- **Why:** 10+ identical set_status closures (already drifted — one omits `mode` field, likely cause of stuck spinners), 8+ identical log_cost, 4 identical fail-job 60-line scaffolds. ~500 LOC.
- **Files:** modal_app.py at lines 265, 2661, 3129, 4194, 4964, 5456, 5628, 6223 (set_status); 880-940, 3015-3070, 3470-3520, 4760-4810 (fail-job)
- **Fix:** Create `src/job_status.py` with `make_status_setter(sb, job_id, mode)`, `make_cost_logger(sb, job_id)`, `_fail_job(sb, job_id, exc, tb, mode)`. Each entrypoint becomes 3 lines.

### 3.3 Extract `notify_pipeline_complete/failed` + `_prime_refs`
- [ ] **C-IMP** *[half-day, code]*
- **Files:** modal_app.py webhook sites 856, 925, 2991, 3057, 3443, 3506, 4731, 4798, 5280, 6136, 6664, 6719, 6999; char_refs/dojo_refs sites 537-538, 2804-2805, 3272-3273, 4494-4495, 5091-5092, 5817-5818, 6453-6454
- **Fix:** `src/pipeline_notify.py` + `async _prime_refs(kie)`. Bundle in one big modal_app cleanup commit with 3.1 + 3.2.

### 3.4 Migrate `tools/rewrite_scripts*.py` + `backfill_script_tldrs.py` onto `src/claude_call.py`
- [ ] **C-IMP** *[half-day, code]*
- **Files:** tools/rewrite_scripts.py:32, tools/rewrite_scripts_tight.py:32, tools/backfill_script_tldrs.py:29
- **Fix:** Replace hand-rolled Claude HTTP with `claude_call(...)`. Drop ANTHROPIC_API_KEY from tool env. Drop `anthropic>=0.40.0` from pyproject.toml. Update .env.example.

### 3.5 Consolidate 3 SOCIAL_URLS copies
- [ ] **C-IMP** *[1h, code]*
- **Files:** [website/src/lib/jsonld.ts:10-18](website/src/lib/jsonld.ts#L10), [website/src/components/SiteNav.tsx:9-19](website/src/components/SiteNav.tsx#L9), [website/src/lib/site-content.ts:117-124](website/src/lib/site-content.ts#L117)
- **Fix:** Extract server-only `website/src/lib/socials.ts`. Import from jsonld + SiteFooter. Pass to SiteNav as props from layout (client component). Delete warning comments.

### 3.6 Inline `publicVideoUrl` helper at 6 bypass sites
- [ ] **C-IMP** *[1h, code]*
- **Files:** auto-post.ts:118,122, phase-5-data.ts:146,150, edit-posted.ts:78, save-youtube-thumbnail.ts:34
- **Fix:** Replace each `supabase.storage.from('videos').getPublicUrl(p)` with `publicVideoUrl(p)`. Delete unused `publicClipUrl` export.

### 3.7 Extract `walkRegenChain` helper
- [ ] **C-IMP** *[half-day, code]*
- **Why:** 3 implementations with different depth caps (10/25/unbounded). Cron's doc claims it matches website's 25-hop bound — website actually uses 10.
- **Files:** clip-plan.ts:62-73, [api/cron/purge-old-clips/route.ts:68-93](dashboard/src/app/api/cron/purge-old-clips/route.ts#L68), [videos/[slug]/page.tsx:58-74](dashboard/src/app/videos/[slug]/page.tsx#L58)
- **Fix:** `dashboard/src/lib/regen-chain.ts` exposing `walkRegenChain(supabase, jobId, {select, stop, maxDepth})`. Pick one depth cap.

### 3.8 Cross-app shared helpers
- [ ] **C-IMP** *[half-day, code]*
- **Why:** storage-url.ts, email.ts, formatDuration, formatNumber, BOOK_SHORT all duplicated between dashboard + website. email.ts uses different env names (NOTIFY_EMAIL/EMAIL_FROM vs CONTACT_TO_EMAIL/CONTACT_FROM_EMAIL) for the same Resend account.
- **Fix:** Normalize email.ts env names on dashboard's set + extract `sendResendEmail()` helper. Move formatDuration to dashboard/src/lib/format.ts. Extract format-analytics.ts. Move BOOK_SHORT into website/src/lib/parshiot.ts. Match storage-url quote styles + add "keep in sync" comments (or set up workspace package if monorepo tooling lands).

### 3.9 Inline `_extract_last_frame` to use `src/frame_extract.py`
- [ ] **C-IMP** *[1h, code]*
- **Why:** modal_app.py duplicate uses `-sseof -0.1` with no empty-file guard while src/ version uses `-sseof -1` with explicit docstring warning. Clip-chaining invariant silently breaks if any returns empty PNG.
- **Files:** modal_app.py:1504-1534 (delete), call sites 749, 1640, 5969
- **Fix:** Delete modal_app duplicate. Import `src.frame_extract.extract_last_frame` at 3 sites. Keep `-sseof -1` (safer).

### 3.10 Refactor 3 row→Parsha mappers in website/src/lib/parshiot.ts
- [ ] **C-IMP** *[half-day, code]*
- **Files:** [website/src/lib/parshiot.ts:147-175,234-253,279-287](website/src/lib/parshiot.ts#L147)
- **Fix:** Extract `PARSHA_SELECT` constant, `mapParshaCore(row)` (always-present), `mergeParshaContent(core, videoRow, scriptRow)` (overlays). Compose in three fetchers.

### 3.11 Mirror website/src/lib/supabase/ onto dashboard layout
- [ ] **C-IMP** *[1h, code]*
- **Files:** website/src/lib/supabase.ts → website/src/lib/supabase/client.ts; rename `supabaseClient` → `createBrowserClient`
- **Fix:** Update parshiot.ts (only importer). Align with dashboard trio (client/server/service).

---

## Phase 4 — Performance Wins (Week 3-4, ~4 days)

Sequenced biggest-bang-for-buck first. Don't optimize code Phase 2 is about to delete.

### 4.1 MotionPicker poster column + Image swap
- [ ] **P-CRIT** *[half-day, perf]*
- **Win:** **10-50 MB → ~50 KB per picker open.** Eliminates autoplay decoder load on iPhone.
- **Files:** [motion-picker-sheet.tsx:116-132](dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx#L116), [tai-chi-moves.ts:19-33](dashboard/src/lib/tai-chi-moves.ts#L19), [next.config.ts](dashboard/next.config.ts)
- **Fix:** Add `thumb_poster_path` column to tai_chi_moves. One-off ffmpeg pass (`-vframes 1 -vf scale=80:-1 webp`). Replace `<video>` grid with `<Image>`; promote to `<video>` on tap/hover. Configure `next.config.ts images.remotePatterns` for Supabase host.

### 4.2 RefPicker Image swap (30 MB → 250 KB)
- [ ] **P-CRIT** *[1h, perf]*
- **Win:** **~120× byte reduction.**
- **Files:** [reference-image-picker-sheet.tsx:182-188,330-336](dashboard/src/app/videos/[slug]/_components/_shared/reference-image-picker-sheet.tsx#L182)
- **Fix:** Add Supabase host to next.config.ts remotePatterns (4.1 covers this). Swap `<img>` for `<Image width={76} height={76} sizes='76px' loading='lazy'>` (and 64×64).

### 4.3 Replace `revalidatePath('/', 'layout')` keystroke-busts
- [ ] **P-CRIT** *[half-day, perf]* ⚠️ *Reviewer-sharpened 2026-06-03*
- **Win:** Eliminates ~100ms × dozens of full-layout re-resolutions per editing session. Removes perceptible jank class while typing.
- **Files:** 16+ files under [dashboard/src/app/actions/video-page/](dashboard/src/app/actions/video-page/)
- **⚠️ Original "drop revalidate entirely" claim is WRONG for 2 of 4 listed actions.** `useRealtimeRow` only subscribes to `posts`, `clips`, `jobs`, `videos`. So:
  - **`save-script` writes `scripts`** — no listener. Dropping revalidate leaves UI stale on reload.
  - **`save-platform-caption` writes `clip_plans`** — no listener (clip_plans IS in realtime publication but the dashboard doesn't subscribe to it from these editor surfaces). Same staleness.
- **Fix (corrected):**
  - **Replace** `revalidatePath('/', 'layout')` → `revalidatePath('/videos/${parshaSlug}')` for `save-script` + `save-platform-caption` (keep narrow revalidate).
  - **Drop entirely** only for actions writing `clips`: `save-plan-clip`, `save-plan-clip-motion`, `save-plan-clip-refs` — these have `useRealtimeRows('clips')` subscribers in phase-2-plan-review.
- **Verification:** after change, type a script → reload → text is still there.

### 4.4 Add `jobs` to supabase_realtime publication
- [ ] **P-CRIT** *[1h, perf]*
- **Win:** **30-48 polls/min → ~2 polls/min per open video page.** Restores correctness of job-state advancement.
- **Files:** new migration; [use-realtime-row.ts:58](dashboard/src/hooks/use-realtime-row.ts#L58), editable-clip-* poll intervals
- **Fix:** Migration with `DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE jobs; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`. Widen poll intervals from 4-10s to 30s.
- **Memory:** `feedback_alter_publication_not_idempotent`

### 4.5 Composite index on clip_plans(job_id, created_at desc)
- [ ] **P-CRIT** *[1h, perf]*
- **Win:** Seq-scan → index scan on every /videos/[slug] render (8 callers); unblocks realtime row filtering.
- **Fix:** Migration: `create index if not exists clip_plans_job_id_created_at_idx on clip_plans(job_id, created_at desc);`

### 4.6 Composite index on jobs(parsha_id, triggered_at desc)
- [ ] **P-IMP** *[1h, perf]*
- **Fix:** `create index if not exists jobs_parsha_id_triggered_at_idx on jobs(parsha_id, triggered_at desc);`

### 4.7 Code-split 5 phase trees via next/dynamic
- [ ] **P-CRIT** *[half-day, perf]*
- **Win:** **~150-250 kB off /videos/[slug] initial JS; ~500ms-1s faster TTI on iPhone.**
- **Files:** [videos/[slug]/page.tsx:30-37](dashboard/src/app/videos/[slug]/page.tsx#L30)
- **Fix:** Replace static imports of Phase1-5Connected with `dynamic(() => import(...).then(m => m.X), {ssr: true})`. Optionally dynamic() picker sheets too.

### 4.8 Parallelize shell-data.ts (4 waves → 3)
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** **~80-160ms off every /videos/[slug] TTFB.**
- **Files:** [shell-data.ts:87,99-110,127-137,173](dashboard/src/app/videos/[slug]/_data/shell-data.ts#L87), [page.tsx:601](dashboard/src/app/videos/[slug]/page.tsx#L601)
- **Fix:** Wave 4 (posts) joins Wave 3 Promise.all via PostgREST subquery on video_id IN.

### 4.9 Extend getCanonicalClipPlan select; drop duplicate clip_plans read in Phase-5 + Live-at-Rest
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~80ms × 2 pages eliminated per render.
- **Files:** [clip-plan.ts:78-84](dashboard/src/lib/clip-plan.ts#L78), [phase-5-data.ts:77-92,99-109](dashboard/src/app/videos/[slug]/_data/phase-5-data.ts#L77), [live-at-rest-data.ts:106-126,207-219](dashboard/src/app/videos/[slug]/_data/live-at-rest-data.ts#L106)
- **Fix:** Add social_metadata + youtube_tags to getCanonicalClipPlan select. Delete Wave B blocks.

### 4.10 Drop blocking await on `refreshVideoPostUrls` in live-at-rest
- [ ] **P-IMP** *[1h, perf]*
- **Win:** 200-800ms off Live-at-Rest TTFB in post-publish refresh window.
- **Files:** [live-at-rest-data.ts:99-103](dashboard/src/app/videos/[slug]/_data/live-at-rest-data.ts#L99)
- **Fix:** Fire-and-forget; helper already writes to DB on completion. Or fold into Wave A's Promise.all.

### 4.11 useRealtimeRow narrow select + terminal-state stop
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** 70-90% per-tick payload reduction; eliminates ~30 polls/min on settled live-at-rest pages.
- **Files:** [use-realtime-row.ts:30,58](dashboard/src/hooks/use-realtime-row.ts#L30), [use-realtime-rows.ts:37,72](dashboard/src/hooks/use-realtime-rows.ts#L37)
- **Fix:** Add `select?: string` and `isTerminal?: (row) => boolean` args. Default to narrow projection. On terminal, `clearInterval + removeChannel`. Drop per-platform-card useRealtimeRow on live-at-rest — parent's useRealtimeRows already feeds children via props.

### 4.12 Phase-2: consolidate per-pending-job channels + drop blanket router.refresh poll
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** Cuts ~40 needless RSC refetches per multi-clip render.
- **Files:** [phase-2-plan-review.tsx:155-183](dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx#L155)
- **Fix:** One channel filtered by `job_id=in.(jobIdList)`. Replace `router.refresh()` with local setRows merge into useRealtimeRows clips. Bump 15s blanket poll → 60s gated on `document.visibilityState === 'visible'`.

### 4.13 Parallelize 3 sequential supabase calls on Today landing
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~80ms parallelization + ~160ms first-paint unblock.
- **Files:** [app/page.tsx:72,85,99,490,505](dashboard/src/app/page.tsx#L72)
- **Fix:** Parallelize parshiot + posts inside getLatestLiveVideo after vRow. Extract LatestLiveData server component in Suspense boundary.

### 4.14 jobs/[id]: 5 serial reads → 2 waves
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~320ms off /jobs/[id] TTFB.
- **Files:** [jobs/[id]/page.tsx:9,22,36,46,56](dashboard/src/app/jobs/[id]/page.tsx#L9)
- **Fix:** Promise.all jobs+clips+clipPlan+doneJobs; sequentially await tai_chi_moves.

### 4.15 Settings: 3 sequential → 1 parallel
- [ ] **P-IMP** *[1h, perf]*
- **Files:** [settings/page.tsx:90,97,98](dashboard/src/app/settings/page.tsx#L90)
- **Fix:** `const [defaultTierRow, usersRes, stance] = await Promise.all([...])`. ~160ms off TTFB.

### 4.16 Website: parallelize /videos page 3-backend chain + drop spoken_script/draft_text from getAllParshiot
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~200-300ms off /videos cold-regen + 100-500 KB cut from every ISR regen.
- **Files:** [website/src/app/videos/page.tsx:37,42,45](website/src/app/videos/page.tsx#L37), [website/src/lib/parshiot.ts:95-101](website/src/lib/parshiot.ts#L95)
- **Fix:** Promise.all for getAllParshiot + getSiteContent + getThisWeekParsha. Drop spoken_script/draft_text from getAllParshiot select; keep in getParshaBySlug only. Optionally getAllParshiotLite variant.

### 4.17 Website: drop duplicate getParshaBySlug in getNearbyParshiot
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~150-300ms off every public /videos/[slug] ISR regen (8→5 queries).
- **Files:** [website/src/lib/parshiot.ts:259](website/src/lib/parshiot.ts#L259), [website/src/app/videos/[slug]/page.tsx:104-105](website/src/app/videos/[slug]/page.tsx#L104)
- **Fix:** Change signature to `getNearbyParshiot(currentOrder: number)`. Pass `parsha.order` from caller. Promise.all at page level.

### 4.18 Website /videos: <img> → <Image> (30 MB → 5 MB)
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** ~400-800ms LCP improvement on slow networks.
- **Files:** [VideoCard.tsx:52-64](website/src/components/VideoCard.tsx#L52), [VideosFilter.tsx:148-163](website/src/components/VideosFilter.tsx#L148), [website/next.config.ts](website/next.config.ts)
- **Fix:** Add images.remotePatterns for Supabase + a.storyblok.com. Swap `<img>` for `<Image width={300} height={533} sizes='(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw'>`. Priority only on homepage hero.

### 4.19 SidebarNav: 'use client' → server component
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** ~15-30 kB off every authenticated page; halves /api/kie-balance traffic.
- **Files:** [sidebar-nav.tsx:1,74](dashboard/src/components/sidebar-nav.tsx#L1), [kie-balance.tsx:16-35](dashboard/src/components/kie-balance.tsx#L16), [kie-low-balance-banner.tsx:36-55](dashboard/src/components/kie-low-balance-banner.tsx#L36)
- **Fix:** Convert SidebarNav to server component; extract tiny ClientActiveLink for usePathname. Delete KieBalance duplicate poller; let sidebar consume same context.

### 4.20 Lazy-load `diff` library inside Phase 1 polish handler
- [ ] **P-IMP** *[1h, perf]*
- **Win:** ~15-25 kB off every /videos/[slug] route.
- **Files:** [phase-1-script.tsx:13,482](dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx#L13)
- **Fix:** `const { diffWords } = await import('diff');` inside handler. Inline Change type.

### 4.21 Pipeline: parallelize char/dojo/jewish ref uploads + cache immutable PNGs
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** **10-20s off every render; ~0s on warm containers.**
- **Files:** modal_app.py:537-539, 2804-2806, 4494-4496, 5091-5093, 5817-5819, 6453-6455; [_upload_dir at modal_app.py:1002-1004](modal_app.py#L1002)
- **Fix:** Replace `for img in pngs: await kie.upload_file(...)` with `await asyncio.gather(*[kie.upload_file(...) for ...])`. Wrap 3-tuple in `_upload_all_refs(kie)`. Module-level cache keyed on mtime of /root/references.

### 4.22 Pipeline: parallel x264 encodes in stitcher
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** **~30-60s shaved per 5-clip stitch.**
- **Files:** [src/stitcher.py:230-240,156-167,294-313](src/stitcher.py#L230)
- **Fix:** `concurrent.futures.ThreadPoolExecutor(max_workers=4).map(_preprocess_clip_for_concat, ...)`. Same for loudnorm_then_concat. Bonus: fold loudnorm into preprocess filter chain to kill duplicate encode pass.

### 4.23 regen_agent: 4 serial asyncio.run → 1 shared httpx + parallel ref upload
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** ~15-25s per regen_agent invocation.
- **Files:** [modal_app.py:4337,4373,4426,4439](modal_app.py#L4337), [claude_call.py:551](src/claude_call.py#L551)
- **Fix:** Wrap 4 Claude steps in one async coroutine + single asyncio.run with shared httpx.AsyncClient. Kick off ref-upload as asyncio.Task at entry, await just before Seedance fanout.

### 4.24 job-progress: cheap created_at probe before fetching plan_json
- [ ] **P-IMP** *[1h, perf]*
- **Win:** 80-95% per-poll payload reduction.
- **Files:** [job-progress.tsx:235-251](dashboard/src/components/job-progress.tsx#L235)
- **Fix:** Two-step probe: SELECT only `created_at`, compare; only refetch plan_json when newer.

### 4.25 refreshVideoPostUrls: serial loop → upsert
- [ ] **P-IMP** *[1h, perf]*
- **Win:** 200-600ms off Live-at-Rest TTFB.
- **Files:** [refresh-post-urls.ts:54-63](dashboard/src/lib/refresh-post-urls.ts#L54)
- **Fix:** Build id→url map; one `sb.from('posts').upsert(rows, {onConflict: 'id'})`. Or Promise.all individual updates.

### 4.26 Dashboard /articles/[id]/edit: dedupe mapiGetStory + wrap Storyblok reads in unstable_cache
- [ ] **P-IMP** *[half-day, perf]*
- **Win:** ~200-400ms off /articles/[id]/edit; ~80-200ms off /site-content + /settings/seo.
- **Files:** [articles/[id]/edit/page.tsx:13,27](dashboard/src/app/articles/[id]/edit/page.tsx#L13), [storyblok-server.ts:11-14](dashboard/src/lib/storyblok-server.ts#L11)
- **Fix:** Wrap mapiGetStory in `import { cache } from 'react'` for request-scoped dedup. Wrap listSiteText/getSeoDefaults/listArticles in unstable_cache with revalidateTag fired by POST routes.

---

## Phase 5 — Hardening (Week 4-5, ~3 days)

Defensive work that prevents the next class of bugs.

### 5.1 Add `dashboard/src/lib/env.ts` with `requireEnv()`
- [ ] **C-IMP** *[half-day, code]*
- **Why:** 16+ `process.env.X!` bang-asserts. Missing config → opaque 401/500 mid-request instead of clear boot error. storage-url.ts silently produces `undefined/storage/v1/...` URLs.
- **Files:** dashboard/src/lib/{storyblok,storage-url}.ts, supabase/{client,server,service}.ts; dashboard/.env.local.example, website/.env.local.example
- **Fix:** `requireEnv(name): string` throws on missing. Replace every bang-assert. Sweep both .env.local.example into parity with actual `process.env` reads (8+ undocumented vars currently). Add CI grep diffing examples vs source.

### 5.2 Lock Next 16 / React 19 stack: engines.node + .nvmrc + smoke build CI
- [ ] **C-IMP** *[half-day, code]*
- **Why:** Brand-new majors. Tailwind/@base-ui/@tiptap caret-floating. AGENTS.md warns "This is NOT the Next.js you know."
- **Fix:** Add `engines.node` to both package.json (Next 16 tested version). Add .nvmrc. CI step running `next build` for both apps against pinned matrix on every PR.

### 5.3 Audit service-role-key blast radius
- [ ] **C-IMP** *[multi-day phased, code]*
- **Why:** 44 dashboard files use createServiceClient(); most have cookie auth already.
- **Files:** [supabase/service.ts:5](dashboard/src/lib/supabase/service.ts#L5)
- **Fix (immediate, 1h):** Replace `!` with throw on missing. **(Larger):** Audit 44 callers, migrate cookie-auth ones to `createClient()` under RLS, keep service-role only for webhooks/crons.

### 5.4 Add zod at 3 trust boundaries
- [ ] **C-IMP** *[day, code]*
- **Why:** Modal→dashboard webhook, Buffer GraphQL responses, YouTube upload responses all `as Body` casts. Buffer's file documents repeated schema breakages.
- **Files:** [pipeline/video-complete/route.ts:98](dashboard/src/app/api/pipeline/video-complete/route.ts#L98), [buffer.ts:36-41](dashboard/src/lib/buffer.ts#L36)
- **Fix:** Add zod. Define Body/BufferResponse/YouTubeUploadResponse schemas. Wrap 3 call sites with `.parse()`. Promote typed `BufferRateLimitError` from String.includes('HTTP 429').

### 5.5 Pick one dashboard URL convention
- [ ] **C-IMP** *[1h, code]*
- **Files:** [api/pipeline/video-failed/route.ts:23](dashboard/src/app/api/pipeline/video-failed/route.ts#L23), [.env.local.example:36](dashboard/.env.local.example#L36), [claude.ts:38](dashboard/src/lib/claude.ts#L38)
- **Fix:** Pick `admin.torahtaichi.com` (assume that's prod CNAME). Make DASHBOARD_BASE_URL the only source. Update fallback + claude.ts HTTP-Referer + .env.local.example to match.

### 5.6 Buffer backstop: cached profile list + daily health probe
- [ ] **C-IMP** *[day, code]*
- **Files:** [buffer.ts](dashboard/src/lib/buffer.ts), [vercel.json](dashboard/vercel.json)
- **Fix:** `buffer_profiles_cache` table in Supabase. listProfiles writes through on success, falls back on GraphQL failure. New `/api/cron/buffer-health` daily ping + Resend email Yonah on 4xx.

### 5.7 Document videos.description writer lifecycle + carry-forward test
- [ ] **C-IMP** *[1h, code]*
- **Files:** modal_app.py:1450,1469-1481, save-site-fields.ts, publish-site-changes.ts, save-script-draft.ts; tests/
- **Fix:** Comment block on videos.description explaining 4-writer lifecycle. One pytest re-running `_resolve_video_title_fields` twice with synthetic prior row to pin carry-forward.

### 5.8 Soften 7 bare `except: pass` in modal_app.py
- [ ] **C-IMP** *[1h, code]*
- **Files:** modal_app.py:773-774, 898-899, 1657-1658, 2104-2105, 3035-3036, 3484-3485, 4776-4777
- **Fix:** Replace each `pass` with `log_event(sb, job_id, event='cleanup.exception', details={'stage':'<label>', 'error': str(exc)})`. `log_event` already used 35× in the file.

---

## Nits — Batchable Chore Commits

Group into 3-4 commits over the cycle. None block other work.

### Code nits (13)
- [ ] Drop unused `anthropic>=0.40.0` from pyproject.toml + ANTHROPIC_API_KEY from .env.example
- [ ] Promote `KieClient.upload_with_mime()` public + delete duplicates in tools/test_seedance_*.py
- [ ] Promote `upload_png_dir(kie, dir, *, remote_dir, priority_order)` to src/kie_client.py; replace modal_app._upload_dir + tools/generate._upload_dir_pngs + _upload_jewish_refs
- [ ] Collapse `_kie_phase` + `_openrouter_phase` in claude_call.py into one `_attempt_phase`
- [ ] Add `toDatetimeLocalString(d)` to dashboard/src/lib/utils.ts; replace duplicates in schedule-all-sheet + schedule-for-later-sheet
- [ ] Extract `OgFrame({theme,kicker,title,hebrew})` JSX into website/src/lib/og.tsx; collapse parsha + article OG routes
- [ ] Add `useShare(url, title)` hook; consolidate ShareRow + ShareButton
- [ ] Add `ogParshaUrl(slug)` + `ogArticleUrl(slug)` helpers in website/src/lib/og.ts
- [ ] Add `excerptFromParsha(p, {mode})` helper in website/src/lib/parshiot.ts
- [ ] Either share storyblok env-constants between storyblok.ts + storyblok-server.ts, or re-export mapiGetStory from storyblok.ts
- [ ] Optional website cron that revalidates / and current parsha as Storyblok-webhook backstop
- [ ] `CONFIG.md` documenting CLAUDE_PRIMARY_PROVIDER flip procedure (3 configs require sync)
- [ ] Typed `BufferRateLimitError` thrown from lib/buffer.ts; unify two platform-error-collectors at auto-post.ts:306,448

### UX nits (19)
- [ ] Sidebar `isActive` uses pathname.startsWith — highlights both /settings and /settings/seo; tighten
- [ ] Nest /settings/seo visually under Settings with indent + caret (or in-page sub-nav)
- [ ] Pick one collective noun for /articles ('Writings' is current canonical); propagate to nav, footer, eyebrow, endrail
- [ ] CompressedStepper "▾ steps" chevron renders no items — wire to phase nav or remove
- [ ] Delete dead `.fab-btn` + `.fab-tooltip` CSS from globals.css:148-159
- [ ] Drop tiktok from BUFFER_PLATFORMS + delete WatchOnRow tiktok branch + delete tiktok-card.tsx
- [ ] Add /contact to website sitemap.ts staticRoutes (or document noindex)
- [ ] Article detail eyebrow + endrail labels identical ("All writings" or "Back to writings")
- [ ] Move ShareButton hardcoded copy ('Share this essay'/'Link copied') into Storyblok
- [ ] Extract single Hero CTA component (currently duplicated for desktop + mobile)
- [ ] Move 'Play now'/'Flip back'/'Tap to read'/not-found/error copy to Storyblok keys
- [ ] Tooltip 'i' trigger 14×14 px — add 8px wrapping padding for ~30px tap target while visible circle stays 14px
- [ ] Hardcoded SOCIAL_URLS at SiteNav.tsx:14-19 → Storyblok source (covered by 3.5)
- [ ] Calendar HARDCODED_STATUS map (kedoshim/emor/behar/bechukotai/bamidbar/naso) is stale — wire to Supabase or delete
- [ ] Compose 'Generate image with AI' button label = 'Generate' but heading = 'Generate image with AI'; match
- [ ] Phase 5 back-button missing '← ' prefix (covered by 1.5)
- [ ] Centralize TERMINAL_JOB_STATUSES set (covered by 1.4)
- [ ] phase-1-script-connected.tsx:47 ?phase=2&start_plan=1&script= 6th URL shape → videoPageHref (covered by 1.12)
- [ ] Calendar H1 "Six weeks ahead" vs sidebar meta "4 ahead" — confirm one source (covered by 1.10)

### Perf nits (19)
- [ ] Composite index on posts(job_id, created_at desc) — small table today, cheap migration
- [ ] Partial index `feedback_applied_to_job_id_idx on feedback(applied_to_job_id) where applied_to_job_id is not null`
- [ ] Drop duplicate `clips_job_id_index` btree (unique(job_id, index) constraint covers it)
- [ ] Replace `getAllArticles → slice(0,2)` with `getRecentArticles(2, excludeSlug)`
- [ ] `storyblokImg(url, w, h)` helper for /m/ transforms; book cover saves ~770 KB
- [ ] Fold `extract_thumbnail` into final concat ffmpeg pass as second `-frames:v 1` output (1-3s/render)
- [ ] Merge pre-check status read + main job-row fetch at every Modal entrypoint (7 entrypoints, ~50ms each)
- [ ] Inside _fetchThisWeekParsha holiday-fallthrough, call cached `getUpcomingWeeks(1)` not inner `_fetchUpcomingWeeks(1)`
- [ ] Module-level singleton in website/src/lib/supabase.ts (anon-only safe)
- [ ] Sidebar /logo.png → static import + `<Image priority>` (PNG→AVIF saves 20-60 KB/page)
- [ ] ScheduleAllSheet + PublishConfirmDialog 720×1280 thumbs at 64-100px → `<Image>` (after 4.1 remotePatterns)
- [ ] Lift getSiteContent into RootLayout + React.cache wrapper
- [ ] phase-5-post.tsx + live-at-rest.tsx platform cards → next/dynamic gated on connectedPlatforms
- [ ] `<link rel='preload' as='image'>` for homepage hero poster + pre-render WebP in src/thumbnails.py
- [ ] Replace ffprobe ×3 per clip in src/stitcher.py with single `_probe_all(mp4)` helper
- [ ] Lazy-load tiptap in article-form.tsx via next/dynamic({ssr:false}); drop unused `marked`
- [ ] Buffer log_event inserts in Modal pipeline; flush once at end-of-job (saves ~10 round-trips/render)
- [ ] Lazy `loading='lazy' decoding='async'` band-aid on MotionPicker + RefPicker thumbnails (before full 4.1/4.2)
- [ ] /admin/events embed → two-step (videos → jobs.in → parshiot.in)

---

## Stack Verdict (from code audit)

**Stable — keep:** Supabase (Postgres + Storage + Auth + Realtime + service-role), Modal (Python pipeline runtime), Next 16.2.4 App Router + server actions, Tiptap + Base UI + Sonner, Resend via raw fetch, [src/claude_call.py](src/claude_call.py) with OpenRouter↔Kie primary/fallback (the resilience pattern other parts of the codebase should copy).

**Fragile — invest:**
- `modal_app.py` 7,128-line single file (addressed by Phase 3 extractions)
- Buffer GraphQL hand-rolled, vendor schema breakages (5.6 backstop)
- YouTube Data API v3 hand-rolled client (~775 LOC, fine today, future pain)
- Env-var contract (5.1)
- Multi-source-of-truth between two Next apps (Phase 0 + 3.5/3.8)
- Storyblok content fallbacks (nav + JSON-LD silently use hardcoded copies — covered by 3.5)

**Replace candidates (consider next time):**
- Stop accreting modal_app.py — next regen flavor, lift into `modal_app/` package via Modal's `add_local_dir`
- If a third Next app ever lands, missing `packages/shared/` becomes real cost — at that point pnpm/turbo workspaces pays for itself
- Hand-rolled YouTube client → `googleapis` library if it grows past ~1,500 LOC
- Adopt zod as project-wide validation primitive — Pydantic already sets pattern Python-side

---

## Dependencies & Sequencing Notes

*Reviewer-expanded 2026-06-03.*

- **Phase 0 before Phase 1.4** — TERMINAL_JOB_STATUSES centralization (1.4) is easier after 0.2 unifies regen-paths' overlay handling.
- **Phase 2 BEFORE Phase 1.4** *(updated)* — 1.4's file list includes 3 files Phase 2 deletes. Run Phase 2 first OR scope 1.4 to surviving files (done — see updated 1.4).
- **0.5 + Phase 2 captions-list deletion coordinate** — 0.5 deprecates `update-caption.ts` but `captions-list.tsx` still imports it. Either ship them together or keep update-caption callable until Phase 2.
- **1.16-bis before Phase 2 delete commit** — compose page must migrate off `TaiChiMovePicker` before file can be deleted.
- **1.5 before 1.9** *(1.9 dropped — moot)*
- **0.2 + 3.2 conflict zone** — both touch the same modal_app.py regen entrypoint headers. **Recommended:** bundle 0.2 with 3.2 as one cleanup commit, OR expect 3.2's line numbers to shift after 0.2 lands and re-grep at execution time.
- **0.6 migration FIRST, code SECOND** — `supabase db push` the `youtube_thumbnail_url` column migration before deploying any code that reads it. Same lesson applies to 4.5, 4.6 index migrations.
- **Phase 0 before Phase 2** — Several Phase 2 deletions depend on Phase 0 collapsing writers (0.3 collapses update-clip-text; 0.5 absorbs update-caption's mirror).
- **Phase 1 before Phase 2** — Phase 3 retirement (1.5), edit/ deletion (1.20), MotionPicker consolidation (1.16 + 1.16-bis) all unlock Phase 2 deletions.
- **Phase 2 before Phase 3** — Don't refactor code Phase 2 is about to delete. Specifically: Phase 3.1's supabase_client.py extraction should follow modal_app cleanup of dead-code blocks.
- **Phase 4.1 before 4.2 / nits** — Adding Supabase host to next.config.ts remotePatterns is shared infrastructure for all <Image> migrations.
- **Phase 4.4 before 4.11** — Adding jobs to realtime publication unlocks dropping the polling fallbacks that 4.11 narrows. Doing 4.11 first would waste effort.
- **Phase 5.1 before 5.3** — env.ts requireEnv() is the building block for the service-role fail-loud guard.

## Stability Considerations Beyond This Plan

*Added 2026-06-03. Things the three audits + adversarial review didn't surface but I (the developer responsible for the app) need to track regardless.*

### Blind spots — infrastructure & process

- [ ] **No error monitoring.** No Sentry / Logflare / DataDog. Vercel function logs are reactive only — discovered after a customer (Yonah) complains. Modal worker has zero observability beyond `execution_events`. **Action:** add Sentry to dashboard + website (free tier covers our volume) and a Modal exception hook into `execution_events.error`. Without this, the Phase 0 deploys ship to prod blind.
- [ ] **No CI gates.** Vercel auto-deploys main; `next build` happens AFTER merge, not before. A broken build ships and is only caught when the deploy fails (or worse, deploys and 500s at runtime). **Action:** GitHub Actions PR-build check that runs `next build` for dashboard + website + `python -m pytest` + `node --test src/lib/*.test.ts` before merge to main. Half-day. Should land BEFORE Phase 1 starts since most subsequent work changes shared code.
- [ ] **No staging environment.** All deploys go straight to prod. The "smoke test on staging" line in the original Phase 0 wrap-up is aspirational, not real. **Action (cheap):** create a `staging` branch on dashboard repo, configure Vercel preview deployment URLs for PRs, soak Phase 0 items on the preview URL for an hour before merging. Effectively free.
- [ ] **Supabase backup/restore — never tested.** Daily backups exist (Supabase default for paid tier) but the restore path has never been exercised. If a migration drops data, can we actually recover within 24h? **Action:** dry-run a restore to a throwaway project once a quarter. Document the runbook in `docs/RUNBOOK.md`. 2 hours quarterly.
- [ ] **Database migrations have no apply-to-prod automation.** Migrations land in `dashboard/supabase/migrations/*.sql` but who runs them in prod and when? If I forget, the code references missing columns. **Action:** either (a) wire up `supabase db push` to a GitHub Action that fires on merge-to-main for files under `supabase/migrations/`, or (b) add a checklist item to every PR template ("Did you run the migration?"). Option (a) is the right answer; ~half-day.
- [ ] **No cost budget alarms on Kie / Modal / Anthropic.** A runaway loop could burn $hundreds before anyone notices. **Action:** weekly Resend email summarizing Kie spend (Modal sandbox exposes balance via API), and a hard cap in modal_app.py that refuses to start a render if predicted-spend > N. Half-day.
- [ ] **Bus factor of one.** I'm the only person who can debug Modal. Yonah is the only operator. Neither is documented for handoff. **Action (minimal):** keep CLAUDE.md / AGENTS.md current as I work. Add a `RUNBOOK.md` for the 5 most common incidents (job stuck > 2h, Buffer 429, Kie low balance, dashboard 500, webhook drop) — what to check, how to retry. Half-day, low-priority but high-asymmetry.

### Blind spots — code

- [ ] **Webhook idempotency unaudited.** Modal calls dashboard `/api/pipeline/video-complete` and `/video-failed`. What if Vercel returns 502 — does Modal retry? Could a video appear "done" twice and trigger duplicate auto-posts? **Action:** read modal_app.py webhook caller — confirm there's retry-with-idempotency-key or accept that duplicates are possible. If possible, add a dedup check at the webhook endpoint based on `job_id + status`.
- [ ] **Cancel race conditions.** Job is in-flight on Modal, user clicks Cancel, meanwhile Modal completes successfully. What wins in `jobs.status`? Need to verify the row-level locking story (or absence thereof). **Action:** trace the cancel-path + complete-path concurrent writes; if `last-write-wins` is the current behavior, accept it OR add a status-machine guard (cancelled → terminal, no further transitions).
- [ ] **`execution_events` table grows unbounded.** No retention policy. Several writes per render × N renders/week = millions of rows over a year. Eventually slow + expensive on Supabase. **Action:** add a Vercel cron that deletes events older than 90 days. 1 hour.
- [ ] **`clip_plans` rows grow unbounded too** (the audit's purge-old-clips cron only touches `clips`). Each regen creates a new `clip_plans` row. **Action:** extend the purge cron to also delete `clip_plans` orphaned from non-canonical jobs older than 30 days. 1 hour, batchable with the prior item.
- [ ] **`?v2=1` flag is half-retired.** Some pages check it, others ignore it. Memory notes the cookie-based override that was added. If we ever want to dark-launch a Phase 0 fix behind it, the gating mechanism is brittle. **Action:** audit `?v2=1` usage — either fully retire or fully formalize as a feature-flag service (LaunchDarkly is overkill; a single `featureFlags.ts` reading env var or cookie is enough). Half-day.
- [ ] **Hebcal hardcoded to `geonameid=5128581` (New York).** If Yonah operates from Israel or the audience shifts, Shabbat times are wrong. Affects Today + Calendar pages + scheduling logic. **Action:** confirm with Yonah this is intentional; if not, parameterize via env var. 1 hour.
- [ ] **Service-role-key surface area in dashboard layout.** 44 files import `createServiceClient`. The chance one of them eventually gets accidentally invoked from a client component (which would bundle the key into the JS payload) grows with every new feature. **Action:** in addition to Phase 5.3's audit, add an ESLint rule blocking `createServiceClient` imports from any file with `'use client'`. 1 hour.
- [ ] **No regression-test protection for perf wins.** After 4.7 (code-splitting), what stops a future feature from re-adding a static import that re-bundles all 5 phases? **Action:** add a `size-limit` GitHub Action that fails the PR if the `/videos/[slug]` bundle grows >10% from baseline. 1 hour.
- [ ] **Dependency CVEs.** Next 16 + React 19 + Tiptap 3 + @base-ui 1.x are all bleeding edge. **Action:** enable Dependabot (or Renovate) with weekly grouped PRs for security-only updates. 30 min.

### Blind spots — operator experience

- [ ] **Cold-start latency on first Modal render of the day** (~5-15s slower). Yonah will think it's broken. **Action:** add a daily 6am cron that pings Modal to keep a warm container. ~1 hour. If Modal billing makes this expensive, accept the cold-start but add a UI note "Warming up — first generation of the day takes a bit longer."
- [ ] **Single-operator onboarding.** If we ever hire a second producer or hand the dashboard to someone else, the muscle memory of which-button-does-what isn't in the help docs. **Action (deferred):** record a 5-min Loom walkthrough as evergreen reference. Track as a backlog item, not in this plan.

### Discovered 2026-06-03 during Phase 0.1 execution

- [ ] **Populate `parshiot.hebrew_name` column + migrate website readers off `hebrew-names.ts`** *[half-day, code]*. Plan item 0.1 assumed the DB column was seeded — it isn't (all rows are `null`). Phase 0.1 instead corrected the 10 stale keys in `website/src/data/hebrew-names.ts` to match DB slugs (kills the immediate empty-Hebrew-name bug class). True consolidation requires: (a) one-off SQL/Python script to populate `parshiot.hebrew_name` for all 54 rows from the data file, (b) update `website/src/lib/parshiot.ts` lines 161/240/285 to read `row.hebrew_name` instead of `HEBREW_NAMES[row.slug]`, (c) replace `ALL_PARSHA_SLUGS = Object.keys(HEBREW_NAMES)` at parshiot.ts:60 with a static array derived from `PARSHA_DB_SLUGS`, (d) delete `website/src/data/hebrew-names.ts`. Track as Phase 0.5-bis or Phase 1 hardening.

### Discovered 2026-06-03 — pre-existing lint debt now visible

- [ ] **Clean up 7 dashboard + 1 website lint errors** *[half-day, code]*. The Phase -1 CI gate (`.github/workflows/pr-check.yml`) currently runs lint as `continue-on-error: true` because these errors exist and would block every PR. Errors include: `react-hooks/set-state-in-effect` (use-localstorage-draft.ts:43), `react/no-unescaped-entities` (live-site-cms-card.tsx:422), `Cannot access refs during render` (article-editor.tsx:21, live-site-cms-card.tsx:319), `Cannot call impure function during render` (phase-3-clips.tsx:246 — likely moot once Phase 3 retired by 1.5), `no-html-link-for-pages` (videos-dashboard.tsx:73). None are production bugs today but they're real React anti-patterns. Once fixed, remove `continue-on-error` from the workflow's Lint step so future regressions block PRs.

### Pre-work I want to land BEFORE Phase 0 starts

1. **Sentry on dashboard + website** (2h, infra) — so we see Phase 0 deploy errors immediately, not after a Yonah report.
2. **GitHub Actions PR-build check** (half-day, infra) — so a broken build can't land.
3. **Migration auto-apply via GitHub Actions** (half-day, infra) — so 0.6 + 4.5 + 4.6 can safely deploy.
4. **`supabase db restore` runbook** (1h, infra) — so if migration go sideways we have a tested recovery path.

These 4 items are ~1.5 days. They reduce the risk profile of every Phase 0-5 item that follows. I'd recommend doing them as Phase **-1** before any code in the plan lands.

## Item Source Index

For full audit detail on any item, find its title in:
- Code: `tasks/wxg48n8zc.output` (53 verified findings + 13 nits)
- UX: `tasks/wbcd8ztf4.output` (64 verified findings + 19 nits, plus navigationGraph)
- Perf: `tasks/wwx8y1x7i.output` (59 verified findings + 19 nits, plus topRoutesByLoadCost)

## Progress Log

Append session notes here as items are completed.

- **2026-06-03** Plan created. Code + UX + perf audits run via parallel workflows (403 total agents, 16.7M tokens). Critical Phase 0 items identified. Pre-existing fix from prior session: dashboard hebcal-slug fix (commit 65e352c) sets template for item 0.1.
