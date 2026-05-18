# Video Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `dashboard/src/app/videos/[slug]/page.tsx` around a 4-state page model + 5-phase guided draft workflow, mobile-first, with "live = read-only" as a system-wide invariant. Replaces the current ~1387-line accreted page.

**Architecture:** New page is built side-by-side with the existing one. A small dispatcher at the canonical route reads a feature flag from `site_content` and renders either the old code (preserved as `page-legacy.tsx`) or the new code (`page-new.tsx`). Backend work splits the Modal pipeline into `plan-only` and `clips-only` job kinds, adds `videos.title/subtitle/description` columns to kill the anon-RLS chain-walk bug, and adds `social_metadata` + `youtube_tags` to `clip_plans` for the new Phase 5 fields. The freshness pillar is implemented via Supabase Realtime subscriptions on `jobs/clips/videos/posts` + optimistic mutation helpers + parallelized server queries with Next.js Suspense streaming. Buffer's `editPost` capability is verified up-front (§13 of the spec) and Phase 5's posted-state branches accordingly.

**Tech Stack:** Next.js 16.2.4 App Router (React 19), Supabase (Postgres + Realtime + Storage), Modal (Python pipeline), Buffer GraphQL API, YouTube Data API v3, `@base-ui/react`, Tailwind v4, `sonner` for toasts, `tsx` for one-off scripts.

**Note on testing:** The dashboard has no Jest/Vitest/Playwright config today. Adding a full test framework is out of scope. Verification per task is one of:
- **Pure logic helper** → write a small `*.test.ts` file using Node's built-in `node:test` runner (no new dependency); run via `npx tsx --test path/to/file.test.ts`.
- **React component / page** → start `npm run dev`, navigate to `/videos/<slug>?flag=...`, smoke-test by hand, capture a Playwright screenshot into `qa-screenshots/video-redesign/<task>.png`.
- **Modal pipeline change** → trigger from the dashboard against a throwaway slug, watch `/jobs/[id]` for status transitions.
- **DB migration** → `supabase db reset && supabase db push` in dev, then query the new column.

Every task ends with a commit. Smaller commits over fewer.

---

## Pre-implementation: read before starting

The engineer running this plan should read these in order to get oriented:

1. `docs/superpowers/specs/2026-05-17-video-page-redesign.md` — the spec this plan implements.
2. `docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md` — kickoff plan with the "what works don't break" list. Every preserved behavior is enumerated.
3. `dashboard/src/app/videos/[slug]/page.tsx` — the current 1387-line page. Don't memorize; understand the data fetch shape and where preserved behaviors live.
4. `dashboard/src/lib/buffer.ts`, `dashboard/src/lib/auto-post.ts`, `dashboard/src/lib/youtube.ts` — the social posting plumbing.
5. `modal_app.py` (repo root) + `src/` — the Python pipeline. Look at `_IN_FLIGHT_STATUSES` (line 84) and the existing job_kind dispatch.
6. Memories at `C:\Users\yitzym\.claude\projects\c--Users-yitzym-git-torah-tai-chi\memory\` — especially `project_yonah_operator_patterns.md`, `project_dashboard_mobile_first.md`, `project_live_state_hides_edit_controls.md`, `feedback_no_estimates_in_action_labels.md`.
7. `dashboard/AGENTS.md` — "This is NOT the Next.js you know." Heed deprecation notices in `node_modules/next/dist/docs/`.

---

## Data model rework: takes, not job-owned clip sets (critical — must adopt in this plan)

**Why this matters.** The 2026-05-17 Shavuot session surfaced a latent bug that's been dormant since chip dedupe-by-storage_path was added on 2026-05-05 (commit `9f46c5d`). Every regen inserts a full 5-row clip set, copying non-target slots from the parent verbatim under fresh `clip_id`s that reuse the parent's `storage_path`. The UI then deduplicates per path; the resulting **chip → clip_id** mapping silently diverges from the **parent_job → clip_id** mapping Modal reads on the next render. Symptom: Yonah's textbox edits save successfully but never reach Seedance, burning thousands of credits.

The bug was patched in commits `926a183` and `e9929fb` on 2026-05-17 (bind chip to latest-triggered clip_id per path; parent the regen off the edited clip_id, not the top-player video). Those keep Yonah unblocked, but they're complexity tax on a model that should never have needed any of it. This redesign **must** drop the model that requires the patch.

**Adopt instead: clip takes are first-class globally-unique entities, not job-owned copies.**

| Table | Today | New shape |
|---|---|---|
| `clips` | one row per `(job_id, slot_index)`; copy-pasted across jobs | one row per unique render. Globally identified by `id`. Carries `voiceover`, `visual_prompt`, `mp4_path`, `setting_id`, `duration_s`, `motion_ref_slug`, `produced_by_job_id`, `regen_of_clip_id`. |
| `videos` | `mp4_path` + (compose only) `composed_from_clip_ids` | every video is `takes JSONB` — ordered list of `clips.id`. Same shape for first-time renders, regens, and composes. |
| `jobs` | one job produces a full clip set + a video | `kind ∈ ('plan', 'render_take', 'stitch')`. A render produces exactly one clip row. A stitch produces one video. |

**Invariants the redesign must preserve.**

1. Editing a clip's text updates exactly one row. The same row Modal reads on the next re-render. **They cannot diverge.**
2. No copy rows. No dedupe-by-path in the UI.
3. Compose is not a special case — it's the same `stitch` operation a normal post-regen flow uses.
4. The chip list for slot N = `clips WHERE parsha_id = … AND index = N` ordered by `created_at`. Naturally complete.

**Where this lands in this plan.**

- **Task 1.1 migration** — add the schema above. Include a backfill: for each unique `storage_path` in today's `clips` table, collapse to one canonical row, choosing `voiceover`/`visual_prompt` from the row most recently updated (since Yonah's edits live on divergent rows across paths today). Drop `videos.composed_from_clip_ids`; populate `videos.takes` for every video row.
- **Phase 1 Modal changes** — rewrite `regen_clip_from_text`, `regen_single_clip`, `regen_agent`, and `compose_video` to operate on takes. Each render job produces exactly one clip row; each stitch job produces one video row referencing existing clip rows. Drop the "copy all non-target clips into the new job" pattern at `modal_app.py:5478-5496` (and the matching blocks in the other regen functions).
- **Phase 3+ frontend** — drop `seenPathPerIndex` / `pathSlotPerIndex` dedupe and `displayedClipIdByIndex` resolution in `page.tsx` and `EditableClipList`. Chips are takes; no resolution layer. `regen-clip-from-text.ts` no longer needs to plumb `clipId` because the chip's `clipId` IS the row Modal reads.

**Red flag while implementing.** If you find yourself reintroducing dedupe-by-storage_path, stop and reconsider the schema — that signals shadow rows are leaking back in. The current bug exists *because* the model forces dedupe.

**Related — first-frame chaining leak.** `regen_clip_from_text`'s first-frame chain (`modal_app.py:5368-5408`) reads `parent_clips[target_index - 1]['storage_path']` from the parent job's clip rows. When clip N-1 was regenerated by a *sibling* job (not via this regen's parent_job chain), the parent's clip N-1 row points at the *old* mp4 even though a newer take exists. Yonah hit this on 2026-05-18 Shavuot clip 4: a mountain-path first second leaked in even though the latest clip 3 take had a totally different setting. In the takes model, first-frame chaining resolves to whichever clip N-1 take the user has selected for the video being rendered (or the latest take if no video context) — no job-keyed shadow rows. Implementer must update the chain logic to look up takes, not parent_clips rows.

**Reference.** The bug this rework prevents is documented in the commit messages of `926a183` and `e9929fb` (2026-05-17). The investigation transcript that uncovered it is in chat history but the upshot is: a sub-day-of-work fix today (drop copy-rows + use takes) eliminates this entire bug class permanently.

---

## File Structure

```
dashboard/src/app/videos/[slug]/
  page.tsx                                # NEW: thin dispatcher (~30 lines)
  page-legacy.tsx                         # MOVED: today's full page, byte-for-byte
  page-new.tsx                            # NEW: the redesigned page (server component)
  _components/                            # NEW: page-scoped components
    bilingual-header.tsx
    persistent-live-strip.tsx
    compressed-stepper.tsx
    bottom-sheet.tsx
    empty-state.tsx
    phase-1-script.tsx
    phase-2-plan-review.tsx
    phase-3-clips.tsx
    phase-4-stitched.tsx
    phase-5-post.tsx
    live-at-rest.tsx
    replace-version-sheet.tsx
    draft-callout-strip.tsx
    _shared/
      motion-picker-sheet.tsx             # NEW: Tai Chi move picker (Phase 2 + 3)
    posting-cards/
      site-card.tsx
      tiktok-card.tsx
      instagram-card.tsx
      youtube-card.tsx
      facebook-card.tsx
      x-card.tsx
      _shared/
        editable-field.tsx                # 16pt textarea wrapper
        hashtag-field.tsx                 # parses #tags
        posted-summary-row.tsx            # collapsed posted-state row
        edit-on-platform-sheet.tsx        # opens editable state
        reel-or-post-toggle.tsx           # segmented control

dashboard/src/hooks/
  use-localstorage-draft.ts               # NEW: extends existing caption-draft logic to all fields
  use-optimistic-save.ts                  # NEW: instant local + bg save + revert toast
  use-realtime-row.ts                     # NEW: subscribe to a Supabase row by id
  use-realtime-rows.ts                    # NEW: subscribe to many rows by parsha id

dashboard/src/lib/
  page-state.ts                           # NEW: 4-state detection (pure)
  page-state.test.ts                      # NEW: node:test unit tests
  word-count.ts                           # NEW: wps + duration estimate
  word-count.test.ts                      # NEW: node:test unit tests
  tai-chi-moves.ts                        # NEW: listTaiChiMoves() for the picker library
  buffer.ts                               # MODIFY: thumbnail path + editPost + deletePost
  feature-flag.ts                         # NEW: reads site_content key

dashboard/src/app/actions/video-page/
  trigger-plan-only.ts                    # NEW: triggers Modal plan-only job
  trigger-clips.ts                        # NEW: triggers Modal clips-only (one or all)
  save-script.ts                          # NEW: writes scripts.draft_text
  save-plan-clip.ts                       # NEW: writes one clip row (voiceover/visual_prompt)
  save-plan-clip-motion.ts                # NEW: writes clips.motion_ref_slug (spec §6.5)
  save-platform-caption.ts                # NEW: writes captions back into clip_plans.captions
  save-social-metadata.ts                 # NEW: writes clip_plans.social_metadata + youtube_tags
  post-platform.ts                        # NEW: posts to ONE platform via Buffer/YT
  edit-posted.ts                          # NEW: Branch A (editPost) OR Branch B (delete+create)
  replace-version.ts                      # NEW: creates a fresh draft from a live version

modal_app.py                              # MODIFY: add plan-only + clips-only job_kinds + _IN_FLIGHT_STATUSES updates
src/pipeline.py (or equivalent)           # MODIFY: stop-after-plan flag + per-clip rendering

dashboard/supabase/migrations/
  0xxx_video_page_redesign.sql            # NEW: videos.{title,subtitle,description}, clip_plans.{social_metadata,youtube_tags}

tools/
  test_buffer_edit_post.ts                # NEW: editPost verification script
  test_buffer_edit_post.README.md         # NEW: how to run it safely
```

**Deletions (after migration validated):**
- `dashboard/src/app/videos/[slug]/page-legacy.tsx`
- Any components ONLY referenced from the legacy page (the new page may reuse some via the `_components/` re-imports — flagged per-task).

---

## Phase 0 — editPost verification (gates Phase 8 branch selection)

### Task 0.1: Write the editPost verification script

**Files:**
- Create: `tools/test_buffer_edit_post.ts`
- Create: `tools/test_buffer_edit_post.README.md`

- [ ] **Step 1: Create the script.**

```typescript
// tools/test_buffer_edit_post.ts
//
// Verify whether Buffer's editPost mutation works on a post that has
// ALREADY been published to a platform (not just queued/scheduled).
// Determines which branch of the video-page redesign Phase 5 ships.
//
// SAFE-USE PROTOCOL: posts to TikTok as the target platform with a
// clearly labeled test caption, sleeps ~10 minutes for publication,
// edits the caption, polls for propagation, then DELETES the post.
//
// Requires: BUFFER_ACCESS_TOKEN in .env, a TikTok channel connected.
// Cost: one TikTok post (free) visible to followers for the test window.
//
// Run: tsx tools/test_buffer_edit_post.ts

import { config } from 'dotenv';
import { createUpdate, listProfiles, getPostExternalLinks } from '../dashboard/src/lib/buffer';

config({ path: '.env' });

const BUFFER_GRAPHQL = 'https://api.buffer.com/graphql';
const ORIGINAL_TEXT = `[TEST POST — please ignore. Created ${new Date().toISOString()}]`;
const EDITED_TEXT = `[TEST POST EDITED — please ignore. Edited at ${new Date().toISOString()}]`;

async function gql<T>(token: string, query: string, variables?: object): Promise<T> {
  const res = await fetch(BUFFER_GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  if (!body.data) throw new Error('empty response');
  return body.data;
}

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
    }
  }
`;

const DELETE_POST_MUTATION = `
  mutation DeletePost($id: PostId!) {
    deletePost(input: { id: $id }) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on NotFoundError { message }
      ... on UnexpectedError { message }
    }
  }
`;

async function main() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error('BUFFER_ACCESS_TOKEN not set');

  console.log('1. Listing Buffer profiles...');
  const profiles = await listProfiles(token);
  const tiktok = profiles.find((p) => p.service === 'tiktok');
  if (!tiktok) throw new Error('No TikTok channel found');
  console.log(`   Found TikTok: ${tiktok.service_username} (${tiktok.id})`);

  console.log('2. Posting test (shareNow=true)...');
  const update = await createUpdate({
    token,
    channelId: tiktok.id,
    text: ORIGINAL_TEXT,
    // No mediaUrl — Buffer requires media for TikTok video posts. For the test
    // we'll need to point at a small public mp4. Use this Torah Tai Chi
    // published test video URL, or substitute a known small public mp4:
    mediaUrl: process.env.TEST_MP4_URL || 'https://example.com/test.mp4',
    mediaType: 'video',
    shareNow: true,
    channelService: 'tiktok',
  });
  console.log(`   Buffer post id: ${update.id}, status: ${update.status}`);

  console.log('3. Waiting 10 minutes for TikTok publication...');
  await new Promise((r) => setTimeout(r, 10 * 60 * 1000));

  console.log('4. Confirming published-to-TikTok via externalLink...');
  const links = await getPostExternalLinks(token, [update.id]);
  if (!links[update.id]) {
    console.error(`   externalLink not resolved — TikTok may still be processing. Aborting.`);
    process.exit(2);
  }
  console.log(`   Live at: ${links[update.id]}`);

  console.log('5. Calling editPost with new text...');
  try {
    const editResult = await gql<{ editPost: { __typename: string; message?: string; post?: { id: string; status: string } } }>(
      token,
      EDIT_POST_MUTATION,
      { input: { id: update.id, text: EDITED_TEXT } },
    );
    if (editResult.editPost.__typename === 'PostActionSuccess') {
      console.log(`   editPost SUCCEEDED. New status: ${editResult.editPost.post?.status}`);
      console.log('6. Waiting 5 minutes for TikTok propagation, then check manually at:', links[update.id]);
      await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
      console.log('   MANUAL CHECK REQUIRED: open the URL above. Does the caption show EDITED text?');
      console.log('   If YES → Branch A (editPost works post-publish).');
      console.log('   If NO  → Branch B (editPost rejected silently or only updated Buffer-side).');
    } else {
      console.log(`   editPost FAILED: ${editResult.editPost.__typename}: ${editResult.editPost.message ?? '(no message)'}`);
      console.log('   → Branch B (editPost rejected by Buffer for published posts).');
    }
  } catch (e) {
    console.log(`   editPost THREW: ${(e as Error).message}`);
    console.log('   → Branch B (editPost not available for this post type).');
  }

  console.log('7. Cleaning up: deleting test post...');
  try {
    const del = await gql<{ deletePost: { __typename: string; message?: string } }>(
      token,
      DELETE_POST_MUTATION,
      { id: update.id },
    );
    console.log(`   deletePost result: ${del.deletePost.__typename}`);
  } catch (e) {
    console.warn(`   deletePost failed — clean up manually in Buffer dashboard. Error: ${(e as Error).message}`);
  }

  console.log('\nDone. Record the result in docs/superpowers/specs/2026-05-17-video-page-redesign.md §13.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Create the README.**

```markdown
<!-- tools/test_buffer_edit_post.README.md -->

