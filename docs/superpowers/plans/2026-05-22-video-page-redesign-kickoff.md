# Video page redesign — kickoff plan

> **For the next session starting this:** This is the entry point. You're
> coming in with zero context. Read this doc front-to-back, then read
> the linked references. Do not start coding before brainstorming with
> Yonah. The page is in a working-but-confusing state — don't break
> working flows while fixing the confusing ones.

**Status:** Not started. Doc captured 2026-05-15 after a long firefighting day.

**Target start date:** Week of 2026-05-19 (so this is on disk when you pick it up).

**Estimated effort:** 5–10 working sessions across roughly two weeks.
Brainstorming + spec = sessions 1–3. Implementation = sessions 4–10.
Each session may be one Claude conversation or multiple.

## TL;DR

The dashboard route `/videos/[slug]` has accreted ~12 feature additions
since editing-v2 shipped. Each addition was reasonable in isolation;
together they overwhelm the non-technical operator (Yonah). On
2026-05-15 he confused himself for ~3 hours about which Bamidbar
version was live, published the wrong version twice, hit a 5+ secondary
bugs (inline-edit reload reverts, anon-RLS-blocks-title-resolution,
title shown was always A-tight regardless of source script, etc.).

The next session redesigns this page around the actual operator flow
("generate → review → publish → post"), splitting the current single
overloaded view into phased screens or progressive disclosure.

## Why this matters

Yonah is the primary operator. He's not technical. He drives the
content side of the product. Every hour he spends confused or
firefighting is an hour not spent making videos. Multiple recent
Claude Code sessions have been spent recovering from confusion rather
than shipping features. This rework is the highest-leverage thing
we can do for his throughput.

## Required reading (in order)

1. [docs/superpowers/plans/2026-05-15-video-page-ux-rethink.md](./2026-05-15-video-page-ux-rethink.md) —
   the diagnosis doc. List of accumulated features, observed problems,
   goals, non-goals, and the running list of bandaid fixes ready to ship
   if the full rework slips. **Read this first.**
2. Memory entries (auto-loaded):
   - `project_overview.md` — concept, people, social handles, domain
   - `user_delivery.md` — non-technical end users, keep it simple,
     AI-vibe-coding timelines (days, not weeks)
   - `project_dashboard.md` — Next.js + Supabase + Modal, multi-route,
     use `qa-screenshots/` before proposing UX changes
   - `project_video_page_ux_rethink.md` — short-form summary of the
     above rethink doc
3. [docs/superpowers/plans/2026-05-04-editing-v2.md](./2026-05-04-editing-v2.md) —
   the original editing-v2 plan that built the foundation. Knowing
   what was deliberately designed vs. accreted helps decide what to
   preserve.
4. Current `dashboard/src/app/videos/[slug]/page.tsx` — the file to
   redesign. ~1100 lines. Read top-to-bottom.
5. Current `dashboard/src/components/editable-clip-card.tsx` and
   `editable-clip-list.tsx` — the per-clip editing UI. Most of the
   active per-clip controls live here.

## Current state — what exists

| Component | Lives in | Owns |
|---|---|---|
| Version chips (v1 v2 v3 …) | `editable-clip-list.tsx` | Per-clip version selection + compose |
| Per-clip text editor (voiceover + scene direction) | `editable-clip-card.tsx` | Edit + auto-save + WPS indicator + Re-render button |
| Tier picker (720p / 1080p × Fast / Standard) | `editable-clip-card.tsx` | Per-clip resolution + cost estimate |
| Captions panel | `captions-list.tsx` | Per-platform caption edit + draft-localStorage persistence |
| Script carousel | `script-carousel.tsx` | Pick A / A-tight / B / C; inline-edit title + tldr |
| Publish-to-website toggle | inline on page.tsx | Per-video flag, auto-unpublishes sibling versions |
| Schedule sheet | `schedule-all-sheet.tsx` | Multi-platform select + datetime, calls scheduleAll action |
| Post-now / share | inline on page.tsx | Triggers immediate Buffer + YouTube post |
| YouTube comments | `youtube-comments.tsx` | Read-only display per video |
| Captions: per-platform analytics drill-down | `video-analytics-rows.tsx` | YT analytics per video, lazy-load |
| Job progress | `job-progress.tsx` | Real-time render state from Supabase Realtime |
| Cost totals | `cost-totals.tsx` | Sum of Seedance spend per parsha |

## Current state — what works (do NOT break)

These are intentional behaviors validated over multiple iterations.
Preserve them in any redesign:

- **Save-before-render race fix** (commit `5b0b14c`) — clicking
  Re-render flushes the pending debounced save first. Don't reintroduce
  the race.
- **WPS auto-extend on Re-render** (commit `f8ecace`) — Modal bumps
  `duration_s` to fit voiceover word count at 2.6 wps target. Keep.
- **WPS live indicator on textarea** (commit `5f4acc6`) — shows
  current wps + projected duration. Keep visible somewhere; can
  reposition.
