# test_buffer_edit_post — Buffer editPost verification

## Purpose

Determines whether Buffer's `editPost` GraphQL mutation (added Apr 22 2026)
can mutate the caption of a post **after it has already been published** to a
social platform. The answer locks in which branch Phase 5 of the
`/videos/[slug]` redesign uses:

| Outcome | Branch | Approach |
|---|---|---|
| `editPost` mutates the live caption | **Branch A** | True in-place caption edits |
| `editPost` fails or no-ops | **Branch B** | Delete the old post + repost with new caption |

## Prerequisites

1. `BUFFER_ACCESS_TOKEN` set in your environment (from `dashboard/.env.local`).
2. `TEST_MP4_URL` set to a **publicly reachable** small `.mp4` URL.
   TikTok rejects text-only video posts — the media is required.
   Example: a short clip already uploaded to Supabase storage or a public CDN.
3. A TikTok channel connected in your Buffer account.
4. `tsx` installed (`npm install` in `dashboard/` covers this — it's a devDep).

## What the script does (safe-use protocol)

> **This script posts a real video to your TikTok account.**
> The post is labeled `[TEST POST — please ignore]` and is deleted at the end,
> but it will be publicly visible for approximately 15–20 minutes during the
> test window. Do not run this on a production account without understanding this.

1. Lists Buffer profiles, finds the TikTok channel.
2. Posts the test video with `shareNow=true`.
3. Waits ~10 minutes for TikTok to process and publish the upload.
4. Polls `getPostExternalLinks` to confirm the `externalLink` resolves.
5. Calls `editPost` with updated caption text.
6. Waits ~5 minutes for propagation.
7. **PAUSES** and prints the TikTok URL — you must manually verify whether
   the caption changed on TikTok itself. (Buffer's API response saying
   "success" is not sufficient; TikTok may ignore the edit silently.)
8. Deletes the test post from Buffer (TikTok deletion propagates
   asynchronously — may linger minutes longer on the platform).

Total elapsed time: ~17–20 minutes.

## How to run

From the **repo root**:

```bash
tsx --env-file=.env tools/test_buffer_edit_post.ts
```

`tsx`'s `--env-file` flag loads `.env` natively — no `dotenv` package required.
If your Buffer token lives in `dashboard/.env.local`, copy `BUFFER_ACCESS_TOKEN`
and `TEST_MP4_URL` into the root `.env` before running.

## After the run — update the spec

Once you have the result, open the video-page redesign spec
(`docs/superpowers/specs/*-video-page-redesign.md`) and update **§ 13
(Phase 5 — social caption editing)**:

- **Branch A confirmed:** document that `editPost` works post-publish.
  Phase 5 can use direct mutation; no delete/repost plumbing needed.
- **Branch B confirmed:** document that `editPost` does not propagate
  to the live post. Phase 5 must delete the Buffer post and repost with
  the corrected caption. Note any data loss (likes, comments, view count)
  that comes with the delete approach.

## Import structure

The script imports from `../dashboard/src/lib/buffer`:

- `listProfiles` — fetch all connected Buffer channels
- `createUpdate` — create a post (shareNow=true for immediate publish)
- `getPostExternalLinks` — poll for the platform-native URL

`editPost` and `deletePost` mutations are called directly against
`api.buffer.com/graphql` in this script (they are not yet in `buffer.ts`).
If either branch is confirmed as the approach for Phase 5, those mutations
should be promoted into `buffer.ts` and covered by types.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `No TikTok channel found` | TikTok not connected in Buffer | Connect TikTok in Buffer → Settings → Channels |
| `externalLink did not resolve after 16 minutes` | TikTok upload is slow / stuck | Check Buffer's publishing queue; re-run |
| `editPost` throws HTTP 4xx | Token scoped incorrectly | Regenerate token in Buffer with `write` scope |
| Post not deleted at end | Network error during cleanup | Delete manually at https://publish.buffer.com |

## Files

- [`test_buffer_edit_post.ts`](test_buffer_edit_post.ts) — the script
- [`test_buffer_edit_post.README.md`](test_buffer_edit_post.README.md) — this file
- [`../dashboard/src/lib/buffer.ts`](../dashboard/src/lib/buffer.ts) — Buffer GraphQL client (reused)
- [`../docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md`](../docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md) — redesign plan

## Repeat for Instagram + Facebook

After TikTok, change `tiktok` → `instagram` then `facebook` in the
script's `find()` call, re-run. The action handler can be per-platform
if behavior differs.