# editPost verification

Determines whether Buffer's `editPost` mutation works on posts that have
already been published to TikTok / Instagram / Facebook / X.

## Prerequisites

- `BUFFER_ACCESS_TOKEN` in `.env` (already present in dev)
- TikTok channel connected in Buffer
- `TEST_MP4_URL` in `.env` pointing at a small public mp4 (use any
  already-published Torah Tai Chi video URL, e.g. from
  `https://<supabase>.supabase.co/storage/v1/object/public/videos/...`)

## Run

```bash
tsx tools/test_buffer_edit_post.ts
```

Takes ~15 minutes (10min wait for TikTok publication, 5min for edit
propagation). Posts a clearly labeled `[TEST POST — please ignore]`
to TikTok during the test window; deletes after the test.

## Recording the result

Update `docs/superpowers/specs/2026-05-17-video-page-redesign.md` §13:

- Branch A: "editPost verified on TikTok — propagates within 5min" + date
- Branch B: "editPost rejected on TikTok — Branch B canonical" + date + Buffer's error code if any

Branch selection determines whether `dashboard/src/app/actions/video-page/edit-posted.ts`
calls `editPost` (Branch A) or `deletePost` + `createPost` (Branch B).

## Repeat for Instagram + Facebook

After TikTok, change `tiktok` → `instagram` then `facebook` in the
script's `find()` call, re-run. The action handler can be per-platform
if behavior differs.
```

- [ ] **Step 3: Run the script. Wait. Record the result.**

```bash
tsx tools/test_buffer_edit_post.ts
```

Expected runtime: ~15 minutes. Manual check at step 6 (visit the TikTok URL).

- [ ] **Step 4: Update the spec § 13 with the result.**

Edit `docs/superpowers/specs/2026-05-17-video-page-redesign.md` §13 to declare the canonical branch.

- [ ] **Step 5: Commit.**

```bash
git add tools/test_buffer_edit_post.ts tools/test_buffer_edit_post.README.md docs/superpowers/specs/2026-05-17-video-page-redesign.md
git commit -m "feat(tools): editPost verification script + spec branch selection"
```

---

## Phase 1 — Backend prep

### Task 1.1: Add `videos.title/subtitle/description` columns

**Files:**
- Create: `dashboard/supabase/migrations/0099_video_page_redesign.sql` (use the next available migration number)

- [ ] **Step 1: Write the migration.**

```sql
-- Snapshot title fields onto videos at stitch time. Kills the anon-RLS
-- chain-walk problem (kickoff doc bug 7) and is the source of truth for
-- the website's parsha page. Phase 5 Site card writes these directly.

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Per-platform structured data added during the Phase 5 redesign.
-- captions stays as today (flat string per platform) and continues to
-- be canonical for Buffer's text field; social_metadata holds the new
-- per-platform extras (Reel/Post type, firstComment) and youtube_tags
-- replaces the hardcoded ['Torah','Tai Chi','Shorts'] in auto-post.ts.

ALTER TABLE clip_plans
  ADD COLUMN IF NOT EXISTS social_metadata JSONB,
  ADD COLUMN IF NOT EXISTS youtube_tags TEXT[];

-- Per-clip Tai Chi move assignment (spec §6.5, §11.7). Per-clip rather
-- than per-script lets Yonah pick which specific clips get which moves;
-- the AI does NOT auto-suggest. clips-only rendering reads this first,
-- falling back to scripts.motion_ref_slug for legacy plans.
ALTER TABLE clips
  ADD COLUMN IF NOT EXISTS motion_ref_slug TEXT;

COMMENT ON COLUMN videos.title IS
  'Title shown on torahtaichi.com. Snapshotted from scripts.title at stitch time so the website does not have to walk videos.job_id -> jobs.script_id (anon RLS blocks that).';
COMMENT ON COLUMN clip_plans.social_metadata IS
  'Per-platform metadata. Shape: {instagram?: {type: "reel"|"post", firstComment?: string}, facebook?: {type, firstComment?}}.';
COMMENT ON COLUMN clip_plans.youtube_tags IS
  'YouTube tags array. Replaces hardcoded [Torah, Tai Chi, Shorts] in lib/auto-post.ts. Empty array = no tags.';
COMMENT ON COLUMN clips.motion_ref_slug IS
  'Per-clip Tai Chi move (references tai_chi_moves.slug). NULL = no move on this clip. Set by the operator via the Phase 2/3 picker; falls back to scripts.motion_ref_slug in clips-only for legacy plans.';
```

- [ ] **Step 2: Apply the migration locally.**

```bash
cd dashboard
supabase db push
```

Expected: migration runs cleanly. Verify with `supabase db diff --schema public` showing no remaining drift.

- [ ] **Step 3: Verify columns exist.**

```bash
supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='videos' AND column_name IN ('title','subtitle','description');"
```

Expected output: 3 rows.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/supabase/migrations/0099_video_page_redesign.sql
git commit -m "feat(db): add videos title/subtitle/description + clip_plans social_metadata/youtube_tags"
```

### Task 1.2: Populate `videos.title` at stitch time + update the website to read it

**Files:**
- Modify: `dashboard/src/lib/parsha-website.ts` (or wherever `getParshaBySlug` lives — search for the function)
- Modify: `modal_app.py` or the stitch step in `src/` that creates the videos row

- [ ] **Step 1: Find the existing stitch-time video insert.**

```bash
grep -rn "insert.*videos" dashboard/src --include="*.ts"
grep -rn "videos.*insert\|videos\[\"insert\"" modal_app.py src/
```

Expected: locate where `videos` rows are created (likely in a `compose-video.ts` action or in the stitch step of the Python pipeline).

- [ ] **Step 2: At that insert site, also write `title`, `subtitle`, `description` from the chosen script.**

The chosen script for a stitch is identified by `jobs.script_id`. Fetch `scripts.title` (subtitle), and for the title/description the spec says use parsha name + sub-title. Implementation:

```typescript
// In the stitch action (TypeScript):
const { data: script } = await supabase
  .from('scripts')
  .select('title, tldr')
  .eq('id', job.script_id)
  .single();
const { data: parsha } = await supabase
  .from('parshiot')
  .select('name')
  .eq('id', job.parsha_id)
  .single();

await supabase.from('videos').insert({
  // ... existing fields ...
  title: parsha?.name ?? null,        // "Bamidbar."
  subtitle: script?.title ?? null,    // "In the desert, counted as one."
  description: script?.tldr ?? null,
});
```

If the insert happens in Python, mirror the same lookup + assignment via the Supabase Python client.

- [ ] **Step 3: Update `getParshaBySlug` (or equivalent website-side reader) to use `videos.title/subtitle/description` directly, removing the `videos.job_id → jobs.script_id` walk.**

```bash
grep -n "getParshaBySlug\|jobs.script_id" website/src/ dashboard/src/lib/ --include="*.ts"
```

In the reader, replace the chain walk with:

```typescript
const { data: video } = await supabase
  .from('videos')
  .select('mp4_path, thumb_path, title, subtitle, description, post_urls')
  .eq('id', publishedVideoId)
  .single();

return {
  title: video.title ?? parsha.name,       // fallback for old rows
  subtitle: video.subtitle ?? null,
  description: video.description ?? null,
  // ... rest unchanged
};
```

- [ ] **Step 4: Backfill existing videos rows so the website doesn't break for already-live content.**

```sql
-- One-off in Supabase SQL editor. Walks the legacy chain for existing rows,
-- writing the snapshot. Safe to run multiple times (only updates NULL rows).

UPDATE videos v
SET
  title    = COALESCE(v.title,    p.name),
  subtitle = COALESCE(v.subtitle, s.title),
  description = COALESCE(v.description, s.tldr)
FROM jobs j
JOIN parshiot p ON p.id = j.parsha_id
LEFT JOIN scripts s ON s.id = j.script_id
WHERE v.job_id = j.id
  AND (v.title IS NULL OR v.subtitle IS NULL OR v.description IS NULL);
```

- [ ] **Step 5: Verify website still renders existing parshiot.**

Start the website locally (`cd website && npm run dev`), visit one published parsha (e.g. `/bamidbar`), confirm title + subtitle render correctly.

Capture screenshot to `qa-screenshots/video-redesign/01-website-after-title-snapshot.png`.

- [ ] **Step 6: Commit.**

```bash
git add dashboard/src/ website/src/ modal_app.py
git commit -m "feat(stitch): snapshot videos.title/subtitle/description; website reads directly (kills anon-RLS chain walk)"
```

### Task 1.3: Buffer thumbnail path bugfix

**Files:**
- Modify: `dashboard/src/lib/buffer.ts` (around lines 191-200)

- [ ] **Step 1: Update the assets shape to the new schema (`assets[i].video.thumbnailUrl`).**

```typescript
// Replace the existing assets block in createUpdate():
const assets = a.mediaUrl
  ? a.mediaType === 'image'
    ? [{ image: { url: a.mediaUrl } }]
    : [{
        video: {
          url: a.mediaUrl,
          ...(a.thumbnailUrl ? { thumbnailUrl: a.thumbnailUrl } : {}),
        },
      }]
  : undefined;
```

Note: the schema also changed from a single object (`{videos: [...]}`) to an array (`[{video: ...}, {image: ...}, ...]`). Verify the change by reading the latest Buffer docs at `https://developers.buffer.com/types/CreatePostInput.html` if any field shape is unclear.

- [ ] **Step 2: Smoke-test by posting a video to TikTok via the dashboard.**

```bash
cd dashboard && npm run dev
```

Open `/videos/<an-existing-test-parsha>`, hit "Schedule all" or the test slack channel post action. Confirm the post creates without error (check `posts` table for status=`scheduled` or `published`).

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/lib/buffer.ts
git commit -m "fix(buffer): update assets path to assets[].video.thumbnailUrl per May 2026 schema"
```

### Task 1.4: Modal pipeline — add `plan-only` job kind

**Files:**
- Modify: `modal_app.py`
- Modify: `src/pipeline.py` (or whichever module orchestrates the stages — confirm by reading `modal_app.py`'s call site)

- [ ] **Step 1: Read the existing job_kind dispatch in `modal_app.py`.**

```bash
grep -n "job_kind\|kind ==\|kind=" modal_app.py
```

- [ ] **Step 2: Add `plan-only` to the job kind enum and dispatch.**

In `modal_app.py`, find the existing kind dispatch (likely an `if kind == 'parsha'` / `elif kind == 'compose'` block in the trigger function). Add:

```python
elif kind == "plan-only":
    # New for video-page redesign Phase 2. Runs script → clip_plan, then
    # exits as 'done' without rendering clips. The dashboard then lets
    # the operator review the plan before triggering clip rendering.
    job_id = await _run_plan_only_for_parsha(parsha_id=parsha_id, script_id=script_id)
    return {"job_id": job_id}
```

Add the supporting function (mirrors `_run_parsha_pipeline` but stops after `generate_plan`):

```python
async def _run_plan_only_for_parsha(parsha_id: str, script_id: str) -> str:
    """Generate the clip_plan only; do NOT render clips. New for the
    Phase 2 review checkpoint in the video page redesign.

    Inserts one clips row per planned clip with voiceover / visual_prompt
    / duration_s populated; motion_ref_slug is intentionally left NULL
    (spec §6.5: AI does not suggest moves; Yonah picks per-clip in the
    Phase 2 review)."""
    sb = _supabase()
    job_id = _create_job_row(sb, parsha_id=parsha_id, script_id=script_id, kind="plan-only")
    try:
        _set_job_status(sb, job_id, "generating_plan")
        plan = await _generate_clip_plan_via_kie(parsha_id, script_id)
        cp_id = sb.table("clip_plans").insert({"job_id": job_id, "plan_json": plan}).execute().data[0]["id"]
        # Insert one clips row per planned clip so the Phase 2 UI has
        # rows to bind to immediately (motion picker, voiceover edits,
        # per-card Generate button all key off clips.id).
        clip_rows = [
            {
                "job_id": job_id,
                "index": c["index"],
                "voiceover": c.get("voiceover", ""),
                "visual_prompt": c.get("visual_prompt", ""),
                "duration_s": c.get("duration_s"),
                "motion_ref_slug": None,
            }
            for c in plan.get("clips", [])
        ]
        if clip_rows:
            sb.table("clips").insert(clip_rows).execute()
        _set_job_status(sb, job_id, "done")
    except Exception as e:
        _set_job_status(sb, job_id, "failed", status_message=str(e))
        raise
    return job_id
```

Refer to existing `_run_parsha_pipeline` for exact `_create_job_row` / `_set_job_status` / `_generate_clip_plan_via_kie` signatures (these are illustrative names — use whatever's already in `modal_app.py`).

- [ ] **Step 3: Update `_IN_FLIGHT_STATUSES` if needed.**

```python
# modal_app.py line ~84
_IN_FLIGHT_STATUSES = frozenset({
    "loading_parsha", "generating_plan", "uploading_refs",
    "generating_clips", "verifying", "stitching",
})
```

`plan-only` jobs only use `generating_plan`, which is already in the set. No change required — verify by reading the file.

- [ ] **Step 4: Deploy to Modal dev.**

```bash
modal deploy modal_app.py
```

Expected: deploy succeeds, the new function appears in Modal's dashboard.

- [ ] **Step 5: Smoke-test from a Python REPL or a small script.**

```python
# Trigger a plan-only job via the Modal endpoint (mirror existing kind=parsha call):
import httpx, os
r = httpx.post(
    os.environ["MODAL_WORKER_URL"],
    headers={"x-shared-secret": os.environ["PIPELINE_SHARED_SECRET"]},
    json={"kind": "plan-only", "parsha_id": "<test-parsha-uuid>", "script_id": "<test-script-uuid>"},
)
print(r.json())
```

Watch the job in Supabase: `select * from jobs where kind='plan-only' order by triggered_at desc limit 1;`. Status should transition `queued → generating_plan → done` without entering `generating_clips`. A `clip_plans` row should be created.

- [ ] **Step 6: Commit.**

```bash
git add modal_app.py src/
git commit -m "feat(modal): add plan-only job kind for Phase 2 review checkpoint"
```

### Task 1.5: Modal pipeline — add `clips-only` job kind

**Files:**
- Modify: `modal_app.py`
- Modify: `src/pipeline.py` (same module as Task 1.4)

- [ ] **Step 1: Add `clips-only` to the job kind dispatch.**

In `modal_app.py`:

```python
elif kind == "clips-only":
    # New for video-page redesign Phase 3. Renders clips for an
    # existing clip_plan. clip_indexes is optional: omit to render all,
    # provide a list to render a subset (single-clip re-render).
    job_id = await _run_clips_only_for_plan(
        clip_plan_id=clip_plan_id,
        clip_indexes=clip_indexes,
    )
    return {"job_id": job_id}
```

- [ ] **Step 2: Implement the supporting function.**

```python
async def _run_clips_only_for_plan(
    clip_plan_id: str,
    clip_indexes: list[int] | None,
) -> str:
    """Render clips for an existing clip_plan. clip_indexes=None renders
    all; a list renders only those indexes (single-clip re-render path).

    Per-clip motion-ref resolution (spec §6.5, §11.7):
    For each clip, motion_ref_slug = clips.motion_ref_slug (operator's
    pick) if set; else scripts.motion_ref_slug (legacy fallback for
    plans created before the redesign); else None (no motion passed
    to Seedance)."""
    sb = _supabase()
    plan_row = sb.table("clip_plans").select("plan_json, job_id").eq("id", clip_plan_id).single().execute().data
    parent_job = sb.table("jobs").select("parsha_id, script_id, resolution, model_tier").eq("id", plan_row["job_id"]).single().execute().data
    parent_script = sb.table("scripts").select("motion_ref_slug").eq("id", parent_job["script_id"]).single().execute().data or {}
    legacy_motion = parent_script.get("motion_ref_slug")

    job_id = _create_job_row(sb, parsha_id=parent_job["parsha_id"], script_id=parent_job["script_id"], kind="clips-only", regen_of_job_id=plan_row["job_id"])
    try:
        _set_job_status(sb, job_id, "generating_clips")
        plan = plan_row["plan_json"]
        target_planned = plan["clips"] if clip_indexes is None else [c for c in plan["clips"] if c.get("index") in clip_indexes]

        # Load per-clip motion_ref_slug for the targeted clips so each render
        # can apply the operator's pick (or the legacy fallback).
        target_indexes = [c["index"] for c in target_planned]
        clip_rows = sb.table("clips").select("index, motion_ref_slug").eq("job_id", plan_row["job_id"]).in_("index", target_indexes).execute().data
        motion_by_index = {r["index"]: (r.get("motion_ref_slug") or legacy_motion) for r in clip_rows}

        # Decorate each targeted clip with its resolved motion_ref_slug
        # so _render_clips_via_kie applies the right one per call.
        target = [{**c, "motion_ref_slug": motion_by_index.get(c["index"])} for c in target_planned]

        await _render_clips_via_kie(job_id=job_id, clips=target, params=parent_job)
        _set_job_status(sb, job_id, "stitching")
        await _stitch_clips(job_id=job_id, all_clip_indexes=[c["index"] for c in plan["clips"]])
        _set_job_status(sb, job_id, "done")
    except Exception as e:
        _set_job_status(sb, job_id, "failed", status_message=str(e))
        raise
    return job_id
