# Torah Tai Chi — Content Management System Design

> **Status:** Approved for planning. Builds on Phase 2 (Direction v2 pipeline producing 30-45s Vayikra-style mp4s).
> **Spec author:** Claude Opus 4.6 with Yitzy
> **Date:** 2026-04-15

## 1. Why This Spec Exists

The v2 pipeline produces mp4s from a CLI command Yitzy runs. Yonah and Harvey can't operate the CLI, can't approve scripts, can't trigger regenerations, can't see analytics — every video shipped means Yitzy in the loop. That makes the system fragile, blocks scaling beyond ~weekly, and means any rough output requires Yitzy to fix it.

This spec defines a **content management system** Yonah operates end-to-end. He picks (or the system auto-picks via Hebcal) the next parsha, hits one button to generate a full video, reviews the final result, gives natural-language feedback for regens if needed, and publishes to all four channels — without touching code or terminal. Every step shows real-time cost so he can manage spend.

## 2. Goals

- Yonah produces and ships a finished weekly video without Yitzy's involvement
- Default workflow is one-click ("generate full video"); stage-by-stage breakdown is opt-in
- Feedback-driven regeneration: Yonah types what he didn't like in plain English, system infers which clip(s) to regen, re-runs only those, re-stitches
- Cost is surfaced per action and as running totals so Yonah is conscious of spend
- Hebcal-driven calendar intelligence: next parsha auto-selected, holidays detected, special parshiot flagged
- Two independent automation toggles: generation (manual / auto-cron) and publishing (manual-approval / auto-post)
- Per-post analytics from Buffer (and later platform APIs) feed back into the dashboard
- Mobile-friendly: Yonah can approve from his phone

## 3. Non-Goals (explicitly out of scope)

