// dashboard/src/lib/rerender-confirm.ts
//
// A Phase 2 re-render is a paid Seedance call (~$3 for a 15s 720p clip),
// and it used to fire on a single tap of "↻ Re-render" with no prompt. On
// 2026-11-16 that produced an unintended clip 4 v2 that Yonah never meant
// to start. These helpers decide when to ask and what to say. Kept pure
// (no React, no Supabase) so it runs under node:test.

/** Ask before rendering only when the clip already has a version. The
 *  first render of a clip is the expected action and stays one tap. */
export function shouldConfirmRerender(existingVersionCount: number): boolean {
  return existingVersionCount > 0;
}

/** "Re-render clip 4? About $3.08, creates v3. Your current versions stay."
 *  clipIndex is 0-based. estimatedCostUsd null/invalid → "About $3". */
export function rerenderConfirmMessage(
  clipIndex: number,
  existingVersionCount: number,
  estimatedCostUsd: number | null | undefined,
): string {
  const cost =
    typeof estimatedCostUsd === 'number' && Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0
      ? `$${estimatedCostUsd.toFixed(2)}`
      : '$3';
  const nextVersion = existingVersionCount + 1;
  return `Re-render clip ${clipIndex + 1}? About ${cost}, creates v${nextVersion}. Your current versions stay.`;
}