```

`_render_clips_via_kie` should be updated to read `c["motion_ref_slug"]` per clip and call `_load_selected_move(sb, slug)` (existing helper, modal_app.py line 45) for the resolved slug; the loaded move's mp4_url is passed to Seedance as the motion reference. Where `motion_ref_slug` is `None`, no motion reference is passed.

- [ ] **Step 3: Deploy + smoke-test.**

```bash
modal deploy modal_app.py
```

Trigger via the test script analogous to Task 1.4, with `kind=clips-only` and a valid `clip_plan_id`. Confirm clips are rendered into Storage and a video row is created.

- [ ] **Step 4: Commit.**

```bash
git add modal_app.py src/
git commit -m "feat(modal): add clips-only job kind for Phase 3 per-clip rendering"
```

### Task 1.6: Enable Supabase Realtime on the relevant tables

**Files:**
- Modify or create: `dashboard/supabase/migrations/0100_realtime_publication.sql`

- [ ] **Step 1: Check current Realtime publication.**

```bash
supabase db query "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';"
```

Expected: shows current tables. `jobs` is likely already in the list (per the existing job-progress component).

- [ ] **Step 2: Add the missing tables.**

```sql
-- 0100_realtime_publication.sql
ALTER PUBLICATION supabase_realtime ADD TABLE clips;
ALTER PUBLICATION supabase_realtime ADD TABLE videos;
ALTER PUBLICATION supabase_realtime ADD TABLE posts;
ALTER PUBLICATION supabase_realtime ADD TABLE clip_plans;
```

(Adjust the list to only include tables NOT already in the publication, per step 1's output.)

- [ ] **Step 3: Apply and verify.**

```bash
supabase db push
supabase db query "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';"
```

Expected: all 4 tables present.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/supabase/migrations/0100_realtime_publication.sql
git commit -m "feat(db): enable Realtime on clips/videos/posts/clip_plans for live page updates"
```

---

## Phase 2 — Feature flag + dispatcher

### Task 2.1: Rename current page to `page-legacy.tsx`

**Files:**
- Move: `dashboard/src/app/videos/[slug]/page.tsx` → `dashboard/src/app/videos/[slug]/page-legacy.tsx`

- [ ] **Step 1: Git-move the file.**

```bash
git mv dashboard/src/app/videos/[slug]/page.tsx dashboard/src/app/videos/[slug]/page-legacy.tsx
```

- [ ] **Step 2: Rename the exported default function inside the file.**

In `page-legacy.tsx`, change:

```typescript
export default async function VideoDetailPage({ params, searchParams }: PageProps) {
```

to:

```typescript
export default async function VideoDetailPageLegacy({ params, searchParams }: PageProps) {
```

Also export it as a named export for the dispatcher:

```typescript
export { VideoDetailPageLegacy };
// Keep the default export too, since Next still uses it if rendered directly.
```

- [ ] **Step 3: Verify the dev server still serves /videos/<slug> via Next.js's file convention. (At this moment Next will complain there's no page.tsx — that's expected, Task 2.3 fixes it.)**

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/
git commit -m "refactor(video-page): rename existing page to page-legacy.tsx (preserve byte-for-byte)"
```

### Task 2.2: Create the feature flag helper

**Files:**
- Create: `dashboard/src/lib/feature-flag.ts`

- [ ] **Step 1: Write the helper.**

```typescript
// dashboard/src/lib/feature-flag.ts
//
// Tiny feature-flag reader. Flags live in the site_content table as
// rows with key='settings.<flag_name>' and a JSON value. For the
// video-page redesign rollout, the flag is 'settings.video_page_v2'
// with value true/false. Add new flags by writing a new row, no schema
// change needed.

import { createClient } from '@/lib/supabase/server';

export async function getFlag(name: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_content')
    .select('value')
    .eq('key', `settings.${name}`)
    .maybeSingle();
  return data?.value === true || data?.value === 'true';
}
```

- [ ] **Step 2: Seed the flag in dev.**

```sql
INSERT INTO site_content (key, value) VALUES ('settings.video_page_v2', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Run via `supabase db query` or the Supabase dashboard SQL editor.

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/lib/feature-flag.ts
git commit -m "feat(flag): site_content-backed feature-flag reader for video_page_v2 rollout"
```

### Task 2.3: Create the dispatcher `page.tsx`

**Files:**
- Create: `dashboard/src/app/videos/[slug]/page.tsx`
- Create: `dashboard/src/app/videos/[slug]/page-new.tsx` (stub for now; filled in later phases)

- [ ] **Step 1: Create a stub `page-new.tsx` that renders "new page placeholder" so the dispatcher has something to call.**

```typescript
// dashboard/src/app/videos/[slug]/page-new.tsx
interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VideoDetailPageNew({ params }: PageProps) {
  const { slug } = await params;
  return (
    <div style={{ padding: 24 }}>
      <h1>New video page (work in progress)</h1>
      <p>Parsha slug: {slug}</p>
    </div>
  );
}
```

- [ ] **Step 2: Create the dispatcher.**

```typescript
// dashboard/src/app/videos/[slug]/page.tsx
import { getFlag } from '@/lib/feature-flag';
import VideoDetailPageLegacy from './page-legacy';
import VideoDetailPageNew from './page-new';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VideoDetailPage(props: PageProps) {
  // settings.video_page_v2 is the rollout flag. Default true once seeded;
  // unset = legacy. Allow ?v2=0 / ?v2=1 query override for side-by-side
  // testing without flipping the flag globally.
  const sp = await props.searchParams;
  const override = typeof sp.v2 === 'string' ? sp.v2 : null;
  const useNew = override === '1' ? true : override === '0' ? false : await getFlag('video_page_v2');
  return useNew ? <VideoDetailPageNew {...props} /> : <VideoDetailPageLegacy {...props} />;
}
```

- [ ] **Step 3: Smoke-test.**

```bash
cd dashboard && npm run dev
```

Visit `/videos/<slug>` (uses flag), `/videos/<slug>?v2=1` (forces new), `/videos/<slug>?v2=0` (forces legacy). Confirm each renders correctly.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/page.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): flag-gated dispatcher; ?v2=1 override for testing"
```

---

## Phase 3 — Shared helpers, hooks, and chrome

### Task 3.1: Page-state detection (pure logic)

**Files:**
- Create: `dashboard/src/lib/page-state.ts`
- Create: `dashboard/src/lib/page-state.test.ts`

- [ ] **Step 1: Write the function.**

```typescript
// dashboard/src/lib/page-state.ts
//
// Determines which of the 4 top-level states the page is in for a parsha.
// See spec §3 for the state model and selection rules.

export type PageState =
  | { kind: 'empty' }
  | { kind: 'draft-in-progress'; draftJobId: string; phase: DraftPhase }
  | { kind: 'live-at-rest'; liveVideoId: string }
  | { kind: 'live-and-draft'; liveVideoId: string; draftJobId: string; phase: DraftPhase };

export type DraftPhase = 1 | 2 | 3 | 4 | 5;

export interface PageStateInput {
  jobs: Array<{
    id: string;
    status: string;
    kind: string | null;
    videoId: string | null;
    clipPlanId: string | null;
    completedAt: string | null;
    triggeredAt: string;
  }>;
  videos: Array<{ id: string; jobId: string; publishedToWebsite: boolean }>;
  posts: Array<{ videoId: string; status: string }>;
  clipsByJobId: Record<string, Array<{ storagePath: string | null }>>;
}

const IN_FLIGHT = new Set(['queued', 'loading_parsha', 'generating_plan', 'uploading_refs', 'generating_clips', 'verifying', 'stitching']);

export function selectPageState(input: PageStateInput): PageState {
  const { jobs, videos, posts, clipsByJobId } = input;

  // A live video = published to website OR has at least one published post.
  const liveVideo = videos.find((v) => {
    if (v.publishedToWebsite) return true;
    return posts.some((p) => p.videoId === v.id && p.status === 'published');
  });

  // A draft = any in-flight job, OR a done plan-only job whose chain hasn't
  // produced a stitched-and-published video.
  const inFlightJob = jobs.find((j) => IN_FLIGHT.has(j.status));
  const planOnlyAwaiting = jobs.find(
    (j) => j.kind === 'plan-only' && j.status === 'done' && !j.videoId,
  );
  const draftJob = inFlightJob ?? planOnlyAwaiting;

  if (!liveVideo && !draftJob) return { kind: 'empty' };

  if (draftJob) {
    const phase = phaseFor(draftJob, clipsByJobId[draftJob.id] ?? []);
    if (liveVideo) {
      return { kind: 'live-and-draft', liveVideoId: liveVideo.id, draftJobId: draftJob.id, phase };
    }
    return { kind: 'draft-in-progress', draftJobId: draftJob.id, phase };
  }

  return { kind: 'live-at-rest', liveVideoId: liveVideo!.id };
}

function phaseFor(job: { status: string; videoId: string | null }, clips: Array<{ storagePath: string | null }>): DraftPhase {
  if (job.videoId) return 4; // Stitched video exists
  if (clips.length > 0 && clips.some((c) => c.storagePath)) return 3; // Some clips rendered
  if (job.status === 'done' || ['generating_clips', 'verifying', 'stitching'].includes(job.status)) return 2; // Plan exists (or being acted on)
  return 1; // Script only
}
```

- [ ] **Step 2: Write the unit tests.**

```typescript
// dashboard/src/lib/page-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPageState } from './page-state';

const base = { jobs: [], videos: [], posts: [], clipsByJobId: {} };

test('empty: no jobs, no videos -> empty', () => {
  const s = selectPageState(base);
  assert.deepEqual(s, { kind: 'empty' });
});

test('draft-in-progress: in-flight job, no live video -> draft', () => {
  const s = selectPageState({
    ...base,
    jobs: [{ id: 'j1', status: 'generating_clips', kind: 'parsha', videoId: null, clipPlanId: 'cp1', completedAt: null, triggeredAt: '2026-05-17T00:00:00Z' }],
    clipsByJobId: { j1: [{ storagePath: '/clips/0.mp4' }] },
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 3);
});

test('live-at-rest: published video, no draft -> live-at-rest', () => {
  const s = selectPageState({
    ...base,
    jobs: [{ id: 'j1', status: 'done', kind: 'parsha', videoId: 'v1', clipPlanId: 'cp1', completedAt: '2026-05-17T01:00:00Z', triggeredAt: '2026-05-17T00:00:00Z' }],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: true }],
  });
  assert.deepEqual(s, { kind: 'live-at-rest', liveVideoId: 'v1' });
});

test('live-and-draft: published video AND a new in-flight job -> live-and-draft', () => {
  const s = selectPageState({
    ...base,
    jobs: [
      { id: 'j1', status: 'done', kind: 'parsha', videoId: 'v1', clipPlanId: 'cp1', completedAt: '2026-05-17T01:00:00Z', triggeredAt: '2026-05-17T00:00:00Z' },
      { id: 'j2', status: 'generating_plan', kind: 'parsha', videoId: null, clipPlanId: null, completedAt: null, triggeredAt: '2026-05-17T02:00:00Z' },
    ],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: true }],
  });
  assert.equal(s.kind, 'live-and-draft');
});

test('phase 4 when draft has a stitched video but no live row yet', () => {
  const s = selectPageState({
    ...base,
    jobs: [{ id: 'j1', status: 'done', kind: 'parsha', videoId: 'v1', clipPlanId: 'cp1', completedAt: '2026-05-17T01:00:00Z', triggeredAt: '2026-05-17T00:00:00Z' }],
    videos: [{ id: 'v1', jobId: 'j1', publishedToWebsite: false }],
    // No posts -> not "live". Should be draft-in-progress phase 4.
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 4);
});

test('plan-only done counts as a draft awaiting clip rendering (phase 2)', () => {
  const s = selectPageState({
    ...base,
    jobs: [{ id: 'jp', status: 'done', kind: 'plan-only', videoId: null, clipPlanId: 'cp1', completedAt: '2026-05-17T00:30:00Z', triggeredAt: '2026-05-17T00:00:00Z' }],
  });
  assert.equal(s.kind, 'draft-in-progress');
  if (s.kind === 'draft-in-progress') assert.equal(s.phase, 2);
});
```

- [ ] **Step 3: Run the tests.**

```bash
cd dashboard
npx tsx --test src/lib/page-state.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/lib/page-state.ts dashboard/src/lib/page-state.test.ts
git commit -m "feat(video-page): page-state detection (pure) + unit tests"
```

### Task 3.2: Word-count and duration helper

**Files:**
- Create: `dashboard/src/lib/word-count.ts`
- Create: `dashboard/src/lib/word-count.test.ts`

- [ ] **Step 1: Write the helper.**

```typescript
// dashboard/src/lib/word-count.ts
//
// Live word/duration/wps feedback for the script editor (Phase 1) and
// the clip plan voiceover fields (Phase 2 + 3). All thresholds match
// the pipeline's behavior: 2.6 wps target, 3.0 wps warning ceiling.

export const TARGET_WPS = 2.6;
export const WARN_WPS = 3.0;

export interface ScriptFeedback {
  words: number;
  estimatedSeconds: number;
  wps: number; // assumes the script will be spoken at TARGET_WPS
  fits60s: boolean;
  warning: 'tight' | null;
}

export function analyzeScript(text: string | null | undefined): ScriptFeedback {
  const words = countWords(text);
  const estimatedSeconds = words / TARGET_WPS;
  return {
    words,
    estimatedSeconds,
    wps: TARGET_WPS,
    fits60s: estimatedSeconds <= 60,
    warning: null,
  };
}

export interface ClipFeedback {
  words: number;
  durationS: number;
  wps: number;
  warning: 'tight' | null;
}

export function analyzeClip(text: string | null | undefined, durationS: number): ClipFeedback {
  const words = countWords(text);
  const wps = durationS > 0 ? words / durationS : 0;
  return {
    words,
    durationS,
    wps,
    warning: wps > WARN_WPS ? 'tight' : null,
  };
}

function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
```

- [ ] **Step 2: Write the unit tests.**

```typescript
// dashboard/src/lib/word-count.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClip, analyzeScript, TARGET_WPS } from './word-count';

test('analyzeScript: empty string -> zero', () => {
  const r = analyzeScript('');
  assert.equal(r.words, 0);
  assert.equal(r.estimatedSeconds, 0);
  assert.equal(r.fits60s, true);
});

test('analyzeScript: 156 words -> ~60s, fits', () => {
  const text = 'word '.repeat(156).trim();
  const r = analyzeScript(text);
  assert.equal(r.words, 156);
  assert.equal(r.estimatedSeconds, 156 / TARGET_WPS); // exactly 60s
  assert.equal(r.fits60s, true);
});

test('analyzeScript: 200 words -> overflow', () => {
  const r = analyzeScript('word '.repeat(200).trim());
  assert.equal(r.fits60s, false);
});

test('analyzeClip: 28 words / 10s -> 2.8 wps, no warning', () => {
  const r = analyzeClip('word '.repeat(28).trim(), 10);
  assert.equal(r.words, 28);
  assert.equal(r.wps, 2.8);
  assert.equal(r.warning, null);
});

test('analyzeClip: 32 words / 10s -> 3.2 wps, tight warning', () => {
  const r = analyzeClip('word '.repeat(32).trim(), 10);
  assert.equal(r.warning, 'tight');
});
```

- [ ] **Step 3: Run.**

```bash
cd dashboard && npx tsx --test src/lib/word-count.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/lib/word-count.ts dashboard/src/lib/word-count.test.ts
git commit -m "feat(video-page): word-count + wps helpers for script / clip feedback"
```

### Task 3.3: localStorage-draft hook (extends current caption-draft logic to all fields)

**Files:**
- Create: `dashboard/src/hooks/use-localstorage-draft.ts`

- [ ] **Step 1: Find the existing caption-draft localStorage code (commit d16a44e per the kickoff doc).**

```bash
grep -rn "localStorage" dashboard/src --include="*.tsx" --include="*.ts" -l
```

Read the pattern in `captions-list.tsx`. Generalize it.

- [ ] **Step 2: Write the hook.**

```typescript
// dashboard/src/hooks/use-localstorage-draft.ts
//
// Generalized localStorage draft persistence. Pass a stable key
// (e.g. `caption.${platform}.${videoId}` or `script.${parshaSlug}`)
// and the current server-side value. The hook returns [current,
// setLocal, clearDraft] and reconciles with the server value on mount:
// if a local draft exists and differs from the server value, the local
// draft wins (the user's unsaved work is more recent than the last
// successful save).
//
// This generalizes the captions-list localStorage behavior (commit
// d16a44e per kickoff doc) so every editable field gets the same
// "draft survives refresh / tab switch / machine swap" property.

'use client';
import { useEffect, useRef, useState } from 'react';

export function useLocalStorageDraft<T extends string>(
  key: string,
  initialServerValue: T,
): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(initialServerValue);
  const loaded = useRef(false);

  // On mount: read localStorage. If a draft exists, use it.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null && stored !== initialServerValue) {
        setValue(stored as T);
      }
    } catch {
      // localStorage may be unavailable (private browsing, etc.) — fall back to server value.
    }
  }, [key, initialServerValue]);

  function setLocal(next: T) {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {}
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }

  return [value, setLocal, clearDraft];
}
```

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/hooks/use-localstorage-draft.ts
git commit -m "feat(video-page): generalized localStorage draft hook (extends caption-draft pattern)"
```

### Task 3.4: Optimistic-save hook + toast on failure

**Files:**
- Create: `dashboard/src/hooks/use-optimistic-save.ts`

- [ ] **Step 1: Write the hook.**

```typescript
// dashboard/src/hooks/use-optimistic-save.ts
//
// Wraps a server action so the UI updates instantly. On failure,
// reverts the local value and shows a toast (sonner). Pairs with
// useLocalStorageDraft for "edit -> instant feedback -> save in bg".

'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface OptimisticSaveOptions<V> {
  current: V;
  save: (next: V) => Promise<void>;
  onSuccess?: () => void;
  errorMessage?: string;
}

