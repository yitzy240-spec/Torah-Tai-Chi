/** Estimated read time in minutes at ~200 words/min, minimum 1. */
export function wordsToReadMinutes(words: number): number {
  return Math.max(1, Math.round((words || 0) / 200));
}
