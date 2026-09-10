// dashboard/src/lib/seed-scripts.ts
//
// Decides which candidate scripts a seed run should write for one parsha.
//
// The rule is PER OPTION, and that detail is the whole point of this file
// existing. The first version of this logic asked "does this parsha have any
// script with real text?" and skipped the parsha entirely if so. That reads
// as a sensible do-no-harm guard, and it is — right up until a run is
// interrupted, or a parsha is half-seeded. Then the guard sees the text the
// seed itself just wrote and refuses to finish the job, leaving a parsha with
// option A and nothing else. That is exactly what happened seeding Ki Teitzei
// and Mishpatim on 2026-08-17: the A drafts landed, B, C and A-tight were
// silently skipped, and the empty A-tight placeholder stayed empty.
//
// Judging each option on its own is immune to that: a written option is left
// alone (so nobody's typing is ever overwritten), and every other option
// still gets filled, no matter what order things ran in or how many times.

export type ExistingScript = { option: string; draft_text: string | null };

export type CandidateScript = {
  option: string;
  title: string;
  style_note: string;
  draft: string;
};

/** A row counts as written once it holds non-whitespace text. A placeholder
 *  row (draft_text '', created by startFromEmpty) does not — filling it in is
 *  the job, not a conflict. */
function isWritten(script: ExistingScript): boolean {
  return (script.draft_text ?? '').trim().length > 0;
}

/**
 * Candidates that still need writing: every option whose existing row is
 * absent or empty. Returns them in the order given.
 *
 * Re-running with the same inputs after a successful pass returns [], so a
 * seed run is idempotent.
 */
export function scriptsToSeed(
  existing: ExistingScript[],
  candidates: CandidateScript[],
): CandidateScript[] {
  const written = new Set(existing.filter(isWritten).map((s) => s.option));
  return candidates.filter((c) => !written.has(c.option));
}
