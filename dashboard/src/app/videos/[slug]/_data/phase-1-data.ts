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
  };
}
