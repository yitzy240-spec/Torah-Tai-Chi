# Per-Clip Regen + Compose — Smoke Test Runbook

This runbook walks through verifying the per-clip regen and compose flow end-to-end against real production-shaped data. Follow it in order; any step that fails should pause the rollout.

## Prerequisites — apply these once

Branch: `feat/per-clip-regen` (currently 12 commits ahead of `main`).

### 1. Apply the DB migration

```bash
cd dashboard
npx supabase migration up
```

Or, if Supabase CLI isn't linked: open the Supabase project → SQL editor → paste the contents of `dashboard/supabase/migrations/20260501_compose.sql` → Run.

Verify in Supabase Studio:
- `videos` table has a new `composed_from_clip_ids` column (jsonb, nullable)
- `jobs.kind` allows `'compose'` (constraint name `jobs_kind_check`)

### 2. Deploy Modal

```bash
modal deploy modal_app.py
```

In the deploy output you should see two new endpoints:
- `regen-single-clip-endpoint`
- `compose-video-endpoint`

### 3. Verify env vars

The dashboard derives Modal endpoint URLs by string-replacing `pipeline-trigger`. Confirm `MODAL_WORKER_URL` in the dashboard's env still points at `https://<account>--torah-tai-chi-pipeline-trigger.modal.run` so the replacement produces the right URLs.

### 4. Storage bucket — the `clips` bucket must be public-readable

The edit page streams individual clip mp4s via `/storage/v1/object/public/clips/...`. If the bucket is private, the per-clip previews will be broken. Open Supabase Storage → `clips` bucket → make it public (or attach an anon-readable RLS policy).

---

## Smoke test — actual flow

### Test 1: Per-clip regen scope is bounded

**Goal:** prove that "fix clip 2" only changes clip 2.

