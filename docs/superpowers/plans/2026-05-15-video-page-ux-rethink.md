# Video page UX rethink

**Status:** Note / not started. Captured 2026-05-15 after a critical-issue session.

## The problem

The `/videos/[slug]` page has become unusable. Yonah (the primary
operator, non-technical) recently iterated 26+ versions of a single
parsha while building it out, and lost track of:
- Which version is currently live on torahtaichi.com
- Which versions have been posted to social / YouTube
- What "this clip's edits will become" vs. "what's already rendered"
- What the per-clip action buttons (Re-render, Apply, Publish) actually do
- Where to find the title/script/scene-direction edit fields for each
  version

The publish state in particular caused a real-world incident:

> 2026-05-15, ~mid-day: Yonah saw "Not on torahtaichi.com yet" on the
> latest version of Bamidbar. He assumed nothing was on the public
> site. In reality, an EARLIER version (v3 or so from that morning)
> had been published + posted to TikTok / Instagram / YouTube / X.
> Yonah confused himself for ~2 hours and the public site was showing
> a different script than he'd written. Resolved by manually
> unpublishing the live version via service-role Supabase.

The page accreted features quickly:
- Per-clip version chips (v1 v2 ... vN)
- Per-clip re-render with tier picker
- Per-clip text editor (voiceover + scene direction)
- WPS indicator (just added)
- Auto-extend hint (just added)
- Compose / apply selections across clips
- Captions panel per platform
- YouTube comments, analytics drill-down
- Publish-to-website toggle with sibling auto-unpublish
- Schedule sheet with per-channel selection
- Post-now flow that publishes + schedules across platforms

Each addition was reasonable in isolation. Together they overwhelm
the primary task: "I want to make a video, see it, publish it, post it."

## Specific problems observed

1. **Publish state is per-video, not per-parsha.** When viewing v26
   of Bamidbar and v3 is the published one, the page says "Not on
   torahtaichi.com yet" — true for v26, but no signal that v3 IS
   on the site. Yonah cannot easily see "which version of this
   parsha is currently live."

2. **Version chips don't surface key facts.** v1-v26 all look the same
   visually. No indication of:
   - Which one is published to website
   - Which one was posted to social (and when)
   - Whether the version is from a regen, compose, or full pipeline
   - Whether the version has the user's latest text edits

3. **The card list has no information hierarchy.** Yonah has to
   scroll the whole page to find what he's looking for. The "what
   you actually want to do next" CTA is buried.

4. **Title editing is not visible.** Yonah asked "how do I edit the
   title" — there's no place to do that for the website. He has to
   know that website title = parsha name (auto-derived) and that
   YouTube title lives in the captions panel. Both are surprising.

5. **Too many ways to take the same action.** Re-render lives on
   each clip card. Schedule-all lives at the bottom. Publish lives
   in a dialog. Post-now lives in a sheet. Each has different
   gating logic.

## Goals for the rethink

- **One screen, one task at a time.** The page is currently trying to
  be edit + iterate + compare + schedule + publish + comment-read
  all at once. Split into modes / tabs / phases.
- **Make "what's live" obvious at all times.** If anything is on the
  public website or social, show that prominently with a way to
  unpublish/replace.
- **Make versions glanceable.** Version chips should show their
  publish/post state at a glance, not require clicking through.
- **Hide advanced controls behind progressive disclosure.** The 80%
  case (generate → review → publish) should not be cluttered by
  the 20% case (compose, per-clip regen with tier picker, AI
  feedback). Those go behind a "more" or a separate mode.
- **Title and metadata should have an obvious place.** Single
  "Metadata" panel per parsha covering: website title, website
  caption, YouTube title/description, per-platform social captions.

## What this is NOT

- Not a complete UI rewrite. Keep the underlying data model.
- Not a removal of features. Everything stays accessible; just
  reorganized so the primary path is clear.
- Not a thing to ship blindly. Needs brainstorming + mockups +
  Yonah's input before any code.

## Next steps when this is picked up

1. Spend a session watching Yonah do the full happy path
   (generate → review → publish) and write down every confusion.
2. Sketch a phased flow: Generate / Review / Publish / Post — each
   as its own screen with explicit "this is what's happening" copy.
3. Mockup in Pencil or by code-stubbing the main /videos/[slug] page.
4. Walk through with Yonah BEFORE building.
5. Then plan the implementation as a normal feature spec.

## Workarounds in the meantime

Until this lands, ship small fixes when these come up:
- **"v3 is live on torahtaichi.com" banner** when viewing a non-
  published version — directly addresses the 2026-05-15 incident.
  ~1 hour of work. Should be next quick fix.
- Mark version chips that are published / posted with a small
  badge (a dot or "LIVE" pill).
- Add a tooltip on the publish toggle clarifying "this version" vs
  "any version."

These are bandaids. The real fix is the rethink above.

## Additional bugs to clean up during the rework

Surfaced 2026-05-15 (afternoon, after Yonah's Bamidbar publishing
flow):

1. **Inline-edit reload reverts changes.** Yonah edited the script
   title via the inline-edit on the script carousel, hit save, the
   page reloaded and the change was lost. He reported the same thing
   happened on a social-media caption earlier. Likely cause: the
   inline-edit's optimistic update doesn't survive a `router.refresh()`
   the action triggers — the save returns OK, but the page re-fetches
   from the DB before the write is durable / before the cache
   invalidates. Needs investigation. Workaround: edit via direct DB
   update (service-role) until fixed.

2. **Anon RLS on `jobs` blocks the website's chain-walk for title
   resolution.** The website's `getParshaBySlug` and `getAllParshiot`
   walk `videos.job_id → jobs.script_id` to find the script that
   produced a published video. Anon can't read `jobs` (deliberate
   per existing comment — internal data). The walk silently returns
   null and falls back to A-tight's title. Two clean fixes:
     - **Snapshot `videos.title` at stitch time** (preferred): set-video-
       published.ts or modal_app.py stores the source script's title
       on the video row directly. Website reads `videos.title`. No anon
       RLS hole needed.
     - **Add an anon RLS policy** allowing SELECT of (id, script_id,
       regen_of_job_id) only. Smaller change but creates a precedent
       of poking holes for read-only fields.
   Until either lands, the workaround is: keep A-tight's title in
   sync with whatever the published video's actual source script title
   should be (manual or scripted).
