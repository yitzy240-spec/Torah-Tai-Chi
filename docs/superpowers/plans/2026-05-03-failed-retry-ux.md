# Failed-Retry UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface failed video generations clearly on `/videos` with inline Resume + plain-English errors, hero a status banner on `/videos/<slug>`, and show generation model/tier on the video page.

**Architecture:** A new pure `friendly-errors` library maps Modal failure strings to plain English (one source of truth used by both the videos grid and the parsha detail page). The failed video card on `/videos` becomes inline-actionable with Resume + Open buttons. A new `VideoStatusBanner` component lifts the failed/in-flight state out of the buried player tile to a hero position above the Production arc on `/videos/<slug>`. Model tier (already on the `jobs` row but dropped before reaching the UI) gets carried through to a header metadata line and the version selector. Resume itself is already wired (commit `af51eb1`).

**Tech Stack:** Next.js 16 App Router (server components + client islands), React 19, Supabase server-side queries, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-03-failed-retry-ux-design.md`.

---

## File Structure

**New files:**
- `dashboard/src/lib/friendly-errors.ts` — pure translator: raw error string → `{summary, hint?, severity}`
- `dashboard/src/lib/friendly-errors.test.ts` — node:test cases for each mapping
- `dashboard/src/components/video-status-banner.tsx` — hero banner for failed/in-flight states on the parsha detail page

**Modified files:**
- `dashboard/src/components/videos-dashboard.tsx` — `VideoCard` interface gains `failedDetails`; `FailedState` rewrites to inline `FailedCard` with Resume + Open
- `dashboard/src/app/videos/page.tsx` — `getVideoCards` enriches failed cards with friendly error + clip-count + parsha/script ids
- `dashboard/src/components/video-versions-view.tsx` — `VersionInfo` type gains `modelTier`
- `dashboard/src/app/videos/[slug]/page.tsx` — propagate `modelTier` through to `versionInfos`; render `VideoStatusBanner` above the Production arc; show resolution + tier in the header metadata line
- `dashboard/src/components/version-selector.tsx` — append resolution + tier to the version label

**Why split this way:** Each modified file has one clear responsibility. The translator is independent and pure. The card and the banner share data shape (friendly error + retry context) but render in different surfaces, so they're separate components consuming the same library.

---

### Task 1: Friendly errors translator library

**Files:**
- Create: `dashboard/src/lib/friendly-errors.ts`
- Create: `dashboard/src/lib/friendly-errors.test.ts`

- [ ] **Step 1: Create the library with type and stub**

`dashboard/src/lib/friendly-errors.ts`:

```ts
/**
 * Maps raw Modal/Kie/Claude error strings (whatever ends up in
 * jobs.error_message) to one-line plain-English explanations Yonah
 * can act on. Pure — no DB, no network. Used by:
 *   - the failed card on /videos (videos-dashboard.tsx)
 *   - the hero banner on /videos/<slug> (video-status-banner.tsx)
 *
 * To add a new mapping: add a new entry to MAPPINGS. The first match
 * wins; ordering matters for substrings that overlap.
 */

export type Severity = 'transient' | 'config' | 'unknown';

export interface FriendlyError {
  /** One-line summary in plain English. */
  summary: string;
  /** Optional second line with action guidance. */
  hint?: string;
  /** Severity drives color/icon choices in the UI. */
  severity: Severity;
}

interface Mapping {
  /** All needles must appear in the raw error (case-insensitive). */
  needles: string[];
  build: () => FriendlyError;
}

const MAPPINGS: Mapping[] = [
  {
    needles: ['kietaskfailed', 'mutually exclusive'],
    build: () => ({
      summary: 'Tai chi reference clashed with frame chain.',
      hint: 'Fixed in pipeline — Resume should work.',
      severity: 'transient',
    }),
  },
  {
    needles: ['insufficient'],
    build: () => ({
      summary: 'Kie.ai is out of credits.',
      hint: 'Top up at kie.ai or wait for the auto-refill.',
      severity: 'config',
    }),
  },
  {
    needles: ['claude returned non-json'],
    build: () => ({
      summary: "Claude wrote something we couldn't parse.",
      hint: 'A quick retry usually fixes it.',
      severity: 'transient',
    }),
  },
  {
    needles: ['modal_worker_url not set'],
    build: () => ({
      summary: "Pipeline isn't configured.",
      hint: 'Contact Yitzy — the worker URL is missing.',
      severity: 'config',
    }),
  },
  {
    needles: ['pipeline_trigger_secret not set'],
    build: () => ({
      summary: "Pipeline auth isn't configured.",
      hint: 'Contact Yitzy — the trigger secret is missing.',
      severity: 'config',
    }),
  },
];