- **Not** building a public-facing website (Phase 5, separate)
- **Not** building a CRM, donor management, or course-delivery platform
- **Not** building any AI/agent feature beyond what serves the current weekly content workflow
- **Not** supporting more than one organization/brand (single-tenant; if Yonah ever launches a second brand we re-evaluate)
- **Not** building real-time multi-user collaboration (Yonah and Harvey work async; concurrent edits OK with last-write-wins)
- **Not** a full media library / DAM (we store finished videos and references; we don't store every Yonah-uploaded asset he might ever produce)

## 4. Personas + Permissions

| Persona | Role | Permissions |
|---|---|---|
| **Yonah** | Owner, primary creator | Everything: trigger generation, approve, publish, edit settings, see analytics, regen with feedback, override calendar |
| **Harvey** | Operator/editor | Same as Yonah for v1 (later: split out approval-only role if needed) |
| **Yitzy** | Admin/dev | Same as Yonah + access to logs, cost overrides, manual SQL, cron config |

Auth: passwordless email magic-link via Supabase Auth. Three accounts pre-provisioned. No public signup.

## 5. Core Flow (Default Mode)

```
Hebcal pings system on Monday  →  next parsha pre-loaded in Yonah's inbox view
                                       ↓
Yonah opens the dashboard, sees "Vayechi — ready to generate. Estimated cost: $5.40"
                                       ↓
Yonah hits [Generate Full Video]
                                       ↓
Backend kicks off: Claude → ClipPlan, then 4 × Seedance clips, then ffmpeg stitch
                                       ↓ (~10-30 min later — Yonah gets a push notification)
"Vayechi video ready for review" — Yonah opens the dashboard
                                       ↓
Yonah watches the stitched mp4 in his phone or browser. Two paths:
   ┌──────────────────────────────────────────────┬────────────────────────────────────────┐
   ▼                                              ▼                                        
[Approve & Publish]                       [Give Feedback for Regen]                 
   ↓                                          ↓
Caption review pane: 4 captions             Text field: "the desert scene felt rushed"
shown side-by-side per platform.             Estimated regen cost surfaced: "~$1.20"
Yonah edits if needed.                       Yonah hits [Regenerate]
   ↓                                          ↓
Yonah picks schedule time                    Backend: Claude infers clip 2 needs regen with
(or "post now").                              modified visual_prompt; re-runs Seedance for
   ↓                                          clip 2 only; re-stitches.
Backend POSTs draft + 4 captions to           ↓
Buffer's API per scheduled platform           ~5-10 min later: notification "regenerated
posts.                                        Vayechi ready for review" — back to top of
   ↓                                          this branch.
Buffer publishes at scheduled time.
   ↓
Each platform's analytics start
trickling into the dashboard.
```

## 6. Two Independent Automation Toggles

Yonah configures these in Settings (and can override per video):

**Generation mode:**
- **Manual** (default for v1): Yonah hits [Generate] when he's ready
- **Auto-Hebcal**: Every Monday at 9am ET, the system auto-generates the next-week parsha. Yonah gets a notification when it's ready to review.

**Publishing mode:**
- **Manual approval** (default for v1): video sits in review state until Yonah approves
- **Auto-publish**: as soon as generation finishes, the system pushes drafts to Buffer with the scheduled posting time (no human gate). Yonah gets a notification with a link to view, but the post will go live unless he intervenes.

Combinations:
- Manual gen + Manual publish = full hands-on (the v1 default)
- Auto-gen + Manual publish = system makes weekly videos, Yonah approves
- Auto-gen + Auto-publish = full hands-off (set-and-forget)

## 7. Feedback-Driven Regeneration

The signature feature. Yonah doesn't review individual clips — he reviews the stitched video. When he wants a change, he writes feedback in plain English. The system figures out which clip(s) to regen.

### How it works

1. Yonah types feedback: "the desert scene moved too fast" or "I want more energy in the dojo at the start"
2. Backend calls Claude with: the original ClipPlan JSON + the feedback text
3. Claude returns a structured response:
   ```json
   {
     "affected_clips": [2],
     "modified_visual_prompts": {
       "2": "Sandstone outcrop overlooking a wide dry valley... [plus the existing prompt with a slower, more held-back camera move and longer beats]"
     },
     "modified_voiceovers": {},
     "explanation": "You said the desert scene felt rushed. That maps to clip 2 (the first desert clip). I've slowed the camera move from 'crane up' to 'slow tilt up' and added 'beats of stillness between motions' to the visual prompt.",
     "estimated_cost_usd": 1.20
   }
   ```
4. Backend shows the explanation + cost to Yonah for confirmation
5. Yonah hits [Regenerate clip 2 — $1.20]
6. Backend re-runs Seedance for clip 2 with the modified visual_prompt + voiceover
7. Re-stitches the new clip 2 with the existing clips 0, 1, 3
8. Notification: "Vayechi regenerated, ready for review"

If Claude is uncertain (e.g., feedback is ambiguous), it asks a clarifying question instead of guessing.

### Failure modes
- Claude picks wrong clip → Yonah can hit "regenerate" again with more specific feedback ("no, the dojo opening, not the desert"). System tries again.
- Claude picks too many clips (e.g., regen all 4 when only 1 needed) → cost is surfaced before commit; Yonah can decline and rephrase.

## 8. Cost Surfacing

Per-action transparency:

| Action | Estimated cost |
|---|---|
| Generate ClipPlan (Claude only) | ~$0.10 |
| Generate 1 clip at 720p (Seedance) | ~$1.20 |
| Generate full video (4 clips at 720p) | ~$4.90 |
| Regen 1 clip | ~$1.20 |
| Regen 2 clips | ~$2.40 |
| Generate caption set (Claude) | ~$0.05 |
| Push to Buffer + 4-channel distribution | $0 (Buffer subscription is flat) |

Estimates surfaced inline before any paid action ("Generate Vayechi — estimated $4.90"). Actual cost computed from API responses post-action and shown in toast + history.

Running totals visible in dashboard:
- This week: $X.XX
- This month: $X.XX (vs $50 budget — set per Yonah's preference)
- Per-video lifetime cost (initial gen + all regens) shown in archive

Cost data lives in `cost_events` table — every paid API call inserts a row with action type, parsha, cost, timestamp.

## 9. Hebcal Integration

[Hebcal API](https://www.hebcal.com/home/195/jewish-calendar-rest-api) is free, mature, returns parsha + holidays + Hebrew dates per Gregorian date.

**What we use:**
- `GET /shabbat?cfg=json&geonameid=281184` — returns this Shabbat's parsha + candle-lighting times (geonameid 281184 = Jerusalem; we may use US zone for default Yonah location)
- `GET /converter?cfg=json&date=YYYY-MM-DD` — returns Hebrew date + parsha
- `GET /hebcal?cfg=json&v=1&maj=on&min=on&mod=on&nx=on&year=YYYY&month=x&ss=on&mf=on&c=on&geonameid=281184` — full year of holidays, special shabbatot, fast days

**How it integrates:**
1. Cron runs Sunday 8pm ET — fetches the upcoming Shabbat's parsha
2. Maps parsha name to entry in `parshiot.json`. If the parsha has a Yonah-written script (option A/B/C), pre-populates the inbox. If no script exists yet, flags it as "need draft from Yonah" (Yonah uploads/types one in the dashboard).
3. If a holiday falls between now and next Shabbat, surfaces it in the dashboard with a "consider topical mention" suggestion (e.g., "Tisha B'Av is this week — should the script reference it?").
4. Special parshiot (Shekalim, Zachor, Parah, HaChodesh) flagged with a banner so Yonah knows.

**Optional topical news layer (Slice 7+):** call Anthropic's web_search for Israel/Jewish news headlines from the last 7 days, ask Claude "any of these tie thematically to this week's parsha?" — return 0-3 suggestions Yonah can accept/reject before generation. Off by default.

## 10. Buffer Integration

Buffer is the API only — Yonah never opens Buffer's app. We POST to it; it distributes to TikTok, Instagram Reels, YouTube Shorts, Facebook.

**Setup (one-time):**
- Yonah creates a Buffer account, connects all 4 social accounts
- Yonah grants our app OAuth access via Buffer's API
- We store the token in Supabase

**Per-video flow:**
1. Pipeline finishes, video uploaded to Supabase Storage with a public URL
2. Backend POSTs to `https://api.bufferapp.com/1/updates/create.json` with: media URL, text (caption), profile_ids (which Buffer-connected channels), scheduled_at (epoch time)
3. Optionally per-platform variants in a single call (or one call per platform if captions differ)
4. Buffer publishes at the scheduled time
5. Webhook (or polling) returns post ID + URL once live; we store in `post_events` table
6. Per-post analytics fetched daily from Buffer's analytics endpoint, stored in `post_analytics` table

**Failure handling:**
- Buffer API down → retry with exponential backoff, then alert Yonah
- A specific channel rejects (e.g., TikTok flags content) → notify Yonah, mark that channel as failed, others proceed

## 11. Architecture

### Frontend
- **Next.js 14+ on Vercel** (App Router, Server Components, Server Actions for mutations, RSC for read paths)
- **Tailwind CSS + shadcn/ui** for UI primitives (consistent design language, mobile-first)
- **Auth via Supabase Auth** (passwordless magic links)
- **Hosted on Vercel** (Hobby tier free, Pro $20 if needed for commercial usage / better limits)

### Backend
- Same Next.js app — API routes / Server Actions handle:
  - Trigger generation (kicks off pipeline run as background job)
  - Approve/publish (calls Buffer API)
  - Submit feedback for regen (calls Claude → kicks off targeted regen)
  - Fetch analytics (calls Buffer + caches)

### Pipeline runner (the part that takes 10-30 min)
This is where it gets interesting. Vercel serverless functions max out at 60s on Hobby, 300s on Pro. The pipeline takes 10-30 min. Options:

**Option A — Vercel Cron + queued background worker (recommended):** Queue a job in Supabase (a row in `pipeline_jobs` table). A separate worker process (Modal, Render Background Worker, Railway, GitHub Actions, or a long-running VPS) polls or subscribes to that queue and executes the pipeline. Posts status updates back to Supabase as it progresses; the dashboard subscribes via Supabase realtime to show live progress. **My pick.**

**Option B — Modal-only:** Modal.com is purpose-built for long-running Python jobs. Has its own queue and HTTP triggers. Pipeline lives in Modal entirely; Vercel just calls the Modal endpoint. Cost: ~$0-5/mo at our volume.

**Option C — Local machine with cron/agent:** keeps current architecture; Yitzy's machine runs a polling agent that picks up pending jobs from Supabase. Cheap but fragile (depends on Yitzy's machine being on).

**Decision deferred to Slice 1 implementation** — pick once we're actually building. My lean is **Option B (Modal)** for simplicity.

### Database (Supabase Postgres)

```
parshiot
  id, name, book, order, slug, hebrew_name, special_flag

scripts                 -- Yonah's draft scripts per parsha
  id, parsha_id, option (A/B/C), title, style_note, draft_text, approved_by, approved_at

jobs                    -- a single end-to-end generation run
  id, parsha_id, script_id, status (queued/running/done/failed/cancelled),
  triggered_by_user_id, triggered_at, completed_at, total_cost_usd

clip_plans              -- the Claude-generated structured plan per job
  id, job_id, plan_json, claude_cost_usd, created_at

clips                   -- one per Seedance generation
  id, job_id, index, voiceover, visual_prompt, setting_id, duration_s,
  seedance_task_id, mp4_url, status, cost_usd, created_at, completed_at

regenerations           -- audit log of every regen
  id, job_id, feedback_text, claude_inference_json, affected_clip_indices,
  estimated_cost_usd, actual_cost_usd, completed_at

videos                  -- the stitched final output
  id, job_id, mp4_url, duration_s, created_at

captions                -- per-video, per-platform captions
  id, video_id, platform (tiktok/instagram/youtube/facebook), caption_text,
  approved_by, approved_at

posts                   -- Buffer-pushed, scheduled or published
  id, video_id, platform, buffer_update_id, scheduled_at, published_at,
  post_url, status

post_analytics          -- polled from Buffer/platforms
  id, post_id, fetched_at, views, likes, comments, shares, watch_time_s

cost_events             -- every paid API call
  id, job_id (nullable), action (clip/clipplan/caption/regen),
  vendor (kie/anthropic), cost_usd, raw_response_summary, created_at

settings                -- per-user prefs and global toggles
  id, user_id, key, value
  examples: gen_mode (manual/auto), publish_mode (manual/auto),
            monthly_budget_usd, notification_email, notification_phone,
            buffer_token, default_resolution
```

### File storage
- **Supabase Storage** bucket for finished videos + last-frame PNGs + dojo refs (already-uploaded character refs stay in the repo for now)
- ~2GB/month at our volume; well within free tier (1GB) → may need Pro ($25/mo) by month 4

### Notifications
- **Email** via Resend ($0-20/mo) for "video ready" and "regen complete" pings
- **SMS** via Twilio (later, optional) for urgent stuff

### Recurring monthly cost (target)
| Service | Cost |
|---|---|
| Vercel Hobby | $0 (Pro $20 if needed) |
| Supabase free tier | $0 (Pro $25 when storage exceeds 1GB) |
| Buffer Essentials | $12 |
| Resend free tier | $0 |
| Modal (or chosen worker) | $0-10 |
| Hebcal API | $0 (free) |
| **Total (low end)** | **$12** |
| **Total (when scale forces upgrades)** | **~$70** |

Plus variable AI costs:
| Per video | ~$5 |
| Per regen | ~$1-2 |
| 4 videos/month | ~$20-30 |

## 12. Slice Decomposition

Each slice is independently shippable and adds real value. Yonah is operationally usable from Slice 3 onward.

### Slice 1: Skeleton + Trigger + Final-Video Review (3-4 days)
- Auth (magic link via Supabase Auth, three pre-provisioned users)
- Empty dashboard with "Inbox" tab
- Manual parsha selection from a dropdown
- One [Generate Full Video] button → kicks off background pipeline job
- Live status: "Generating ClipPlan...", "Generating clip 2/4...", "Stitching..."
- When done: video player + "estimated cost: $X.XX, actual: $Y.YY"
- Cost display in header (this-week + this-month totals)
- **Acceptance:** Yonah can pick a parsha, hit one button, watch a finished video appear in the dashboard, see the cost.

### Slice 2: Feedback-Driven Regen (2-3 days)
- "I want a regen" textarea below the finished video
- Submit → Claude infers + returns plan + cost estimate
- Confirmation modal: "Will regen clip 2 — $1.20. Proceed?"
- Approve → background job runs targeted regen + restitch
- New version replaces the previous (history kept in `videos` table)
- **Acceptance:** Yonah types feedback, sees what will happen + cost, approves, gets a new video in 5-10 min.

### Slice 3: Buffer Push + Captions (2 days)
- Caption pane: 4 captions side-by-side per platform (Claude pre-generates from script)
- Yonah edits any of the 4 captions inline
- "Schedule" button: pick date/time per channel or "post all now"
- Backend POSTs to Buffer API with appropriate scheduled_at
- Confirmation: "Scheduled. View in dashboard or cancel before publish time."
- Manual cancel/reschedule before publish
- **Acceptance:** Yonah approves a video, edits captions, picks a time, video gets posted to all 4 channels via Buffer at the scheduled time.

### Slice 4: Auto Modes + Notifications (2 days)
- Settings page: Generation mode (Manual/Auto) + Publishing mode (Manual/Auto) toggles
- Auto generation: Vercel Cron triggers on configured schedule (e.g., Monday 9am ET)
- Auto publish: skips approval gate; auto-pushes to Buffer with default schedule
- Notification preferences: email (Resend) / SMS (Twilio later) for "ready to review", "published", "regen complete"
- **Acceptance:** Yonah enables Auto-gen, leaves it for a week, gets an email Monday saying "Vayechi ready to review", reviews on phone, approves.

### Slice 5: Hebcal Integration (1-2 days)
- Sunday cron fetches next Shabbat's parsha + nearby holidays
- Inbox displays "next: Vayechi (Genesis), Shabbat 2026-04-25" with parsha-specific draft auto-loaded if available
- Holiday flags shown with banner ("Tisha B'Av next week — consider mentioning")
- Special parshiot tagged
- **Acceptance:** Yonah doesn't pick parshiot anymore; the system always knows what's next.

### Slice 6: History + Analytics (2-3 days)
- "Archive" tab: all generated videos, sortable, with thumbnails + approval state + total cost
- Per-video page: shows the video, original ClipPlan, all regen entries, all 4 posted versions per platform with live links
- Analytics polled daily from Buffer (views, likes, comments, shares, watch time)
- Per-post performance card on the archive view
- **Acceptance:** Yonah can scroll back through every video he's made, see what worked, drill into any one to see its post performance.

### Slice 7 (deferred): Power-User Stage Breakdown + Topical News (3-4 days)
- Per-job "drill down": expand a generated video to see ClipPlan JSON + per-clip mp4 + per-clip cost
- Edit individual clip prompts and re-run that specific clip (manual override)
- Topical news weaving toggle: before generation, fetch headlines, ask Claude for thematic ties, surface 0-3 suggestions Yonah can accept/reject

## 13. UI/UX Notes

This system is mobile-first. Yonah will approve videos from his phone. The dashboard must work well on iOS Safari and Android Chrome at common phone widths (375px-430px), and gracefully scale up to desktop.

**Implementation will require these sub-skills (per Yitzy's note):**
- `bencium-innovative-ux-designer` or `frontend-design:frontend-design` — for distinctive, production-grade interfaces
- `mobile-app-design` — for the mobile-first design pass + iOS/Android conventions
- `mobile-ux-animations` — for transitions and microinteractions (especially around "generating..." progress, regen feedback flow)
- `interface-design` — overall dashboard architecture
- `ux-psychology` — for cost surfacing, approval-gate trust signals, regen-confidence cues

These get invoked at the start of Slice 1 (initial design pass) and revisited per-slice for new surfaces.

**Key UX patterns the design must nail:**
- The "Inbox" view (what's waiting) — Yonah's home page; should feel like a calm to-do list
- Cost surfacing without being scary — show the number plainly, one-tap to see breakdown, never a giant red warning
- The "regen feedback" textarea — feels like talking to a thoughtful colleague, not filing a bug report
- Live progress during generation — no spinning blank page; clear "we're at clip 2 of 4"
- Mobile approval flow — should be 3 taps from notification to approved-and-scheduled
- Calendar awareness shown subtly — "next: Vayechi" not "🔔 ALERT: NEXT PARSHA DUE"

## 14. Open Questions for Implementation

1. **Pipeline runner choice** (Modal vs Vercel-Cron-plus-worker vs local-with-agent) — pick during Slice 1 implementation
2. **Caption generation source** — does Claude write 4 platform-tuned captions from the script + video metadata, or do we let Yonah author one base caption and Claude derives 3 variants? (Spec leans Claude-writes-all-4; revisit if outputs feel off.)
3. **Regen confidence threshold** — when Claude is uncertain about which clip to regen, should it (a) pick the most likely and show the explanation, (b) show 2 candidates and ask Yonah to confirm, or (c) refuse and ask for more specific feedback? (Slice 2 design.)
4. **Cost budget alerts** — at what threshold does Yonah get warned? 80% of monthly budget? Per-action over $5? (Slice 1/4 design.)
5. **Multi-language captions** — Yonah may want Hebrew captions for IG/FB at some point. Out of scope for v1; data model already supports per-platform variants so it's a future-additive change.
6. **Video thumbnail / cover frame** — Buffer accepts custom thumbnails; we should let Yonah pick a frame from the video as the social cover. Slice 3+ feature.
7. **Topical news source** — Anthropic's web_search is one option; a dedicated Israel/Jewish news API is another. Slice 7 decision.

## 15. Success Criteria

After Slice 3 ships, Yonah should be able to: pick a parsha, hit Generate, watch the video, edit captions, schedule, and have it post — all without Yitzy.

After Slice 5 ships, Yonah should not need to pick parshiot manually for ~95% of weeks (only special cases like guest-week themes).

After Slice 6 ships, Yonah should be able to look at a 12-week-old post and answer "did this work?"