- **Stitch-time spoken_script** (commit `5f12cd5` + `d870e4b`) —
  `videos.spoken_script` is rewritten from current clip voiceovers
  every stitch, with proper Hebrew + tai-chi transliterations. Don't
  revert to publish-time-only.
- **Canonical clip-plan lookup** (commit `52ac8c4`) — six call sites
  use `getCanonicalClipPlan()` to walk the parsha's job tree. The
  page rework MUST keep using this helper for any new caption / script
  lookups. Don't reintroduce the hardcoded-A-tight footgun.
- **Caption draft localStorage** (commit `d16a44e`) — text typed in
  caption textareas survives refresh / machine switch via localStorage.
  Critical UX for non-technical operator who tabs out mid-edit.
- **Per-clip regen preserves compose picks** (commit `eb70776`) — when
  regenerating one clip of a composed video, the OTHER clips stay as
  the compose's selections, not the source job's defaults. Yonah hit
  this for hours before it was fixed. Don't regress.
- **Auto-unpublish sibling on publish** (set-video-published.ts
  invariant 1) — only ONE video per parsha is on torahtaichi.com at
  a time. Publishing a new version auto-unpublishes the old. Keep.

## Current state — what's broken (the running list)

From the rethink doc + 2026-05-15 session:

1. **Publish state is per-video, not per-parsha.** Yonah views v26,
   the page says "Not on torahtaichi.com yet" — true for v26, but
   doesn't surface that v3 is currently live. Caused the morning's
   incident where the wrong version stayed published.

2. **Version chips don't surface key facts.** v1-vN all look the same.
   No indication of which is published, posted, AI-regenerated, or
   compose-stitched.

3. **No information hierarchy.** Yonah scrolls past 8 controls before
   finding the one he wants. The "do next" CTA is buried.

4. **Title editing is hidden / broken.** The website title comes from
   `scripts.title` (option=A-tight, hardcoded). No obvious dashboard
   UI to edit "the title on the website" — it lives on the script
   chip and the inline-edit reload-reverts changes (see bug 7).

5. **Too many ways to take the same action.** Re-render lives per-clip;
   Schedule lives at bottom; Publish in a dialog; Post-now in a sheet.
   Different gating logic each.

6. **Inline-edit reload reverts changes.** Yonah edits script title
   inline, hits save, page reloads, change is gone. Same on social
   captions earlier. Likely race between `router.refresh()` and the
   save completing. **Reproducible. Needs investigation in the
   rework.**

7. **Anon RLS on `jobs` blocks the website's title chain-walk.** The
   website's `getParshaBySlug` walks `videos.job_id → jobs.script_id`
   to find the source script. Anon can't SELECT `jobs` (deliberate),
   so the walk silently falls back to A-tight's title. Two clean
   fixes: snapshot `videos.title` at stitch time, or add a narrow
   anon RLS policy. **The rework should pick one.**

8. **Bamidbar 2026-05-15 chain-of-orphans.** Manual recovery jobs
   I created had `script_id=null`, breaking the chain walk. Yonah's
   recovery flow shouldn't depend on Claude Code sessions running
   one-shot scripts — operator-grade UX should never need a person
   in the loop typing SQL.

## Goals for the redesign

1. **One screen, one phase at a time.** Split the page into
   Generate → Review → Publish → Post (or similar). Each phase has
   one obvious next action. Hide controls not relevant to the current
   phase.

2. **"What's live" is impossible to miss.** Whether viewing v1 or
   v26, the page surfaces which version is currently on the website
   and on each social platform, with a way to replace or unpublish.

3. **Version chips communicate state at a glance.** Each chip shows
   a small badge indicating: published / posted / regenerated /
   composed. Hover or click reveals more.

4. **Progressive disclosure for advanced controls.** Per-clip tier
   picker, AI feedback, compose UI go behind a "more" or a separate
   mode. The 80% case (generate → review → publish) stays clean.

5. **Single, obvious metadata panel.** Website title, website caption,
   YouTube title/description, per-platform social captions in ONE
   place. Not scattered across script carousel + captions list.

6. **Save state is bulletproof.** Edits never disappear after a
   reload, error, or machine switch. localStorage drafts everywhere
   text is edited. No race between save and refresh.

## Goals for the redesign — non-goals

- Not a complete UI library swap.
- Not a removal of features. Everything stays accessible; just
  reorganized.
- Not a one-shot ship. Should be brainstormed → speced → planned →
  built in stages, with Yonah reviewing at each stage.
- Not a database migration spree. If clean architecture needs
  `videos.title`, add ONE column; don't refactor schema broadly.

## Process to follow

Use the superpowers skill chain. Don't shortcut:

### Session 1 — brainstorming with Yonah

Invoke `superpowers:brainstorming`. The skill's `<HARD-GATE>` applies:
do not write code or scaffold until a design is approved. The
brainstorming skill prefers visual mockups for layout-heavy questions
— accept the Visual Companion offer if it appears.

Specific things to brainstorm in this session:

- Phase split or progressive disclosure? (Choose ONE primary model.)
- Where does "what's live" status surface? (Top of page? Sticky
  banner? Inline with version chips?)