export function useOptimisticSave<V>({ current, save, onSuccess, errorMessage }: OptimisticSaveOptions<V>) {
  const [local, setLocal] = useState<V>(current);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(next: V) {
    setLocal(next);
    startTransition(async () => {
      try {
        await save(next);
        setSavedAt(new Date());
        onSuccess?.();
      } catch (e) {
        setLocal(current); // revert
        toast.error(errorMessage ?? "Couldn't save — your change was reverted.", {
          description: (e as Error).message,
        });
      }
    });
  }

  return { value: local, update, isPending, savedAt };
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/hooks/use-optimistic-save.ts
git commit -m "feat(video-page): optimistic-save hook with revert + sonner toast"
```

### Task 3.5: Realtime row-subscription hooks

**Files:**
- Create: `dashboard/src/hooks/use-realtime-row.ts`
- Create: `dashboard/src/hooks/use-realtime-rows.ts`

- [ ] **Step 1: Write `use-realtime-row.ts` (subscribe to a single row by id).**

```typescript
// dashboard/src/hooks/use-realtime-row.ts
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeRow<T>(table: string, id: string | null, initial: T | null): T | null {
  const [row, setRow] = useState<T | null>(initial);

  useEffect(() => {
    if (!id) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`row:${table}:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setRow(null);
          } else {
            setRow(payload.new as T);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, id]);

  return row;
}
```

- [ ] **Step 2: Write `use-realtime-rows.ts` (subscribe to many rows filtered by a column).**

```typescript
// dashboard/src/hooks/use-realtime-rows.ts
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRealtimeRows<T extends { id: string }>(
  table: string,
  filterColumn: string,
  filterValue: string | null,
  initial: T[],
): T[] {
  const [rows, setRows] = useState<T[]>(initial);

  useEffect(() => {
    if (!filterValue) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`rows:${table}:${filterColumn}:${filterValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${filterValue}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new as T];
            if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== (payload.old as T).id);
            // UPDATE
            return prev.map((r) => (r.id === (payload.new as T).id ? (payload.new as T) : r));
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filterColumn, filterValue]);

  return rows;
}
```

- [ ] **Step 3: Smoke-test.**

Add the hook to the legacy page temporarily, log all row changes for a parsha's jobs, trigger a state transition (manually update `jobs.status` in Supabase), confirm the page receives the event.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/hooks/use-realtime-row.ts dashboard/src/hooks/use-realtime-rows.ts
git commit -m "feat(video-page): Realtime row + rows subscription hooks"
```

### Task 3.6: Bilingual header component (preserve current look)

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/bilingual-header.tsx`

- [ ] **Step 1: Extract the header from `page-legacy.tsx` (lines ~587-687) into a standalone component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/bilingual-header.tsx
//
// The same bilingual header from the legacy page, lifted into its own
// component for reuse across the new page's states. Hebrew name + book
// + parsha display title with the existing typographic treatment.

interface Props {
  hebrewName: string | null;
  book: string;
  name: string;
}

export function BilingualHeader({ hebrewName, book, name }: Props) {
  return (
    <header style={{ marginBottom: 20, paddingBottom: 24, borderBottom: '1px solid var(--ink-100)' }}>
      {hebrewName && (
        <div
          lang="he"
          dir="rtl"
          style={{
            fontFamily: 'var(--ff-hebrew)',
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 400,
            color: 'var(--ink-700)',
            lineHeight: 1,
            marginBottom: 16,
            textAlign: 'right',
            direction: 'rtl',
          }}
        >
          {hebrewName}
        </div>
      )}
      <div style={{ fontFamily: 'var(--ff-body)', fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--cedar-600)', marginBottom: 8 }}>{book}</div>
      <h1 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 'clamp(36px, 6vw, 72px)', lineHeight: 0.96, letterSpacing: '-0.035em', color: 'var(--ink-900)', margin: 0, fontVariationSettings: '"opsz" 144, "SOFT" 20' }}>
        {name}
        <em style={{ fontStyle: 'italic', color: 'var(--cedar-600)', fontVariationSettings: '"opsz" 144, "SOFT" 70' }}>.</em>
      </h1>
    </header>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/bilingual-header.tsx
git commit -m "feat(video-page): extract bilingual header for reuse"
```

### Task 3.7: Persistent live-status strip

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/persistent-live-strip.tsx`

- [ ] **Step 1: Write the component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/persistent-live-strip.tsx
//
// Pinned to the top of every draft phase when a live version exists.
// Per spec §3.1: "no matter where Yonah is, he sees what's live."
// Does NOT render on the live-at-rest state (that whole state IS the
// live status display).

import { PlatformIcon } from '@/components/platform-icon';

interface LivePost { platform: string; url: string | null }
interface Props {
  liveVersionLabel: string;        // e.g. "v2"
  publishedToWebsite: boolean;
  websiteUrl: string;
  livePosts: LivePost[];           // only platforms with status='published'
}

export function PersistentLiveStrip({ liveVersionLabel, publishedToWebsite, websiteUrl, livePosts }: Props) {
  const channels: string[] = [];
  if (publishedToWebsite) channels.push('torahtaichi.com');
  livePosts.forEach((p) => channels.push(p.platform));
  if (channels.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: 'var(--linen-50)',
        border: '1px solid var(--jade)',
        borderRadius: 'var(--r-md)',
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
      <span><strong>{liveVersionLabel}</strong> still live on {channels.join(' · ')}</span>
      <a href={websiteUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: 'var(--navy-700)', textDecoration: 'underline', fontSize: 12 }}>View →</a>
    </div>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/persistent-live-strip.tsx
git commit -m "feat(video-page): persistent live-status strip (spec §3.1)"
```

### Task 3.8: Compressed mobile stepper

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/compressed-stepper.tsx`

- [ ] **Step 1: Write the component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/compressed-stepper.tsx
//
// Compressed mobile stepper. Shows "Phase X of 5: <name>" + a 5-segment
// progress bar. Tap "▾ steps" to expand to a full list. Per spec §4.

'use client';
import { useState } from 'react';

const PHASE_NAMES = ['Script', 'Plan', 'Clips', 'Stitched video', 'Post'] as const;

interface Props { currentPhase: 1 | 2 | 3 | 4 | 5 }

export function CompressedStepper({ currentPhase }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: 'var(--linen-50)', border: '1px solid var(--ink-100)', borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, color: 'var(--ink-900)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
      >
        <span style={{ color: 'var(--navy-700)' }}>Phase {currentPhase} of 5 · {PHASE_NAMES[currentPhase - 1]}</span>
        <span style={{ color: 'var(--ink-500)', fontSize: 12 }}>{expanded ? '▴ steps' : '▾ steps'}</span>
      </button>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {[1, 2, 3, 4, 5].map((p) => (
          <div
            key={p}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: p < currentPhase ? 'var(--jade)' : p === currentPhase ? 'var(--navy-700)' : 'var(--ink-200)',
            }}
          />
        ))}
      </div>
      {expanded && (
        <ol style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }}>
          {PHASE_NAMES.map((name, i) => {
            const p = (i + 1) as 1 | 2 | 3 | 4 | 5;
            const status = p < currentPhase ? 'done' : p === currentPhase ? 'current' : 'pending';
            return (
              <li key={name} style={{ padding: '4px 0', color: status === 'pending' ? 'var(--ink-400)' : 'var(--ink-900)' }}>
                {status === 'done' ? '✓' : status === 'current' ? '●' : '○'} {p}. {name}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/compressed-stepper.tsx
git commit -m "feat(video-page): compressed mobile stepper (spec §4)"
```

### Task 3.9: Bottom-sheet primitive

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/bottom-sheet.tsx`

- [ ] **Step 1: Use Base UI's Dialog as the substrate, styled as a bottom sheet on mobile.**

```typescript
// dashboard/src/app/videos/[slug]/_components/bottom-sheet.tsx
//
// Mobile-first bottom sheet. Drag-down dismiss handled by Base UI's
// Dialog dismiss logic; primary action is at the bottom for thumb
// reach. Used for destructive confirms ("Replace with a new version",
// "Edit on TikTok").

'use client';
import { Dialog } from '@base-ui/react/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode; // body
  primaryAction: { label: string; onClick: () => void; destructive?: boolean };
  secondaryAction?: { label: string; onClick: () => void };
}

export function BottomSheet({ open, onOpenChange, title, children, primaryAction, secondaryAction }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
        <Dialog.Popup
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'var(--linen-50)',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: '20px 20px max(20px, env(safe-area-inset-bottom))',
            maxHeight: '85vh',
            overflowY: 'auto',
          }}
        >
          <div style={{ width: 36, height: 4, background: 'var(--ink-200)', borderRadius: 2, margin: '0 auto 16px' }} />
          <Dialog.Title style={{ fontSize: 18, fontWeight: 500, margin: '0 0 12px' }}>{title}</Dialog.Title>
          <div style={{ fontSize: 14, color: 'var(--ink-700)', marginBottom: 20 }}>{children}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={primaryAction.onClick}
              style={{
                width: '100%',
                minHeight: 48,
                fontSize: 15,
                fontWeight: 500,
                background: primaryAction.destructive ? 'var(--tassel)' : 'var(--navy-700)',
                color: 'var(--linen-50)',
                border: 'none',
                borderRadius: 10,
                padding: '14px',
                cursor: 'pointer',
              }}
            >
              {primaryAction.label}
            </button>
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                style={{ width: '100%', minHeight: 44, fontSize: 14, background: 'transparent', color: 'var(--ink-700)', border: 'none', cursor: 'pointer' }}
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/bottom-sheet.tsx
git commit -m "feat(video-page): mobile-first bottom-sheet primitive"
```

---

## Phase 4 — Phase 1 (Script) implementation

### Task 4.1: Phase 1 (Script) UI

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx`
- Create: `dashboard/src/app/actions/video-page/save-script.ts`

- [ ] **Step 1: Server action.**

```typescript
// dashboard/src/app/actions/video-page/save-script.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function saveScript(scriptId: string, draftText: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('scripts')
    .update({ draft_text: draftText })
    .eq('id', scriptId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Phase 1 component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx
'use client';
import { useState } from 'react';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { analyzeScript } from '@/lib/word-count';
import { saveScript } from '@/app/actions/video-page/save-script';

interface Script { id: string; option: string; title: string | null; draft_text: string | null }
interface Props {
  parshaSlug: string;
  scripts: Script[];                  // all 4 variants
  defaultScript: Script;              // A-tight or whatever was last edited
  onAdvance: () => void;              // tap "Next: review clip plan →"
}

export function Phase1Script({ parshaSlug, scripts, defaultScript, onAdvance }: Props) {
  const [selectedId, setSelectedId] = useState<string>(defaultScript.id);
  const selected = scripts.find((s) => s.id === selectedId) ?? defaultScript;
  const [showOthers, setShowOthers] = useState(false);

  const [localText, setLocalText, clearDraft] = useLocalStorageDraft(
    `script.${parshaSlug}.${selected.id}`,
    selected.draft_text ?? '',
  );

  const { update, isPending } = useOptimisticSave<string>({
    current: localText,
    save: async (next) => { await saveScript(selected.id, next); },
    onSuccess: clearDraft,
    errorMessage: 'Saving the script failed.',
  });

  const fb = analyzeScript(localText);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontFamily: 'var(--ff-display)', fontSize: 22, margin: 0 }}>Edit the script</h2>
        <button type="button" onClick={() => setShowOthers((x) => !x)} style={{ background: 'none', border: 'none', color: 'var(--navy-700)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer' }}>
          {showOthers ? 'Hide alternates' : 'Try another'}
        </button>
      </div>

      {showOthers && (
        <div style={{ marginBottom: 16 }}>
          {scripts.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSelectedId(s.id); setShowOthers(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: 12,
                marginBottom: 6,
                border: `1px solid ${s.id === selectedId ? 'var(--navy-700)' : 'var(--ink-100)'}`,
                borderRadius: 8,
                background: s.id === selectedId ? 'var(--linen-50)' : 'white',
                cursor: 'pointer',
              }}
            >
              <strong>{s.option}</strong>
              <div style={{ color: 'var(--ink-500)', fontSize: 12, marginTop: 4 }}>{s.draft_text?.slice(0, 80)}…</div>
            </button>
          ))}
        </div>
      )}

      <textarea
        value={localText}
        onChange={(e) => { setLocalText(e.target.value); update(e.target.value); }}
        style={{
          width: '100%',
          minHeight: 240,
          padding: 12,
          border: '1px solid var(--ink-100)',
          borderRadius: 8,
          fontSize: 16, // prevent iOS zoom
          lineHeight: 1.5,
          background: 'white',
          color: 'var(--ink-900)',
          fontFamily: 'var(--ff-body)',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', marginTop: 8, background: 'var(--linen-50)', borderRadius: 8, fontSize: 12 }}>
        <span>{fb.words} words · ~{Math.round(fb.estimatedSeconds)} seconds · {fb.wps.toFixed(1)} wps</span>
        <span style={{ color: fb.fits60s ? 'var(--jade)' : 'var(--tassel)' }}>{fb.fits60s ? 'fits 60s ✓' : 'over 60s ⚠'}</span>
      </div>

      {/* Sticky bottom action — actual sticky placement handled by page-level layout */}
      <div style={{ marginTop: 18 }}>
        <button
          type="button"
          onClick={onAdvance}
          disabled={isPending}
          style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 10, padding: 14, cursor: 'pointer' }}
        >
          Next: review clip plan →
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into `page-new.tsx` for Phase-1-only smoke test.**

Update `page-new.tsx` to render `<Phase1Script ... />` when state is `draft-in-progress` and `phase === 1`. Stub `onAdvance` with a console.log for now.

- [ ] **Step 4: Smoke-test.**

`npm run dev`, open `/videos/<a-parsha-without-a-job>?v2=1` (force new page). Type in the textarea, refresh — text should persist. Capture screenshot to `qa-screenshots/video-redesign/04-phase1.png`.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/app/actions/video-page/save-script.ts dashboard/src/app/videos/[slug]/_components/phase-1-script.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 1 script editor with optimistic save + localStorage drafts"
```

