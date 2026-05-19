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
 */
export function getPhase1Props(parsha: ShellParsha): Phase1Props | null {
  const scripts = parsha.scripts;
  const defaultScript =
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