const DEFAULT: FriendlyError = {
  summary: 'Something broke in the pipeline.',
  hint: 'Open the logs for details.',
  severity: 'unknown',
};

export function translate(rawError: string | null | undefined): FriendlyError {
  if (!rawError) return DEFAULT;
  const lower = rawError.toLowerCase();
  for (const m of MAPPINGS) {
    if (m.needles.every((n) => lower.includes(n))) return m.build();
  }
  return DEFAULT;
}
```

- [ ] **Step 2: Write the failing test**

`dashboard/src/lib/friendly-errors.test.ts`:

```ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { translate } from './friendly-errors';

test('motion-ref vs frame-chain mutex maps to transient', () => {
  const out = translate('KieTaskFailed: 400: The reference video and the first and last frames are mutually exclusive');
  assert.equal(out.severity, 'transient');
  assert.match(out.summary, /tai chi reference/i);
  assert.match(out.hint!, /resume/i);
});

test('credits insufficient maps to config', () => {
  const out = translate('createTask error (credits exhausted after 3 long retries): {"msg":"Credits insufficient"}');
  assert.equal(out.severity, 'config');
  assert.match(out.summary, /out of credits/i);
});

test('non-json from Claude maps to transient', () => {
  const out = translate('Claude returned non-JSON content after 3 attempts');
  assert.equal(out.severity, 'transient');
  assert.match(out.summary, /couldn't parse/i);
});

test('missing MODAL_WORKER_URL maps to config', () => {
  const out = translate('MODAL_WORKER_URL not set');
  assert.equal(out.severity, 'config');
  assert.match(out.hint!, /worker URL/i);
});

test('unknown error falls back to default', () => {
  const out = translate('Some unexpected stack trace from a place we never saw');
  assert.equal(out.severity, 'unknown');
  assert.match(out.summary, /something broke/i);
});

test('null/empty input falls back to default', () => {
  assert.equal(translate(null).severity, 'unknown');
  assert.equal(translate('').severity, 'unknown');
  assert.equal(translate(undefined).severity, 'unknown');
});

test('matching is case-insensitive', () => {
  const upper = translate('KIETASKFAILED: MUTUALLY EXCLUSIVE');
  const lower = translate('kietaskfailed: mutually exclusive');
  assert.equal(upper.severity, lower.severity);
  assert.equal(upper.summary, lower.summary);
});
```

- [ ] **Step 3: Run the test, confirm it passes**

Run from the `dashboard/` directory:

```bash
npx tsx --test src/lib/friendly-errors.test.ts
```

Expected: all 7 tests pass. If any fail, fix the mapping and re-run.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/friendly-errors.ts dashboard/src/lib/friendly-errors.test.ts
git commit -m "feat(dashboard): friendly error translator for Modal failure strings"
```

---

### Task 2: Carry modelTier into VersionInfo + show resolution+tier in header line

**Files:**
- Modify: `dashboard/src/components/video-versions-view.tsx` (around line 31)
- Modify: `dashboard/src/app/videos/[slug]/page.tsx` (around lines 233-246 and lines 506-525)

- [ ] **Step 1: Add `modelTier` to the `VersionInfo` interface**

In `dashboard/src/components/video-versions-view.tsx`, find the `VersionInfo` interface (around line 23-42) and add `modelTier`:

```ts
import type { ModelTier } from '@/lib/seedance-pricing';

export interface VersionInfo {
  id: string;
  videoUrl: string | null;
  thumbUrl: string | null;
  captionsVttDataUrl: string | null;
  clips: FeedbackClip[];
  costEstimateUsd: number | null;
  resolutionLabel: string | null;
  /** 'standard' | 'fast' — together with resolutionLabel determines the
   * Seedance model variant used for this version. Surfaced in the
   * header metadata and on version chips so Yonah can compare quality
   * tiers without digging into the jobs table. */
  modelTier: ModelTier | null;
  createdAt: string;
  isRegen: boolean;
  feedbackText: string | null;
  smartRegenAvailable: boolean;
}
```

- [ ] **Step 2: Populate `modelTier` when building versionInfos**

In `dashboard/src/app/videos/[slug]/page.tsx`, find the `versionInfos.push({...})` call (around line 233-246) and add the field:

```ts
versionInfos.push({
  id: row.videoId,
  videoUrl: row.mp4Path ? publicVideoUrl(row.mp4Path) : null,
  thumbUrl: row.thumbPath ? publicVideoUrl(row.thumbPath) : null,
  captionsVttDataUrl,
  clips,
  costEstimateUsd,
  resolutionLabel: row.resolution,
  modelTier: row.modelTier,
  createdAt: row.createdAt,
  isRegen: row.isRegen,
  feedbackText,
  smartRegenAvailable,
});
```

- [ ] **Step 3: Compute the selected version's tier display string**

Still in `dashboard/src/app/videos/[slug]/page.tsx`, after `selectedRow` is computed (around line 255), add:

```ts
function formatModelTierLabel(
  resolution: string | null,
  tier: ModelTier | null,
): string | null {
  if (!resolution && !tier) return null;
  const parts: string[] = [];
  if (resolution) parts.push(resolution);
  if (tier) parts.push(tier === 'fast' ? 'Fast' : 'Standard');
  return parts.join(' ');
}

const selectedTierLabel = formatModelTierLabel(
  selectedRow?.resolution ?? null,
  selectedRow?.modelTier ?? null,
);
```

- [ ] **Step 4: Render the tier label in the header metadata line**

In `dashboard/src/app/videos/[slug]/page.tsx`, find the header metadata `<div>` (around line 493-525, the line containing `Script A-tight · ${words} words`) and extend it:

```tsx
<span>{aTight ? `Script A-tight · ${words} words` : 'No script yet'}</span>
{selectedTierLabel && (
  <>
    <span style={{ color: 'var(--ink-300)' }}>·</span>
    <span style={{ color: 'var(--ink-500)' }}>{selectedTierLabel}</span>
  </>
)}
{videoId && (
  <span style={{ color: 'var(--ink-300)' }}>·</span>
)}
```

(The existing `videoId &&` separator stays; the new tier label sits between word count and the existing pills.)

- [ ] **Step 5: Verify visually**

Run the dashboard dev server:

```bash
cd dashboard && npm run dev
```

Navigate to `http://localhost:3000/videos/<a-parsha-with-a-done-video>`. Confirm the header line shows e.g. *"Script A-tight · 104 words · 720p Fast"*. Switch versions if multiple exist and confirm the tier label updates to match the selected version.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/video-versions-view.tsx dashboard/src/app/videos/[slug]/page.tsx
git commit -m "feat(video-page): show resolution + tier in header metadata line"
```

---

### Task 3: Append resolution + tier to the version selector label

**Files:**
- Modify: `dashboard/src/components/version-selector.tsx`
- Modify: `dashboard/src/components/video-versions-view.tsx` (where VersionSelector is rendered — pass the new prop)

- [ ] **Step 1: Add `tierSuffix` prop to VersionSelector**

In `dashboard/src/components/version-selector.tsx`, extend `VersionSelectorProps`:

```ts
export interface VersionSelectorProps {
  total: number;
  selectedIndex: number;
  relativeTime: string;
  /** Optional resolution+tier suffix, e.g. "720p Fast". Appears after
   * relativeTime in the header bar so the user can tell at a glance
   * which quality tier the selected version was generated at. */
  tierSuffix?: string | null;
  compareMode: boolean;
  canCompare: boolean;
  onNavigate: (newIndex: number) => void;
  onToggleCompare: () => void;
  onExitCompare: () => void;
}
```

- [ ] **Step 2: Render `tierSuffix` in the label**

Still in `dashboard/src/components/version-selector.tsx`, find the `<div>` that contains `{versionLabel}` and `{relativeTime}` (around lines 66-81) and append the tier:

```tsx
<div
  style={{
    fontFamily: 'var(--ff-display)',
    fontStyle: 'italic',
    fontSize: '13.5px',
    color: 'var(--ink-700)',
    fontVariationSettings: '"opsz" 14, "SOFT" 50',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }}
>
  {versionLabel}
  <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
  <span style={{ color: 'var(--ink-500)' }}>{relativeTime}</span>
  {tierSuffix && (
    <>
      <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
      <span style={{ color: 'var(--ink-500)' }}>{tierSuffix}</span>
    </>
  )}
</div>
```

- [ ] **Step 3: Pass tierSuffix from VideoVersionsView**

In `dashboard/src/components/video-versions-view.tsx`, find where `<VersionSelector />` is rendered. Compute the suffix from the selected version's `resolutionLabel` and `modelTier`, then pass it:

```tsx
const tierSuffix = (() => {
  const parts: string[] = [];
  if (selected.resolutionLabel) parts.push(selected.resolutionLabel);
  if (selected.modelTier) {
    parts.push(selected.modelTier === 'fast' ? 'Fast' : 'Standard');
  }
  return parts.length > 0 ? parts.join(' ') : null;
})();

// ... existing JSX ...
<VersionSelector
  total={versions.length}
  selectedIndex={selectedIndex}
  relativeTime={relativeTime}
  tierSuffix={tierSuffix}
  compareMode={compareMode}
  canCompare={versions.length >= 2}
  onNavigate={navigateTo}
  onToggleCompare={toggleCompare}
  onExitCompare={exitCompare}
/>
```

(Read the file to find the existing call site and exact prop list — the snippet above shows the new prop in the context of likely existing props.)

- [ ] **Step 4: Verify visually**

With the dev server still running, open a parsha that has 2+ versions (use `/videos/<slug>?compare=1`). Confirm the version selector now reads e.g. *"Version 2 of 3 · 5 min ago · 1080p Standard"*. Click the chevrons; confirm the tier suffix updates as you move between versions.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/version-selector.tsx dashboard/src/components/video-versions-view.tsx
git commit -m "feat(video-page): append resolution + tier to version selector label"
```

---

### Task 4: Enrich VideoCard data with friendly error + clip count + ids

**Files:**
- Modify: `dashboard/src/components/videos-dashboard.tsx` (`VideoCard` interface, around lines 5-15)
- Modify: `dashboard/src/app/videos/page.tsx` (`getVideoCards`, around lines 22-84)

- [ ] **Step 1: Extend `VideoCard` with `failedDetails`**

In `dashboard/src/components/videos-dashboard.tsx`, replace the `VideoCard` interface:

```ts
import type { FriendlyError } from '@/lib/friendly-errors';

export interface VideoCard {
  key: string;
  kind: 'parsha' | 'topic';
  title: string;
  href: string;
  jobId: string;
  state: 'in_flight' | 'done' | 'failed' | 'other';
  statusMessage: string;
  triggeredAt: string;
  thumbUrl: string | null;
  /** Populated only when state === 'failed'. Carries everything the
   *  inline FailedCard needs to render the friendly error and call
   *  triggerGeneration without an extra round-trip. */
  failedDetails: {
    friendly: FriendlyError;
    failedAt: number;
    totalClips: number;
    parshaId: string | null;
    scriptId: string | null;
    parshaSlug: string | null;
  } | null;
}
```

- [ ] **Step 2: Extend `getVideoCards` query to fetch the data needed for failed enrichment**

In `dashboard/src/app/videos/page.tsx`, modify the SELECT in `getVideoCards` to pull `error_message` + `script_id` + `parsha_id` + a clips count. The existing query is:

```ts
.select(
  'id, kind, status, status_message, topic, triggered_at, parsha_id, ' +
  'parshiot!jobs_parsha_id_fkey(name, slug), videos(id, thumb_path)'
)
```

Replace with:

```ts
.select(
  'id, kind, status, status_message, error_message, topic, triggered_at, ' +
  'parsha_id, script_id, ' +
  'parshiot!jobs_parsha_id_fkey(name, slug), videos(id, thumb_path), ' +
  'clips(status)'
)
```

Update the `JobRow` interface above `getVideoCards` to match:

```ts
interface JobRow {
  id: string;
  kind: string | null;
  status: string;
  status_message: string | null;
  error_message: string | null;
  topic: string | null;
  triggered_at: string;
  parsha_id: string | null;
  script_id: string | null;
  parshiot: { name: string; slug: string } | { name: string; slug: string }[] | null;
  videos: { id: string; thumb_path: string | null }[] | { id: string; thumb_path: string | null } | null;
  clips: { status: string }[] | null;
}
```

- [ ] **Step 3: Build `failedDetails` for failed cards**

Still in `dashboard/src/app/videos/page.tsx`, import the translator and add a helper above `getVideoCards`:

```ts
import { translate, type FriendlyError } from '@/lib/friendly-errors';

function buildFailedDetails(row: JobRow): {
  friendly: FriendlyError;
  failedAt: number;
  totalClips: number;
  parshaId: string | null;
  scriptId: string | null;
  parshaSlug: string | null;
} {
  const totalClips = row.clips?.length ?? 0;
  const doneClips = (row.clips ?? []).filter((c) => c.status === 'done').length;
  const parsha = Array.isArray(row.parshiot) ? row.parshiot[0] : row.parshiot;
  return {
    friendly: translate(row.error_message),
    failedAt: doneClips + 1, // 1-indexed; the first NOT-done clip is "where it failed"
    totalClips,
    parshaId: row.parsha_id,
    scriptId: row.script_id,
    parshaSlug: parsha?.slug ?? null,
  };
}
```

- [ ] **Step 4: Plumb `failedDetails` through to each card**

In `getVideoCards`, update both `cards.push(...)` calls to populate the field:

```ts
if (kind === 'parsha' && row.parsha_id) {
  if (seenParshaIds.has(row.parsha_id)) continue;
  seenParshaIds.add(row.parsha_id);
  cards.push({
    key: `parsha:${row.parsha_id}`,
    kind: 'parsha',
    title: parsha?.name ?? 'Parsha',
    href: parsha?.slug ? `/videos/${parsha.slug}` : `/jobs/${row.id}`,
    jobId: row.id,
    state,
    statusMessage: row.status_message ?? row.status,
    triggeredAt: row.triggered_at,
    thumbUrl: video?.thumb_path ? publicVideoUrl(video.thumb_path) : null,
    failedDetails: state === 'failed' ? buildFailedDetails(row) : null,
  });
} else if (kind === 'topic') {
  cards.push({
    key: `job:${row.id}`,
    kind: 'topic',
    title: (row.topic ?? 'Ad-hoc video').slice(0, 80),
    href: `/jobs/${row.id}`,
    jobId: row.id,
    state,
    statusMessage: row.status_message ?? row.status,
    triggeredAt: row.triggered_at,
    thumbUrl: video?.thumb_path ? publicVideoUrl(video.thumb_path) : null,
    failedDetails: state === 'failed' ? buildFailedDetails(row) : null,
  });
}
```

- [ ] **Step 5: Run the build to confirm no type errors**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no output (no errors). If errors appear, they're typically about `failedDetails` being missing from existing card construction sites — fix by adding `failedDetails: null` to any unmodified site.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/videos-dashboard.tsx dashboard/src/app/videos/page.tsx
git commit -m "feat(videos-grid): enrich failed cards with friendly error + clip count"
```

---

### Task 5: New FailedCard component with inline Resume + Open

**Files:**
- Modify: `dashboard/src/components/videos-dashboard.tsx` (replace `FailedState` and the corresponding branch in `VideoCardTile`)

- [ ] **Step 1: Replace the `FailedState` placeholder with a richer `FailedCard` body**

Currently the failed branch renders a small overlay inside the 9:16 thumb area (lines 295-316). The new design needs more vertical space — a compact body BELOW the thumb area instead of inside it. Replace the render in `VideoCardTile` (around lines 200-237 — the section that includes `card.state === 'failed' && <FailedState />` plus the status-pill block below) so failed cards diverge from done/in-flight tiles:

```tsx
function VideoCardTile({ card }: { card: VideoCard }) {
  if (card.state === 'failed' && card.failedDetails) {
    return <FailedCard card={card} />;
  }

  // ... existing render for done / in_flight / other ...
}
```

Move the existing render body into the function unchanged for the non-failed branches.

- [ ] **Step 2: Implement `FailedCard`**

Add the new component below `VideoCardTile`. It uses a non-link wrapper because we have two distinct buttons (Resume calls a server action; Open navigates):

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { triggerGeneration } from '@/app/actions/trigger-generation';

function FailedCard({ card }: { card: VideoCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const details = card.failedDetails!;

  const canResume = !!details.parshaId && !!details.scriptId;

  function handleResume() {
    if (!canResume) return;
    setError(null);
    startTransition(async () => {
      const result = await triggerGeneration({
        parshaId: details.parshaId!,
        scriptId: details.scriptId!,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      // Navigate to the parsha page so Yonah lands on the in-progress
      // banner. card.href already points there for parsha cards.
      router.push(card.href);
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: '360px',
        width: '100%',
        margin: '0 auto',
        padding: '14px',
        border: '1px solid var(--tassel)',
        borderRadius: 'var(--r-md)',
        background: 'rgba(192,57,43,.04)',
      }}
      className="video-card video-card--failed"
    >
      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontSize: '17px',
          fontWeight: 500,
          color: 'var(--ink-900)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {card.title}
      </div>

      <div
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: 'var(--tassel)',
          textTransform: 'uppercase',
        }}
      >
        Failed at clip {details.failedAt} of {details.totalClips || '?'}
      </div>

      <div
        style={{
          fontFamily: 'var(--ff-display)',
          fontStyle: 'italic',
          fontSize: '13.5px',
          color: 'var(--ink-700)',
          lineHeight: 1.45,
          fontVariationSettings: '"opsz" 14, "SOFT" 50',
        }}
      >
        {details.friendly.summary}
        {details.friendly.hint && (
          <>
            {' '}
            <span style={{ color: 'var(--ink-500)' }}>{details.friendly.hint}</span>
          </>
        )}
      </div>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--tassel)',
            fontFamily: 'var(--ff-body)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={handleResume}
          disabled={!canResume || pending}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '13px',
            padding: '9px 14px',
            minHeight: 40,
            borderRadius: '999px',
            border: '1px solid var(--jade)',
            background: canResume && !pending ? 'var(--jade)' : 'var(--ink-200)',
            color: 'var(--linen-50)',
            cursor: canResume && !pending ? 'pointer' : 'not-allowed',
            transition: 'all var(--trans)',
          }}
        >
          {pending ? 'Resuming…' : 'Resume'}
        </button>
        <a
          href={card.href}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '13px',
            padding: '9px 14px',
            minHeight: 40,
            borderRadius: '999px',
            border: '1px solid var(--ink-300)',
            background: 'transparent',
            color: 'var(--ink-700)',
            textDecoration: 'none',
          }}
        >
          Open
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Remove the now-unused `FailedState` helper**

Delete the `FailedState` function at the bottom of `videos-dashboard.tsx` (around lines 295-316). It's no longer called.

- [ ] **Step 4: Verify visually**

Start the dev server (or refresh if still running):

```bash
cd dashboard && npm run dev
```

Navigate to `/videos`. Find a parsha tile with `state='failed'` (use the failed Vayikra job from earlier today, or trigger a fresh failure if none exist). Confirm:
- Card has a soft tassel/red border, no large 9:16 thumb (it's compact text)
- Title at top
- "Failed at clip N of M" line
- Friendly error summary + hint
- "Resume" (jade) and "Open" (outlined) buttons side-by-side
- Click Resume → button shows "Resuming…", then navigates to `/videos/<slug>`
- Click Open → just navigates

If `triggerGeneration` returns an error, it appears above the buttons in tassel red.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/videos-dashboard.tsx
git commit -m "feat(videos-grid): inline Resume + Open buttons on failed cards"
```

---

### Task 6: VideoStatusBanner component

**Files:**
- Create: `dashboard/src/components/video-status-banner.tsx`

- [ ] **Step 1: Define props and decide rendering branches**

Create `dashboard/src/components/video-status-banner.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { triggerGeneration } from '@/app/actions/trigger-generation';
import type { FriendlyError } from '@/lib/friendly-errors';

export interface VideoStatusBannerProps {
  /** When set, the banner renders the failed state. */
  failed: {
    jobId: string;
    friendly: FriendlyError;
    failedAt: number;
    totalClips: number;
    parshaId: string;
    scriptId: string;
  } | null;
  /** When set, the banner renders the in-flight state. Mutually
   *  exclusive with `failed` — pass exactly one or neither. */
  inFlight: {
    jobId: string;
    statusMessage: string;
    /** p25-p75 minutes from completed runs, for the ETA display. */
    typicalRun: { lowMin: number; highMin: number } | null;
    /** Optional clip-progress hint (e.g. "clip 3 of 5"). */
    clipProgress: string | null;
  } | null;
}

export function VideoStatusBanner({ failed, inFlight }: VideoStatusBannerProps) {
  if (failed) return <FailedBanner {...failed} />;
  if (inFlight) return <InFlightBanner {...inFlight} />;
  return null;
}

function FailedBanner(props: NonNullable<VideoStatusBannerProps['failed']>) {
  const { jobId, friendly, failedAt, totalClips, parshaId, scriptId } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleResume() {
    setError(null);
    startTransition(async () => {
      const result = await triggerGeneration({ parshaId, scriptId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        padding: '18px 22px',
        marginBottom: 24,
        border: '1px solid var(--tassel)',
        borderRadius: 'var(--r-lg)',
        background: 'rgba(192,57,43,.06)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--tassel)',
            marginBottom: 6,
          }}
        >
          Generation failed at clip {failedAt}{totalClips ? ` of ${totalClips}` : ''}
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontSize: '17px',
            color: 'var(--ink-900)',
            lineHeight: 1.35,
            fontVariationSettings: '"opsz" 18, "SOFT" 30',
          }}
        >
          {friendly.summary}
        </div>
        {friendly.hint && (
          <div
            style={{
              fontFamily: 'var(--ff-display)',
              fontStyle: 'italic',
              fontSize: '13.5px',
              color: 'var(--ink-500)',
              marginTop: 4,
              fontVariationSettings: '"opsz" 14, "SOFT" 60',
            }}
          >
            {friendly.hint}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--tassel)', marginTop: 8 }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleResume}
          disabled={pending}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontFamily: 'var(--ff-body)',
            fontWeight: 500,
            fontSize: '14px',
            padding: '11px 22px',
            minHeight: 44,
            borderRadius: '999px',
            border: '1px solid var(--jade)',
            background: pending ? 'var(--ink-200)' : 'var(--jade)',
            color: 'var(--linen-50)',
            cursor: pending ? 'wait' : 'pointer',
            transition: 'all var(--trans)',
          }}
        >
          {pending ? 'Resuming…' : 'Resume'}
        </button>
        <Link
          href={`/jobs/${jobId}`}
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '13px',
            color: 'var(--ink-500)',
            textDecoration: 'underline',
            textDecorationColor: 'var(--ink-200)',
            textUnderlineOffset: 4,
          }}
        >
          view full logs →
        </Link>
      </div>
    </div>
  );
}

function InFlightBanner(props: NonNullable<VideoStatusBannerProps['inFlight']>) {
  const { jobId, statusMessage, typicalRun, clipProgress } = props;
  const eta = typicalRun
    ? `~${typicalRun.lowMin}-${typicalRun.highMin} min total`
    : null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        padding: '18px 22px',
        marginBottom: 24,
        border: '1px solid var(--navy-500)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--navy-wash)',
        flexWrap: 'wrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--navy-700)',
          animation: 'pulse-navy 1.8s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--ff-body)',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--navy-800)',
            marginBottom: 6,
          }}
        >
          Generating
        </div>
        <div
          style={{
            fontFamily: 'var(--ff-display)',
            fontSize: '15px',
            color: 'var(--ink-900)',
            fontVariationSettings: '"opsz" 16, "SOFT" 40',
          }}
        >
          {statusMessage}
          {clipProgress && (
            <>
              <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
              <span style={{ color: 'var(--ink-500)' }}>{clipProgress}</span>
            </>
          )}
          {eta && (
            <>
              <span style={{ color: 'var(--ink-300)', margin: '0 6px' }}>·</span>
              <span style={{ color: 'var(--ink-500)' }}>{eta}</span>
            </>
          )}
        </div>
      </div>
      <Link
        href={`/jobs/${jobId}`}
        style={{
          fontFamily: 'var(--ff-body)',
          fontSize: '13px',
          color: 'var(--navy-800)',
          textDecoration: 'underline',
          textDecorationColor: 'var(--navy-300)',
          textUnderlineOffset: 4,
          flexShrink: 0,
        }}
      >
        view full progress →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no output. If errors complain about a missing `pulse-navy` keyframe, that's fine — it's defined in globals.css.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/video-status-banner.tsx
git commit -m "feat(video-page): VideoStatusBanner component for failed and in-flight states"
```

---

### Task 7: Wire VideoStatusBanner onto /videos/[slug]

**Files:**
- Modify: `dashboard/src/app/videos/[slug]/page.tsx`

- [ ] **Step 1: Query the most-recent failed job for this parsha**

In `dashboard/src/app/videos/[slug]/page.tsx`, after the existing `activeJob` query (around line 309-316), add a query for the latest failed job:

```ts
const { data: latestFailedJob } = await supabase
  .from('jobs')
  .select('id, error_message, script_id, triggered_at, clips(status)')
  .eq('parsha_id', parsha.id)
  .eq('status', 'failed')
  .order('triggered_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

- [ ] **Step 2: Decide which banner state to show**

Still in `dashboard/src/app/videos/[slug]/page.tsx`, after that query, derive the banner props. Show failed only when:
- A latest failed job exists AND
- There's no successful version currently selected (i.e. `selectedRow` is null OR was generated BEFORE the failed attempt)

```ts
import { translate } from '@/lib/friendly-errors';

const showFailedBanner = !!latestFailedJob
  && (!selectedRow
      || (selectedRow.createdAt
          && latestFailedJob.triggered_at
          && new Date(latestFailedJob.triggered_at).getTime() > new Date(selectedRow.createdAt).getTime()));

const failedBannerProps = showFailedBanner
  ? (() => {
      const clips = (latestFailedJob!.clips as { status: string }[] | null) ?? [];
      const doneClips = clips.filter((c) => c.status === 'done').length;
      return {
        jobId: latestFailedJob!.id as string,
        friendly: translate(latestFailedJob!.error_message as string | null),
        failedAt: doneClips + 1,
        totalClips: clips.length,
        parshaId: parsha.id,
        scriptId: (latestFailedJob!.script_id as string | null) ?? '',
      };
    })()
  : null;

// In-flight banner — only show when activeJob exists. Skip if it's a
// regen (the existing RegenInProgressBanner inside VideoVersionsView
// already handles regens and would double up here).
const showInFlightBanner = !!activeJob && !inFlightRegen;
const inFlightBannerProps = showInFlightBanner
  ? {
      jobId: activeJob!.id as string,
      statusMessage:
        (activeJob!.status_message as string | null) ?? (activeJob!.status as string),
      typicalRun,
      clipProgress: null, // future: parse step+clip from status_message
    }
  : null;
```

- [ ] **Step 3: Render the banner above the Production arc**

Find the `{/* Production arc */}` block (around line 528) and insert the banner just above it:

```tsx
import { VideoStatusBanner } from '@/components/video-status-banner';

// ... inside the JSX, just before the Production arc block ...
<VideoStatusBanner
  failed={failedBannerProps}
  inFlight={failedBannerProps ? null : inFlightBannerProps}
/>

{/* Production arc */}
<div style={{ ... existing arc ... }}>
```

(`failed` takes precedence over `inFlight` if both somehow apply — defensive guard.)

- [ ] **Step 4: Remove the buried in-flight state from the placeholder player**

In the same file, find the existing in-flight branch inside the placeholder player (around lines 693-720, the block starting with `{isGenerating ? (`). Replace its body with a simple "No video yet" message — the heroed banner now carries the in-flight signal:

```tsx
{isGenerating ? (
  <span style={{ opacity: 0.6 }}>
    Generating…<br />
    <span style={{ fontSize: '11.5px' }}>see banner above</span>
  </span>
) : (
  <span style={{ opacity: 0.6 }}>No video yet.<br />Approve a script to start.</span>
)}
```

This avoids duplicate "view progress" links cluttering the page.

- [ ] **Step 5: Verify type-check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Verify visually — failed banner**

With the dev server running:
1. Find a parsha that has a failed job and no successful version yet (use the previously failed Vayikra if still around, or trigger a fresh failure).
2. Navigate to `/videos/<slug>`.
3. Confirm a tassel-red banner sits above the Production arc with: "Generation failed at clip N of M" + friendly error + Resume button + "view full logs →" link.
4. Click Resume; confirm `triggerGeneration` is called and the page refreshes — the banner should switch to in-flight (or hide if status is now queued).

- [ ] **Step 7: Verify visually — in-flight banner**

1. Trigger a fresh generation on a parsha with no done video.
2. Navigate to `/videos/<slug>`.
3. Confirm a navy banner appears above the arc with: pulsing dot + "Generating" eyebrow + status_message + ETA + "view full progress →".
4. Confirm the placeholder player tile no longer shows its own "view progress →" link (now redirects readers to the banner).

- [ ] **Step 8: Verify visually — done state hides the banner**

1. Wait for generation to complete (or pick a parsha with an existing done video).
2. Navigate to `/videos/<slug>`.
3. Confirm NO banner appears — the page goes straight from header to Production arc to player.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/app/videos/[slug]/page.tsx
git commit -m "feat(video-page): hero VideoStatusBanner above Production arc"
```

---

### Task 8: End-to-end validation

**Files:** None (manual smoke test)

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

Vercel auto-deploys; wait ~1-2 min for the build to finish. Watch the deploy URL in the Vercel dashboard.

- [ ] **Step 2: Trigger a known failure to validate end-to-end**

A clean way to test without breaking the production fix: pick a parsha that has no done video yet, attach a tai chi move via the move picker that lands on a non-first dojo clip, and trigger a generation BEFORE this fix's deploy lands. (Skip if you already have the failed Vayikra job around.)

- [ ] **Step 3: Walk through the user-visible flow**

1. Open `/videos`. Confirm the failed parsha card shows the new compact body with friendly error + Resume + Open buttons.
2. Click Open. Land on `/videos/<slug>`. Confirm the hero banner shows the same friendly error + Resume button.
3. Click Resume from either surface. Confirm:
   - `triggerGeneration` reuses the failed `job_id` (commit `af51eb1` already shipped this)
   - Modal's resume short-circuit reuses the prior plan + completed clips
   - Run finishes in ~30-60s for a single-clip retry
4. After done, navigate back to `/videos/<slug>`. Confirm:
   - Banner is hidden
   - Header line shows e.g. "Script A-tight · 104 words · 720p Fast"
   - Version selector chip shows the same "720p Fast"
   - Production arc shows green for Video stage

- [ ] **Step 4: Spot-check unknown error handling**

Manually pick a job in the DB with a weird `error_message` (or insert one for testing). Confirm the friendly translator falls back to "Something broke in the pipeline. Open the logs for details." with `severity: 'unknown'` rendering — banner stays tassel-themed.

- [ ] **Step 5: Spot-check the no-double-banner case**

If a regen-after-done is in flight, the existing `RegenInProgressBanner` inside `VideoVersionsView` should fire. Our new `VideoStatusBanner` skips in-flight rendering when `inFlightRegen` is set. Confirm visually: only one banner appears.

- [ ] **Step 6: If anything looks wrong**

File a follow-up issue or fix in place. The plan tasks are independently revertable — `git revert` any single feature commit if it regresses.

---

## Self-Review

**Spec coverage:**
- Section 1 (failed card with inline Resume + friendly error) → Tasks 1, 4, 5 ✓
- Section 2 (hero banner on video page) → Tasks 6, 7 ✓
- Section 3 (friendly error translator library) → Task 1 ✓
- Section 4 (skip separate generation-status module) → no task needed; explicit no-op ✓
- Section 5 (show generation model on video page) → Tasks 2, 3 ✓

**Validation steps:** Task 8 covers the manual smoke test from the spec's Validation section.

**No placeholders:** every code block contains real working code. No "TBD"s.

**Type consistency:** `FriendlyError` defined in Task 1 used in Tasks 4, 5, 6, 7. `VideoCard.failedDetails` defined in Task 4 consumed in Task 5. `VideoStatusBannerProps.failed` and `.inFlight` defined in Task 6 consumed in Task 7.

**Out of scope (per spec):** topic-video flow at `/api/compose/generate-video`, `/jobs/<id>` page redesign — neither has a task; both are documented as out of scope.
