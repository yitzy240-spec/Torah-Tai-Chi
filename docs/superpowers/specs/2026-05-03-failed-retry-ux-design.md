# Failed-Retry UX Design

**Status:** approved 2026-05-03
**Scope:** dashboard (`/videos` grid + `/videos/<slug>` detail page)
**Out of scope:** topic-video flow at `/api/compose/generate-video` (same wasteful pattern; tracked separately), `/jobs/<id>` page redesign

## Problem

When a video generation fails, the failed state is buried and the retry path is wasteful:

1. **Failed cards aren't actionable.** [dashboard/src/components/videos-dashboard.tsx:295-316](dashboard/src/components/videos-dashboard.tsx#L295-L316) renders "Generation failed / tap to view details" — the entire card is a link to `/videos/<slug>`, no inline retry. Yonah has to click in to do anything.
2. **The detail page doesn't surface the failure.** [dashboard/src/app/videos/[slug]/page.tsx](dashboard/src/app/videos/[slug]/page.tsx) shows the failure state only inside the per-script carousel ([dashboard/src/components/script-carousel.tsx:669-694](dashboard/src/components/script-carousel.tsx#L669-L694)) — Yonah must flip to the failed script to see the "Generation failed · details →" pill.
3. **The retry was wasteful.** Until commit `af51eb1` the "Try again" button created a fresh `jobs` row, orphaning the prior plan + checkpointed clips. Modal's resume logic exists ([modal_app.py:361-466](modal_app.py#L361-L466)) but is keyed on `job_id` — a fresh id missed it. Wired up now: `triggerGeneration` resumes in place when the latest attempt is `failed`.
4. **No retry messaging.** Even with resume working, the button still says "Try again" with no indication of what that means cost-wise.
5. **Model/tier opacity.** Once a video exists, the page doesn't display what model or quality tier produced it. Comparing v1 vs v2 requires reading the `jobs` table.

## Design

### Section 1 — Failed card on the videos grid

Replace the placeholder failed card with an inline-actionable card:

- Parsha title (e.g., *Vayikra*)
- One line: "Failed at clip N of M" (computed from `clips` rows for the failed `job_id`)
- Friendly error one-liner from the translator (Section 3)
- Two buttons:
  - **Resume** (primary, jade): one click, calls `triggerGeneration` (which now resumes in place). After dispatch, navigates to `/videos/<slug>` so Yonah lands on the in-progress banner.
  - **Open** (secondary, ghost): navigate to `/videos/<slug>` without retrying — for when Yonah wants to look first.

Card must remain a 9:16 tile in the grid layout. Inline buttons sit beneath the thumb area (same place the status pill sits today).

**Component:** extract `FailedCard` from `VideoCardTile` since the failed branch now diverges in shape from done/in-flight.

### Section 2 — Hero banner on `/videos/<slug>`

When the parsha's latest attempt is failed (and no successful version is currently selected) OR is in-flight, render a pinned banner at the top of the page above the Production arc.

- **Failed state:** plain-English error from translator + Resume button + "view full logs →" link to `/jobs/<id>`
- **In-flight state:** current step + clip N of M + ETA (reuses `typicalRun` p25-p75 already computed at [videos/[slug]/page.tsx:1101-1121](dashboard/src/app/videos/[slug]/page.tsx#L1101-L1121)) + "view progress →" link
- **Done state:** banner hidden (existing arc/player suffice)

The banner replaces the buried in-flight state currently squeezed into the placeholder player tile (lines 693-720). The placeholder player still shows when there's no video yet, but the *informational* state — what's happening, why, what to do — moves to the heroed banner.

**Component:** new `VideoStatusBanner` — server-rendered (the data is already on the page) with a small client-side polling effect for in-flight jobs (5s interval, matching `script-carousel.tsx`'s pattern).

### Section 3 — Friendly error translator

A pure library at `dashboard/src/lib/friendly-errors.ts`:

```ts
export interface FriendlyError {
  /** One-line summary in plain English. */
  summary: string;
  /** Optional second line with action guidance. */
  hint?: string;
  /** Severity for color/icon. */
  severity: 'transient' | 'config' | 'unknown';
}

export function translate(rawError: string | null | undefined): FriendlyError;
```

Initial mappings (extend as new failure modes show up in production):

| Raw error contains | Friendly summary | Hint | Severity |
|---|---|---|---|
| `KieTaskFailed` + `mutually exclusive` | "Tai chi reference clashed with frame chain." | "Fixed in pipeline — Resume should work." | transient |
| `insufficient` (credits) | "Kie.ai is out of credits." | "Top up at kie.ai or wait for the auto-refill." | config |
| `Claude returned non-JSON` | "Claude wrote something we couldn't parse." | "A quick retry usually fixes it." | transient |
| `MODAL_WORKER_URL not set` | "Pipeline isn't configured." | "Contact Yitzy — the worker URL is missing." | config |
| `PIPELINE_TRIGGER_SECRET not set` | "Pipeline auth isn't configured." | "Contact Yitzy — the trigger secret is missing." | config |
| (default) | "Something broke in the pipeline." | "Open the logs for details." | unknown |

Used by Section 1 (FailedCard) and Section 2 (VideoStatusBanner). The translator is pure; no DB or network calls. Tests live alongside as `friendly-errors.test.ts`.

### Section 4 — No separate generation-status module on /videos

Decision: skip. The in-flight tile in the grid (with its pulsing dot + status_message) already conveys what's generating. A summary strip at the top would duplicate without adding signal. Revisit if the grid grows beyond ~20 cards or if Yonah specifically requests a glance-able dashboard.

### Section 5 — Show generation model on the video page

Carry `modelTier` into `VersionInfo` alongside the existing `resolutionLabel` ([video-versions-view.tsx:31](dashboard/src/components/video-versions-view.tsx#L31)). Display in two places:

- **Header metadata line** (under the bilingual title, alongside word count):
  *"Script A-tight · 104 words · 720p Fast"*
  When multiple versions exist, this reflects the **selected** version's tier.

- **Version chips** in the version selector: append the tier so chips read e.g. *"v2 · 1080p Standard"*. Important for comparing versions generated at different qualities.

The cost whisper line at page bottom (*"This video cost $X.XX to produce"*) stays as-is — model+tier answers *what was used*, cost answers *what it cost*.

## Implementation order

1. **Friendly error translator** (Section 3) — pure library, no UI dependencies.
2. **Model + tier display** (Section 5) — independent of failure UX, small wiring change.
3. **FailedCard** (Section 1) — depends on translator.
4. **VideoStatusBanner** (Section 2) — depends on translator; replaces buried failure surface in detail page.

Each step ships independently. Friendly translator + model display are low-risk; failed card and banner are the visible behavior change.

## Validation

After all four ship:

- Trigger a known failure (e.g., revert the motion-ref fix temporarily, run a generation with a motion ref on a non-first clip).
- Confirm the failed card on `/videos` shows the friendly error + Resume button.
- Click Resume; confirm `triggerGeneration` resumes in place (same `job_id`), Modal reuses prior plan + clips, and the run completes in ~30-60s.
- Click Open instead; confirm `/videos/<slug>` shows the hero banner with the same error.
- After success, confirm the header line shows the resolution + tier and cost whisper is unchanged.
- Confirm an in-flight regen on the same parsha still surfaces the existing `RegenInProgressBanner` correctly (no double-banner).