---

## Phase 5 — Phase 2 (Plan review) implementation

### Task 5.1: Server action — trigger plan-only Modal job

**Files:**
- Create: `dashboard/src/app/actions/video-page/trigger-plan-only.ts`

- [ ] **Step 1: Action.**

```typescript
// dashboard/src/app/actions/video-page/trigger-plan-only.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function triggerPlanOnly(parshaId: string, scriptId: string): Promise<{ jobId: string }> {
  const supabase = await createClient();

  // Insert the job row first (matches existing Modal trigger pattern).
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({ parsha_id: parshaId, script_id: scriptId, kind: 'plan-only', status: 'queued' })
    .select('id')
    .single();
  if (jobErr) throw new Error(jobErr.message);

  const res = await fetch(process.env.MODAL_WORKER_URL!, {
    method: 'POST',
    headers: { 'x-shared-secret': process.env.PIPELINE_SHARED_SECRET!, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'plan-only', parsha_id: parshaId, script_id: scriptId, job_id: job.id }),
  });
  if (!res.ok) throw new Error(`Modal trigger failed: ${res.status}`);

  return { jobId: job.id };
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/actions/video-page/trigger-plan-only.ts
git commit -m "feat(video-page): server action to trigger plan-only Modal job"
```

### Task 5.2: Server action — save a single clip's voiceover / visual_prompt

**Files:**
- Create: `dashboard/src/app/actions/video-page/save-plan-clip.ts`

- [ ] **Step 1: Action.**

```typescript
// dashboard/src/app/actions/video-page/save-plan-clip.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function savePlanClip(
  clipId: string,
  patch: { voiceover?: string; visual_prompt?: string },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('clips').update(patch).eq('id', clipId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/actions/video-page/save-plan-clip.ts
git commit -m "feat(video-page): server action to save a single clip's voiceover/visual_prompt"
```

### Task 5.3: Server action — trigger clips-only Modal job (one or all)

**Files:**
- Create: `dashboard/src/app/actions/video-page/trigger-clips.ts`

- [ ] **Step 1: Action.**

```typescript
// dashboard/src/app/actions/video-page/trigger-clips.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function triggerClips(
  clipPlanId: string,
  clipIndexes: number[] | null,    // null = all
): Promise<{ jobId: string }> {
  const supabase = await createClient();

  // Look up the parent job to copy params.
  const { data: plan } = await supabase
    .from('clip_plans')
    .select('job_id')
    .eq('id', clipPlanId)
    .single();
  if (!plan) throw new Error('clip_plan not found');

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      kind: 'clips-only',
      status: 'queued',
      regen_of_job_id: plan.job_id,
    })
    .select('id')
    .single();
  if (jobErr) throw new Error(jobErr.message);

  const res = await fetch(process.env.MODAL_WORKER_URL!, {
    method: 'POST',
    headers: { 'x-shared-secret': process.env.PIPELINE_SHARED_SECRET!, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'clips-only', clip_plan_id: clipPlanId, clip_indexes: clipIndexes, job_id: job.id }),
  });
  if (!res.ok) throw new Error(`Modal trigger failed: ${res.status}`);

  return { jobId: job.id };
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/actions/video-page/trigger-clips.ts
git commit -m "feat(video-page): server action to trigger clips-only Modal job"
```

### Task 5.3b: Motion picker bottom sheet + server action (spec §6.5)

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx`
- Create: `dashboard/src/app/actions/video-page/save-plan-clip-motion.ts`

- [ ] **Step 1: Server action.**

```typescript
// dashboard/src/app/actions/video-page/save-plan-clip-motion.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function savePlanClipMotion(clipId: string, motionRefSlug: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('clips')
    .update({ motion_ref_slug: motionRefSlug })
    .eq('id', clipId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Server-side move-library fetcher (shared, cached on the server component side).**

Add to `dashboard/src/lib/tai-chi-moves.ts`:

```typescript
import { createClient } from '@/lib/supabase/server';
import { publicVideoUrl } from '@/lib/storage-url';

export interface TaiChiMove {
  slug: string;
  english: string;
  pinyin: string | null;
  thumbVideoUrl: string | null;  // resolved from mp4_storage_path
}

export async function listTaiChiMoves(): Promise<TaiChiMove[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('tai_chi_moves')
    .select('slug, english, pinyin, mp4_storage_path')
    .order('english');
  return (data ?? []).map((r) => ({
    slug: r.slug as string,
    english: r.english as string,
    pinyin: (r.pinyin as string | null) ?? null,
    thumbVideoUrl: r.mp4_storage_path ? publicVideoUrl(r.mp4_storage_path as string) : null,
  }));
}
```

- [ ] **Step 3: Bottom-sheet picker component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx
'use client';
import { useState, useMemo } from 'react';
import { BottomSheet } from '../bottom-sheet';
import type { TaiChiMove } from '@/lib/tai-chi-moves';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moves: TaiChiMove[];               // fetched server-side, passed in
  currentSlug: string | null;
  onPick: (slug: string | null) => Promise<void>;
}