- Version chip vocabulary: what info does each chip show?
- Metadata panel: tabbed per-platform, or single combined editor?
- Publish flow: does "publish" become a multi-step confirm with
  preview, or stay one-click with a more visible "what's live" cue?

### Session 2 — write the spec

After Yonah approves the design, invoke `superpowers:writing-plans`
or write the spec directly. Save to
`docs/superpowers/specs/YYYY-MM-DD-video-page-redesign.md`. The spec
must answer:

- New page structure (component tree)
- Which existing components are kept / refactored / replaced
- Database changes (likely: add `videos.title` column to eliminate
  the anon-RLS-blocks-chain-walk problem)
- Migration path: how do we ship without breaking the page during
  the transition? Feature flag? Side-by-side route at
  `/videos/[slug]/v2` until validated?
- Definition of done: what does Yonah's happy path look like?

### Session 3+ — implementation

Use `superpowers:subagent-driven-development` to execute the spec.
Each subagent gets a focused task from the plan; fresh context per
task. Use a git worktree (`superpowers:using-git-worktrees`) so
this doesn't block other work on main.

## Open questions for Yonah (ask in session 1)

These need his decisions, not yours:

1. Do you want a single page that progressively reveals controls
   (less context-switching) or separate routes for Generate / Review
   / Publish (less density per page)?
2. When you re-render a clip, what's the most important thing to see
   AFTER it finishes — the new video, the new clip in context, or
   side-by-side comparison with the prior version?
3. How often do you publish a video without posting to socials? (If
   never, we can collapse publish + post into one flow.)
4. Do you ever want to publish a NEW version without retiring the
   prior live one? (If never, the auto-unpublish-sibling rule is
   right and we can hide the toggle ambiguity entirely.)
5. Title on the website — is that always the parsha + a sub-title,
   or sometimes just the sub-title alone?
6. The 4 script options (A, A-tight, B, C) — do you actively use
   more than one per video, or just pick one and forget the others?
   (Affects how prominently the carousel needs to be displayed.)

## Pre-work checklist (before session 1)

- [ ] Take 10-15 fresh screenshots of the current `/videos/[slug]`
  page in different states (no video yet, generating, error,
  multiple versions, published, posted). Save to
  `qa-screenshots/video-page-current-state/`. The brainstorming
  session needs these as reference.
- [ ] Re-read the rethink doc and this kickoff doc end-to-end.
- [ ] Skim the linked `editing-v2` plan to see what was deliberate.
- [ ] List the specific small UX questions Yonah has flagged in
  recent sessions (e.g. "where do I edit the title?") so they're
  on the brainstorming agenda.
- [ ] Set up the worktree:
  ```
  .worktrees/video-page-redesign
  ```
  Use the `superpowers:using-git-worktrees` skill if unfamiliar.

## Starter prompt for the next session

Paste this verbatim when you open a fresh Claude Code session to
kick off the rework:

> I'm starting the video page redesign that we planned on 2026-05-15.
> The plan doc is at `docs/superpowers/plans/2026-05-22-video-page-redesign-kickoff.md` —
> please read that and the linked rethink doc before doing anything
> else. We are at Session 1: brainstorming with Yonah. Do not write
> code. Use the `superpowers:brainstorming` skill and walk me through
> the design discussion. Before you start, confirm you've read the
> kickoff doc, the rethink doc, and skimmed the current
> `dashboard/src/app/videos/[slug]/page.tsx`. Then start with the
> open questions for Yonah listed in the kickoff doc.

## Sequence: bandaid quick-fixes vs. the rework

Two paths to keep separate:

- **Bandaids worth shipping if the rework slips a week:**
  - "vN is currently on torahtaichi.com" banner when viewing a
    non-published version (~1 hr)
  - Snapshot `videos.title` at stitch time + use it on the website
    (kills the A-tight fallback problem, ~2 hrs)
  - Investigation + fix for the inline-edit reload-reverts bug
    (could be ~30 min once root-caused)
- **The rework itself:**
  - Should NOT be done in pieces. One spec, one project, multi-session
    execution. Bandaids buy us time; they're not a substitute.

## Out of scope for the rework

These are valid but separate projects — flag if they come up but don't
absorb them:

- The Kie-account-mismatch issue (already mitigated by swapping the
  API key to Yonah's account on 2026-05-15)
- The TTC inbox forwarding (DNS / mailbox issue on torahtaichi.com,
  not a dashboard task)
- Per-video title customization separate from script title (deferred
  — current model says title = script title is fine)
- Twitter thread continuation editor (Buffer supports it, not shipped
  yet; defer until Yonah explicitly asks for it)

## When this is done

Definition of done:

- Yonah can take a fresh parsha from "no video yet" to "published on
  torahtaichi.com + posted to all platforms" without asking Yitzy
  what to click.
- He can iterate on a single clip (edit script + scene + tone, then
  re-render) and visually confirm his changes landed before moving on.
- He can revert / replace / unpublish without manual SQL.
- No new bandaid fixes were needed in the 30 days after launch.
- The plan in this doc, plus the rethink doc, plus the
  `editing-v2` plan are stale and can be archived.