1. Open `/videos/<a-recent-checkpointed-parsha-slug>` (any parsha that's been generated since `20260430_clip_checkpoint.sql`).
2. Click "Edit clips →" — you land on `/videos/<slug>/edit`.
3. In Clip 2's card, type: `say Shabbat as Sha-BAHT clearly`.
4. Click "Regenerate this clip." Status flips to "Queuing…", then resets.
5. Watch the events log in Supabase (`select * from events where created_at > now() - interval '5 minutes' order by created_at desc;`). You should see:
   - `pipeline.status.loading_parsha` (mode=regen_single_clip)
   - `pipeline.status.generating_plan`
   - `pipeline.status.generating_clips`
   - `pipeline.status.stitching`
   - `pipeline.status.done`
   - **Zero `regen_agent.*` events.** If you see any of those, we hit the wrong endpoint.
6. After ~2-3 minutes the page revalidates. Refresh the edit page. Clip 2 has a new version in its gallery; clips 1, 3, 4 do **not**.
7. SQL spot-check:
```sql
select index, regen_of_clip_id, storage_path
from clips where job_id = '<the-regen-job-id>' order by index;
```
- Clip 2's `storage_path` is new (`jobs/<regen-job-id>/clips/clip_02.mp4`)
- Clips 0, 1, 3 share the parent's `storage_path` string (no new mp4 uploaded for them)

**Pass criteria:** only clip 2 changed.

### Test 2: Compose mixes versions

**Goal:** stitch clip 2 from one version + clip 3 from another.

1. On `/videos/<slug>/edit`, in Clip 2's gallery, click v1 (the original take).
2. In Clip 3's gallery, click whichever version isn't the current default.
3. Click "Compose."
4. Watch events: `pipeline.status.loading_parsha` → `stitching` → `done` (mode=compose).
5. After completion, the page redirects to `/videos`. Open the new compose video.
6. Play it: clip 2 is the original take, clip 3 is the alternate take, clips 1+4 are the latest.
7. Listen at the cuts — loudnorm should keep volume consistent.

**Pass criteria:** the final mp4 plays the user-selected mix in the right order.

### Test 3: Publish-version safety #1 — only one live per parsha

**Goal:** publishing v3 of Emor unpublishes v1 of Emor automatically.

1. Open `/videos/emor` (or any parsha with at least 2 versions).
2. Manually mark v1 as published in Studio: `update videos set published_to_website = true where id = '<v1-id>';`
3. Refresh `/videos/emor`. The page should now default to v1 (because of the published-version-first rule).
4. In the version chips, click v3. Click "Publish to site."
5. The confirm dialog opens. It should show:
   - "You're about to make Version 3 of Emor live"
   - **"Replaces Version 1"** callout in amber
   - Thumbnail of v3
6. Click "Publish to site" inside the dialog.
7. After save, query Studio: `select id, published_to_website from videos where job_id in (select id from jobs where parsha_id = '<emor-id>');`
   - Exactly one row has `published_to_website = true` (v3)
   - All others, including the previously-live v1, have `published_to_website = false`

**Pass criteria:** at most one live version per parsha after the publish.

### Test 4: Publish-version safety #2 — default-to-published

**Goal:** opening the page without `?v=` shows the live version, not the latest draft.

1. In Studio, ensure v3 of Emor has `published_to_website = true` and v4/v5 (if they exist) are false.
2. Open `/videos/emor` (no `?v=`).
3. The version selector should highlight v3, the player should be playing v3, and the publish toggle should show "Live on torahtaichi.com."
4. Click v5 in the version chips. URL becomes `/videos/emor?v=v5-id`. Now the publish toggle shows "Off torahtaichi.com" (v5 isn't published).
5. Reload the page (without `?v=`). It defaults back to v3.

**Pass criteria:** the published version is the default landing.

### Test 5: Publish-version safety #3 — confirm dialog

**Goal:** the confirm modal shows accurate context.

1. From a fresh page load, click "Publish to site" on a video.
2. The dialog opens. Verify:
   - Title: "Publish to torahtaichi.com?"
   - Version label matches the version chip you have selected
   - Parsha name matches the URL
   - Thumbnail renders (or no thumb area if the version has no thumb_path)
   - "Replaces Version N" appears iff a sibling is currently live
3. Click Cancel — modal closes, nothing changes.
4. Open it again, click "Publish to site." It saves and closes.

**Pass criteria:** dialog accurately summarizes what's about to happen, Cancel is non-destructive.

### Test 6: Publish-version safety #4 — unconnected platforms hidden

**Goal:** captions list reflects only connected channels.

1. In `/channels`, confirm which platforms have a Buffer profile and whether YouTube is connected. Expected today: TikTok, Instagram, YouTube, X yes; Facebook no.
2. Open any video page → scroll to "Per-platform preview."
3. The captions list should show TikTok, Instagram, YouTube, X cards. **No Facebook card.**
4. (Optional) Manually disconnect Instagram in Buffer → reload the page. Instagram should disappear from the list.

**Pass criteria:** only connected platforms appear.

### Test 7: Publish-version safety #5 — post-now bundles site publish

**Goal:** clicking "Post now" on an unpublished video also flips published_to_website.

1. Find a video that is `published_to_website = false`.
2. On `/videos/<slug>`, click "Post now."
3. The sheet opens with the "Post now" timing pre-selected. A green callout reads:
   > "This will also publish the video to torahtaichi.com (replacing any earlier version of this parsha)."
4. Click "Post now" inside the sheet.
5. Toast appears: "Posting to N channels and torahtaichi.com" — confirming the bundled site publish.
6. SQL check: `select published_to_website from videos where id = '<the-video-id>';` returns true.
7. If a sibling Emor was previously live, that sibling is now `false`.

**Pass criteria:** social posts go out, site publish flips, sibling unpublishes.

---

## Rollback plan

If any test fails badly enough that we want to back out:

1. **Revert the dashboard branch:** `git revert <the-bad-commits>` or simply re-deploy `main` to Vercel/wherever the dashboard lives.
2. **Modal:** `modal deploy modal_app.py` after checking out `main` — the new functions disappear from the deployed app.
3. **DB migration:** `composed_from_clip_ids` is additive (nullable), safe to leave in place. The `jobs_kind_check` constraint expansion is also safe — old code never sends `kind='compose'`.

---

## Known gaps not exercised by this runbook

- **Storage retention:** the design depends on never deleting per-clip mp4s. Confirm Supabase Storage doesn't have a TTL/lifecycle policy on the `clips` bucket.
- **Cross-clip continuity in compose:** when picks span different lineages, the first-frame chain breaks. Audio is normalized but visual cuts may feel abrupt. Not a regression, just a UX call.
- **Concurrency on publish:** two browser tabs both publishing different versions of the same parsha within the same second could race. The sibling-unpublish is two SQL calls back-to-back, not a single transaction. Low risk in practice (one user, one tab).
- **`bufferConfigured` vs connected-platforms:** `bufferConfigured` is just an env-var check; `getConnectedPlatforms` actually queries Buffer. They can disagree if the env var is set but the token is invalid. The captions list will silently hide platforms in that case, which is the right default ("don't promise channels we can't post to").
