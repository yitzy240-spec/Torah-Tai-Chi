# Video page redesign — execution notes

Pre-flight orientation captured 2026-05-17 by the lead. Read this before
each milestone dispatch. Covers what already exists in the codebase so
implementing subagents don't re-discover infrastructure mid-task.

## Architecture: existing patterns to honor

- **Dashboard:** Next.js 16.2.4 App Router + React 19 + Supabase + Base
  UI. Server components by default; `'use client'` only where state /
  effects are needed.
- **Auth:** every editing action checks `auth.getUser()` first. Writes
  use `createServiceClient()` because RLS on `scripts` / `clips` /
  `jobs` only allows authed reads (not authed writes for some legacy
  tables). See `add-move-to-script.ts` for the canonical pattern.
- **Cache invalidation:** server actions call
  `revalidatePath('/', 'layout')` then `revalidatePath('/videos/' +
  parshaSlug, 'layout')`. Page-scope alone has been unreliable in N16.
- **Modal entry points:** there are SEVERAL Modal endpoints, not just
  one (`run_pipeline`, `regen_clip_from_text`, `regen_smart`,
  `regen_clip`, `regen_agent`, `regen_single_clip`,
  `pipeline-compose-video-endpoint`). Each is its own `@modal.fastapi_endpoint`
  with its own env var (`MODAL_WORKER_URL`,
  `MODAL_REGEN_CLIP_FROM_TEXT_URL`, etc.).
- **Job kinds:** `parsha` (full pipeline), `topic`, `compose`. Plus
  regen jobs that carry `regen_of_job_id`. No `plan-only` or
  `clips-only` yet.
- **Migration filenames:** convention is `YYYYMMDD_<description>.sql`,
  NOT numbered `0099_...`. Use today's date.

## Reuse opportunities (don't re-invent)

### Tai Chi moves

- **`clips.motion_ref_slug TEXT` already exists** (migration
  `20260421_clips_motion_ref_slug.sql`). The plan's Task 1.1 was edited
  to skip adding it.
- **`/api/tai-chi-moves` GET endpoint** already returns the full move
  library with `slug, english, pinyin, section, mp4_url, duration_s`.
  Authed only. Client-side picker can fetch from here; server-side
  helper (`lib/tai-chi-moves.ts`) can query the table directly.
- **`addMoveToScript(scriptId, slug, parshaSlug)` server action** is
  the existing per-script motion writer. Mirror its pattern (auth
  check, slug validation, service-role write, `revalidatePath` to both
  '/' and the parsha) when building `savePlanClipMotion(clipId, slug)`.

### Per-clip regen

- **`regen-clip-from-text.ts` server action + `regen_clip_from_text`
  Modal endpoint** already do per-clip re-rendering for an existing
  video's clip. They use `regen_of_job_id` + `feedback_clip_index`
  to identify the regen target. Idempotency guard prevents double
  re-renders for the same (parent job, clip index) pair.
- **Important:** this action sets `motion_ref_slug: parentJob.motion_ref_slug`
  on the regen job — i.e. it reads from JOB, not from CLIP. When we
  introduce per-clip motion picking via `clips.motion_ref_slug`, the
  regen Modal worker needs to read from CLIPS first (falling back to
  JOB) so the new per-clip slug takes effect. The plan's Task 1.5
  describes this resolution logic — same logic must be applied to
  `regen_clip_from_text` too, not just to the new `clips-only` job kind.
- **For Phase 3 "Re-render"** in the new clip cards: REUSE
  `regenClipFromText` instead of implementing a fresh `triggerClips`
  for individual clips. Only the bulk "Generate all" (Phase 2) and
  the per-card "Generate this clip" for a plan-only state (clip row
  exists but `storage_path` is null) need new wiring.

### Stitched-video state

- **`videos.website_caption`** is already populated/denormalized for
  the public website. The new `videos.title`/`subtitle`/`description`
  columns follow the same denorm pattern.
- **`videos.spoken_script`** is already snapshot at stitch time and
  read by the website. Pattern is established — extending it to
  title/subtitle/description is incremental, not novel.
- **`videos.parsha_id`** is already denormalized (migration
  `20260426_videos_publish_gate.sql`). Don't re-add this column.

### Existing chain-walk in the website

- **`website/src/lib/parshiot.ts`** has the chain-walk in TWO places:
  - `getAllParshiot()` (lines 119-140) — for the index page
  - `getParshaBySlug()` (lines 212-234) — for the parsha detail page
- Both walk `videos.job_id → jobs.script_id (with regen_of_job_id
  fallback, bounded depth 25)` and fall back to A-tight if anon RLS
  blocks `jobs` reads. Both sites need to be updated when
  `videos.title` snapshot lands. Same pattern of change in each.

### Buffer + auto-post

- **`autoPost(args)`** is the bulk post-to-many-platforms fanout. Reuse
  via `selectedPlatforms: [platform]` to post to ONE platform per the
  per-platform card model. No need to write a new "post one platform"
  primitive — `post-platform.ts` is essentially `autoPost` with a
  filter.
- **`createUpdate`, `listProfiles`, `getPostExternalLinks`** are the
  existing Buffer GraphQL helpers in `dashboard/src/lib/buffer.ts`.
- **YouTube** is direct via `dashboard/src/lib/youtube.ts uploadVideo()`
  — NOT through Buffer.
- **YouTube tags** are currently hardcoded `['Torah', 'Tai Chi',
  'Shorts']` at `auto-post.ts:333`. Making them editable means
  threading the value through `autoPost` from the caller.