export function MotionPickerSheet({ open, onOpenChange, moves, currentSlug, onPick }: Props) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (!filter) return moves;
    const f = filter.toLowerCase();
    return moves.filter((m) => m.english.toLowerCase().includes(f) || (m.pinyin ?? '').toLowerCase().includes(f));
  }, [moves, filter]);

  async function pick(slug: string | null) {
    await onPick(slug);
    onOpenChange(false);
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pick a Tai Chi move"
      primaryAction={{ label: 'Cancel', onClick: () => onOpenChange(false) }}
    >
      {moves.length > 15 && (
        <input
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: '100%', minHeight: 44, fontSize: 16, padding: 10, marginBottom: 12, border: '1px solid var(--ink-100)', borderRadius: 6 }}
        />
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '60vh', overflowY: 'auto' }}>
        <li>
          <button
            type="button"
            onClick={() => pick(null)}
            style={{ width: '100%', minHeight: 56, padding: 12, textAlign: 'left', background: currentSlug === null ? 'var(--linen-50)' : 'white', border: '1px solid var(--ink-100)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >
            {currentSlug === null ? '● ' : '○ '}No move on this clip
          </button>
        </li>
        {filtered.map((m) => (
          <li key={m.slug}>
            <button
              type="button"
              onClick={() => pick(m.slug)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 64, padding: 8, textAlign: 'left', background: currentSlug === m.slug ? 'var(--linen-50)' : 'white', border: '1px solid var(--ink-100)', borderRadius: 8, marginBottom: 6, cursor: 'pointer' }}
            >
              {m.thumbVideoUrl ? (
                <video src={m.thumbVideoUrl} muted playsInline preload="metadata" autoPlay loop style={{ width: 40, height: 71, borderRadius: 4, objectFit: 'cover', background: 'var(--ink-900)', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 40, height: 71, borderRadius: 4, background: 'var(--ink-200)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{currentSlug === m.slug ? '● ' : '○ '}{m.english}</div>
                {m.pinyin && <div style={{ fontSize: 11, color: 'var(--ink-500)', fontStyle: 'italic' }}>{m.pinyin}</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
```

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/actions/video-page/save-plan-clip-motion.ts dashboard/src/lib/tai-chi-moves.ts dashboard/src/app/videos/[slug]/_components/_shared/motion-picker-sheet.tsx
git commit -m "feat(video-page): motion picker bottom sheet + save action (spec §6.5)"
```

### Task 5.4: Phase 2 (Plan review) UI

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx`

- [ ] **Step 1: Component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx
'use client';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { analyzeClip } from '@/lib/word-count';
import { savePlanClip } from '@/app/actions/video-page/save-plan-clip';
import { triggerClips } from '@/app/actions/video-page/trigger-clips';

interface Clip { id: string; index: number; voiceover: string; visual_prompt: string; duration_s: number | null; storage_path: string | null; motion_ref_slug: string | null }
interface Props {
  parshaSlug: string;
  jobId: string;                     // the plan-only job
  clipPlanId: string;
  initialClips: Clip[];              // sorted by index
  totalCostEstimateUsd: number | null;
  tierLabel: string;                 // "720p Fast"
  moves: import('@/lib/tai-chi-moves').TaiChiMove[];   // server-fetched library, passed in
  onAdvance: () => void;
  onBack: () => void;
}

export function Phase2PlanReview({ parshaSlug, jobId, clipPlanId, initialClips, totalCostEstimateUsd, tierLabel, onAdvance, onBack }: Props) {
  const clips = useRealtimeRows<Clip>('clips', 'job_id', jobId, initialClips)
    .sort((a, b) => a.index - b.index);

  async function generateAll() {
    await triggerClips(clipPlanId, null);
    onAdvance();
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 14 }}>
        <span>{clips.length} clips</span>
        {totalCostEstimateUsd !== null && (
          <span style={{ color: 'var(--ink-500)', fontStyle: 'italic', fontSize: 12 }}>
            Estimated cost: ~${totalCostEstimateUsd.toFixed(2)} at {tierLabel}
          </span>
        )}
      </div>

      {clips.map((c) => (
        <PlanClipCard key={c.id} clip={c} clipPlanId={clipPlanId} parshaSlug={parshaSlug} moves={moves} />
      ))}

      <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid var(--ink-100)', padding: '10px 0 max(16px, env(safe-area-inset-bottom))' }}>
        <button
          type="button"
          onClick={generateAll}
          style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 10, padding: 14, cursor: 'pointer' }}
        >
          Generate all {clips.length} clips →
        </button>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--ink-500)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer' }}>← Back to script</button>
        </div>
      </div>
    </section>
  );
}

function PlanClipCard({ clip, clipPlanId, parshaSlug, moves }: { clip: Clip; clipPlanId: string; parshaSlug: string; moves: import('@/lib/tai-chi-moves').TaiChiMove[] }) {
  const [voTxt, setVoTxt, clearVoDraft] = useLocalStorageDraft(`plan.${parshaSlug}.${clip.id}.voiceover`, clip.voiceover);
  const [scTxt, setScTxt, clearScDraft] = useLocalStorageDraft(`plan.${parshaSlug}.${clip.id}.scene`, clip.visual_prompt);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);

  const voSave = useOptimisticSave<string>({
    current: voTxt,
    save: async (next) => { await savePlanClip(clip.id, { voiceover: next }); },
    onSuccess: clearVoDraft,
  });
  const scSave = useOptimisticSave<string>({
    current: scTxt,
    save: async (next) => { await savePlanClip(clip.id, { visual_prompt: next }); },
    onSuccess: clearScDraft,
  });

  const fb = analyzeClip(voTxt, clip.duration_s ?? 0);
  const currentMove = moves.find((m) => m.slug === motionSlug) ?? null;

  async function generateThis() {
    await triggerClips(clipPlanId, [clip.index]);
  }

  async function pickMotion(slug: string | null) {
    setMotionSlug(slug);                                  // optimistic
    try {
      await savePlanClipMotion(clip.id, slug);
    } catch (e) {
      setMotionSlug(clip.motion_ref_slug);                // revert
      toast.error("Couldn't save the move.", { description: (e as Error).message });
    }
  }

  return (
    <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 12, marginBottom: 12, background: 'var(--linen-50)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Clip {clip.index + 1}{clip.duration_s ? ` · ${clip.duration_s}s` : ''}
        </span>
        <button
          type="button"
          onClick={generateThis}
          style={{ minHeight: 44, padding: '8px 14px', fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}
        >
          Generate this clip
        </button>
      </div>

      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}>Voiceover</label>
      <textarea
        value={voTxt}
        onChange={(e) => { setVoTxt(e.target.value); voSave.update(e.target.value); }}
        style={{ width: '100%', minHeight: 64, padding: 8, fontSize: 16, border: '1px solid var(--ink-100)', borderRadius: 6, background: 'white', fontFamily: 'inherit' }}
      />
      <div style={{ fontSize: 10.5, color: 'var(--ink-500)', marginTop: 3 }}>
        {fb.words} words{clip.duration_s ? ` · ${fb.wps.toFixed(1)} wps` : ''}{fb.warning === 'tight' ? ' ⚠ tight' : ' ✓'}
      </div>

      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', margin: '10px 0 3px' }}>Scene direction</label>
      <textarea
        value={scTxt}
        onChange={(e) => { setScTxt(e.target.value); scSave.update(e.target.value); }}
        style={{ width: '100%', minHeight: 64, padding: 8, fontSize: 16, border: '1px solid var(--ink-100)', borderRadius: 6, background: 'white', fontFamily: 'inherit' }}
      />

      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', margin: '10px 0 3px' }}>Tai Chi move</label>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        style={{ width: '100%', minHeight: 44, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
      >
        <span>{currentMove ? `🥋 ${currentMove.english}` : 'No move assigned'}</span>
        <span style={{ color: 'var(--ink-500)' }}>▾</span>
      </button>
      <MotionPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />
    </div>
  );
}
```

Add the imports at the top of the file:

```typescript
import { useState } from 'react';
import { toast } from 'sonner';
import { savePlanClipMotion } from '@/app/actions/video-page/save-plan-clip-motion';
import { MotionPickerSheet } from '@/app/videos/[slug]/_components/_shared/motion-picker-sheet';
```

- [ ] **Step 2: Wire into `page-new.tsx` for state `draft-in-progress` phase 2.** Pass `moves={await listTaiChiMoves()}` from the server component to the client component.

- [ ] **Step 3: Smoke-test.**

Trigger a plan-only job via the Phase 1 advance. Confirm Phase 2 renders the cards with voiceover + scene direction + Tai Chi move picker (defaulting to "No move assigned"). Open the picker, select a move — confirm `clips.motion_ref_slug` updates in Supabase. Tap "Generate this clip" — confirm a `clips-only` job appears in Supabase and the page subscribes to clip updates.

Screenshot → `qa-screenshots/video-redesign/05-phase2.png`.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-2-plan-review.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 2 plan review with per-card generate + Realtime"
```

---

## Phase 6 — Phase 3 (Clips) implementation

### Task 6.1: Phase 3 component

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx`

- [ ] **Step 1: Component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx
'use client';
import { useState } from 'react';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';
import { triggerClips } from '@/app/actions/video-page/trigger-clips';
import { publicVideoUrl } from '@/lib/storage-url';

interface Clip { id: string; index: number; storage_path: string | null; duration_s: number | null; voiceover: string; visual_prompt: string }
interface Props {
  parshaSlug: string;
  jobId: string;
  clipPlanId: string;
  initialClips: Clip[];
  onAdvance: () => void;
  onBack: () => void;
}

export function Phase3Clips({ jobId, clipPlanId, initialClips, onAdvance, onBack }: Props) {
  const clips = useRealtimeRows<Clip>('clips', 'job_id', jobId, initialClips)
    .filter((c) => c.storage_path)
    .sort((a, b) => a.index - b.index);

  return (
    <section>
      {clips.map((c) => <ClipCard key={c.id} clip={c} clipPlanId={clipPlanId} />)}

      <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid var(--ink-100)', padding: '10px 0 max(16px, env(safe-area-inset-bottom))' }}>
        <button
          type="button"
          onClick={onAdvance}
          style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 10, padding: 14, cursor: 'pointer' }}
        >
          Preview stitched video →
        </button>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--ink-500)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer' }}>← Back to plan</button>
        </div>
      </div>
    </section>
  );
}

function ClipCard({ clip, clipPlanId }: { clip: Clip; clipPlanId: string }) {
  const [playing, setPlaying] = useState(false);
  async function regen() {
    await triggerClips(clipPlanId, [clip.index]);
  }

  const videoUrl = clip.storage_path ? publicVideoUrl(clip.storage_path) : null;

  return (
    <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 12, marginBottom: 12, background: 'var(--linen-50)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 12 }}>
        <span style={{ color: 'var(--jade)', fontWeight: 600 }}>● Clip {clip.index + 1}{clip.duration_s ? ` · ${clip.duration_s}s` : ''}</span>
      </div>
      {videoUrl && (
        <video
          src={videoUrl}
          controls
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 8, background: 'var(--ink-900)' }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={regen}
          style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}
        >
          Re-render
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire + smoke-test + screenshot to `qa-screenshots/video-redesign/06-phase3.png`.**

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 3 clips with inline mini-player + per-card regen"
```

### Task 6.1b: Clip-card error + long-wait states (spec §10.1, §10.2)

**Files:**
- Modify: `dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx`

- [ ] **Step 1: Subscribe to the parent `jobs` row for the per-clip render job so failure / long-wait states surface in the card.**

Use `useRealtimeRow<Job>('jobs', regenJobId, initialJob)`. Show:
- **Failed** (`status='failed'`): red left border, error message in plain language pulled from `jobs.status_message`, two actions: "Retry" (calls `triggerClips(clipPlanId, [clip.index])` again) + "View logs →" (links to `/jobs/[regenJobId]`).
- **In-flight, queued/generating < 5min**: spinner + "Generating…" + small "queued at Kie · waiting" sub-line. No time estimate.
- **In-flight, > 5min**: append "This is taking longer than usual — Kie's queue is busy."
- **In-flight, > 12min**: replace with "Still queued — you can leave this page and come back, or [Cancel and retry]."

Use the `triggered_at` timestamp + `Date.now()` to compute elapsed.

```typescript
// Inside ClipCard (additional state derived from regenJob row):
const elapsedSec = regenJob ? (Date.now() - new Date(regenJob.triggered_at).getTime()) / 1000 : 0;
const longWait = elapsedSec > 300;       // 5 min
const stuckWait = elapsedSec > 720;       // 12 min

if (regenJob?.status === 'failed') {
  return (
    <div style={{ border: '1px solid var(--ink-100)', borderLeft: '4px solid var(--tassel)', /* ... */ }}>
      <strong>⚠ Clip {clip.index + 1} failed</strong>
      <p style={{ fontSize: 12, color: 'var(--ink-700)' }}>{regenJob.status_message || 'Unknown error.'}</p>
      <button type="button" onClick={() => triggerClips(clipPlanId, [clip.index])}>Retry</button>
      <a href={`/jobs/${regenJob.id}`}>View logs →</a>
    </div>
  );
}

if (regenJob && ['queued', 'generating_clips', 'verifying'].includes(regenJob.status)) {
  return (
    <div style={{ /* in-flight styling */ }}>
      <span>Generating…</span>
      <span style={{ fontStyle: 'italic', color: 'var(--ink-500)' }}>queued at Kie · waiting</span>
      {longWait && !stuckWait && <p>This is taking longer than usual — Kie's queue is busy.</p>}
      {stuckWait && (
        <>
          <p>Still queued — you can leave this page and come back.</p>
          <button type="button" onClick={() => /* cancel + retry */ {}}>Cancel and retry</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx
git commit -m "feat(video-page): clip-card failed + long-wait states (spec §10)"
```

### Task 6.1c: Add motion picker to Phase 3 clip cards (with stale-on-change behavior)

**Files:**
- Modify: `dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx`

- [ ] **Step 1: Add `motion_ref_slug` to the `Clip` interface in this file (same shape as Phase 2).**

- [ ] **Step 2: Pass `moves: TaiChiMove[]` down from the page-level server component to `Phase3Clips` to `ClipCard`.**

- [ ] **Step 3: Inside `ClipCard`, track the picker state + the "last rendered" motion slug.**

The "last rendered" slug is what was current when the clip was rendered — captured by reading `clips.motion_ref_slug` at mount time and freezing it. If Yonah changes the slug afterward and hasn't re-rendered, the card is stale.

```typescript
function ClipCard({ clip, clipPlanId, moves }: { clip: Clip; clipPlanId: string; moves: TaiChiMove[] }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [motionSlug, setMotionSlug] = useState<string | null>(clip.motion_ref_slug);
  // The rendered video reflects the slug that was active at render time.
  // We freeze the initial value so a later picker change marks the card stale.
  const [renderedWithSlug] = useState<string | null>(clip.motion_ref_slug);

  const isStale = motionSlug !== renderedWithSlug;
  const currentMove = moves.find((m) => m.slug === motionSlug) ?? null;

  async function pickMotion(slug: string | null) {
    setMotionSlug(slug);
    try {
      await savePlanClipMotion(clip.id, slug);
    } catch (e) {
      setMotionSlug(clip.motion_ref_slug);
      toast.error("Couldn't save the move.", { description: (e as Error).message });
    }
  }

  async function regen() {
    await triggerClips(clipPlanId, [clip.index]);
  }

  // ... existing video player markup ...

  return (
    <div style={{ /* existing styling */ }}>
      {/* existing player + version picker */}

      {/* Motion picker section */}
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', margin: '10px 0 3px' }}>Tai Chi move</label>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        style={{ width: '100%', minHeight: 44, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
      >
        <span>{currentMove ? `🥋 ${currentMove.english}` : 'No move assigned'}</span>
        <span style={{ color: 'var(--ink-500)' }}>▾</span>
      </button>

      {/* Stale hint */}
      {isStale && (
        <p style={{ fontSize: 12, color: 'var(--tassel)', margin: '6px 0 0', fontStyle: 'italic' }}>
          Move changed — re-render to apply.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={regen}
          style={{ flex: 1, minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}
        >
          {isStale ? 'Re-render with new move' : 'Re-render'}
        </button>
      </div>

      <MotionPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        moves={moves}
        currentSlug={motionSlug}
        onPick={pickMotion}
      />
    </div>
  );
}
```

- [ ] **Step 4: Smoke-test.**

In a parsha with rendered clips, change a clip's motion via the picker — verify the card shows "Move changed — re-render to apply" and the button changes to "Re-render with new move." Re-render — confirm the new mp4 was generated using the new motion ref (check the Modal logs or the Seedance call's payload).

Screenshot → `qa-screenshots/video-redesign/06b-clip-card-stale-motion.png`.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 3 motion picker + stale-on-change hint (spec §6.5)"
```

### Task 6.2: Add version-picker dropdown to Phase 3 clip cards

**Files:**
- Modify: `dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx`

- [ ] **Step 1: Extend the data prop to include all distinct versions per index.**

Reuse the dedupe logic from the legacy page (lines 290-323). Group clips by `index`; within each, dedupe by `storage_path`.

- [ ] **Step 2: Add a `<select>` per card to switch displayed version.**

```typescript
// Inside ClipCard (modified):
const [selectedClipId, setSelectedClipId] = useState<string>(clip.id);
const displayed = versionsForIndex.find((v) => v.id === selectedClipId) ?? clip;

// ... render the video for `displayed.storage_path`
// ... select:
<select value={selectedClipId} onChange={(e) => setSelectedClipId(e.target.value)} style={{ minHeight: 44, fontSize: 14 }}>
  {versionsForIndex.map((v, i) => <option key={v.id} value={v.id}>v{i + 1}{v.id === clip.id ? ' (latest)' : ''}</option>)}
</select>
```

- [ ] **Step 3: Smoke-test + screenshot.**

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-3-clips.tsx
git commit -m "feat(video-page): Phase 3 version picker per clip (spec §4 Phase 3)"
```

---

## Phase 7 — Phase 4 (Stitched video) implementation

### Task 7.1: Phase 4 component

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx`

- [ ] **Step 1: Component.**

```typescript
// dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx
'use client';
import { publicVideoUrl } from '@/lib/storage-url';

interface Props {
  videoMp4Path: string | null;
  thumbPath: string | null;
  captionsVttDataUrl: string | null;
  clipBoundariesS: number[]; // cumulative offsets, e.g. [0, 9, 19, 28] for 4 clips
  totalDurationS: number;
  onAdvance: () => void;
  onBack: () => void;
}

export function Phase4Stitched({ videoMp4Path, thumbPath, captionsVttDataUrl, clipBoundariesS, totalDurationS, onAdvance, onBack }: Props) {
  if (!videoMp4Path) return <p style={{ color: 'var(--ink-500)' }}>Stitched video not ready yet.</p>;
  const videoUrl = publicVideoUrl(videoMp4Path);

  return (
    <section>
      <video
        src={videoUrl}
        poster={thumbPath ? publicVideoUrl(thumbPath) : undefined}
        controls
        playsInline
        crossOrigin={captionsVttDataUrl ? 'anonymous' : undefined}
        style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 8, background: 'var(--ink-900)' }}
      >
        {captionsVttDataUrl && <track kind="captions" srcLang="en" label="English" default src={captionsVttDataUrl} />}
      </video>

      {/* Scrub markers — shown below the player for visual reference */}
      <div style={{ position: 'relative', height: 6, background: 'var(--ink-100)', borderRadius: 3, marginTop: 10 }}>
        {clipBoundariesS.map((s, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(s / totalDurationS) * 100}%`, top: -2, width: 2, height: 10, background: 'var(--navy-700)' }} />
        ))}
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: 'white', borderTop: '1px solid var(--ink-100)', padding: '10px 0 max(16px, env(safe-area-inset-bottom))', marginTop: 18 }}>
        <button type="button" onClick={onAdvance} style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 10, padding: 14, cursor: 'pointer' }}>
          Continue to posting →
        </button>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--ink-500)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer' }}>← Back to clips</button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire into `page-new.tsx`. Pass `captionsVttDataUrl` built via the existing `buildClipPayload` helper from `page-legacy.tsx` (extract it into a shared module if not already).**

- [ ] **Step 3: Smoke-test + screenshot.**

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-4-stitched.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 4 stitched video with captions track + clip markers"
```

---

## Phase 8 — Phase 5 (Post) implementation

### Task 8.1: Shared posting-card primitives

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/editable-field.tsx`
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/hashtag-field.tsx`
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/posted-summary-row.tsx`
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/reel-or-post-toggle.tsx`

- [ ] **Step 1: `editable-field.tsx` (16pt textarea wrapper with label).**

```typescript
'use client';
import { useLocalStorageDraft } from '@/hooks/use-localstorage-draft';
import { useOptimisticSave } from '@/hooks/use-optimistic-save';

interface Props {
  storageKey: string;
  label: string;
  initialValue: string;
  onSave: (next: string) => Promise<void>;
  minHeight?: number;
  multiline?: boolean;
}

export function EditableField({ storageKey, label, initialValue, onSave, minHeight = 60, multiline = true }: Props) {
  const [local, setLocal, clear] = useLocalStorageDraft(storageKey, initialValue);
  const { update } = useOptimisticSave<string>({ current: local, save: onSave, onSuccess: clear });

  const Input = (multiline ? 'textarea' : 'input') as 'textarea';

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}>{label}</label>
      <Input
        value={local}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setLocal(e.target.value); update(e.target.value); }}
        style={{ width: '100%', minHeight: multiline ? minHeight : 44, padding: 8, fontSize: 16, border: '1px solid var(--ink-100)', borderRadius: 6, background: 'white', fontFamily: 'inherit' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: `hashtag-field.tsx` (parses caption body for trailing `#tags`, returns body + tags).**

This is purely a UI split. Body and tags are joined back into the flat caption string on save.

```typescript
'use client';
import { useMemo } from 'react';
import { EditableField } from './editable-field';

interface Props {
  storageKey: string;
  initialCombined: string;
  onSave: (combined: string) => Promise<void>;
}

export function CaptionAndHashtags({ storageKey, initialCombined, onSave }: Props) {
  const { body: initBody, tags: initTags } = useMemo(() => splitCaption(initialCombined), [initialCombined]);

  return (
    <>
      <EditableField storageKey={`${storageKey}.body`} label="Caption body" initialValue={initBody} onSave={async (b) => onSave(joinCaption(b, initTags))} />
      <EditableField storageKey={`${storageKey}.tags`} label="Hashtags" initialValue={initTags} onSave={async (t) => onSave(joinCaption(initBody, t))} multiline={false} />
    </>
  );
}

function splitCaption(s: string): { body: string; tags: string } {
  const m = s.match(/^(.*?)(?:\n+)?((?:#[\w_]+\s*)+)$/s);
  if (!m) return { body: s, tags: '' };
  return { body: m[1].trim(), tags: m[2].trim() };
}

function joinCaption(body: string, tags: string): string {
  return tags ? `${body}\n\n${tags}` : body;
}
```

- [ ] **Step 3: `posted-summary-row.tsx` (collapsed posted-state row).**

```typescript
interface Props {
  icon: string;             // emoji or name passed to PlatformIcon
  platform: string;
  postedAt: string;          // ISO
  viewsLabel?: string;       // e.g. "2.4k views"
  postUrl: string | null;
  onExpand: () => void;
}
export function PostedSummaryRow({ icon, platform, postedAt, viewsLabel, postUrl, onExpand }: Props) {
  return (
    <button
      type="button"
      onClick={onExpand}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: 56, padding: '12px 14px', border: '1px solid var(--ink-100)', borderRadius: 10, background: 'var(--linen-50)', cursor: 'pointer', textAlign: 'left' }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          <span style={{ color: 'var(--jade)' }}>●</span> {icon} {platform}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
          Posted {new Date(postedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {viewsLabel ? ` · ${viewsLabel}` : ''}
        </div>
      </div>
      <span style={{ fontSize: 18, color: 'var(--ink-500)' }}>▸</span>
    </button>
  );
}
```

- [ ] **Step 4: `reel-or-post-toggle.tsx`.**

```typescript
'use client';
interface Props { value: 'reel' | 'post'; onChange: (v: 'reel' | 'post') => void }
export function ReelOrPostToggle({ value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      {(['reel', 'post'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          style={{
            flex: 1, minHeight: 44, padding: 10,
            border: `1.5px solid ${value === k ? 'var(--navy-700)' : 'var(--ink-100)'}`,
            background: value === k ? 'rgba(26,42,74,0.06)' : 'white',
            color: value === k ? 'var(--navy-700)' : 'var(--ink-500)',
            borderRadius: 8, fontSize: 13, cursor: 'pointer', textAlign: 'center',
          }}
        >
          {value === k ? '●' : '○'} {k === 'reel' ? 'Reel' : 'Feed post'}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/
git commit -m "feat(video-page): shared posting-card primitives (editable-field, hashtag split, posted row, reel toggle)"
```

### Task 8.2: Server actions — save platform caption + social metadata + post

**Files:**
- Create: `dashboard/src/app/actions/video-page/save-platform-caption.ts`
- Create: `dashboard/src/app/actions/video-page/save-social-metadata.ts`
- Create: `dashboard/src/app/actions/video-page/post-platform.ts`

- [ ] **Step 1: `save-platform-caption.ts` — writes one key inside `clip_plans.captions`.**

```typescript
'use server';
import { createClient } from '@/lib/supabase/server';
import { getCanonicalClipPlan } from '@/lib/clip-plan';

export async function savePlatformCaption(jobId: string, platform: string, text: string): Promise<void> {
  const supabase = await createClient();
  const plan = await getCanonicalClipPlan(supabase, jobId);
  if (!plan) throw new Error('No clip plan for job');
  const next = { ...(plan.planJson as Record<string, unknown>) };
  const captions = { ...((next as { captions?: Record<string, string> }).captions ?? {}) };
  captions[platform] = text;
  (next as { captions: Record<string, string> }).captions = captions;
  const { error } = await supabase.from('clip_plans').update({ plan_json: next }).eq('id', plan.id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: `save-social-metadata.ts` — writes `clip_plans.social_metadata` + `youtube_tags`.**

```typescript
'use server';
import { createClient } from '@/lib/supabase/server';
import { getCanonicalClipPlan } from '@/lib/clip-plan';

export async function saveSocialMetadata(jobId: string, patch: { social_metadata?: Record<string, unknown>; youtube_tags?: string[] }): Promise<void> {
  const supabase = await createClient();
  const plan = await getCanonicalClipPlan(supabase, jobId);
  if (!plan) throw new Error('No clip plan for job');
  const update: Record<string, unknown> = {};
  if (patch.social_metadata) update.social_metadata = patch.social_metadata;
  if (patch.youtube_tags) update.youtube_tags = patch.youtube_tags;
  const { error } = await supabase.from('clip_plans').update(update).eq('id', plan.id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: `post-platform.ts` — posts to one platform (reuses `autoPost` with `selectedPlatforms=[platform]`).**

```typescript
'use server';
import { autoPost } from '@/lib/auto-post';
import type { Platform } from '@/lib/platforms';

export async function postToPlatform(
  videoId: string,
  platform: Platform,
  captions: Partial<Record<Platform, string>>,
  options: { scheduledAt?: Date; shareNow?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const res = await autoPost({
    videoId,
    captions,
    selectedPlatforms: [platform],
    scheduledAt: options.scheduledAt ?? new Date(),
    shareNow: options.shareNow ?? true,
  });
  if (res.error) return { ok: false, error: res.error };
  return { ok: true };
}
```

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/actions/video-page/save-platform-caption.ts dashboard/src/app/actions/video-page/save-social-metadata.ts dashboard/src/app/actions/video-page/post-platform.ts
git commit -m "feat(video-page): server actions for per-platform caption / metadata / post"
```

### Task 8.3: Site card (live vs draft variants)

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/site-card.tsx`

- [ ] **Step 1: Component with both variants.**

```typescript
'use client';
import { useState } from 'react';
import { EditableField } from './_shared/editable-field';
import { BottomSheet } from '../bottom-sheet';

interface Props {
  videoId: string;
  parshaSlug: string;
  isLive: boolean;
  liveSince: string | null;     // ISO; null if not live yet
  liveVersionLabel: string | null; // e.g. "v2"; null when not live
  title: string;
  subtitle: string;
  description: string;
  websiteUrl: string;
  onPublish: () => Promise<void>;
  onSaveField: (field: 'title' | 'subtitle' | 'description', value: string) => Promise<void>;
  onUnpublish: () => Promise<void>;
  onReplace: () => Promise<void>;  // called from the confirm sheet; routes to Phase 1 of a fresh draft via the parent
}

export function SiteCard(p: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false);

  if (p.isLive) {
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>🌐 torahtaichi.com</div>
            <div style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600, marginTop: 2 }}>● Live{p.liveSince ? ` since ${new Date(p.liveSince).toLocaleDateString()}` : ''}</div>
          </div>
          <a href={p.websiteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--navy-700)', textDecoration: 'underline' }}>View page →</a>
        </div>
        <div style={{ fontSize: 14, marginBottom: 6 }}><strong>{p.title}</strong></div>
        <div style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 6 }}>{p.subtitle}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 14 }}>{p.description}</div>
        <button
          type="button"
          onClick={() => setConfirmReplace(true)}
          style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}
        >
          Replace site version
        </button>
        <BottomSheet
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          title="Replace what's on torahtaichi.com?"
          primaryAction={{
            label: 'Yes — start a new version',
            onClick: async () => { setConfirmReplace(false); await p.onReplace(); },
            destructive: true,
          }}
          secondaryAction={{ label: 'Cancel', onClick: () => setConfirmReplace(false) }}
        >
          This starts a new draft. {p.liveVersionLabel ?? 'The current version'} stays live on the website until you publish the new one.
        </BottomSheet>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
      <div style={{ fontSize: 11, color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>🌐 torahtaichi.com — not yet published</div>
      <EditableField storageKey={`site.${p.parshaSlug}.title`} label="Title" initialValue={p.title} onSave={(v) => p.onSaveField('title', v)} multiline={false} />
      <EditableField storageKey={`site.${p.parshaSlug}.subtitle`} label="Sub-title" initialValue={p.subtitle} onSave={(v) => p.onSaveField('subtitle', v)} multiline={false} />
      <EditableField storageKey={`site.${p.parshaSlug}.description`} label="Description (longer copy + SEO meta)" initialValue={p.description} onSave={(v) => p.onSaveField('description', v)} />
      <button
        type="button"
        onClick={p.onPublish}
        style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: 'pointer' }}
      >
        Publish to torahtaichi.com
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the `videos.{title,subtitle,description}` save action.**

Add to `dashboard/src/app/actions/video-page/`:

```typescript
// save-site-fields.ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function saveSiteField(videoId: string, field: 'title' | 'subtitle' | 'description', value: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('videos').update({ [field]: value }).eq('id', videoId);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 3: Reuse the existing `set-video-published.ts` server action (preserves auto-unpublish-sibling invariant) for `onPublish` and `onUnpublish`.**

Confirm via `grep set-video-published dashboard/src/`.

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/site-card.tsx dashboard/src/app/actions/video-page/save-site-fields.ts
git commit -m "feat(video-page): Site card — live-vs-draft variants per spec §5.2"
```

### Task 8.4: TikTok card

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/tiktok-card.tsx`

- [ ] **Step 1: Component.** Follow the same pattern as `SiteCard`: posted state shows `PostedSummaryRow` collapsed; unposted shows `CaptionAndHashtags` + `Post to TikTok` button. Edit flow uses `BottomSheet` with Branch A or B copy depending on §13 verification result.

```typescript
'use client';
import { useState } from 'react';
import { CaptionAndHashtags } from './_shared/hashtag-field';
import { PostedSummaryRow } from './_shared/posted-summary-row';
import { BottomSheet } from '../bottom-sheet';
import { savePlatformCaption } from '@/app/actions/video-page/save-platform-caption';
import { postToPlatform } from '@/app/actions/video-page/post-platform';
import { editPostedOnPlatform } from '@/app/actions/video-page/edit-posted';

interface PostRow { status: string; created_at: string; buffer_update_id: string | null; caption: string | null }
interface Props {
  jobId: string;
  videoId: string;
  parshaSlug: string;
  caption: string;                  // current value (may be from localStorage draft or DB)
  post: PostRow | null;
  postUrl: string | null;
}

export function TikTokCard({ jobId, videoId, parshaSlug, caption, post, postUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editFlowOpen, setEditFlowOpen] = useState(false);

  const isPosted = post?.status === 'published';

  if (isPosted && !expanded) {
    return <PostedSummaryRow icon="📱" platform="TikTok" postedAt={post.created_at} viewsLabel={undefined} postUrl={postUrl} onExpand={() => setExpanded(true)} />;
  }

  if (isPosted) {
    // Expanded posted view: read-only + Edit on TikTok button
    return (
      <div style={{ border: '1px solid var(--ink-100)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--linen-50)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 13 }}>📱 TikTok · posted</strong>
          <button type="button" onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-500)', cursor: 'pointer' }}>▴</button>
        </div>
        <div style={{ fontSize: 13, padding: 8, background: 'white', border: '1px solid var(--ink-100)', borderRadius: 6, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{post.caption}</div>
        <button type="button" onClick={() => setEditFlowOpen(true)} style={{ width: '100%', minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
          Edit on TikTok
        </button>
        <BottomSheet
          open={editFlowOpen}
          onOpenChange={setEditFlowOpen}
          title="Edit this post?"
          primaryAction={{ label: 'Yes — open editor', onClick: () => setEditFlowOpen(false /* + open inline editor */) }}
          secondaryAction={{ label: 'Cancel', onClick: () => setEditFlowOpen(false) }}
        >
          {/* Copy varies per §13 branch — populated at build time from the verified branch */}
          {process.env.NEXT_PUBLIC_EDITPOST_BRANCH === 'A'
            ? 'Saving will update the post on TikTok. Likes and comments will be preserved.'
            : 'Editing this post will unpost it from TikTok and post the new version. The original post\'s likes and comments will be lost.'}
        </BottomSheet>
      </div>
    );
  }

  // Unposted: editable
  async function onPost() {
    await postToPlatform(videoId, 'tiktok', { tiktok: caption }, { shareNow: true });
  }

  return (
    <div style={{ border: '1.5px solid var(--navy-700)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'white' }}>
      <div style={{ fontSize: 11, color: 'var(--navy-700)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>📱 TikTok · next up</div>
      <CaptionAndHashtags storageKey={`caption.tiktok.${parshaSlug}`} initialCombined={caption} onSave={async (next) => savePlatformCaption(jobId, 'tiktok', next)} />
      <button type="button" onClick={onPost} style={{ width: '100%', minHeight: 48, fontSize: 14, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
        Post to TikTok
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test + screenshot to `qa-screenshots/video-redesign/08-tiktok-card.png`.**

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/tiktok-card.tsx
git commit -m "feat(video-page): TikTok card with posted/edit flows"
```

### Task 8.5: Instagram card

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/instagram-card.tsx`

- [ ] **Step 1: Mirror `TikTokCard`, adding:**
  - First-comment field (with `(may not appear on IG — Buffer report flagged this)` label).
  - `ReelOrPostToggle`.
  - On post, pass `social_metadata.instagram.{type, firstComment}` through `saveSocialMetadata` before posting.

Use the same shared primitives. Skip code repetition here — reproduce `TikTokCard`'s structure with the additional fields.

- [ ] **Step 2: Smoke-test + commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/instagram-card.tsx
git commit -m "feat(video-page): Instagram card with first-comment + Reel/Post toggle"
```

### Task 8.6: YouTube Short card

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx`

- [ ] **Step 1: Component with title + description + tags + cover-frame picker.**

Tags: editable comma-separated string saved via `saveSocialMetadata({ youtube_tags: [...] })`. Cover frame: stub for this task — picker UI deferred to Task 8.10.

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx
git commit -m "feat(video-page): YouTube Short card with editable title/description/tags"
```

### Task 8.7: Facebook card

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/facebook-card.tsx`

- [ ] **Step 1: Mirror Instagram (caption + hashtags + first-comment + Reel/Post toggle).**

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/facebook-card.tsx
git commit -m "feat(video-page): Facebook card (mirrors Instagram with FB metadata)"
```

### Task 8.8: X card

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/x-card.tsx`

- [ ] **Step 1: Minimal card — tweet text only.**

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/x-card.tsx
git commit -m "feat(video-page): X card (tweet text only; thread continuation deferred)"
```

### Task 8.9: Phase 5 assembly + progress strip

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/phase-5-post.tsx`

- [ ] **Step 1: Component that stacks all the cards in fixed order + renders the "Posted X of N" progress strip + back link.**

```typescript
'use client';
import { SiteCard } from './posting-cards/site-card';
import { TikTokCard } from './posting-cards/tiktok-card';
import { InstagramCard } from './posting-cards/instagram-card';
import { YouTubeCard } from './posting-cards/youtube-card';
import { FacebookCard } from './posting-cards/facebook-card';
import { XCard } from './posting-cards/x-card';
import { useRealtimeRows } from '@/hooks/use-realtime-rows';

interface Props { /* per-platform props bundled from the page; site, video, posts, etc. */ onBack: () => void }

export function Phase5Post(p: Props) {
  // ... realtime subscribe to posts so the progress strip updates live
  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--linen-50)', border: '1px solid var(--ink-100)', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
        <span><strong>Posted: X of 6</strong></span>
        <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>Remaining: …</span>
      </div>
      <SiteCard {...p.site} />
      <TikTokCard {...p.tiktok} />
      <InstagramCard {...p.instagram} />
      <YouTubeCard {...p.youtube} />
      <FacebookCard {...p.facebook} />
      <XCard {...p.x} />
      <div style={{ marginTop: 14, padding: '12px 0', borderTop: '1px solid var(--ink-100)' }}>
        <button type="button" onClick={p.onBack} style={{ background: 'none', border: 'none', color: 'var(--ink-500)', textDecoration: 'underline', fontSize: 13, cursor: 'pointer' }}>← Back to stitched video</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire into `page-new.tsx` for phase 5. Pass real props from the server-fetched data.**

- [ ] **Step 3: Smoke-test + screenshot to `qa-screenshots/video-redesign/09-phase5-full.png`.**

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/phase-5-post.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): Phase 5 assembly with progress strip + per-platform cards"
```

### Task 8.10: YouTube cover-frame picker

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/frame-picker.tsx`
- Modify: `dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx`

- [ ] **Step 1: Picker — uses HTML5 video `currentTime` to extract a frame as a blob via canvas.**

```typescript
'use client';
import { useRef, useState } from 'react';

interface Props {
  videoUrl: string;
  initialThumbUrl: string | null;
  onPick: (blob: Blob) => Promise<void>;
}

export function FramePicker({ videoUrl, initialThumbUrl, onPick }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialThumbUrl);
  const [pending, setPending] = useState(false);

  async function pick() {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth || 720;
    canvas.height = v.videoHeight || 1280;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    setPending(true);
    canvas.toBlob(async (blob) => {
      if (blob) {
        setPreviewUrl(URL.createObjectURL(blob));
        await onPick(blob);
      }
      setPending(false);
    }, 'image/jpeg', 0.9);
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-700)', marginBottom: 3 }}>Cover thumbnail</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {previewUrl && <img src={previewUrl} alt="cover preview" style={{ width: 80, height: 142, borderRadius: 4, background: 'var(--ink-900)', objectFit: 'cover' }} />}
        <div style={{ flex: 1 }}>
          <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" style={{ width: '100%', aspectRatio: '9/16', borderRadius: 4, background: 'var(--ink-900)' }} />
          <button type="button" onClick={pick} disabled={pending} style={{ marginTop: 8, minHeight: 44, padding: '8px 14px', fontSize: 13, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, cursor: 'pointer' }}>
            {pending ? 'Picking…' : 'Use this frame'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Server action to upload the picked blob to Supabase Storage and update the YouTube card to use it on post.**

(Mirror existing `thumb_path` write pattern from the stitch step.)

- [ ] **Step 3: Wire into `YouTubeCard`.**

- [ ] **Step 4: Smoke-test + commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/
git commit -m "feat(video-page): YouTube cover-frame picker"
```

### Task 8.10b: Schedule-for-later bottom sheet (spec §17 default)

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/schedule-for-later-sheet.tsx`
- Modify: each platform card to wire its "Schedule for later" link to this sheet.

- [ ] **Step 1: Bottom-sheet body with native `<input type="datetime-local">` (iOS Safari renders a native picker).**

```typescript
'use client';
import { useState } from 'react';
import { BottomSheet } from '../../bottom-sheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;
  onSchedule: (when: Date) => Promise<void>;
}

export function ScheduleForLaterSheet({ open, onOpenChange, platform, onSchedule }: Props) {
  // Default: tomorrow at 9 AM local
  const tomorrow9am = (() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d;
  })();
  const [when, setWhen] = useState<string>(toLocalInput(tomorrow9am));

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Schedule for ${platform}`}
      primaryAction={{
        label: 'Schedule',
        onClick: async () => { await onSchedule(new Date(when)); onOpenChange(false); },
      }}
      secondaryAction={{ label: 'Cancel', onClick: () => onOpenChange(false) }}
    >
      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-700)', marginBottom: 6 }}>When to post</label>
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        style={{ width: '100%', minHeight: 44, fontSize: 16, padding: 10, border: '1px solid var(--ink-100)', borderRadius: 6 }}
      />
    </BottomSheet>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 2: In each per-platform card's unposted state, wire the "Schedule for later" link to open this sheet, calling `postToPlatform(videoId, platform, captions, { scheduledAt: when, shareNow: false })`.**

- [ ] **Step 3: When `posts.status='scheduled'` for a platform, surface "Scheduled for [date]" pill on the platform card (instead of "● Posted ...").**

Add to the per-platform card's state logic:

```typescript
const isScheduled = post?.status === 'scheduled';
if (isScheduled) {
  return (
    <div style={{ /* ... */ }}>
      <strong>📱 TikTok · Scheduled for {new Date(post.scheduled_at!).toLocaleString()}</strong>
      <button type="button" onClick={/* cancel + return to unposted state */}>Cancel</button>
    </div>
  );
}
```

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/posting-cards/
git commit -m "feat(video-page): schedule-for-later bottom sheet + scheduled-state pill"
```

### Task 8.11: Edit-posted action (Branch A or Branch B)

**Files:**
- Create: `dashboard/src/app/actions/video-page/edit-posted.ts`

- [ ] **Step 1: Single action, branches internally on `process.env.EDITPOST_BRANCH`.**

```typescript
// dashboard/src/app/actions/video-page/edit-posted.ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { createUpdate } from '@/lib/buffer';
// Branch A only:
// import { editPostBuffer, deletePostBuffer } from '@/lib/buffer';  // (uncomment when added)

export async function editPostedOnPlatform(
  videoId: string,
  platform: string,
  newText: string,
): Promise<{ ok: boolean; mode: 'edited' | 'reposted'; error?: string }> {
  const branch = process.env.EDITPOST_BRANCH ?? 'B';
  const supabase = await createClient();

  // Find the most recent published post row for this video+platform.
  const { data: post } = await supabase
    .from('posts')
    .select('id, buffer_update_id')
    .eq('video_id', videoId)
    .eq('platform', platform)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!post?.buffer_update_id) return { ok: false, mode: 'edited', error: 'No published post found.' };

  if (branch === 'A') {
    // Call editPost via lib/buffer.ts (add the helper when Branch A is canonical).
    // const result = await editPostBuffer({ token: process.env.BUFFER_ACCESS_TOKEN!, postId: post.buffer_update_id, text: newText });
    // await supabase.from('posts').update({ caption: newText }).eq('id', post.id);
    return { ok: true, mode: 'edited' };
  }

  // Branch B: unpost + repost.
  // await deletePostBuffer({ token: process.env.BUFFER_ACCESS_TOKEN!, postId: post.buffer_update_id });
  // const fresh = await createUpdate({ ... text: newText, channelId: ..., shareNow: true, ... });
  // await supabase.from('posts').update({ status: 'unposted' }).eq('id', post.id);
  // await supabase.from('posts').insert({ ... buffer_update_id: fresh.id, status: 'published', caption: newText });
  return { ok: true, mode: 'reposted' };
}
```

- [ ] **Step 2: Add `editPostBuffer` and `deletePostBuffer` to `lib/buffer.ts` (mutation strings; same shape as `createUpdate`).**

- [ ] **Step 3: Set `EDITPOST_BRANCH=A` or `B` in `.env.local` based on Task 0.1's verification result.**

- [ ] **Step 4: Smoke-test the active branch.**

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/app/actions/video-page/edit-posted.ts dashboard/src/lib/buffer.ts .env.local.example
git commit -m "feat(video-page): edit-posted action — branches on EDITPOST_BRANCH per spec §13"
```

---

## Phase 9 — Live-state implementations + Replace flow

### Task 9.1: Live-at-rest landing component

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/live-at-rest.tsx`

- [ ] **Step 1: Component.**

```typescript
'use client';
import { useState } from 'react';
import { BottomSheet } from './bottom-sheet';

interface PlatformStatus { platform: string; postedAt: string | null; postUrl: string | null; viewsLabel: string | null }
interface Props {
  parshaName: string;
  versionLabel: string;          // "v2"
  videoMp4Path: string;
  thumbPath: string | null;
  websiteUrl: string;
  title: string;
  subtitle: string;
  publishedToWebsiteSince: string | null;
  platforms: PlatformStatus[];
  onReplace: () => void;
}

export function LiveAtRest(p: Props) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  return (
    <section>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <video src={p.videoMp4Path} poster={p.thumbPath ?? undefined} controls playsInline style={{ width: 200, aspectRatio: '9/16', borderRadius: 8, background: 'var(--ink-900)' }} />
        <div style={{ flex: '1 1 200px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(46,125,94,.12)', color: 'var(--jade)', borderRadius: 999, fontSize: 11, fontWeight: 600, marginBottom: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--jade)' }} /> LIVE since {p.publishedToWebsiteSince ? new Date(p.publishedToWebsiteSince).toLocaleDateString() : '—'}
          </span>
          <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--ff-display)', fontSize: 22 }}>{p.subtitle}</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-500)', fontSize: 13 }}>{p.title}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--ink-100)', borderRadius: 8 }}>
            {p.platforms.map((pl) => (
              <li key={pl.platform} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--ink-100)', fontSize: 13 }}>
                <span>{pl.platform}{pl.postedAt ? ` · posted ${new Date(pl.postedAt).toLocaleDateString()}` : ' · not posted'}</span>
                {pl.postUrl && <a href={pl.postUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--navy-700)', textDecoration: 'underline' }}>{pl.viewsLabel ?? 'View'} →</a>}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--ink-100)' }}>
            <a href={p.videoMp4Path} download style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 14px', fontSize: 13, color: 'var(--ink-500)', textDecoration: 'underline' }}>Download mp4</a>
            <button type="button" onClick={() => setConfirmReplace(true)} style={{ minHeight: 44, fontSize: 13, fontWeight: 500, background: 'white', color: 'var(--navy-700)', border: '1px solid var(--navy-700)', borderRadius: 8, padding: '0 16px', cursor: 'pointer' }}>
              Replace with a new version
            </button>
          </div>
        </div>
      </div>
      <BottomSheet
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title={`Start a new draft of ${p.parshaName}?`}
        primaryAction={{ label: 'Start a new draft', onClick: p.onReplace, destructive: true }}
        secondaryAction={{ label: 'Cancel', onClick: () => setConfirmReplace(false) }}
      >
        {p.versionLabel} stays live on torahtaichi.com + the social platforms until you publish the new one. The new draft starts from the same script — you can change it.
      </BottomSheet>
    </section>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/live-at-rest.tsx
git commit -m "feat(video-page): live-at-rest landing per spec §5.1"
```

### Task 9.2: Replace-version server action

**Files:**
- Create: `dashboard/src/app/actions/video-page/replace-version.ts`

- [ ] **Step 1: Action — creates a new draft (Phase 1) without triggering Modal, with the prior script's text pre-loaded.**

```typescript
'use server';
import { createClient } from '@/lib/supabase/server';

export async function replaceVersion(parshaId: string, sourceScriptId: string): Promise<{ scriptId: string }> {
  const supabase = await createClient();
  // Clone the source script into a fresh draft script row.
  const { data: src } = await supabase
    .from('scripts')
    .select('option, title, tldr, draft_text, director_notes, motion_ref_slug')
    .eq('id', sourceScriptId)
    .single();
  const { data: fresh, error } = await supabase
    .from('scripts')
    .insert({ ...src, parsha_id: parshaId, option: 'A-tight' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { scriptId: fresh.id };
}
```

- [ ] **Step 2: Commit.**

```bash
git add dashboard/src/app/actions/video-page/replace-version.ts
git commit -m "feat(video-page): replace-version action (clones source script into fresh draft)"
```

### Task 9.3: Draft-callout strip + landing on most-recent-completed-phase

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/draft-callout-strip.tsx`

- [ ] **Step 1: Component renders the strip; tap navigates to `/videos/[slug]?phase=<n>` where n is the most-recent-completed phase per spec §3.2.**

```typescript
'use client';
import Link from 'next/link';
import type { DraftPhase } from '@/lib/page-state';

interface Props { parshaSlug: string; draftJobId: string; phase: DraftPhase; clipsRendered: number; clipsTotal: number | null }

export function DraftCalloutStrip({ parshaSlug, phase, clipsRendered, clipsTotal }: Props) {
  // §3.2: land on the MOST RECENT COMPLETED phase (not the next pending one).
  // The page-state machine already gives us `phase`; that's the *current* phase.
  // The "most recent completed" is phase - 1 for an in-flight phase, or `phase`
  // if that phase is itself complete (e.g. a finished Phase 4 stitched video
  // for a draft that hasn't entered Phase 5 yet — phase remains 4 here).
  // For simplicity: link to phase 4 if stitched exists else clamp to phase.
  const PHASES = ['Script', 'Plan', 'Clips', 'Stitched video', 'Post'];
  return (
    <Link
      href={`/videos/${parshaSlug}?continue=1`}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: '#f1f3f8', border: '1px solid #d4dae4', borderRadius: 10, textDecoration: 'none', color: 'var(--navy-700)', marginBottom: 16 }}
    >
      <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--navy-700)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>●</span>
      <div style={{ flex: 1, fontSize: 13 }}>
        <strong>Draft in progress</strong> · Phase {phase} of 5 ({PHASES[phase - 1]}{clipsTotal ? ` · ${clipsRendered}/${clipsTotal} clips` : ''})
      </div>
      <span style={{ fontSize: 12, textDecoration: 'underline' }}>Continue draft →</span>
    </Link>
  );
}
```

- [ ] **Step 2: In `page-new.tsx`, when state = `live-and-draft` and `searchParams.continue !== '1'`, render LiveAtRest + DraftCalloutStrip. When `continue=1`, render the draft phase per spec §3.2 starting from `mostRecentCompletedPhase(draftJob, clips, video)`.**

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/draft-callout-strip.tsx dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "feat(video-page): draft-callout strip + landing on most-recent-completed phase"
```

### Task 9.4: Empty-state component

**Files:**
- Create: `dashboard/src/app/videos/[slug]/_components/empty-state.tsx`
- Modify: `dashboard/src/app/actions/video-page/trigger-plan-only.ts` (or add a new action that auto-generates scripts first)

- [ ] **Step 1: Component.**

```typescript
'use client';
interface Props { parshaName: string; onStart: () => Promise<void> }

export function EmptyState({ parshaName, onStart }: Props) {
  return (
    <section style={{ padding: '40px 20px', textAlign: 'center' }}>
      <p style={{ fontSize: 14, color: 'var(--ink-700)', marginBottom: 20 }}>
        {parshaName} doesn't have a video yet. The script generates automatically — review it, then we'll make the clips.
      </p>
      <button type="button" onClick={onStart} style={{ minHeight: 48, fontSize: 15, fontWeight: 500, background: 'var(--navy-700)', color: 'var(--linen-50)', border: 'none', borderRadius: 10, padding: '14px 28px', cursor: 'pointer' }}>
        Start scripting
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Add a `start-from-empty` action that ensures scripts exist (triggers script generation via the existing pipeline) and advances to Phase 1.**

- [ ] **Step 3: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/_components/empty-state.tsx dashboard/src/app/actions/video-page/
git commit -m "feat(video-page): empty-state + start-from-empty flow"
```

---

## Phase 10 — Server perf (parallelization + Suspense)

### Task 10.1: Parallelize the page's data fetch

**Files:**
- Modify: `dashboard/src/app/videos/[slug]/page-new.tsx`

- [ ] **Step 1: Replace any sequential `await` chains with `Promise.all` for independent queries.**

Example pattern:

```typescript
const [parsha, doneJobs, recentPosts, connectedPlatforms, defaultTier] = await Promise.all([
  supabase.from('parshiot').select(...).eq('slug', slug).single(),
  supabase.from('jobs').select(...).eq('parsha_id', parshaId).order('triggered_at'),
  supabase.from('posts').select(...).gte('created_at', sevenDaysAgo),
  getConnectedPlatforms(),
  supabase.from('site_content').select('value').eq('key', 'settings.default_tier').maybeSingle(),
]);
```

- [ ] **Step 2: Add Suspense boundaries around per-phase bodies.**

```typescript
import { Suspense } from 'react';

return (
  <>
    <BilingualHeader ... />
    <PersistentLiveStrip ... />
    <CompressedStepper currentPhase={phase} />
    <Suspense fallback={<PhaseSkeleton />}>
      <PhaseBody ... />
    </Suspense>
  </>
);
```

`PhaseBody` becomes its own async function that does the per-phase data fetches; the page shell renders immediately while the body streams.

- [ ] **Step 3: Smoke-test in dev — verify first paint shows header + stepper + live strip before the body content.**

- [ ] **Step 4: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/page-new.tsx
git commit -m "perf(video-page): parallelize data fetch + Suspense per phase"
```

### Task 10.2: Measure + tune

**Files:** None (verification only).

- [ ] **Step 1: Open `/videos/<slug>?v2=1` in Chrome DevTools, run Lighthouse mobile.**

Record first-paint, LCP, TTI numbers.

- [ ] **Step 2: If first-paint > 500ms or LCP > 1.5s, identify the slowest query and consolidate or move to client-side (Realtime hooks handle the freshness once mounted).**

- [ ] **Step 3: Document the numbers in the spec.**

Append to spec §8.3:

> Measured 2026-05-XX: first paint = Xms; LCP = Yms (Lighthouse, mobile-emulated, 4G throttling).

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/specs/2026-05-17-video-page-redesign.md
git commit -m "docs: record measured perf numbers post-Phase-10"
```

---

## Phase 11 — Migration validation + flag flip

### Task 11.1: Side-by-side validation + preserved-behavior verification

**Files:** None (validation only).

- [ ] **Step 1: With `?v2=0` (legacy), walk through Yonah's full flow on a test parsha: generate, review, publish, post to all platforms. Confirm nothing regressed.**

- [ ] **Step 2: With `?v2=1` (new), walk through the same flow. Confirm the 4-state model + 5-phase workflow + live-as-read-only invariant all behave per spec.**

- [ ] **Step 3: Verify spec §14 preserved-behavior list. Each item below must still work in the new page:**

  - [ ] Save-before-render race fix (commit `5b0b14c`) — type into a clip's voiceover, immediately hit Re-render, verify the typed text was sent to Modal (check `clip_plans.plan_json` or the resulting clip's voiceover).
  - [ ] WPS auto-extend on render (commit `f8ecace`) — set a clip's voiceover to overshoot its duration, regen, verify Modal bumped `duration_s` accordingly.
  - [ ] Live WPS indicator on textareas — visible on every voiceover field in Phase 2 and Phase 3.
  - [ ] Stitch-time `videos.spoken_script` (commits `5f12cd5`, `d870e4b`) — regen one clip, re-stitch, verify `videos.spoken_script` reflects the NEW clip's voiceover (not the old one).
  - [ ] `getCanonicalClipPlan` helper — verify Phase 5 caption save (`save-platform-caption.ts`) uses it via grep.
  - [ ] Caption draft localStorage — type a caption, refresh the page, verify the draft persists.
  - [ ] Per-clip regen preserves compose picks (commit `eb70776`) — compose a video with mixed clip versions, regen ONE clip, verify the OTHER clips in the new compose are the same versions you had picked (not the latest of each).
  - [ ] Auto-unpublish sibling on publish — publish a new version, verify the prior version's `published_to_website` flipped to false.

- [ ] **Step 4: Capture before/after Playwright screenshots in `qa-screenshots/video-redesign/`.**

- [ ] **Step 5: Have Yonah try the new page on his iPhone for a real Saturday parsha cycle. Collect feedback in a brief markdown note at `qa-screenshots/video-redesign/yonah-feedback.md`.**

- [ ] **Step 6: Commit screenshots + feedback.**

```bash
git add qa-screenshots/video-redesign/
git commit -m "docs(video-page): validation screenshots + Yonah feedback notes"
```

### Task 11.2: Flip the flag globally

**Files:** None (DB update only).

- [ ] **Step 1: After validation, set the flag default:**

```sql
INSERT INTO site_content (key, value) VALUES ('settings.video_page_v2', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

- [ ] **Step 2: Smoke-test once more without the `?v2=1` override.**

- [ ] **Step 3: No commit (DB state only).**

### Task 11.3: Delete the legacy page (after 2 weeks stable)

**Files:**
- Delete: `dashboard/src/app/videos/[slug]/page-legacy.tsx`
- Modify: `dashboard/src/app/videos/[slug]/page.tsx` (remove dispatcher, rename `page-new.tsx` to `page.tsx`)
- Possibly delete: components only referenced from the legacy page

- [ ] **Step 1: Identify dead components.**

```bash
grep -rln "from.*page-legacy\|from.*editable-clip-card\|from.*editable-clip-list\|from.*script-carousel" dashboard/src/
```

For each component still referenced from the new page (some likely will be — caption draft mechanism, etc.), keep. For those only referenced from `page-legacy.tsx`, delete.

- [ ] **Step 2: Move `page-new.tsx` content into `page.tsx`, remove the dispatcher.**

- [ ] **Step 3: Remove `getFlag('video_page_v2')` from `feature-flag.ts` if no other caller uses it (leave the helper itself for future flags).**

- [ ] **Step 4: Smoke-test.**

- [ ] **Step 5: Commit.**

```bash
git add dashboard/src/app/videos/[slug]/ dashboard/src/components/
git commit -m "chore(video-page): remove legacy page + flag dispatcher after 2 weeks stable"
```

- [ ] **Step 6: Archive the related plan docs.**

```bash
git mv docs/superpowers/plans/2026-05-15-video-page-ux-rethink.md docs/superpowers/plans/archive/
git mv docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md docs/superpowers/plans/archive/
git mv docs/superpowers/plans/2026-05-04-editing-v2.md docs/superpowers/plans/archive/
git commit -m "docs: archive superseded plans now that video-page-redesign is live"
```

---

## Self-review notes

After completing the plan, the engineer should verify against spec §15 (Definition of done):

- [ ] Yonah can take a fresh parsha from "no video" → published + posted everywhere, on his iPhone, in one sitting, without asking what to click.
- [ ] He can iterate on a single clip and visually confirm before moving on.
- [ ] He can revert a per-clip regen via the version picker (no SQL, no refresh).
- [ ] No Generate button is visible anywhere on the page while a version is live.
- [ ] The persistent live-status strip is visible on every screen where a live version exists.
- [ ] First paint < 500ms on a 4G iPhone (per Task 10.2 measurement).
- [ ] No bandaid fixes in the first 30 days after launch.

If any of these fail validation, file a follow-up plan; do not patch the spec mid-implementation.
