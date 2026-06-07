# Phase 2: Posting cards consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate the "fix in one card, forget the other four" bug class by extracting genuinely-shared rendering into sub-components, AND drop the per-card `useRealtimeRow` subscription (parent's `useRealtimeRows` already provides live updates). After this phase, `use-realtime-row.ts` has zero consumers and can be deleted.

**Approach: extracted shared sub-components** (not a single mega-card). The 5 posting cards share ~60–70% structure (scheduled state, posted-collapsed, posted-expanded edit flow, failure banner, Post+Schedule buttons) but have meaningfully different platform-specific fields (X = just text; FB/IG = hashtags + reel toggle + first comment; YouTube = title + description + tags + thumbnail, no Buffer). Mega-card would conflate them behind a complex platform config; sub-components keep each card readable while collapsing the duplicated chunks.

**Why per-card useRealtimeRow can go:** Each card's comment says it's "defense in depth" against the parent. But the parent (phase-5-post.tsx) ALREADY uses `useRealtimeRows<PostRow>('posts', 'video_id', videoId, initialPosts)` — every post update flows through the parent's prop. The per-card subscription is therefore redundant: if the parent's subscription breaks (postgres_changes publication drops `posts`), the per-card subscription breaks identically because both share the same publication. The defense isn't real, just costs a duplicate WAL-decode filter per card.

---

## File structure

**Created:**
- `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/scheduled-state-card.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/posted-expanded-header.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/failure-banner.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/post-action-buttons.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/_shared/unposted-card-shell.tsx`

**Modified:**
- `dashboard/src/app/videos/[slug]/_components/posting-cards/x-card.tsx` (simplest, ~220 → ~120 lines)
- `dashboard/src/app/videos/[slug]/_components/posting-cards/tiktok-card.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/facebook-card.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/instagram-card.tsx`
- `dashboard/src/app/videos/[slug]/_components/posting-cards/youtube-card.tsx` (uses fewer shared bits since no Buffer path)

**Deleted:**
- `dashboard/src/hooks/use-realtime-row.ts` (zero consumers after migration)

---

## Tasks

### Task 1: Build 5 shared sub-components

Each is a tightly-scoped presentational component. No business logic. Pure props in → JSX out. Designed so adding a 6th platform tomorrow is mechanical.

Files:
- `_shared/scheduled-state-card.tsx` — the "Scheduled for X · Edit or cancel in Buffer →" card. Takes: `platformName`, `iconName`, `scheduledAt`, `bufferUpdateId`, `externalEditUrl: (bufferId: string) => string`, `externalListUrl: string`.
- `_shared/posted-expanded-header.tsx` — the platform-name + "Posted" pill + collapse caret. Takes: `platformName`, `iconName`, `onCollapse`.
- `_shared/failure-banner.tsx` — the failure alert with first-line error preview. Takes: `errorMessage: string | null`.
- `_shared/post-action-buttons.tsx` — the Post + Schedule pair. Takes: `posting: boolean`, `onPost`, `onScheduleOpen`, `platformName`, `postingLabel?: string`.
- `_shared/unposted-card-shell.tsx` — the outer "next up" container with platform header. Takes: `platformName`, `iconName`, `suffix?: string`, `children`.

All components follow existing visual style (var(--ink-*) tokens, padding 14, marginBottom 12, etc.). Lift styles verbatim from x-card.tsx (the simplest) to start, refine as needed.

- [ ] Implement all 5 components in one dispatch (small, related, tightly-scoped)
- [ ] Typecheck
- [ ] Commit: `feat(posting): extract shared sub-components for posting cards`

### Task 2: Migrate x-card.tsx (simplest)

Use as the proof-of-concept for the pattern.

- [ ] Remove `useRealtimeRow` import + subscription. Use `post` prop directly (it's already live via parent's `useRealtimeRows`).
- [ ] Replace scheduled state with `<ScheduledStateCard>`.
- [ ] Replace posted-expanded header with `<PostedExpandedHeader>`.
- [ ] Replace failure banner with `<FailureBanner>`.
- [ ] Replace Post + Schedule buttons with `<PostActionButtons>`.
- [ ] Wrap unposted-state in `<UnpostedCardShell>`.
- [ ] Typecheck.
- [ ] Visual smoke (typecheck-only — no dev server available; rely on visual continuity from style lifting).
- [ ] Commit: `refactor(posting): x-card uses shared sub-components`

### Task 3: Migrate tiktok-card.tsx
Same pattern as x-card, plus `CaptionAndHashtags` instead of plain `EditableField`.
- [ ] Apply same migration as Task 2.
- [ ] Commit: `refactor(posting): tiktok-card uses shared sub-components`

### Task 4: Migrate facebook-card.tsx
Same as tiktok plus the FB-specific `ReelOrPostToggle` + first comment field + `saveFBMeta` callback.
- [ ] Apply migration; keep FB-specific fields inline.
- [ ] Commit: `refactor(posting): facebook-card uses shared sub-components`

### Task 5: Migrate instagram-card.tsx
Same as facebook, just with `instagram` metadata key.
- [ ] Apply migration.
- [ ] Commit: `refactor(posting): instagram-card uses shared sub-components`

### Task 6: Migrate youtube-card.tsx
YouTube is the outlier — no Buffer (direct YouTube Data API), thumbnail picker, title+description+tags. Most shared sub-components don't apply EXCEPT `<FailureBanner>` and `<PostActionButtons>` (the Post button works the same way). Scheduled state uses YouTube Studio not Buffer — needs to handle the `externalEditUrl` differently.

- [ ] Drop `useRealtimeRow` import + subscription.
- [ ] Use `<FailureBanner>` + `<PostActionButtons>` + `<UnpostedCardShell>` where applicable.
- [ ] Use `<ScheduledStateCard>` with YouTube-specific edit URL (`https://studio.youtube.com/video/${bufferId}/edit`).
- [ ] Use `<PostedExpandedHeader>` (but the posted-expanded view body is simpler than the others — no edit flow modal).
- [ ] Commit: `refactor(posting): youtube-card uses shared sub-components`

### Task 7: Delete use-realtime-row.ts

After Tasks 2–6 all consumers are gone.

- [ ] Verify: `grep -rn "use-realtime-row" dashboard/src/` returns 0 matches.
- [ ] Delete file: `dashboard/src/hooks/use-realtime-row.ts`.
- [ ] Typecheck.
- [ ] Commit: `chore(hooks): delete useRealtimeRow (zero consumers after Phase 2)`

---

## Self-review

**Spec coverage:** All 5 cards migrated + per-card subscription removed + dead hook deleted. ✓

**Placeholder scan:** Each task has actionable steps; the unique-per-card platform fields stay inline (no premature abstraction). ✓

**Risk:** UI is operator-critical (Yonah uses these for every posting flow). To mitigate:
- All 5 cards in this phase, one task per card, with spec+quality review between each
- Styles lifted verbatim from existing cards (no design changes)
- Per-card useRealtimeRow drop relies on parent's `useRealtimeRows` continuing to work, which is unchanged by this phase

**Out of scope (Phase 3+):**
- The autosave-via-EditableField pattern stays as-is. Phase 3 replaces autosave with explicit save.
- The parent's `useRealtimeRows<PostRow>('posts', ...)` stays. Phase 3+ migrates it.
- The Buffer/YouTube posting actions themselves are unchanged.