### Connected platforms

- **`getConnectedPlatforms()`** in `dashboard/src/lib/connected-platforms.ts`
  reports which platforms are wired up. Use this to hide unconfigured
  platform cards in Phase 5.

## "What works don't break" (from kickoff doc §what works)

Preserved behaviors that must still work in the new page:

1. **Save-before-render race fix** (commit `5b0b14c`) — every regen
   action must flush pending debounced saves first. The
   `useOptimisticSave` hook needs to expose a flush mechanism, OR each
   per-clip generate button should call the save action directly
   before triggering the regen.
2. **WPS auto-extend on render** (commit `f8ecace`) — pipeline-side,
   unchanged.
3. **Live WPS indicator on textareas** (commit `5f4acc6`) — preserved
   in the new `analyzeClip` helper.
4. **Stitch-time `videos.spoken_script`** — pipeline-side, unchanged.
   Don't revert.
5. **`getCanonicalClipPlan` helper** — six call sites already use it.
   The new Phase 5 caption save MUST go through it too (per spec §11.2).
6. **Caption draft localStorage** — generalized into
   `useLocalStorageDraft` hook. Don't remove the per-caption localStorage
   keys used by the legacy page (`captions-list.tsx`) — they live on
   the legacy page and continue to work while the flag is off.
7. **Per-clip regen preserves compose picks** — handled at the data
   layer (`regen-clip-from-text.ts` line 49 comment). The new clip card
   UX doesn't change this; it just exposes a new entry point.
8. **Auto-unpublish sibling on publish** — `set-video-published.ts`
   invariant. Reused by the new Site card via the same action.

## Things that need careful inserting (not greenfield)

- **New Modal `kind`s** (`plan-only`, `clips-only`) need to be added to
  the `trigger` function's branching at `modal_app.py:112+`. Other
  `kind == "parsha"` / `"compose"` branches must continue to work.
- **`_IN_FLIGHT_STATUSES`** at `modal_app.py:84` is already the right
  set for the new kinds — both still flow through `generating_plan` →
  (for clips-only) `generating_clips` → `stitching` → `done`. No edit
  needed.
- **`run_pipeline`** at `modal_app.py:202` is where the new kinds
  branch. Likely: add an early-return after plan generation when
  `kind == "plan-only"`. Add a "skip script/plan generation, start at
  clips" branch when `kind == "clips-only"`.

## What we're NOT changing

- The character-reference / motion-reference pipeline mechanics.
- The voiceover TTS / wps-extension logic.
- The Storyblok integration.
- The website's parsha detail layout (only the data source for title
  changes, not the rendering).
- Buffer's posting flow underneath `autoPost` (only the per-platform
  caller surface changes).
- Anything in `/dashboard/src/app/jobs/[id]/page.tsx` — that's the
  technical job-detail page used to debug pipeline runs; out of scope.
- The autopilot / cron paths that post on a schedule without operator
  involvement — out of scope.

## Style + craft conventions for this redesign

- **16pt min font on inputs** — iOS auto-zooms below this.
- **44pt min hit targets** — Apple HIG; secondary "Schedule for later"
  links should be buttons sized to 44pt, not 12pt text links.
- **Bottom sheets for destructive confirms** — not modal dialogs.
- **Sticky bottom action bar** with `env(safe-area-inset-bottom)` for
  iPhone home indicator.
- **No emoji or icons in commit messages.**
- **No estimates in button labels** — costs / times live in soft
  secondary copy with explicit "estimate" framing.
- **CSS variables already defined** in `dashboard/src/app/globals.css`:
  `--ink-100/300/500/700/900`, `--linen-50/100`, `--navy-700/800`,
  `--jade`, `--tassel`, `--cedar-600`, `--ff-display`, `--ff-body`,
  `--ff-hebrew`, `--r-md`, `--r-lg`, `--shadow-page`, `--trans`. Use
  these — don't introduce new color names.
- **Animations**: `pulse-navy 1.8s ease-in-out infinite` is the
  existing in-flight pulse. Reuse for "Generating…" indicators.

## Subagent dispatch protocol (revised)

- One subagent per milestone, NOT per task.
- The subagent gets: the milestone goal, the relevant plan-task IDs,
  this EXECUTION-NOTES file (path), the spec (path), and any
  milestone-specific brief from the lead.
- The subagent commits in logical chunks (small commits ARE good)
  but doesn't pause for per-commit review.
- After the milestone, the lead does smoke-test + grep + diff glance.
- Dispatched code-review only for high-leverage milestones (M2 shared
  helpers, M5 posting cards, M7 perf). Other milestones rely on the
  lead's inline review.
- The lead resolves any cross-milestone questions inline (e.g. "should
  this hook expose a flush mechanism?") rather than re-dispatching.

## Worktree + branch

- Worktree: `c:\Users\yitzym\git\torah tai chi\.claude\worktrees\video-page-redesign`
- Branch: `worktree-video-page-redesign`
- Commits so far on this branch (most recent first):
  - `72bfeb3` feat(db): videos title/subtitle/description + clip_plans social_metadata/youtube_tags
  - `666999f` fix(tools): clean up orphan Buffer post on TikTok-publish-timeout exit path
  - `3ee656c` fix(tools): align editPost test script with plan spec
  - `812a7c7` docs(rework): add video-page-redesign spec + plan
  - `6227c28` feat(tools): editPost verification script + spec branch selection
- Forked from: `d026206` (main HEAD at the moment of worktree creation).
