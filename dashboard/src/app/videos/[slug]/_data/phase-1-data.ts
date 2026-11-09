// dashboard/src/app/videos/[slug]/_data/phase-1-data.ts
//
// Data preparation for Phase 1 (Script editor).
// All data is already available from the shell (parsha.scripts) — no extra
// DB round-trips needed. This module just picks the default script.

import type { ShellParsha } from './shell-data';

type ScriptRow = ShellParsha['scripts'][number];

export type Phase1Props = {
  parshaSlug: string;
  parshaId: string;
  scripts: ScriptRow[];
  defaultScript: ScriptRow;
  scriptId: string;
  /** Script the current draft plan was built from (null = no plan yet). Lets
   *  the client know whether pressing Generate would start a NEW plan. */
  draftScriptId: string | null;
  /** How many of the current draft's clips are already rendered. Drives the
   *  "this will discard N clips" confirm before a regenerate. */
  renderedClipCount: number;
  /** full_script from the current draft plan (null if none). Lets Phase 1
   *  detect in-place edits of the same script_id so Generate regenerates. */
  planFullScript: string | null;
};

/**
 * Resolves Phase 1 props from shell data. Returns null when no script exists
 * yet (pipeline may still be generating the plan). Caller renders a "check
 * back in a moment" placeholder in that case.
 *
 * `draftScriptId` is the script the CURRENT draft plan was actually built from
 * (null before any plan exists). We default the editor's selected script to it,
 * because the "Generate clip plan" button carries the selected script id, and
 * page.tsx regenerates the plan whenever that id differs from the draft's. If
 * we defaulted to A-tight instead, an operator who built from a different
 * script (a "Write my own"/"From an idea"/alternate pick), went Back to Phase 1,
 * and pressed Generate would silently regenerate from the WRONG script and
 * orphan every clip already rendered. Defaulting to the draft's script makes
 * that round-trip a no-op unless the operator deliberately picks another script.
 */
export function getPhase1Props(
  parsha: ShellParsha,
  draftScriptId?: string | null,
  renderedClipCount = 0,
  planFullScript: string | null = null,
): Phase1Props | null {
  const scripts = parsha.scripts;
  const draftScript = draftScriptId
    ? scripts.find((s) => s.id === draftScriptId)
    : undefined;
  const defaultScript =
    draftScript ??
    scripts.find((s) => s.option === 'A-tight') ??
    scripts.find((s) => s.option === 'A') ??
    scripts[0] ??
    null;

  if (!defaultScript) return null;

  return {
    parshaSlug: parsha.slug,
    parshaId: parsha.id,
    scripts,
    defaultScript,
    scriptId: defaultScript.id,
    draftScriptId: draftScriptId ?? null,
    renderedClipCount,
    planFullScript,
  };
}

/**
 * Should pressing "Generate clip plan" warn the operator before it discards
 * work? True only when a new plan WOULD be started (see shouldStartNewPlan) AND
 * the current draft already has rendered clips to lose. The confirm is the
 * safety net so rendered clips never vanish silently — the root failure mode
 * behind the whole class of "Yonah lost his work" bugs.
 */
export function shouldConfirmDiscard(args: {
  draftScriptId: string | null;
  requestedScriptId: string;
  renderedClipCount: number;
  /** Same-script edit: draft_text no longer matches the plan's full_script. */
  scriptContentChanged?: boolean;
}): boolean {
  return (
    args.renderedClipCount > 0 &&
    shouldStartNewPlan({
      draftScriptId: args.draftScriptId,
      requestedScriptId: args.requestedScriptId,
      scriptContentChanged: args.scriptContentChanged,
    })
  );
}

/**
 * Collapse whitespace so incidental editor newlines don't look like a rewrite.
 */
export function normalizeScriptText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * True when the operator edited the script in place (same script_id) so the
 * current draft_text no longer matches the plan's stored full_script.
 * Missing either side → false (can't claim a content edit; id-gate still applies).
 */
export function scriptTextsDiffer(
  currentDraftText: string | null | undefined,
  planFullScript: string | null | undefined,
): boolean {
  const a = normalizeScriptText(currentDraftText ?? '');
  const b = normalizeScriptText(planFullScript ?? '');
  if (!a || !b) return false;
  return a !== b;
}

/**
 * Decide whether tapping "Generate clip plan" should START A NEW plan (which
 * discards/orphans the current draft's rendered clips) or REUSE the existing
 * plan. This is the exact gate that silently orphaned Yonah's rendered clips,
 * so it lives as its own tested function rather than an inline expression.
 *
 * - No existing plan (`draftScriptId == null`) → start one (first run).
 * - Existing plan built from a DIFFERENT script than the operator selected →
 *   they deliberately chose another script → regenerate.
 * - SAME script id, but draft_text differs from the plan's full_script →
 *   they edited the script in place and hit Generate again → regenerate
 *   (Yonah Toldot 2026-11-09: shortened script, Generate reused the old 6-clip plan).
 * - SAME script, same content → reuse. Combined with getPhase1Props defaulting
 *   Phase 1 to the draft's script, a Back-to-Phase-1 → Generate round-trip
 *   with no edits lands here and is a no-op — the fix's core invariant.
 *
 * `draftScriptId` is the script the current draft plan was built from (null when
 * no draft exists yet). `requestedScriptId` is the script id the Generate button
 * carried (getPhase1Props.scriptId).
 */
export function shouldStartNewPlan(args: {
  draftScriptId: string | null;
  requestedScriptId: string;
  scriptContentChanged?: boolean;
}): boolean {
  if (args.draftScriptId == null) return true;
  if (args.draftScriptId !== args.requestedScriptId) return true;
  return !!args.scriptContentChanged;
}

/**
 * How many clips of the draft plan are actually rendered — the number
 * shouldConfirmDiscard gates on, and the number the confirm sheet quotes.
 *
 * Has to span the plan's whole job tree, not just the plan-only root. A
 * plan's rendered clips are spread across jobs by design: plan_only_job
 * inserts the row set under the ROOT with storage_path NULL, then each
 * clips-only render "upserts the clip row so this job owns a full clips
 * set" — under ITS OWN job id (modal_app.py, clips_only_job). So the root's
 * rows can stay NULL forever while every clip is rendered.
 *
 * Counting only the root (what page.tsx did until 2026-10-04) therefore
 * returned 0 for the normal case — clips rendered from Phase 2 — so the
 * discard confirm never fired for exactly the drafts it exists to protect.
 * Yonah regenerated a plan over a finished Bereishit render and got no
 * warning at all.
 *
 * De-duplicated by clip index: re-rendering clip 3 twice creates a row
 * under each child job (that's what the Phase 2 version chips are), and
 * that's one rendered clip, not two.
 */
export function countRenderedClips(
  jobs: ReadonlyArray<{ id: string; regenOfJobId: string | null }>,
  clipsByJobId: Record<string, ReadonlyArray<{ index: number; storagePath: string | null }>>,
  rootJobId: string | null,
): number {
  if (!rootJobId) return 0;

  // Collect the root plus every job descending from it. Walking children
  // (rather than each job's ancestor chain) keeps this linear-ish and needs
  // no cycle guard beyond the visited set.
  const tree = new Set<string>([rootJobId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of jobs) {
      if (!tree.has(j.id) && j.regenOfJobId && tree.has(j.regenOfJobId)) {
        tree.add(j.id);
        grew = true;
      }
    }
  }

  const rendered = new Set<number>();
  for (const jobId of tree) {
    for (const c of clipsByJobId[jobId] ?? []) {
      if (c.storagePath) rendered.add(c.index);
    }
  }
  return rendered.size;
}
